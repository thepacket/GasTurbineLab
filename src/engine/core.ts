/**
 * Generic cycle evaluation.  The same station-by-station code serves the
 * design point (compressor PR/eff fixed, turbine PR solved for the shaft
 * balance) and off-design operation (PR/eff read from scaled maps, with
 * continuity / power / area residuals returned for an outer Newton solver).
 */
import { Gas, FUELS, warFromRH } from './gas';
import { isa } from './atmosphere';
import { Flow, staticFromMN, totalFromStatic, StaticState } from './flow';
import { compressor, turbineAtPR, turbineForPower, burnerToT, nozzle, mixer, TurbineStream, BurnerOut } from './components';
import { EngineInputs, EngineResult, Station, ComponentResult, Performance, ShaftResult } from './types';

export interface CompOp { PR: number; eff: number; residual?: number; extra?: Record<string, number> }
export interface TurbOp { PR: number; eff: number; residual?: number; extra?: Record<string, number> }

/** Supplies component operating points; design and off-design providers differ. */
export interface Provider {
  /** inlet mass flow, bypass ratio and shaft speeds for this evaluation */
  W: number; BPR: number;
  speeds: { LP: number; IP: number; HP: number; PT: number };
  compressor(id: string, inlet: Flow, N: number, design: { PR: number; eff: number }): CompOp;
  /** powerReq: power the turbine must supply (W); design provider solves PR, off-design reads PR from state */
  turbine(id: string, inlet: Flow, N: number, cooling: TurbineStream[], design: { eff: number }, powerReq: number, PRmax: number): TurbOp;
  /** combustion: target T4 (design) or fuel flow / FAR (off-design throttle) */
  burner(id: string, inlet: Flow, design: { T4: number; dPqP: number; eff: number; hFuel: number; LHV: number }): BurnerOut & { residual?: number };
  /** fixed nozzle throat area in off-design (undefined at design) */
  nozzleArea(id: string): number | undefined;
  /** fixed mixer areas in off-design */
  mixerAreas(): { Acore: number; Abyp: number } | undefined;
  residuals: Record<string, number>;
  /** effective variable geometry / bleed settings for this evaluation */
  geometry: EngineInputs['geometry'];
}

function station(id: string, name: string, f: Flow, st: StaticState, x: number, stream: Station['stream'] = 'core'): Station {
  const g = f.gas;
  return { id, name, Pt: f.Pt, Tt: f.Tt, ht: f.ht, s: g.s(f.Tt, f.Pt), W: f.W, FAR: g.far, Ps: st.Ps, Ts: st.Ts, V: st.V, MN: st.MN, A: st.A, gamma: g.gamma(f.Tt, f.Pt), cp: g.cp(f.Tt, f.Pt), R: g.Rlocal(f.Tt, f.Pt), x, stream };
}

/** Actuator-disc propeller: solve thrust from available power, free-stream speed and disc area. */
export function propellerThrust(Pavail: number, V0: number, rho: number, diameter: number): { T: number; vInduced: number; etaIdeal: number } {
  const A = (Math.PI * diameter * diameter) / 4;
  if (Pavail <= 0) return { T: 0, vInduced: 0, etaIdeal: 0 };
  const pOf = (T: number) => T * (V0 + 0.5 * (-V0 + Math.sqrt(V0 * V0 + (2 * T) / (rho * A))));
  let lo = 0, hi = 1;
  while (pOf(hi) < Pavail) hi *= 2;
  for (let i = 0; i < 100; i++) { const mid = 0.5 * (lo + hi); if (pOf(mid) < Pavail) lo = mid; else hi = mid; }
  const T = 0.5 * (lo + hi);
  const w = 0.5 * (-V0 + Math.sqrt(V0 * V0 + (2 * T) / (rho * A)));
  return { T, vInduced: w, etaIdeal: V0 > 0 ? V0 / (V0 + w) : 0 };
}

/** Design-point provider: fixed compressor PR/eff; turbine PR solved for the required power. */
export function designProvider(inp: EngineInputs): Provider {
  return {
    W: inp.flight.W_kgs, BPR: inp.BPR, speeds: inp.speeds, residuals: {}, geometry: inp.geometry,
    compressor: (_id, _inlet, _N, d) => ({ PR: d.PR, eff: d.eff }),
    turbine: (_id, inlet, _N, cooling, d, powerReq, PRmax) => {
      const t = turbineForPower(inlet, powerReq, d.eff, cooling, PRmax);
      return { PR: t.res.PR, eff: d.eff, extra: { satisfied: t.satisfied ? 1 : 0 } };
    },
    burner: (_id, inlet, d) => burnerToT(inlet, d.T4, d.dPqP, d.eff, d.hFuel, d.LHV),
    nozzleArea: () => undefined,
    mixerAreas: () => undefined,
  };
}

