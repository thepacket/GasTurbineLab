/**
 * Off-design operation: fixed geometry (nozzle throat and mixer areas), scaled
 * component maps, shaft speeds and bypass ratio floating.  A Newton solver with
 * finite-difference Jacobian drives continuity, power-balance and area
 * residuals to zero.
 */
import { EngineInputs, EngineResult } from './types';
import { evaluate, designProvider, Provider, SasAreas, orificeArea, coolingModel } from './core';
import { CompressorMap, TurbineMap, CompScalars, TurbScalars, correctedFlow, correctedSpeed, paramFlow, paramSpeed } from './maps';
import { burnerAtFAR, TurbineStream } from './components';
import { Flow } from './flow';
import { validateEngineInputs, validateOperatingPoint } from './inputValidation';

export type ThrottleMode = 'T4' | 'Wf' | 'NHP' | 'NLP' | 'Fn';
export interface OffDesignInputs {
  altitude_m: number; mach: number; dT_isa: number;
  throttle: { mode: ThrottleMode; value: number }; // T4 in K, Wf in kg/s, NHP as fraction of design
  HPX_W?: number;
  propPower_W?: number; // turboprop: power absorbed by the propeller (constant-speed governor)
  geometry?: Partial<EngineInputs['geometry']>; // variable geometry / bleed overrides
  installation?: boolean; // installed thrust in the Fn throttle target
  /** multiplicative deltas on component efficiency and flow (e.g. from tip-clearance changes): id -> {eff, Wc} */
  deltas?: Record<string, { eff?: number; Wc?: number }>;
  /** false = burner not lit (start-up before ignition): zero fuel and zero heat release whatever the throttle says */
  burnerLit?: boolean;
}
/** R-line band (map units) below the first tabulated R-line (stall side) over which the map is extrapolated linearly before the solver is clamped. */
export const RLINE_BAND_STALL = 1.0;
/** R-line band above the last tabulated R-line (choke side) over which the choke-side extension of the map is used before the solver is clamped. */
export const RLINE_BAND_CHOKE = 3.0;
/** Burner and duct pressure-loss fractions are held at their design value (pyCycle convention) down to this fraction of the
 *  design corrected flow and scale with dynamic head (corrected flow squared) below it, so that the sub-idle gas path has a
 *  physical through-flow solution. */
export const LOSS_CONST_ABOVE = 0.5;
/** smallest turbine expansion ratio the solver may ask for */
const TURB_PR_MIN = 1.001;
/** dummy value the fuel/air unknown is driven to while the burner is unlit (the burner itself runs at FAR = 0) */
const UNLIT_FAR = 1e-3;
export interface SolveOptions {
  /** transient mode: spool speeds are states, not unknowns; shaft power imbalance is reported instead */
  fixedSpeeds?: { LP: number; IP: number; HP: number };
}

interface CompDes { map: CompressorMap; sc: CompScalars; NcDes: number; Ndes: number }
interface TurbDes { map: TurbineMap; sc: TurbScalars; PRdes: number }
export interface DesignPoint {
  inputs: EngineInputs;
  result: EngineResult;
  comps: Record<string, CompDes>;
  turbs: Record<string, TurbDes>;
  nozzleAreas: Record<string, number>;
  mixerAreas?: { Acore: number; Abyp: number };
  mapNames: Record<string, string>;
  sasAreas?: SasAreas;
  designHptPR?: number;
}

export const MAP_FOR: Record<string, string> = { fan: 'Fan', lpc: 'LPC', ipc: 'LPC', hpc: 'HPC', comp: 'HPC', hpt: 'HPT', ipt: 'LPT', lpt: 'LPT', turb: 'HPT', pt: 'LPT' };
const mapFor = (inp: EngineInputs, id: string) => inp.mapIds?.[id] ?? MAP_FOR[id];
/** station id feeding each component (main flow) */
const INLET_STATION = (inp: EngineInputs): Record<string, string> => ({
  fan: '2', lpc: '22', ipc: '22', hpc: '25', comp: '2', hpt: '4', ipt: '45', lpt: inp.spools === 3 ? '47' : '45', turb: '4', pt: '45',
});

