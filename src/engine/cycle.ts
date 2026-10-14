import { Gas } from './gas';
import { isa } from './atmosphere';
import { Flow, staticFromMN, totalFromStatic, StaticState } from './flow';
import { compressor, turbineForPower, burnerToT, nozzle, TurbineStream } from './components';
import { EngineInputs, EngineResult, Station, ComponentResult, Performance } from './types';

function station(id: string, name: string, f: Flow, st: StaticState, x: number, stream: Station['stream'] = 'core'): Station {
  const g = f.gas;
  return {
    id, name, Pt: f.Pt, Tt: f.Tt, ht: f.ht, s: g.s(f.Tt, f.Pt), W: f.W, FAR: g.far,
    Ps: st.Ps, Ts: st.Ts, V: st.V, MN: st.MN, A: st.A, gamma: g.gamma(f.Tt), cp: g.cp(f.Tt), R: g.R, x, stream,
  };
}

/** Actuator-disc propeller: solve thrust from available power, free-stream speed and disc area. */
export function propellerThrust(Pavail: number, V0: number, rho: number, diameter: number): { T: number; vInduced: number; etaIdeal: number } {
  const A = (Math.PI * diameter * diameter) / 4;
  if (Pavail <= 0) return { T: 0, vInduced: 0, etaIdeal: 0 };
  // P = T * (V0 + w),  w = 0.5*(-V0 + sqrt(V0^2 + 2T/(rho A)))
  const pOf = (T: number) => T * (V0 + 0.5 * (-V0 + Math.sqrt(V0 * V0 + (2 * T) / (rho * A))));
  let lo = 0, hi = 1;
  while (pOf(hi) < Pavail) hi *= 2;
  for (let i = 0; i < 100; i++) {
    const mid = 0.5 * (lo + hi);
    if (pOf(mid) < Pavail) lo = mid; else hi = mid;
  }
  const T = 0.5 * (lo + hi);
  const w = 0.5 * (-V0 + Math.sqrt(V0 * V0 + (2 * T) / (rho * A)));
  return { T, vInduced: w, etaIdeal: V0 > 0 ? V0 / (V0 + w) : 0 };
}