/**
 * Turbine cooling: effectiveness ε = (T_gas − T_metal)/(T_gas − T_coolant) with ε(m) = ε_max · m/(m + m½),
 * m½ = 3 % of core flow per cooled row.  Returns the per-row flow fraction needed for a target metal temperature,
 * or the metal temperature reached with a given fraction.  Creep life: a Larson–Miller-type rule of thumb,
 * 25 000 h at 1200 K halving every 20 K.
 */
const M_HALF = 0.03;
export function coolingModel(T4: number, T3: number, c: EngineInputs['cooling'], mFixedInlet: number) {
  const Tc = T3 + c.coolantTempRise_K;
  const epsOf = (m: number) => (c.effectivenessMax * m) / (m + M_HALF);
  let mRow: number, infeasible = false;
  if (c.mode === 'computed') {
    const epsReq = Math.max(0, (T4 - c.targetMetal_K) / Math.max(T4 - Tc, 1));
    if (epsReq >= 0.95 * c.effectivenessMax) { mRow = 0.25 / 1.6; infeasible = true; } else mRow = (M_HALF * epsReq) / (c.effectivenessMax - epsReq);
  } else mRow = mFixedInlet / 1.6;
  const eps = epsOf(mRow);
  const Tmetal = T4 - eps * (T4 - Tc);
  const life_h = 25000 * Math.pow(2, (1200 - Tmetal) / 20);
  return { inletFrac: 1.6 * mRow, exitFrac: 0.6 * mRow, metal_K: Tmetal, effectiveness: eps, life_h, infeasible, Tcoolant: Tc };
}