export function makeDesignPoint(inp: EngineInputs): DesignPoint {
  validateEngineInputs(inp);
  const result = evaluate(inp, designProvider(inp));
  const st = (id: string) => result.stations.find((s) => s.id === id)!;
  const comps: Record<string, CompDes> = {}, turbs: Record<string, TurbDes> = {}, nozzleAreas: Record<string, number> = {}, mapNames: Record<string, string> = {};
  const inletOf = INLET_STATION(inp);
  const speedOf = (id: string) => (id === 'fan' ? inp.speeds.LP / inp.fanGear.ratio : id === 'lpc' || id === 'lpt' ? inp.speeds.LP : id === 'ipc' || id === 'ipt' ? inp.speeds.IP : id === 'pt' ? inp.speeds.PT : inp.speeds.HP);
  for (const c of result.components) {
    if (c.kind === 'compressor') {
      const s = st(inletOf[c.id]); const N = speedOf(c.id);
      const map = new CompressorMap(mapFor(inp, c.id));
      const Nc = correctedSpeed(N, s.Tt), Wc = correctedFlow(s.W, s.Tt, s.Pt);
      comps[c.id] = { map, sc: map.scalars(Nc, c.values.PR, c.values.eff, Wc), NcDes: Nc, Ndes: N };
      mapNames[c.id] = map.name;
    } else if (c.kind === 'turbine') {
      const s = st(inletOf[c.id]); const N = speedOf(c.id);
      const map = new TurbineMap(mapFor(inp, c.id));
      turbs[c.id] = { map, sc: map.scalars(paramSpeed(N, s.Tt), c.values.PR, c.values.eff, paramFlow(s.W, s.Tt, s.Pt)), PRdes: c.values.PR };
      mapNames[c.id] = map.name;
    } else if (c.kind === 'nozzle') nozzleAreas[c.id] = c.values.Ath_m2;
  }
  const mx = result.components.find((c) => c.kind === 'mixer');
  // secondary air system: size orifices to pass the design cooling / customer / leak flows at design pressures
  let sasAreas: SasAreas | undefined, designHptPR: number | undefined;
  if (inp.arch === 'turbofan' && inp.sas?.enabled) {
    const hpc = result.components.find((c) => c.id === 'hpc')!, hpt = result.components.find((c) => c.id === 'hpt')!;
    const s3 = st('3'), s25 = st('25'), s4 = st('4');
    const W25 = s25.W, P3 = s3.Pt, T3 = s3.Tt, P4 = s4.Pt, P45 = P4 / hpt.values.PR;
    const cm = inp.cooling.mode === 'computed' ? coolingModel(inp.burner.T4_K, T3, inp.cooling, inp.coolInletFrac) : null;
    const fin = cm ? cm.inletFrac : inp.coolInletFrac, fex = cm ? cm.exitFrac : inp.coolExitFrac;
    void hpc;
    const wIn = Math.max(fin * W25, 1e-6), wEx = Math.max(fex * W25, 1e-6), wCu = Math.max(inp.geometry.customerBleed_kgs, 1e-6), wLk = Math.max(inp.sas.leakFrac * W25, 1e-6);
    const Pfeed = s25.Pt * inp.sas.interstageFrac + (1 - inp.sas.interstageFrac) * P3, Pcav = P45 * inp.sas.cavityPressureFrac;
    sasAreas = { coolInlet: orificeArea(wIn, P3, T3, P4 * 0.97), coolExit: orificeArea(wEx, P3, T3, P45), customer: orificeArea(wCu, P3, T3, Math.min(P3 * 0.5, 4e5)), leak: orificeArea(wLk, P3, T3, 101325), interstageSeal: orificeArea(0.01 * W25, Math.max(Pfeed, Pcav * 1.05), s25.Tt, Pcav) };
    designHptPR = hpt.values.PR;
  }
  return { inputs: inp, result, comps, turbs, nozzleAreas, mixerAreas: mx ? { Acore: mx.values.Acore_m2, Abyp: mx.values.Abyp_m2 } : undefined, mapNames, sasAreas, designHptPR };
}

