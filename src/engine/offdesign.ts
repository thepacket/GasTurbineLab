/**
 * Off-design operation: fixed geometry (nozzle throat and mixer areas), scaled
 * component maps, shaft speeds and bypass ratio floating.  A Newton solver with
 * finite-difference Jacobian drives continuity, power-balance and area
 * residuals to zero.
 */
import { EngineInputs, EngineResult } from './types';
import { evaluate, designProvider, Provider } from './core';
import { CompressorMap, TurbineMap, CompScalars, TurbScalars, correctedFlow, correctedSpeed, paramFlow, paramSpeed } from './maps';
import { burnerAtFAR, TurbineStream } from './components';
import { Flow } from './flow';

export type ThrottleMode = 'T4' | 'Wf' | 'NHP';
export interface OffDesignInputs {
  altitude_m: number; mach: number; dT_isa: number;
  throttle: { mode: ThrottleMode; value: number }; // T4 in K, Wf in kg/s, NHP as fraction of design
  HPX_W?: number;
  propPower_W?: number; // turboprop: power absorbed by the propeller (constant-speed governor)
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
}

const MAP_FOR: Record<string, string> = { fan: 'Fan', lpc: 'LPC', ipc: 'LPC', hpc: 'HPC', comp: 'HPC', hpt: 'HPT', ipt: 'LPT', lpt: 'LPT', turb: 'HPT', pt: 'LPT' };
/** station id feeding each component (main flow) */
const INLET_STATION = (inp: EngineInputs): Record<string, string> => ({
  fan: '2', lpc: '22', ipc: '22', hpc: '25', comp: '2', hpt: '4', ipt: '45', lpt: inp.spools === 3 ? '47' : '45', turb: '4', pt: '45',
});

export function makeDesignPoint(inp: EngineInputs): DesignPoint {
  const result = evaluate(inp, designProvider(inp));
  const st = (id: string) => result.stations.find((s) => s.id === id)!;
  const comps: Record<string, CompDes> = {}, turbs: Record<string, TurbDes> = {}, nozzleAreas: Record<string, number> = {}, mapNames: Record<string, string> = {};
  const inletOf = INLET_STATION(inp);
  const speedOf = (id: string) => (id === 'fan' ? inp.speeds.LP / inp.fanGear.ratio : id === 'lpc' || id === 'lpt' ? inp.speeds.LP : id === 'ipc' || id === 'ipt' ? inp.speeds.IP : id === 'pt' ? inp.speeds.PT : inp.speeds.HP);
  for (const c of result.components) {
    if (c.kind === 'compressor') {
      const s = st(inletOf[c.id]); const N = speedOf(c.id);
      const map = new CompressorMap(MAP_FOR[c.id]);
      const Nc = correctedSpeed(N, s.Tt), Wc = correctedFlow(s.W, s.Tt, s.Pt);
      comps[c.id] = { map, sc: map.scalars(Nc, c.values.PR, c.values.eff, Wc), NcDes: Nc, Ndes: N };
      mapNames[c.id] = map.name;
    } else if (c.kind === 'turbine') {
      const s = st(inletOf[c.id]); const N = speedOf(c.id);
      const map = new TurbineMap(MAP_FOR[c.id]);
      turbs[c.id] = { map, sc: map.scalars(paramSpeed(N, s.Tt), c.values.PR, c.values.eff, paramFlow(s.W, s.Tt, s.Pt)), PRdes: c.values.PR };
      mapNames[c.id] = map.name;
    } else if (c.kind === 'nozzle') nozzleAreas[c.id] = c.values.Ath_m2;
  }
  const mx = result.components.find((c) => c.kind === 'mixer');
  return { inputs: inp, result, comps, turbs, nozzleAreas, mixerAreas: mx ? { Acore: mx.values.Acore_m2, Abyp: mx.values.Abyp_m2 } : undefined, mapNames };
}

/** Names of the unknowns for an architecture. */
export function unknownNames(inp: EngineInputs): string[] {
  if (inp.arch === 'turbojet') return ['W', 'N_HP', 'FAR', 'Rl_comp', 'PR_turb'];
  if (inp.arch === 'turboprop') return ['W', 'N_HP', 'FAR', 'Rl_comp', 'PR_turb', 'PR_pt'];
  const u = ['W', 'BPR', 'N_LP', 'N_HP', 'FAR', 'Rl_fan', 'Rl_hpc', 'PR_hpt', 'PR_lpt'];
  if (inp.spools === 3) u.push('N_IP', 'Rl_ipc', 'PR_ipt'); else u.push('Rl_lpc');
  return u;
}