export function evaluate(inp: EngineInputs, prov: Provider): EngineResult {
  const warnings: string[] = [];
  const stations: Station[] = [];
  const components: ComponentResult[] = [];
  const shafts: ShaftResult[] = [];
  const R = prov.residuals;

  // ---- ambient / flight
  const amb = isa(inp.flight.altitude_m, inp.flight.dT_isa, !!inp.flight.altIsGeopotential);
  const fuel = FUELS[inp.fuel ?? 'jetA'];
  const war = warFromRH(inp.humidity?.relative ?? 0, amb.T, amb.P);
  const air = Gas.air(inp.chemistry ?? 'equilibrium', war, inp.fuel ?? 'jetA');
  const LHV = inp.fuel && inp.fuel !== 'jetA' ? fuel.LHV_Jkg : inp.LHV_Jkg;
  const hFuel = inp.fuel && inp.fuel !== 'jetA' ? fuel.h_Jkg : inp.burner.fuel_h_Jkg;
  const a0 = air.a(amb.T, amb.P);
  const V0 = inp.flight.mach * a0;
  const W0 = prov.W;
  const f0 = totalFromStatic(air, amb.T, amb.P, V0, W0);
  stations.push(station('0', 'Free stream', f0, { Ts: amb.T, Ps: amb.P, V: V0, MN: inp.flight.mach, A: V0 > 0 ? W0 / (amb.rho * V0) : Infinity, rho: amb.rho }, 0.0, 'ambient'));

  // ---- inlet
  const f2: Flow = { ...f0, Pt: f0.Pt * inp.inlet.ramRecovery };
  const st2 = staticFromMN(f2, inp.inlet.MN);
  const ramDrag = W0 * V0;
  components.push({ id: 'inlet', kind: 'inlet', name: 'Inlet', values: { ramRecovery: inp.inlet.ramRecovery, ramDrag_N: ramDrag, Pt_ratio: f2.Pt / amb.P } });

  const perf: Performance = {
    Fn: 0, Fg: 0, ramDrag, Fg_core: 0, Fg_byp: 0, TSFC_kg_Nh: 0, TSFC_mg_Ns: 0, Wfuel: 0, specificThrust: 0, OPR: 1, FAR: 0,
    thermalEff: 0, propulsiveEff: 0, overallEff: 0, V0, shaftPower_W: 0, propThrust: 0, jetThrust: 0, ESHP_W: 0, PSFC_kg_kWh: 0, heatRate_W: 0,
    installedFn: 0, inletDrag: 0, nacelleDrag: 0, afterbodyDrag: 0, installedTSFC_mg_Ns: 0,
    EI_NOx_g_kg: 0, EI_CO_g_kg: 0, NOx_g_s: 0, CO_g_s: 0, CO2_g_s: 0, jetNoise_dB: 0,
  };
  const geom = prov.geometry;
  const jets: { W: number; V: number; rho: number; A: number }[] = [];
  let T3 = 0, P3 = 0;
  let kineticPowerOut = 0;
  let Wfuel = 0;
  const PRavail = (Pt: number) => Pt / (amb.P * 1.02);
  const compValues = (id: string, name: string, op: CompOp, c: ReturnType<typeof compressor>) => {
    const v: Record<string, number> = { PR: op.PR, eff: op.eff, effPoly: c.effPoly, power_W: c.power, Tt_out: c.out.Tt, ...(op.extra ?? {}) };
    components.push({ id, kind: 'compressor', name, values: v });
  };
  const turbValues = (id: string, name: string, op: TurbOp, power: number, Tt: number) => {
    components.push({ id, kind: 'turbine', name, values: { PR: op.PR, eff: op.eff, power_W: power, Tt_out: Tt, ...(op.extra ?? {}) } });
    if (op.extra?.satisfied === 0) warnings.push(`${name} cannot supply the required shaft power at this operating point: raise T4 or reduce the load.`);
  };
  const burnerBlock = (id: string, name: string, b: BurnerOut, dPqP: number) => {
    components.push({ id, kind: 'burner', name, values: { FAR: b.FAR, Wfuel_kgs: b.Wfuel, dPqP, T4: b.out.Tt } });
  };
  const nozzleBlock = (id: string, name: string, f: Flow, type: 'CV' | 'CD', Cv: number, key: string) => {
    const n = nozzle(f, amb.P, type, Cv);
    components.push({ id, kind: 'nozzle', name, values: { PR: n.PR, choked: n.choked ? 1 : 0, Fg_N: n.Fg, [`V${key}`]: n.exit.V, [`A${key}_m2`]: n.exit.A, Ath_m2: n.throat.A, Cv } });
    const Ades = prov.nozzleArea(id);
    if (Ades !== undefined) R[id + '_area'] = n.throat.A / Ades - 1;
    kineticPowerOut += 0.5 * f.W * (n.Fg / f.W) ** 2;
    jets.push({ W: f.W, V: n.Fg / f.W, rho: n.exit.rho, A: n.exit.A });
    return n;
  };
  /** overboard handling bleed at a compressor exit (turbojet / turboprop): flow removed, work already spent */
  const dumpOverboard = (f: Flow, frac: number): Flow => (frac > 0 ? { ...f, W: f.W * (1 - frac) } : f);
  const hpx = inp.HPX_W;
  const coolFracs = (T3: number) => {
    const cm = coolingModel(inp.burner.T4_K, T3, inp.cooling, inp.coolInletFrac);
    return inp.cooling.mode === 'computed' ? { inlet: cm.inletFrac, exit: cm.exitFrac } : { inlet: inp.coolInletFrac, exit: inp.coolExitFrac };
  };
  const coolingBlock = (id: string, T4: number, T3: number, fracInlet: number) => {
    const cm = coolingModel(T4, T3, { ...inp.cooling, mode: 'fixed' }, fracInlet);
    const comp = components.find((c) => c.id === id)!;
    comp.values.coolingFrac = fracInlet + 0.6 * (fracInlet / 1.6);
    comp.values.metalTemp_K = cm.metal_K; comp.values.coolingEffectiveness = cm.effectiveness; comp.values.creepLife_h = cm.life_h; comp.values.coolantTemp_K = cm.Tcoolant;
    if (inp.cooling.mode === 'computed' && coolingModel(inp.burner.T4_K, T3, inp.cooling, fracInlet).infeasible) warnings.push(`${comp.name}: target metal temperature ${inp.cooling.targetMetal_K} K is not reachable with the cooling effectiveness available; cooling flow capped at 25 %.`);
    if (cm.metal_K > 1350) warnings.push(`${comp.name} metal temperature ${cm.metal_K.toFixed(0)} K is above typical single-crystal limits (~1350 K).`);
  };

  if (inp.arch === 'turbojet') {
    const N = prov.speeds.HP;
    stations.push(station('2', 'Compressor inlet', f2, st2, 0.17));
    const op = prov.compressor('comp', f2, N, inp.comp);
    const cf0 = compressor(f2, op.PR, op.eff); // exit temperature first, for the cooling model
    const cfr = coolFracs(cf0.out.Tt);
    const c = compressor(f2, op.PR, op.eff, [cfr.inlet, cfr.exit, Math.min(0.5, geom.customerBleed_kgs / f2.W)]);
    if (op.residual !== undefined) R.comp_flow = op.residual;
    const f3 = dumpOverboard(c.out, geom.handlingBleedFrac);
    stations.push(station('3', 'Compressor exit', f3, staticFromMN(f3, inp.comp.MN), 0.42));
    compValues('comp', 'Compressor', op, c);
    if (geom.customerBleed_kgs > 0 || geom.handlingBleedFrac > 0) components[components.length - 1].values.bleed_kgs = c.bleeds[2].W + c.out.W * geom.handlingBleedFrac;
    T3 = f3.Tt; P3 = f3.Pt;
    const b = prov.burner('burner', f3, { T4: inp.burner.T4_K, dPqP: inp.burner.dPqP, eff: inp.burner.eff, hFuel, LHV });
    if (b.residual !== undefined) R.burner = b.residual;
    Wfuel += b.Wfuel;
    stations.push(station('4', 'Turbine inlet', b.out, staticFromMN(b.out, inp.burner.MN), 0.56));
    burnerBlock('burner', 'Combustor', b, inp.burner.dPqP);
    const req = (c.power + hpx) / inp.mechEff;
    const coolingTJ: TurbineStream[] = [{ flow: c.bleeds[0], fracP: 1 }, { flow: c.bleeds[1], fracP: 0 }];
    const top = prov.turbine('turb', b.out, N, coolingTJ, inp.hpt, req, PRavail(b.out.Pt));
    const t = turbineAtPR(b.out, top.PR, top.eff, coolingTJ);
    if (top.residual !== undefined) R.turb_flow = top.residual;
    R.hp_power = (t.power * inp.mechEff - (c.power + hpx)) / Math.max(c.power, 1);
    stations.push(station('5', 'Turbine exit', t.out, staticFromMN(t.out, inp.hpt.MN), 0.68));
    turbValues('turb', 'Turbine', top, t.power, t.out.Tt);
    coolingBlock('turb', b.out.Tt, f3.Tt, cfr.inlet);
    shafts.push({ name: 'Shaft', powerIn_W: t.power * inp.mechEff, powerOut_W: c.power + hpx, turbinePR: top.PR, rpm: N });
    let fNoz = t.out;
    if (inp.afterburner.enabled) {
      const ab = burnerToT(t.out, inp.afterburner.T7_K, inp.afterburner.dPqP, inp.afterburner.eff, hFuel, LHV);
      Wfuel += ab.Wfuel; fNoz = ab.out;
      stations.push(station('7', 'Afterburner exit', ab.out, staticFromMN(ab.out, 0.3), 0.82));
      components.push({ id: 'ab', kind: 'afterburner', name: 'Afterburner', values: { FAR_add: ab.FAR, Wfuel_kgs: ab.Wfuel, T7: ab.out.Tt } });
      if (ab.out.gas.far > 0.062) warnings.push('Afterburner fuel/air ratio is near stoichiometric; the gas model is at its limit.');
    }
    const n = nozzleBlock('nozz', 'Nozzle', fNoz, inp.coreNozzle.type, inp.coreNozzle.Cv, '9');
    stations.push(station('9', 'Nozzle exit', fNoz, n.exit, 1.0));
    perf.Fg_core = n.Fg; perf.Fg = n.Fg; perf.OPR = c.out.Pt / f2.Pt; perf.FAR = fNoz.gas.far;
  } else if (inp.arch === 'turbofan') {
    const three = inp.spools === 3;
    const Nlp = prov.speeds.LP, Nip = prov.speeds.IP, Nhp = prov.speeds.HP;
    const Nfan = Nlp / inp.fanGear.ratio;
    stations.push(station('2', 'Fan inlet', f2, st2, 0.12));
    const fop = prov.compressor('fan', f2, Nfan, inp.fan);
    const fan = compressor(f2, fop.PR, fop.eff);
    if (fop.residual !== undefined) R.fan_flow = fop.residual;
    stations.push(station('21', 'Fan exit', fan.out, staticFromMN(fan.out, inp.fan.MN), 0.22));
    compValues('fan', 'Fan', fop, fan);
    if (inp.fanGear.ratio !== 1) components.push({ id: 'fangear', kind: 'gearbox', name: 'Fan drive gearbox', values: { ratio: inp.fanGear.ratio, eff: inp.fanGear.eff, fan_rpm: Nfan, lp_rpm: Nlp, loss_W: fan.power * (1 / inp.fanGear.eff - 1) } });
    const Wcore = W0 / (1 + prov.BPR), Wbyp = W0 - Wcore;
    const f22: Flow = { ...fan.out, W: Wcore };
    const f13: Flow = { ...fan.out, W: Wbyp };
    stations.push(station('22', 'Core inlet', f22, staticFromMN(f22, 0.4), 0.27));
    stations.push(station('13', 'Bypass inlet', f13, staticFromMN(f13, 0.45), 0.27, 'bypass'));
    components.push({ id: 'splitter', kind: 'splitter', name: 'Splitter', values: { BPR: prov.BPR, Wcore_kgs: Wcore, Wbyp_kgs: Wbyp } });
    // LP-side core compression: booster (2-spool) or IPC (3-spool)
    let f25: Flow, lpPower = 0, ipPower = 0;
    if (three) {
      const iop = prov.compressor('ipc', f22, Nip, inp.ipc);
      const ipc = compressor(f22, iop.PR, iop.eff);
      if (iop.residual !== undefined) R.ipc_flow = iop.residual;
      stations.push(station('25', 'IPC exit', ipc.out, staticFromMN(ipc.out, inp.ipc.MN), 0.36));
      compValues('ipc', 'IP compressor', iop, ipc);
      f25 = ipc.out; ipPower = ipc.power;
    } else {
      const lop = prov.compressor('lpc', f22, Nlp, inp.lpc);
      const lpc = compressor(f22, lop.PR, lop.eff);
      if (lop.residual !== undefined) R.lpc_flow = lop.residual;
      stations.push(station('25', 'Booster exit', lpc.out, staticFromMN(lpc.out, inp.lpc.MN), 0.36));
      compValues('lpc', 'LP compressor (booster)', lop, lpc);
      f25 = lpc.out; lpPower = lpc.power;
    }
    // handling bleed: part of the booster/IPC exit flow is dumped into the bypass duct
    const Whb = f25.W * geom.handlingBleedFrac;
    const f25c: Flow = Whb > 0 ? { ...f25, W: f25.W - Whb } : f25;
    const hop = prov.compressor('hpc', f25c, Nhp, inp.hpc);
    const hpc0 = compressor(f25c, hop.PR, hop.eff);
    const cfr = coolFracs(hpc0.out.Tt);
    const hpc = compressor(f25c, hop.PR, hop.eff, [cfr.inlet, cfr.exit, Math.min(0.3, geom.customerBleed_kgs / f25c.W)]);
    if (hop.residual !== undefined) R.hpc_flow = hop.residual;
    stations.push(station('3', 'HPC exit', hpc.out, staticFromMN(hpc.out, inp.hpc.MN), 0.50));
    compValues('hpc', 'HP compressor', hop, hpc);
    components[components.length - 1].values.Wbleed_kgs = hpc.bleeds[0].W + hpc.bleeds[1].W;
    if (hpc.bleeds[2].W > 0) components[components.length - 1].values.customerBleed_kgs = hpc.bleeds[2].W;
    if (Whb > 0) components[components.length - 1].values.handlingBleed_kgs = Whb;
    T3 = hpc.out.Tt; P3 = hpc.out.Pt;
    if (hpc.out.Tt > 950) warnings.push(`HPC exit temperature ${hpc.out.Tt.toFixed(0)} K exceeds typical material limits (~950 K).`);
    const b = prov.burner('burner', hpc.out, { T4: inp.burner.T4_K, dPqP: inp.burner.dPqP, eff: inp.burner.eff, hFuel, LHV });
    if (b.residual !== undefined) R.burner = b.residual;
    Wfuel += b.Wfuel;
    stations.push(station('4', 'HPT inlet', b.out, staticFromMN(b.out, inp.burner.MN), 0.59));
    burnerBlock('burner', 'Combustor', b, inp.burner.dPqP);
    const cooling: TurbineStream[] = [{ flow: hpc.bleeds[0], fracP: 1 }, { flow: hpc.bleeds[1], fracP: 0 }];
    const reqHP = (hpc.power + hpx) / inp.mechEff;
    const hop2 = prov.turbine('hpt', b.out, Nhp, cooling, inp.hpt, reqHP, PRavail(b.out.Pt) / (three ? 1.6 : 1.3));
    const hpt = turbineAtPR(b.out, hop2.PR, hop2.eff, cooling);
    if (hop2.residual !== undefined) R.hpt_flow = hop2.residual;
    R.hp_power = (hpt.power * inp.mechEff - (hpc.power + hpx)) / hpc.power;
    stations.push(station('45', 'HPT exit', hpt.out, staticFromMN(hpt.out, inp.hpt.MN), 0.66));
    turbValues('hpt', 'HP turbine', hop2, hpt.power, hpt.out.Tt);
    coolingBlock('hpt', b.out.Tt, hpc.out.Tt, cfr.inlet);
    shafts.push({ name: 'HP shaft', powerIn_W: hpt.power * inp.mechEff, powerOut_W: hpc.power + hpx, turbinePR: hop2.PR, rpm: Nhp });
    let fIn = hpt.out;
    if (three) {
      const reqIP = ipPower / inp.mechEff;
      const iop2 = prov.turbine('ipt', fIn, Nip, [], inp.ipt, reqIP, PRavail(fIn.Pt) / 1.4);
      const ipt = turbineAtPR(fIn, iop2.PR, iop2.eff, []);
      if (iop2.residual !== undefined) R.ipt_flow = iop2.residual;
      R.ip_power = (ipt.power * inp.mechEff - ipPower) / ipPower;
      stations.push(station('47', 'IPT exit', ipt.out, staticFromMN(ipt.out, inp.ipt.MN), 0.71));
      turbValues('ipt', 'IP turbine', iop2, ipt.power, ipt.out.Tt);
      shafts.push({ name: 'IP shaft', powerIn_W: ipt.power * inp.mechEff, powerOut_W: ipPower, turbinePR: iop2.PR, rpm: Nip });
      fIn = ipt.out;
    }
    const fanShaftPower = inp.fanGear.ratio !== 1 ? fan.power / inp.fanGear.eff : fan.power;
    const reqLP = (fanShaftPower + lpPower) / inp.mechEff;
    const lop2 = prov.turbine('lpt', fIn, Nlp, [], inp.lpt, reqLP, PRavail(fIn.Pt));
    const lpt = turbineAtPR(fIn, lop2.PR, lop2.eff, []);
    if (lop2.residual !== undefined) R.lpt_flow = lop2.residual;
    R.lp_power = (lpt.power * inp.mechEff - (fanShaftPower + lpPower)) / (fanShaftPower + lpPower);
    stations.push(station('5', 'LPT exit', lpt.out, staticFromMN(lpt.out, inp.lpt.MN), 0.76));
    turbValues('lpt', 'LP turbine', lop2, lpt.power, lpt.out.Tt);
    shafts.push({ name: 'LP shaft', powerIn_W: lpt.power * inp.mechEff, powerOut_W: fanShaftPower + lpPower, turbinePR: lop2.PR, rpm: Nlp, outputRpm: inp.fanGear.ratio !== 1 ? Nfan : undefined });
    let f17: Flow = { ...f13, Pt: f13.Pt * (1 - inp.bypDuct_dPqP) };
    if (Whb > 0) { // bleed air mixes into the bypass duct at bypass pressure
      const ht = (f17.W * f17.ht + Whb * f25.ht) / (f17.W + Whb);
      const Tt = f17.gas.TfromH(ht, f17.Pt, f17.Tt + 20);
      f17 = { gas: f17.gas, Pt: f17.Pt, Tt, ht, W: f17.W + Whb };
    }
    if (inp.mixed) {
      stations.push(station('17', 'Bypass duct exit', f17, staticFromMN(f17, 0.45), 0.72, 'bypass'));
      const areas = prov.mixerAreas();
      const m = mixer(lpt.out, f17, areas ? { Acore: areas.Acore, Abyp: areas.Abyp } : inp.mixer.designedStream === 'core' ? { MNbyp: inp.mixer.MNbyp ?? 0.45 } : { MNcore: inp.mixer.MNcore }, inp.mixer.dPqP);
      if (areas) R.mixer_ps = m.PsCore / m.PsByp - 1;
      components.push({ id: 'mixer', kind: 'mixer', name: 'Mixer', values: { MNcore: m.MNcore, MNbyp: m.MNbyp, MNmixed: m.MNout, Acore_m2: m.Acore, Abyp_m2: m.Abyp, Ps_core_Pa: m.PsCore, Ps_byp_Pa: m.PsByp, Pt_loss: m.PtLoss, Tt_out: m.out.Tt } });
      stations.push(station('6', 'Mixer exit', m.out, staticFromMN(m.out, m.MNout), 0.84));
      let fNoz = m.out;
      if (inp.afterburner.enabled) {
        const ab = burnerToT(m.out, inp.afterburner.T7_K, inp.afterburner.dPqP, inp.afterburner.eff, hFuel, LHV);
        Wfuel += ab.Wfuel; fNoz = ab.out;
        stations.push(station('7', 'Afterburner exit', ab.out, staticFromMN(ab.out, 0.3), 0.9));
        components.push({ id: 'ab', kind: 'afterburner', name: 'Afterburner', values: { FAR_add: ab.FAR, Wfuel_kgs: ab.Wfuel, T7: ab.out.Tt } });
      }
      const n = nozzleBlock('nozz', 'Mixed nozzle', fNoz, inp.coreNozzle.type, inp.coreNozzle.Cv, '9');
      stations.push(station('9', 'Nozzle exit', fNoz, n.exit, 1.0));
      perf.Fg_core = n.Fg; perf.Fg = n.Fg; perf.FAR = fNoz.gas.far;
    } else {
      const nC = nozzleBlock('core_nozz', 'Core nozzle', lpt.out, inp.coreNozzle.type, inp.coreNozzle.Cv, '9');
      stations.push(station('9', 'Core nozzle exit', lpt.out, nC.exit, 1.0));
      stations.push(station('17', 'Bypass duct exit', f17, staticFromMN(f17, 0.45), 0.62, 'bypass'));
      const nB = nozzleBlock('byp_nozz', 'Bypass nozzle', f17, inp.bypNozzle.type, inp.bypNozzle.Cv, '19');
      stations.push(station('19', 'Bypass nozzle exit', f17, nB.exit, 0.78, 'bypass'));
      perf.Fg_core = nC.Fg; perf.Fg_byp = nB.Fg; perf.Fg = nC.Fg + nB.Fg; perf.FAR = b.FAR;
    }
    perf.OPR = hpc.out.Pt / f2.Pt;
  } else {
    // turboprop: gas generator + free power turbine + gearbox + actuator-disc propeller
    const Nhp = prov.speeds.HP, Npt = prov.speeds.PT;
    stations.push(station('2', 'Compressor inlet', f2, st2, 0.30));
    const op = prov.compressor('comp', f2, Nhp, inp.comp);
    const cf0 = compressor(f2, op.PR, op.eff);
    const cfr = coolFracs(cf0.out.Tt);
    const c = compressor(f2, op.PR, op.eff, [cfr.inlet, cfr.exit, Math.min(0.5, geom.customerBleed_kgs / f2.W)]);
    if (op.residual !== undefined) R.comp_flow = op.residual;
    const f3 = dumpOverboard(c.out, geom.handlingBleedFrac);
    stations.push(station('3', 'Compressor exit', f3, staticFromMN(f3, inp.comp.MN), 0.50));
    compValues('comp', 'Compressor', op, c);
    T3 = f3.Tt; P3 = f3.Pt;
    const b = prov.burner('burner', f3, { T4: inp.burner.T4_K, dPqP: inp.burner.dPqP, eff: inp.burner.eff, hFuel, LHV });
    if (b.residual !== undefined) R.burner = b.residual;
    Wfuel += b.Wfuel;
    stations.push(station('4', 'Turbine inlet', b.out, staticFromMN(b.out, inp.burner.MN), 0.62));
    burnerBlock('burner', 'Combustor', b, inp.burner.dPqP);
    const req = (c.power + hpx) / inp.mechEff;
    const coolingTP: TurbineStream[] = [{ flow: c.bleeds[0], fracP: 1 }, { flow: c.bleeds[1], fracP: 0 }];
    const top = prov.turbine('turb', b.out, Nhp, coolingTP, inp.hpt, req, PRavail(b.out.Pt) / 1.2);
    const t = turbineAtPR(b.out, top.PR, top.eff, coolingTP);
    if (top.residual !== undefined) R.turb_flow = top.residual;
    R.hp_power = (t.power * inp.mechEff - (c.power + hpx)) / c.power;
    stations.push(station('45', 'Power turbine inlet', t.out, staticFromMN(t.out, inp.hpt.MN), 0.72));
    turbValues('turb', 'Gas-generator turbine', top, t.power, t.out.Tt);
    coolingBlock('turb', b.out.Tt, f3.Tt, cfr.inlet);
    shafts.push({ name: 'HP shaft', powerIn_W: t.power * inp.mechEff, powerOut_W: c.power + hpx, turbinePR: top.PR, rpm: Nhp });
    const reqPT = inp.prop.shaftPower_W / inp.mechEff;
    const pop = prov.turbine('pt', t.out, Npt, [], inp.lpt, reqPT, PRavail(t.out.Pt));
    const pt = turbineAtPR(t.out, pop.PR, pop.eff, []);
    if (pop.residual !== undefined) R.pt_flow = pop.residual;
    const shaftPower = pt.power * inp.mechEff;
    stations.push(station('5', 'Power turbine exit', pt.out, staticFromMN(pt.out, inp.lpt.MN), 0.84));
    turbValues('pt', 'Power turbine', pop, pt.power, pt.out.Tt);
    const propRpm = Npt / inp.prop.gearRatio;
    shafts.push({ name: 'Power shaft', powerIn_W: shaftPower, powerOut_W: shaftPower, turbinePR: pop.PR, rpm: Npt, outputRpm: propRpm });
    const n = nozzleBlock('nozz', 'Exhaust nozzle', pt.out, 'CV', inp.coreNozzle.Cv, '9');
    stations.push(station('9', 'Exhaust exit', pt.out, n.exit, 1.0));
    const Pgear = shaftPower * inp.prop.gearboxEff;
    components.push({ id: 'gearbox', kind: 'gearbox', name: 'Reduction gearbox', values: { ratio: inp.prop.gearRatio, eff: inp.prop.gearboxEff, input_rpm: Npt, prop_rpm: propRpm, loss_W: shaftPower - Pgear } });
    const Pavail = Pgear * inp.prop.propEff;
    const prop = propellerThrust(Pavail, V0, amb.rho, inp.prop.diameter_m);
    const tipSpeed = Math.sqrt((Math.PI * inp.prop.diameter_m * propRpm / 60) ** 2 + V0 * V0);
    components.push({ id: 'prop', kind: 'propeller', name: 'Propeller', values: { shaftPower_W: shaftPower, powerToAir_W: Pavail, thrust_N: prop.T, inducedVelocity_ms: prop.vInduced, etaIdeal: prop.etaIdeal, etaTotal: prop.etaIdeal * inp.prop.propEff * inp.prop.gearboxEff, diameter_m: inp.prop.diameter_m, rpm: propRpm, tipMach: tipSpeed / a0, discLoading_W_m2: Pavail / (Math.PI * inp.prop.diameter_m ** 2 / 4) } });
    if (tipSpeed / a0 > 0.92) warnings.push(`Propeller helical tip Mach ${(tipSpeed / a0).toFixed(2)}: compressibility losses not modelled above ~0.9.`);
    perf.Fg_core = n.Fg; perf.Fg = n.Fg;
    perf.shaftPower_W = shaftPower; perf.propThrust = prop.T; perf.jetThrust = n.Fg - ramDrag;
    perf.OPR = c.out.Pt / f2.Pt; perf.FAR = b.FAR;
    kineticPowerOut += Pavail;
    const etaP = Math.max(prop.etaIdeal * inp.prop.propEff, 0.5);
    perf.ESHP_W = shaftPower + (V0 > 0 ? (perf.jetThrust * V0) / etaP : perf.jetThrust / (2.5 * 4.44822 / 745.7));
    perf.PSFC_kg_kWh = (Wfuel * 3600) / (shaftPower / 1000);
  }

  // ---- performance
  perf.Wfuel = Wfuel;
  perf.Fn = perf.Fg - ramDrag + perf.propThrust;
  perf.TSFC_kg_Nh = perf.Fn > 0 ? (Wfuel * 3600) / perf.Fn : NaN;
  perf.TSFC_mg_Ns = perf.Fn > 0 ? (Wfuel * 1e6) / perf.Fn : NaN;
  perf.specificThrust = perf.Fn / W0;
  perf.heatRate_W = Wfuel * LHV;
  const kineticPowerIn = 0.5 * W0 * V0 * V0;
  perf.thermalEff = (kineticPowerOut - kineticPowerIn) / perf.heatRate_W;
  perf.propulsiveEff = V0 > 0 ? (perf.Fn * V0) / Math.max(kineticPowerOut - kineticPowerIn, 1e-9) : 0;
  perf.overallEff = V0 > 0 ? (perf.Fn * V0) / perf.heatRate_W : 0;
  if (perf.FAR > 0.9 * fuel.stoichFAR) warnings.push('Fuel/air ratio is close to stoichiometric.');

  // ---- installed performance (optional): additive inlet drag, nacelle friction, afterbody drag
  const q0 = 0.5 * amb.rho * V0 * V0;
  if (inp.installation.enabled) {
    const A2 = st2.A;
    const rTip = Math.sqrt(A2 / (Math.PI * (1 - 0.3 * 0.3)));
    const Ahl = A2 / inp.installation.captureRatioDesign; // highlight area sized at the design capture ratio
    const A0 = V0 > 0 ? W0 / (amb.rho * V0) : Ahl;
    const Dmax = 2.3 * rTip, L = (inp.arch === 'turbofan' ? 3.6 : 5.6) * rTip;
    perf.inletDrag = 0.4 * q0 * Math.max(Ahl - A0, 0); // ~60 % of additive drag recovered by lip suction
    perf.nacelleDrag = inp.installation.nacelleCf * 1.25 * q0 * Math.PI * Dmax * L;
    const A9 = jets.reduce((a, j) => a + j.A, 0);
    perf.afterbodyDrag = inp.installation.afterbodyCd * q0 * Math.max((Math.PI * Dmax * Dmax) / 4 - A9, 0);
  }
  perf.installedFn = perf.Fn - perf.inletDrag - perf.nacelleDrag - perf.afterbodyDrag;
  perf.installedTSFC_mg_Ns = perf.installedFn > 0 ? (Wfuel * 1e6) / perf.installedFn : NaN;

  // ---- emissions: P3–T3 correlations (approximate, conventional RQL-type combustor)
  const Wf = Wfuel;
  perf.EI_NOx_g_kg = 32 * Math.pow(P3 / 2965e3, 0.4) * Math.exp((T3 - 826) / 194);
  perf.EI_CO_g_kg = 0.4 + 40 * Math.exp(-(T3 - 450) / 110);
  perf.NOx_g_s = perf.EI_NOx_g_kg * Wf; perf.CO_g_s = perf.EI_CO_g_kg * Wf; perf.CO2_g_s = fuel.comp.C * 44.0095 * 1000 * Wf;
  if (inp.fuel === 'hydrogen') { perf.EI_CO_g_kg = 0; perf.CO_g_s = 0; }

  // ---- jet mixing noise (Lighthill V^8 scaling, SAE ARP 876 style constant), OASPL at 1 m
  let pw = 0;
  for (const j of jets) { if (j.V > V0 + 1) pw += Math.pow(j.rho / amb.rho, 2) * Math.pow((j.V - V0) / a0, 8) * j.A; }
  perf.jetNoise_dB = pw > 0 ? 141 + 10 * Math.log10(pw) : 0;
  return { inputs: inp, stations, components, perf, warnings, shafts };
}