/** Names of the unknowns for an architecture. */
export function unknownNames(inp: EngineInputs): string[] {
  if (inp.arch === 'turbojet') return ['W', 'N_HP', 'FAR', 'Rl_comp', 'PR_turb'];
  if (inp.arch === 'turboprop') return ['W', 'N_HP', 'FAR', 'Rl_comp', 'PR_turb', 'PR_pt'];
  const u = ['W', 'BPR', 'N_LP', 'N_HP', 'FAR', 'Rl_fan', 'Rl_hpc', 'PR_hpt', 'PR_lpt'];
  if (inp.spools === 3) u.push('N_IP', 'Rl_ipc', 'PR_ipt'); else u.push('Rl_lpc');
  return u;
}

/** Provider plus the physical flow-matching error of every compressor, kept apart from the R-line penalty. */
type OdProvider = Provider & { flowErr: Record<string, number> };
function offDesignProvider(dp: DesignPoint, od: OffDesignInputs, x: Record<string, number>, opt: SolveOptions = {}): OdProvider {
  const inp = dp.inputs;
  const residuals: Record<string, number> = {};
  const flowErr: Record<string, number> = {};
  const fs = opt.fixedSpeeds;
  const speeds = fs ? { ...fs, PT: inp.speeds.PT } : { LP: x.N_LP ?? inp.speeds.LP, IP: x.N_IP ?? inp.speeds.IP, HP: x.N_HP, PT: inp.speeds.PT };
  const geometry = { ...inp.geometry, ...(od.geometry ?? {}) };
  return {
    W: x.W, BPR: x.BPR ?? inp.BPR, speeds, residuals, flowErr, geometry, sasAreas: dp.sasAreas, designHptPR: dp.designHptPR,
    compressor: (id, inlet, N, _d) => {
      const c = dp.comps[id];
      const Nc = correctedSpeed(N, inlet.Tt);
      // The map is read at the solver's R-line: linearly extrapolated up to RLINE_BAND_STALL below the tabulated range
      // (past the stall line: negative surge margin) and on the choke-side extension up to RLINE_BAND_CHOKE above it;
      // both are flagged offMap.  Beyond the bands the R-line is clamped and a penalty steers the solver back; the
      // physical flow-matching error is recorded separately in flowErr so that the penalty can never cancel it and
      // fake convergence.
      const [rlo, rhi] = c.map.RlineRange;
      const RlRaw = x['Rl_' + id];
      const Rl = Math.min(rhi + RLINE_BAND_CHOKE, Math.max(rlo - RLINE_BAND_STALL, RlRaw));
      const m = c.map.read(c.sc, Nc, Rl);
      const d = od.deltas?.[id];
      const vsv = ((id === 'fan' || id === 'hpc' || id === 'comp') ? 1 + geometry.vsvFlowGain * (Nc / c.NcDes - 1) : 1) * (d?.Wc ?? 1);
      const Wc = correctedFlow(inlet.W, inlet.Tt, inlet.Pt);
      const flow = (m.Wc * vsv) / Wc - 1;
      const pen = RlRaw - Rl;
      flowErr[id] = flow;
      const offMap = Rl < rlo || Rl > rhi ? 1 : 0;
      return { PR: m.PR, eff: m.eff * (d?.eff ?? 1), residual: flow + pen, extra: { Nc_pct: 100 * (Nc / c.NcDes), Rline: Rl, offMap, surgeMargin_pct: c.map.surgeMargin(c.sc, Nc, Rl), rpm: N, Wc, WcMap: m.Wc * vsv, effDelta: (d?.eff ?? 1) - 1 } };
    },
    turbine: (id, inlet, N, _cooling: TurbineStream[], _d, _powerReq, _PRmax) => {
      const t = dp.turbs[id];
      const PRraw = x['PR_' + id];
      const PR = Math.max(TURB_PR_MIN, PRraw);
      const m = t.map.read(t.sc, paramSpeed(N, inlet.Tt), PR);
      const d = od.deltas?.[id];
      const Wp = paramFlow(inlet.W, inlet.Tt, inlet.Pt);
      // as for the compressors: the flow-matching error is tracked apart from the floor penalty
      const flow = (m.Wp * (d?.Wc ?? 1)) / Wp - 1;
      flowErr[id] = flow;
      return { PR, eff: m.eff * (d?.eff ?? 1), residual: flow + (PRraw - PR), extra: { Np_pct: 100 * m.NpMap / t.map.d.defaults.NpMap, rpm: N, WpMap: m.Wp * (d?.Wc ?? 1), Wp, effDelta: (d?.eff ?? 1) - 1 } };
    },
    lossScale: (sid, f) => {
      const s = dp.result.stations.find((q) => q.id === sid);
      if (!s) return 1;
      const r = correctedFlow(f.W, f.Tt, f.Pt) / correctedFlow(s.W, s.Tt, s.Pt) / LOSS_CONST_ABOVE;
      return r >= 1 ? 1 : r * r;
    },
    burner: (_id, inlet: Flow, d) => {
      if (od.burnerLit === false) {
        // unlit: no fuel and no heat release; the FAR unknown is parked at a dummy value so the system stays square
        const b0 = burnerAtFAR(inlet, 0, d.dPqP, d.eff, d.hFuel, d.LHV);
        return { ...b0, residual: x.FAR / UNLIT_FAR - 1 };
      }
      const b = burnerAtFAR(inlet, x.FAR, d.dPqP, d.eff, d.hFuel, d.LHV);
      let residual = 0;
      if (od.throttle.mode === 'T4') residual = b.out.Tt / od.throttle.value - 1;
      else if (od.throttle.mode === 'Wf') residual = b.Wfuel / od.throttle.value - 1;
      else if (od.throttle.mode === 'NHP') residual = (fs ? fs.HP : x.N_HP) / (od.throttle.value * inp.speeds.HP) - 1;
      else if (od.throttle.mode === 'NLP') residual = (fs ? fs.LP : (x.N_LP ?? inp.speeds.LP)) / (od.throttle.value * inp.speeds.LP) - 1;
      else residual = 0; // 'Fn': closed after evaluation (needs the thrust)
      return { ...b, residual };
    },
    nozzleArea: (id) => { const a = dp.nozzleAreas[id]; return a === undefined ? undefined : a * (id === 'nozz' || id === 'core_nozz' ? geometry.A8scale : 1); },
    mixerAreas: () => dp.mixerAreas,
  };
}