function offDesignProvider(dp: DesignPoint, od: OffDesignInputs, x: Record<string, number>): Provider {
  const inp = dp.inputs;
  const residuals: Record<string, number> = {};
  const speeds = { LP: x.N_LP ?? inp.speeds.LP, IP: x.N_IP ?? inp.speeds.IP, HP: x.N_HP, PT: inp.speeds.PT };
  return {
    W: x.W, BPR: x.BPR ?? inp.BPR, speeds, residuals,
    compressor: (id, inlet, N, _d) => {
      const c = dp.comps[id];
      const Nc = correctedSpeed(N, inlet.Tt);
      const [rlo, rhi] = c.map.RlineRange;
      const Rl = Math.min(rhi, Math.max(rlo, x['Rl_' + id]));
      const m = c.map.read(c.sc, Nc, Rl);
      const Wc = correctedFlow(inlet.W, inlet.Tt, inlet.Pt);
      const pen = (x['Rl_' + id] - Rl); // keep the solver inside the map
      return { PR: m.PR, eff: m.eff, residual: m.Wc / Wc - 1 + pen, extra: { Nc_pct: 100 * (Nc / c.NcDes), Rline: Rl, surgeMargin_pct: c.map.surgeMargin(c.sc, Nc, Rl), rpm: N } };
    },
    turbine: (id, inlet, N, _cooling: TurbineStream[], _d, _powerReq, _PRmax) => {
      const t = dp.turbs[id];
      const PR = Math.max(1.01, x['PR_' + id]);
      const m = t.map.read(t.sc, paramSpeed(N, inlet.Tt), PR);
      const Wp = paramFlow(inlet.W, inlet.Tt, inlet.Pt);
      return { PR, eff: m.eff, residual: m.Wp / Wp - 1, extra: { Np_pct: 100 * m.NpMap / t.map.d.defaults.NpMap, rpm: N } };
    },
    burner: (_id, inlet: Flow, d) => {
      const b = burnerAtFAR(inlet, x.FAR, d.dPqP, d.eff, d.hFuel, d.LHV);
      let residual = 0;
      if (od.throttle.mode === 'T4') residual = b.out.Tt / od.throttle.value - 1;
      else if (od.throttle.mode === 'Wf') residual = b.Wfuel / od.throttle.value - 1;
      else residual = x.N_HP / (od.throttle.value * inp.speeds.HP) - 1;
      return { ...b, residual };
    },
    nozzleArea: (id) => dp.nozzleAreas[id],
    mixerAreas: () => dp.mixerAreas,
  };
}

function withFlight(inp: EngineInputs, od: OffDesignInputs): EngineInputs {
  const i: EngineInputs = JSON.parse(JSON.stringify(inp));
  i.flight = { ...i.flight, altitude_m: od.altitude_m, mach: od.mach, dT_isa: od.dT_isa };
  if (od.HPX_W !== undefined) i.HPX_W = od.HPX_W;
  if (od.propPower_W !== undefined) i.prop.shaftPower_W = od.propPower_W;
  return i;
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

export interface OffDesignSolution { result: EngineResult; converged: boolean; iterations: number; norm: number; x: Record<string, number> }

function residualVector(inp: EngineInputs, dp: DesignPoint, od: OffDesignInputs, x: Record<string, number>): { r: number[]; names: string[]; result: EngineResult } {
  const prov = offDesignProvider(dp, od, x);
  const result = evaluate(inp, prov);
  const names = Object.keys(prov.residuals).sort();
  return { r: names.map((n) => prov.residuals[n]), names, result };
}

/** Solve the off-design point. Uses Newton with backtracking and, if needed, continuation in the throttle from the design value. */
export function solveOffDesign(dp: DesignPoint, od: OffDesignInputs, x0?: Record<string, number>): OffDesignSolution {
  const inp = withFlight(dp.inputs, od);
  const names = unknownNames(inp);
  let x = { ...(x0 ?? designUnknowns(dp)) };
  const scale: Record<string, number> = {}; for (const n of names) scale[n] = Math.abs(x[n]) || 1;

  const run = (target: OffDesignInputs, xs: Record<string, number>) => newton(inp, dp, target, xs, names, scale);
  let sol = run(od, x);
  if (!sol.converged) {
    // continuation from the design throttle setting
    const des = designThrottle(dp, od.throttle.mode);
    const steps = 6;
    let xs = designUnknowns(dp);
    for (let k = 1; k <= steps; k++) {
      const f = k / steps;
      const t = { ...od, throttle: { mode: od.throttle.mode, value: des + (od.throttle.value - des) * f }, altitude_m: dp.inputs.flight.altitude_m + (od.altitude_m - dp.inputs.flight.altitude_m) * f, mach: dp.inputs.flight.mach + (od.mach - dp.inputs.flight.mach) * f };
      const inpK = withFlight(dp.inputs, t);
      const s = newton(inpK, dp, t, xs, names, scale);
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
  return 1;
}

function newton(inp: EngineInputs, dp: DesignPoint, od: OffDesignInputs, x0: Record<string, number>, names: string[], scale: Record<string, number>): OffDesignSolution {
  let x = { ...x0 };
  const n = names.length;
  const evalR = (xx: Record<string, number>) => { try { return residualVector(inp, dp, od, xx); } catch { return null; } };
  let cur = evalR(x);
  if (!cur) return { result: dp.result, converged: false, iterations: 0, norm: Infinity, x };
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
      if (xn.W <= 0 || xn.FAR <= 0 || xn.N_HP <= 0 || (xn.BPR !== undefined && xn.BPR <= 0)) { lam *= 0.5; continue; }
      const rn = evalR(xn);
      if (rn) {
        const nn = Math.hypot(...rn.r);
        if (nn < norm || k === 9) { x = xn; cur = rn; norm = nn; accepted = true; break; }
      }
      lam *= 0.5;
    }
    if (!accepted) break;
  }
  const converged = norm < 1e-6;
  const result = cur.result;
  result.offDesign = { converged, iterations: it, residualNorm: norm, throttle: `${od.throttle.mode} ${od.throttle.value}`, x };
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