export function solveEngine(inp: EngineInputs): EngineResult {
  const warnings: string[] = [];
  const stations: Station[] = [];
  const components: ComponentResult[] = [];
  const shafts: EngineResult['shafts'] = [];

  // ---- ambient / flight
  const amb = isa(inp.flight.altitude_m, inp.flight.dT_isa, !!inp.flight.altIsGeopotential);
  const air = Gas.air();
  const a0 = air.a(amb.T);
  const V0 = inp.flight.mach * a0;
  const W0 = inp.flight.W_kgs;
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
  };
  let kineticPowerOut = 0; // sum 0.5 W V^2 at exits (actual velocities)
  let Wfuel = 0;
  let maxTurbinePRavail = (Pt: number) => Pt / (amb.P * 1.02);

  if (inp.arch === 'turbojet') {
    stations.push(station('2', 'Compressor inlet', f2, st2, 0.17));
    const c = compressor(f2, inp.comp.PR, inp.comp.eff);
    const st3 = staticFromMN(c.out, inp.comp.MN);
    stations.push(station('3', 'Compressor exit', c.out, st3, 0.42));
    components.push({ id: 'comp', kind: 'compressor', name: 'Compressor', values: { PR: inp.comp.PR, eff: inp.comp.eff, effPoly: c.effPoly, power_W: c.power, Tt_out: c.out.Tt } });
    const b = burnerToT(c.out, inp.burner.T4_K, inp.burner.dPqP, inp.burner.eff, inp.burner.fuel_h_Jkg, inp.LHV_Jkg);
    Wfuel += b.Wfuel;
    stations.push(station('4', 'Turbine inlet', b.out, staticFromMN(b.out, inp.burner.MN), 0.56));
    components.push({ id: 'burner', kind: 'burner', name: 'Combustor', values: { FAR: b.FAR, Wfuel_kgs: b.Wfuel, dPqP: inp.burner.dPqP, T4: b.out.Tt } });
    const req = (c.power + inp.HPX_W) / inp.mechEff;
    const t = turbineForPower(b.out, req, inp.hpt.eff, [], maxTurbinePRavail(b.out.Pt));
    if (!t.satisfied) warnings.push('Turbine cannot supply the compressor power: raise T4, lower compressor PR or power extraction.');
    stations.push(station('5', 'Turbine exit', t.res.out, staticFromMN(t.res.out, inp.hpt.MN), 0.68));
    components.push({ id: 'turb', kind: 'turbine', name: 'Turbine', values: { PR: t.res.PR, eff: inp.hpt.eff, power_W: t.res.power, Tt_out: t.res.out.Tt } });
    shafts.push({ name: 'Shaft', powerIn_W: t.res.power * inp.mechEff, powerOut_W: c.power + inp.HPX_W, turbinePR: t.res.PR });
    let fNoz = t.res.out;
    if (inp.afterburner.enabled) {
      const ab = burnerToT(t.res.out, inp.afterburner.T7_K, inp.afterburner.dPqP, inp.afterburner.eff, inp.burner.fuel_h_Jkg, inp.LHV_Jkg);
      Wfuel += ab.Wfuel;
      fNoz = ab.out;
      stations.push(station('7', 'Afterburner exit', ab.out, staticFromMN(ab.out, 0.3), 0.82));
      components.push({ id: 'ab', kind: 'afterburner', name: 'Afterburner', values: { FAR_add: ab.FAR, Wfuel_kgs: ab.Wfuel, T7: ab.out.Tt } });
      if (ab.out.gas.far > 0.062) warnings.push('Afterburner fuel/air ratio is near stoichiometric; the frozen-products model is at its limit.');
    }
    const n = nozzle(fNoz, amb.P, inp.coreNozzle.type, inp.coreNozzle.Cv);
    stations.push(station('9', 'Nozzle exit', fNoz, n.exit, 1.0));
    components.push({ id: 'nozz', kind: 'nozzle', name: 'Nozzle', values: { PR: n.PR, choked: n.choked ? 1 : 0, Fg_N: n.Fg, V9: n.exit.V, A9_m2: n.exit.A, Ath_m2: n.throat.A, Cv: inp.coreNozzle.Cv } });
    perf.Fg_core = n.Fg; perf.Fg = n.Fg;
    perf.OPR = c.out.Pt / f2.Pt;
    perf.FAR = fNoz.gas.far;
    kineticPowerOut += 0.5 * fNoz.W * (n.Fg / fNoz.W) ** 2;
  } else if (inp.arch === 'turbofan') {
    stations.push(station('2', 'Fan inlet', f2, st2, 0.12));
    const fan = compressor(f2, inp.fan.PR, inp.fan.eff);
    stations.push(station('21', 'Fan exit', fan.out, staticFromMN(fan.out, inp.fan.MN), 0.22));
    components.push({ id: 'fan', kind: 'compressor', name: 'Fan', values: { PR: inp.fan.PR, eff: inp.fan.eff, effPoly: fan.effPoly, power_W: fan.power, Tt_out: fan.out.Tt } });
    const Wcore = W0 / (1 + inp.BPR), Wbyp = W0 - Wcore;
    const f22: Flow = { ...fan.out, W: Wcore };
    const f13: Flow = { ...fan.out, W: Wbyp };
    stations.push(station('22', 'Core inlet', f22, staticFromMN(f22, 0.4), 0.27));
    stations.push(station('13', 'Bypass inlet', f13, staticFromMN(f13, 0.45), 0.27, 'bypass'));
    components.push({ id: 'splitter', kind: 'splitter', name: 'Splitter', values: { BPR: inp.BPR, Wcore_kgs: Wcore, Wbyp_kgs: Wbyp } });
    const lpc = compressor(f22, inp.lpc.PR, inp.lpc.eff);
    stations.push(station('25', 'LPC exit', lpc.out, staticFromMN(lpc.out, inp.lpc.MN), 0.36));
    components.push({ id: 'lpc', kind: 'compressor', name: 'LP compressor (booster)', values: { PR: inp.lpc.PR, eff: inp.lpc.eff, effPoly: lpc.effPoly, power_W: lpc.power, Tt_out: lpc.out.Tt } });
    const hpc = compressor(lpc.out, inp.hpc.PR, inp.hpc.eff, [inp.coolInletFrac, inp.coolExitFrac]);
    stations.push(station('3', 'HPC exit', hpc.out, staticFromMN(hpc.out, inp.hpc.MN), 0.50));
    components.push({ id: 'hpc', kind: 'compressor', name: 'HP compressor', values: { PR: inp.hpc.PR, eff: inp.hpc.eff, effPoly: hpc.effPoly, power_W: hpc.power, Tt_out: hpc.out.Tt, Wbleed_kgs: hpc.bleeds[0].W + hpc.bleeds[1].W } });
    if (hpc.out.Tt > 950) warnings.push(`HPC exit temperature ${hpc.out.Tt.toFixed(0)} K exceeds typical material limits (~950 K).`);
    const b = burnerToT(hpc.out, inp.burner.T4_K, inp.burner.dPqP, inp.burner.eff, inp.burner.fuel_h_Jkg, inp.LHV_Jkg);
    Wfuel += b.Wfuel;
    stations.push(station('4', 'HPT inlet', b.out, staticFromMN(b.out, inp.burner.MN), 0.59));
    components.push({ id: 'burner', kind: 'burner', name: 'Combustor', values: { FAR: b.FAR, Wfuel_kgs: b.Wfuel, dPqP: inp.burner.dPqP, T4: b.out.Tt } });
    const cooling: TurbineStream[] = [{ flow: hpc.bleeds[0], fracP: 1 }, { flow: hpc.bleeds[1], fracP: 0 }];
    const reqHP = (hpc.power + inp.HPX_W) / inp.mechEff;
    const hpt = turbineForPower(b.out, reqHP, inp.hpt.eff, cooling, maxTurbinePRavail(b.out.Pt) / 1.3);
    if (!hpt.satisfied) warnings.push('HP turbine cannot drive the HP compressor: raise T4 or lower HPC pressure ratio.');
    stations.push(station('45', 'HPT exit', hpt.res.out, staticFromMN(hpt.res.out, inp.hpt.MN), 0.66));
    components.push({ id: 'hpt', kind: 'turbine', name: 'HP turbine', values: { PR: hpt.res.PR, eff: inp.hpt.eff, power_W: hpt.res.power, Tt_out: hpt.res.out.Tt } });
    shafts.push({ name: 'HP shaft', powerIn_W: hpt.res.power * inp.mechEff, powerOut_W: hpc.power + inp.HPX_W, turbinePR: hpt.res.PR });
    const reqLP = (fan.power + lpc.power) / inp.mechEff;
    const lpt = turbineForPower(hpt.res.out, reqLP, inp.lpt.eff, [], maxTurbinePRavail(hpt.res.out.Pt));
    if (!lpt.satisfied) warnings.push('LP turbine cannot drive the fan and booster: raise T4, lower fan PR or bypass ratio.');
    stations.push(station('5', 'LPT exit', lpt.res.out, staticFromMN(lpt.res.out, inp.lpt.MN), 0.76));
    components.push({ id: 'lpt', kind: 'turbine', name: 'LP turbine', values: { PR: lpt.res.PR, eff: inp.lpt.eff, power_W: lpt.res.power, Tt_out: lpt.res.out.Tt } });
    shafts.push({ name: 'LP shaft', powerIn_W: lpt.res.power * inp.mechEff, powerOut_W: fan.power + lpc.power, turbinePR: lpt.res.PR });
    const nC = nozzle(lpt.res.out, amb.P, inp.coreNozzle.type, inp.coreNozzle.Cv);
    stations.push(station('9', 'Core nozzle exit', lpt.res.out, nC.exit, 1.0));
    components.push({ id: 'core_nozz', kind: 'nozzle', name: 'Core nozzle', values: { PR: nC.PR, choked: nC.choked ? 1 : 0, Fg_N: nC.Fg, V9: nC.exit.V, A9_m2: nC.exit.A, Cv: inp.coreNozzle.Cv } });
    const f17: Flow = { ...f13, Pt: f13.Pt * (1 - inp.bypDuct_dPqP) };
    stations.push(station('17', 'Bypass duct exit', f17, staticFromMN(f17, 0.45), 0.62, 'bypass'));
    const nB = nozzle(f17, amb.P, inp.bypNozzle.type, inp.bypNozzle.Cv);
    stations.push(station('19', 'Bypass nozzle exit', f17, nB.exit, 0.78, 'bypass'));
    components.push({ id: 'byp_nozz', kind: 'nozzle', name: 'Bypass nozzle', values: { PR: nB.PR, choked: nB.choked ? 1 : 0, Fg_N: nB.Fg, V19: nB.exit.V, A19_m2: nB.exit.A, Cv: inp.bypNozzle.Cv } });
    perf.Fg_core = nC.Fg; perf.Fg_byp = nB.Fg; perf.Fg = nC.Fg + nB.Fg;
    perf.OPR = hpc.out.Pt / f2.Pt;
    perf.FAR = b.FAR;
    kineticPowerOut += 0.5 * lpt.res.out.W * (nC.Fg / lpt.res.out.W) ** 2 + 0.5 * f17.W * (nB.Fg / f17.W) ** 2;
  } else {
    // turboprop: gas generator + free power turbine + actuator-disc propeller
    stations.push(station('2', 'Compressor inlet', f2, st2, 0.30));
    const c = compressor(f2, inp.comp.PR, inp.comp.eff);
    stations.push(station('3', 'Compressor exit', c.out, staticFromMN(c.out, inp.comp.MN), 0.50));
    components.push({ id: 'comp', kind: 'compressor', name: 'Compressor', values: { PR: inp.comp.PR, eff: inp.comp.eff, effPoly: c.effPoly, power_W: c.power, Tt_out: c.out.Tt } });
    const b = burnerToT(c.out, inp.burner.T4_K, inp.burner.dPqP, inp.burner.eff, inp.burner.fuel_h_Jkg, inp.LHV_Jkg);
    Wfuel += b.Wfuel;
    stations.push(station('4', 'Turbine inlet', b.out, staticFromMN(b.out, inp.burner.MN), 0.62));
    components.push({ id: 'burner', kind: 'burner', name: 'Combustor', values: { FAR: b.FAR, Wfuel_kgs: b.Wfuel, dPqP: inp.burner.dPqP, T4: b.out.Tt } });
    const req = (c.power + inp.HPX_W) / inp.mechEff;
    const t = turbineForPower(b.out, req, inp.hpt.eff, [], maxTurbinePRavail(b.out.Pt) / 1.2);
    if (!t.satisfied) warnings.push('Gas-generator turbine cannot drive the compressor: raise T4 or lower compressor PR.');
    stations.push(station('45', 'Power turbine inlet', t.res.out, staticFromMN(t.res.out, inp.hpt.MN), 0.72));
    components.push({ id: 'turb', kind: 'turbine', name: 'Gas-generator turbine', values: { PR: t.res.PR, eff: inp.hpt.eff, power_W: t.res.power, Tt_out: t.res.out.Tt } });
    shafts.push({ name: 'HP shaft', powerIn_W: t.res.power * inp.mechEff, powerOut_W: c.power + inp.HPX_W, turbinePR: t.res.PR });
    const reqPT = inp.prop.shaftPower_W / inp.mechEff;
    const pt = turbineForPower(t.res.out, reqPT, inp.lpt.eff, [], maxTurbinePRavail(t.res.out.Pt));
    if (!pt.satisfied) warnings.push('Power turbine cannot deliver the requested shaft power at this T4 / mass flow; delivering the maximum available.');
    const shaftPower = pt.res.power * inp.mechEff;
    stations.push(station('5', 'Power turbine exit', pt.res.out, staticFromMN(pt.res.out, inp.lpt.MN), 0.84));
    components.push({ id: 'pt', kind: 'turbine', name: 'Power turbine', values: { PR: pt.res.PR, eff: inp.lpt.eff, power_W: pt.res.power, Tt_out: pt.res.out.Tt } });
    shafts.push({ name: 'Power shaft', powerIn_W: shaftPower, powerOut_W: shaftPower, turbinePR: pt.res.PR });
    const n = nozzle(pt.res.out, amb.P, 'CV', inp.coreNozzle.Cv);
    stations.push(station('9', 'Exhaust exit', pt.res.out, n.exit, 1.0));
    components.push({ id: 'nozz', kind: 'nozzle', name: 'Exhaust nozzle', values: { PR: n.PR, choked: n.choked ? 1 : 0, Fg_N: n.Fg, V9: n.exit.V, A9_m2: n.exit.A, Cv: inp.coreNozzle.Cv } });
    const Pavail = shaftPower * inp.prop.gearboxEff * inp.prop.propEff;
    const prop = propellerThrust(Pavail, V0, amb.rho, inp.prop.diameter_m);
    components.push({ id: 'prop', kind: 'propeller', name: 'Propeller', values: { shaftPower_W: shaftPower, powerToAir_W: Pavail, thrust_N: prop.T, inducedVelocity_ms: prop.vInduced, etaIdeal: prop.etaIdeal, etaTotal: prop.etaIdeal * inp.prop.propEff * inp.prop.gearboxEff, diameter_m: inp.prop.diameter_m, discLoading_W_m2: Pavail / (Math.PI * inp.prop.diameter_m ** 2 / 4) } });
    perf.Fg_core = n.Fg; perf.Fg = n.Fg;
    perf.shaftPower_W = shaftPower; perf.propThrust = prop.T; perf.jetThrust = n.Fg - ramDrag;
    perf.OPR = c.out.Pt / f2.Pt; perf.FAR = b.FAR;
    kineticPowerOut += 0.5 * pt.res.out.W * (n.Fg / pt.res.out.W) ** 2 + Pavail; // propeller power counts as useful output
    // equivalent shaft power: jet thrust credited at propeller efficiency in flight, 2.5 lbf/hp static convention otherwise
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
  perf.heatRate_W = Wfuel * inp.LHV_Jkg;
  const kineticPowerIn = 0.5 * W0 * V0 * V0;
  perf.thermalEff = (kineticPowerOut - kineticPowerIn) / perf.heatRate_W;
  perf.propulsiveEff = V0 > 0 ? (perf.Fn * V0) / Math.max(kineticPowerOut - kineticPowerIn, 1e-9) : 0;
  perf.overallEff = V0 > 0 ? (perf.Fn * V0) / perf.heatRate_W : 0;
  if (perf.FAR > 0.9 * 0.0678) warnings.push('Fuel/air ratio is close to stoichiometric.');
  for (const s of stations) if (s.id === '4' && s.Tt > 2000) warnings.push('Turbine inlet temperature above 2000 K: dissociation (not modelled) becomes significant.');

  return { inputs: inp, stations, components, perf, warnings, shafts };
}