function withFlight(inp: EngineInputs, od: OffDesignInputs): EngineInputs {
  const i: EngineInputs = JSON.parse(JSON.stringify(inp));
  i.flight = { ...i.flight, altitude_m: od.altitude_m, mach: od.mach, dT_isa: od.dT_isa };
  if (od.HPX_W !== undefined) i.HPX_W = od.HPX_W;
  if (od.propPower_W !== undefined) i.prop.shaftPower_W = od.propPower_W;
  if (od.installation !== undefined) i.installation = { ...i.installation, enabled: od.installation };
  if (od.burnerLit === false) i.afterburner = { ...i.afterburner, enabled: false };
  return i;
}
/** Unknowns and residual names actually used, given the solve options. */
function activeNames(inp: EngineInputs, opt: SolveOptions): string[] {
  const names = unknownNames(inp);
  return opt.fixedSpeeds ? names.filter((n) => !n.startsWith('N_')) : names;
}

export function designUnknowns(dp: DesignPoint): Record<string, number> {
  const inp = dp.inputs, r = dp.result;
  const x: Record<string, number> = { W: inp.flight.W_kgs, N_HP: inp.speeds.HP, FAR: r.components.find((c) => c.id === 'burner')!.values.FAR };
  for (const n of unknownNames(inp)) {
    if (n === 'BPR') x.BPR = inp.BPR;
    else if (n === 'N_LP') x.N_LP = inp.speeds.LP;
    else if (n === 'N_IP') x.N_IP = inp.speeds.IP;
    else if (n.startsWith('Rl_')) x[n] = dp.comps[n.slice(3)].map.RlineDes;
    else if (n.startsWith('PR_')) x[n] = dp.turbs[n.slice(3)].PRdes;
  }
  return x;
}

export function debugResiduals(dp: DesignPoint, od: OffDesignInputs, x: Record<string, number>) { const inp = withFlight(dp.inputs, od); const prov = offDesignProvider(dp, od, x, {}); const result = evaluate(inp, prov); return { residuals: prov.residuals, stations: result.stations.map((s) => ({ id: s.id, Pt: s.Pt, Tt: s.Tt, W: s.W, MN: s.MN })), comps: result.components.map((c) => ({ id: c.id, ...c.values })) }; }

export interface OffDesignSolution { result: EngineResult; converged: boolean; iterations: number; norm: number; x: Record<string, number> }

function residualVector(inp: EngineInputs, dp: DesignPoint, od: OffDesignInputs, x: Record<string, number>, opt: SolveOptions): { r: number[]; names: string[]; result: EngineResult; flowErr: Record<string, number> } {
  const prov = offDesignProvider(dp, od, x, opt);
  const result = evaluate(inp, prov);
  if (od.throttle.mode === 'Fn') prov.residuals.burner = (od.installation ? result.perf.installedFn : result.perf.Fn) / od.throttle.value - 1;
  if (opt.fixedSpeeds) {
    // speeds are states: the power residuals become the reported imbalance
    const imb: Record<string, number> = {};
    for (const sh of result.shafts) imb[sh.name] = sh.powerIn_W - sh.powerOut_W;
    for (const k of Object.keys(prov.residuals)) if (k.endsWith('_power')) delete prov.residuals[k];
    result.offDesign = { converged: false, iterations: 0, residualNorm: 0, throttle: '', x, shaftImbalance_W: imb };
  }
  const names = Object.keys(prov.residuals).sort();
  return { r: names.map((n) => prov.residuals[n]), names, result, flowErr: prov.flowErr };
}

/** Solve the off-design point. Uses Newton with backtracking and, if needed, continuation in the throttle from the design value. */
export function solveOffDesign(dp: DesignPoint, od: OffDesignInputs, x0?: Record<string, number>, opt: SolveOptions = {}): OffDesignSolution {
  validateOperatingPoint(od);
  const inp = withFlight(dp.inputs, od);
  const names = activeNames(inp, opt);
  let x = { ...(x0 ?? designUnknowns(dp)) };
  const scale: Record<string, number> = {}; for (const n of names) scale[n] = Math.abs(x[n]) || 1;

  const run = (target: OffDesignInputs, xs: Record<string, number>) => newton(inp, dp, target, xs, names, scale, opt);
  let sol = run(od, x);
  if (!sol.converged && x0 && !opt.fixedSpeeds) {
    // a warm start can sit on a map edge; retry from the design point before continuation
    const s2 = run(od, designUnknowns(dp));
    if (s2.converged || s2.norm < sol.norm) sol = s2;
  }
  if (!sol.converged && !opt.fixedSpeeds) {
    // continuation from the design throttle setting
    const des = designThrottle(dp, od.throttle.mode);
    const steps = 6;
    let xs = designUnknowns(dp);
    for (let k = 1; k <= steps; k++) {
      const f = k / steps;
      const t = { ...od, throttle: { mode: od.throttle.mode, value: des + (od.throttle.value - des) * f }, altitude_m: dp.inputs.flight.altitude_m + (od.altitude_m - dp.inputs.flight.altitude_m) * f, mach: dp.inputs.flight.mach + (od.mach - dp.inputs.flight.mach) * f };
      const inpK = withFlight(dp.inputs, t);
      const s = newton(inpK, dp, t, xs, names, scale, opt);
      if (!s.converged) break;
      xs = s.x;
      if (k === steps) sol = s;
    }
  }
  return sol;
}

export function designThrottle(dp: DesignPoint, mode: ThrottleMode): number {
  if (mode === 'T4') return dp.inputs.burner.T4_K;
  if (mode === 'Wf') return dp.result.components.find((c) => c.id === 'burner')!.values.Wfuel_kgs;
  if (mode === 'Fn') return dp.result.perf.Fn;
  return 1;
}

function newton(inp: EngineInputs, dp: DesignPoint, od: OffDesignInputs, x0: Record<string, number>, names: string[], scale: Record<string, number>, opt: SolveOptions = {}): OffDesignSolution {
  let x = { ...x0 };
  const n = names.length;
  const evalR = (xx: Record<string, number>) => { try { return residualVector(inp, dp, od, xx, opt); } catch { return null; } };
  let cur = evalR(x);
  if (!cur || !cur.r.every(Number.isFinite)) return { result: dp.result, converged: false, iterations: 0, norm: Infinity, x };
  let norm = Math.hypot(...cur.r);
  let it = 0;
  for (; it < 40 && norm > 1e-9; it++) {
    if (cur.r.length !== n) throw new Error(`off-design system is not square: ${cur.r.length} residuals (${cur.names.join(', ')}) for ${n} unknowns (${names.join(', ')})`);
    // finite-difference Jacobian
    const J: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const h = 1e-5 * scale[names[j]];
      const xp = { ...x, [names[j]]: x[names[j]] + h };
      const rp = evalR(xp);
      if (!rp) { for (let i = 0; i < n; i++) J[i][j] = 0; continue; }
      for (let i = 0; i < n; i++) J[i][j] = (rp.r[i] - cur.r[i]) / h;
    }
    const dx = solveLinear(J, cur.r.map((v) => -v));
    // backtracking line search with step limits
    let lam = 1;
    for (let j = 0; j < n; j++) {
      const rel = Math.abs(dx[j]) / scale[names[j]];
      if (rel > 0.5) lam = Math.min(lam, 0.5 / rel);
    }
    let accepted = false;
    for (let k = 0; k < 10; k++) {
      const xn: Record<string, number> = { ...x };
      for (let j = 0; j < n; j++) xn[names[j]] = x[names[j]] + lam * dx[j];
      if (xn.W <= 0 || xn.FAR <= 0 || (xn.N_HP !== undefined && xn.N_HP <= 0) || (xn.BPR !== undefined && xn.BPR <= 0)) { lam *= 0.5; continue; }
      const rn = evalR(xn);
      if (rn && rn.r.every(Number.isFinite)) {
        const nn = Math.hypot(...rn.r);
        if (nn < norm || k === 9) { x = xn; cur = rn; norm = nn; accepted = true; break; }
      }
      lam *= 0.5;
    }
    if (!accepted) break;
    if ((globalThis as any).__OD_TRACE) console.log('  it', it, 'norm', norm.toExponential(2), 'lam', lam.toFixed(3), JSON.stringify(Object.fromEntries(Object.entries(x).map(([k, v]) => [k, +v.toPrecision(5)]))));
  }
  // convergence needs the physical flow match of every compressor, not just the penalised residual vector
  const flowMismatch = Math.max(0, ...Object.values(cur.flowErr).map(Math.abs));
  const result = cur.result;
  const subAmbient = result.components.some((c) => c.kind === 'nozzle' && c.values.subAmbient);
  const converged = norm < 1e-6 && flowMismatch < 1e-6 && !subAmbient;
  const mapViolations = result.components.filter((c) => (c.kind === 'compressor' && c.values.offMap) || (c.kind === 'nozzle' && c.values.subAmbient)).map((c) => c.id);
  result.offDesign = { ...(result.offDesign ?? {}), converged, iterations: it, residualNorm: norm, flowMismatch, mapViolations, throttle: `${od.throttle.mode} ${od.throttle.value}`, x };
  return { result, converged, iterations: it, norm, x };
}

function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length; const M = A.map((r) => r.slice()); const r = b.slice();
  for (let c = 0; c < n; c++) {
    let p = c; for (let i = c + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    [M[c], M[p]] = [M[p], M[c]]; [r[c], r[p]] = [r[p], r[c]];
    const d = M[c][c] || 1e-300;
    for (let i = c + 1; i < n; i++) { const f = M[i][c] / d; if (!f) continue; for (let j = c; j < n; j++) M[i][j] -= f * M[c][j]; r[i] -= f * r[c]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = r[i]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / (M[i][i] || 1e-300); }
  return x;
}
