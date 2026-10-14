/**
 * Spool transients: time-marching integration of the shaft dynamics
 *   I ω dω/dt = P_turbine − P_load
 * with the gas path solved quasi-steadily at each step (fixed speeds, floating
 * flows, R-lines and turbine pressure ratios).  Fuel is scheduled against time
 * and, optionally, limited by a ratio-unit (Wf/P3) acceleration schedule.
 */
import { DesignPoint, OffDesignInputs, solveOffDesign, designUnknowns } from './offdesign';
import { EngineResult } from './types';
import { isa } from './atmosphere';

export interface FuelSchedule {
  /** start operating point throttle (T4, K) — solved steady-state */
  T4start: number;
  /** final fuel-flow command as a fraction of the design fuel flow, applied as a ramp */
  WfEndFrac: number;
  rampStart_s: number; rampDuration_s: number;
  /** acceleration limiter: maximum Wf/P3 (kg/s per Pa) as a multiple of the design ratio-unit; 0 disables */
  ratioUnitLimit: number;
  /** deceleration limiter: minimum Wf/P3 as a fraction of the design ratio-unit */
  ratioUnitFloor: number;
}
export interface StartInputs {
  enabled: boolean;
  starterTorque_Nm: number; // applied to the HP spool
  starterCutout: number; // HP speed fraction at which the starter disengages
  lightOffSpeed: number; // HP speed fraction at which fuel is introduced
  lightOffT3min_K: number; // ignition needs T3 above this
  lightOffFuelFrac: number; // initial fuel flow after light-off, fraction of design
  frictionPower_W: number; // drag on the HP spool at design speed (scales with N²)
}
/** Full-authority digital engine control: closed-loop fuel on a spool speed or thrust, with schedules and actuators. */
export interface Controller {
  mode: 'open' | 'N1' | 'N2' | 'Fn'; // 'open' = fuel schedule only
  target: number; // N1 / N2 as fraction of design speed, Fn in N
  targetRamp_s: number; // the demand ramps from the start value to the target over this time
  Kp: number; // proportional gain: ΔWf/Wf_des per unit relative error
  Ki: number; // integral gain, per second
  accelSchedule: { Nc: number; ratioUnit: number }[]; // max Wf/P3 (× design) vs corrected HP speed fraction
  decelFloor: number; // min Wf/P3 (× design)
  bleedValve: { openBelowN2: number; frac: number }; // handling bleed valve opens below this N2 fraction
  vsvGain: number; // variable-stator flow gain while running (geometry.vsvFlowGain)
}
export const DEFAULT_CONTROLLER: Controller = { mode: 'open', target: 1.0, targetRamp_s: 1.0, Kp: 1.5, Ki: 2.0, accelSchedule: [{ Nc: 0.6, ratioUnit: 1.35 }, { Nc: 0.8, ratioUnit: 1.25 }, { Nc: 1.0, ratioUnit: 1.1 }], decelFloor: 0.25, bleedValve: { openBelowN2: 0.75, frac: 0.06 }, vsvGain: 0 };
/**
 * Heat soak and tip clearance.  Casing and disc temperatures follow the local gas
 * temperature as first-order lags; the clearance is the cold build clearance plus
 * casing growth minus disc growth (thermal) and blade/disc centrifugal growth.
 * Efficiency falls ~ k·(δ/h) and the flow capacity slightly with it.
 */
export interface ThermalInputs {
  enabled: boolean;
  tauCasing_s: number; tauDisc_s: number; // thermal time constants
  alpha_1perK: number; // thermal expansion coefficient (nickel alloy ~1.3e-5)
  coldClearance_mm: number; // HPC/HPT cold build clearance
  bladeHeight_mm: number; // representative rear HPC / HPT blade height
  rCasing_mm: number; // casing radius
  centrifugalGrowth_mm: number; // blade + disc growth at design speed (∝ N²)
  effPerClearance: number; // Δη per unit (δ/h): ~1.0–2.0
}
export const DEFAULT_THERMAL: ThermalInputs = { enabled: false, tauCasing_s: 8, tauDisc_s: 90, alpha_1perK: 1.3e-5, coldClearance_mm: 1.2, bladeHeight_mm: 25, rCasing_mm: 350, centrifugalGrowth_mm: 0.9, effPerClearance: 1.5 };
export interface TransientInputs { od: OffDesignInputs; schedule: FuelSchedule; duration_s: number; dt_s: number; start?: StartInputs; controller?: Controller; thermal?: ThermalInputs }
export interface TransientSample {
  t: number; Wf: number; WfCmd: number; limited: boolean; lit?: boolean; starter?: boolean;
  demand?: number; measured?: number; bleedOpen?: boolean;
  Tcasing?: number; Tdisc?: number; clearance_mm?: number; effDeltaHPC?: number;
  N: Record<string, number>; Npct: Record<string, number>; Fn: number; T4: number; T5: number; P3: number;
  SM: Record<string, number>; Wc: Record<string, number>; PR: Record<string, number>; converged: boolean;
}
export interface TransientResult { samples: TransientSample[]; design: { Wf: number; ratioUnit: number }; warnings: string[] }

/** Integrate the engine through the fuel schedule. Calls `progress` with partial samples. */
export function runTransient(dp: DesignPoint, ti: TransientInputs, progress?: (s: TransientSample[]) => void): TransientResult {
  const inp = dp.inputs;
  const warnings: string[] = [];
  const WfDes = dp.result.components.find((c) => c.id === 'burner')!.values.Wfuel_kgs;
  const P3des = dp.result.stations.find((s) => s.id === '3')!.Pt;
  const ruDes = WfDes / P3des;

  const st = ti.start?.enabled ? ti.start : null;
  // steady start point (or a near-zero-speed state for a start-up)
  const start = solveOffDesign(dp, { ...ti.od, throttle: { mode: 'T4', value: ti.schedule.T4start } });
  if (!start.converged && !st) warnings.push('Start operating point did not converge; integrating from the closest iterate.');
  const sp = start.x;
  const windmill = st ? Math.max(0.04, 0.12 * ti.od.mach) : 0; // crude windmilling speed fraction at forward speed
  const speeds = st ? { LP: inp.speeds.LP * windmill * 1.3, IP: inp.speeds.IP * windmill, HP: inp.speeds.HP * windmill } : { LP: sp.N_LP ?? inp.speeds.LP, IP: sp.N_IP ?? inp.speeds.IP, HP: sp.N_HP };
  let Wf = st ? 0 : start.result.components.find((c) => c.id === 'burner')!.values.Wfuel_kgs;
  const WfEnd = ti.schedule.WfEndFrac * WfDes;
  let x: Record<string, number> = { ...designUnknowns(dp), ...sp };
  if (st) { x.W = inp.flight.W_kgs * windmill; x.FAR = 1e-4; for (const k of Object.keys(x)) if (k.startsWith('PR_')) x[k] = 1.05; }
  let lit = !st;
  let starterOn = !!st;
  const samples: TransientSample[] = [];
  const inertia = inp.inertia;
  const names = Object.keys(speeds).filter((k) => (inertia as any)[k] > 0 && (inp.speeds as any)[k] > 0 && (inp.arch === 'turbofan' ? (k !== 'IP' || inp.spools === 3) : k === 'HP'));

  const ctl = ti.controller && ti.controller.mode !== 'open' ? ti.controller : null;
  const sched = ti.controller;
  let geomOverride: Partial<typeof inp.geometry> = {};
  // thermal states: start in equilibrium with the start operating point
  const th = ti.thermal?.enabled ? ti.thermal : null;
  const hotId = inp.arch === 'turbofan' ? 'hpc' : 'comp';
  const T3of = (r: EngineResult) => r.stations.find((q) => q.id === '3')!.Tt;
  const T3start = T3of(start.result);
  let Tcasing = st ? 288.15 : T3start, Tdisc = st ? 288.15 : T3start;
  const T3des = dp.result.stations.find((q) => q.id === '3')!.Tt;
  const clearanceOf = (Tc: number, Td: number, nHP: number) => {
    if (!th) return { delta_mm: NaN, effDelta: 0 };
    const growthCasing = th.alpha_1perK * (Tc - 288.15) * th.rCasing_mm;
    const growthDisc = th.alpha_1perK * (Td - 288.15) * th.rCasing_mm * 0.92 + th.centrifugalGrowth_mm * nHP * nHP;
    const delta = Math.max(0.05, th.coldClearance_mm + growthCasing - growthDisc);
    // efficiency relative to the design-point clearance (so the design point carries no penalty)
    const gcD = th.alpha_1perK * (T3des - 288.15) * th.rCasing_mm, gdD = th.alpha_1perK * (T3des - 288.15) * th.rCasing_mm * 0.92 + th.centrifugalGrowth_mm;
    const deltaDes = Math.max(0.05, th.coldClearance_mm + gcD - gdD);
    const effDelta = -th.effPerClearance * (delta - deltaDes) / th.bladeHeight_mm;
    return { delta_mm: delta, effDelta };
  };
  let deltas: Record<string, { eff?: number; Wc?: number }> | undefined;
  const stepRate = (sp: typeof speeds, WfNow: number): { dN: Record<string, number>; r: EngineResult; conv: boolean; xr: Record<string, number> } | null => {
    const s = solveOffDesign(dp, { ...ti.od, geometry: { ...(ti.od.geometry ?? {}), ...geomOverride }, deltas, throttle: { mode: 'Wf', value: Math.max(WfNow, 2e-4 * WfDes) } }, x, { fixedSpeeds: sp });
    if (!Number.isFinite(s.norm)) return null;
    const imb = s.result.offDesign?.shaftImbalance_W ?? {};
    const dN: Record<string, number> = {};
    for (const k of names) {
      const shaftName = k === 'HP' ? (inp.arch === 'turbofan' || inp.arch === 'turboprop' ? 'HP shaft' : 'Shaft') : k === 'LP' ? 'LP shaft' : 'IP shaft';
      let dP = imb[shaftName] ?? 0;
      if (st && k === 'HP') {
        const omegaHP = (2 * Math.PI * sp.HP) / 60;
        if (starterOn) dP += st.starterTorque_Nm * omegaHP;
        dP -= st.frictionPower_W * Math.pow(sp.HP / inp.speeds.HP, 2);
      }
      const omega = (2 * Math.PI * sp[k as 'LP']) / 60;
      const domega = dP / ((inertia as any)[k] * Math.max(omega, 1));
      dN[k] = (domega * 60) / (2 * Math.PI);
    }
    return { dN, r: s.result, conv: s.converged, xr: s.x };
  };

  const n = Math.round(ti.duration_s / ti.dt_s);
  let lastProgress = 0;
  // closed-loop state
  let integ = 0, lastMeasured = NaN, demand = NaN;
  const WfBase = st ? 0 : Wf0(start);
  const measure = (r: EngineResult, sp: typeof speeds) => (ctl!.mode === 'N1' ? sp.LP / inp.speeds.LP : ctl!.mode === 'N2' ? sp.HP / inp.speeds.HP : r.perf.Fn);
  const startMeasured = ctl ? measure(start.result, speeds) : NaN;
  const T2 = isaT2(dp, ti.od);
  for (let i = 0; i <= n; i++) {
    const t = i * ti.dt_s;
    // actuators: bleed valve and variable stators from the schedule
    if (sched) {
      const n2 = speeds.HP / inp.speeds.HP;
      const bleedOpen = n2 < sched.bleedValve.openBelowN2 && sched.bleedValve.frac > 0;
      geomOverride = { handlingBleedFrac: bleedOpen ? sched.bleedValve.frac : (ti.od.geometry?.handlingBleedFrac ?? inp.geometry.handlingBleedFrac), vsvFlowGain: sched.vsvGain };
    }
    // thermal state → clearance → efficiency deltas for this step
    let clr = { delta_mm: NaN, effDelta: 0 };
    if (th) { clr = clearanceOf(Tcasing, Tdisc, speeds.HP / inp.speeds.HP); deltas = { [hotId]: { eff: 1 + clr.effDelta, Wc: 1 + 0.3 * clr.effDelta }, [inp.arch === 'turbofan' ? 'hpt' : 'turb']: { eff: 1 + 0.6 * clr.effDelta } }; }
    // fuel command: open-loop ramp, or PI controller on the demanded quantity
    const f = Math.min(1, Math.max(0, (t - ti.schedule.rampStart_s) / Math.max(ti.schedule.rampDuration_s, 1e-6)));
    let WfCmd = st ? (lit ? st.lightOffFuelFrac * WfDes + (WfEnd - st.lightOffFuelFrac * WfDes) * f : 0) : Wf0(start) + (WfEnd - Wf0(start)) * f;
    if (ctl && (!st || lit)) {
      const fr = Math.min(1, Math.max(0, (t - ti.schedule.rampStart_s) / Math.max(ctl.targetRamp_s, 1e-6)));
      demand = startMeasured + (ctl.target - startMeasured) * fr;
      const meas = Number.isFinite(lastMeasured) ? lastMeasured : startMeasured;
      const e = (demand - meas) / Math.max(Math.abs(demand), 1e-9);
      integ += e * ti.dt_s;
      integ = Math.max(-0.5, Math.min(0.5, integ)); // anti-windup
      WfCmd = Math.max(0.02 * WfDes, WfBase + WfDes * (ctl.Kp * e + ctl.Ki * integ));
    }
    // evaluate at current state with the commanded fuel, then apply the ratio-unit limiter
    let r1 = stepRate(speeds, WfCmd);
    if (!r1) { warnings.push(`Gas path failed to solve at t = ${t.toFixed(2)} s.`); break; }
    if (st) {
      const nHP = speeds.HP / inp.speeds.HP;
      const T3 = r1.r.stations.find((q) => q.id === '3')!.Tt;
      if (!lit && nHP >= st.lightOffSpeed && T3 >= st.lightOffT3min_K) { lit = true; warnings.push(`Light-off at t = ${t.toFixed(1)} s, N2 ${(100 * nHP).toFixed(0)} %, T3 ${T3.toFixed(0)} K.`); WfCmd = st.lightOffFuelFrac * WfDes; r1 = stepRate(speeds, WfCmd) ?? r1; }
      if (starterOn && nHP >= st.starterCutout) { starterOn = false; warnings.push(`Starter cut-out at t = ${t.toFixed(1)} s.`); }
      if (!lit && !starterOn && (r1.dN.HP ?? 0) <= 0) { warnings.push(`Hung start: no light-off before the starter cut out (t = ${t.toFixed(1)} s).`); samples.push({ ...sample(t, 0, 0, false, speeds, inp, r1.r, r1.conv), lit, starter: starterOn }); break; }
    }
    let limited = false;
    let WfNow = WfCmd;
    const P3 = r1.r.stations.find((s) => s.id === '3')!.Pt;
    let ruMax = ti.schedule.ratioUnitLimit, ruMin = ti.schedule.ratioUnitFloor;
    if (sched) {
      const nc = speeds.HP / Math.sqrt(T2 / 288.15) / (inp.speeds.HP / Math.sqrt(dp.result.stations.find((q) => q.id === '2')!.Tt / 288.15));
      ruMax = interpSchedule(sched.accelSchedule, nc); ruMin = sched.decelFloor;
    }
    if (ruMax > 0 && WfCmd / P3 > ruMax * ruDes) { WfNow = ruMax * ruDes * P3; limited = true; }
    if (ruMin > 0 && WfCmd / P3 < ruMin * ruDes) { WfNow = ruMin * ruDes * P3; limited = true; }
    if (limited && ctl) integ -= 0.5 * (demand - (Number.isFinite(lastMeasured) ? lastMeasured : startMeasured)) / Math.max(Math.abs(demand), 1e-9) * ti.dt_s; // back off the integrator while limited
    if (limited) { const r2 = stepRate(speeds, WfNow); if (r2) r1 = r2; }
    Wf = WfNow; x = r1.xr;
    if (ctl) lastMeasured = measure(r1.r, speeds);
    samples.push({ ...sample(t, Wf, WfCmd, limited, speeds, inp, r1.r, r1.conv), lit, starter: starterOn, demand: ctl ? demand : undefined, measured: ctl ? lastMeasured : undefined, bleedOpen: sched ? (geomOverride.handlingBleedFrac ?? 0) > (ti.od.geometry?.handlingBleedFrac ?? inp.geometry.handlingBleedFrac) : undefined, Tcasing: th ? Tcasing : undefined, Tdisc: th ? Tdisc : undefined, clearance_mm: th ? clr.delta_mm : undefined, effDeltaHPC: th ? clr.effDelta : undefined });
    if (th) { const T3 = T3of(r1.r); Tcasing += (ti.dt_s / th.tauCasing_s) * (T3 - Tcasing); Tdisc += (ti.dt_s / th.tauDisc_s) * (T3 - Tdisc); }
    // Heun (RK2) step on speeds
    if (i < n) {
      const k1 = r1.dN;
      const pred: typeof speeds = { ...speeds };
      for (const k of names) (pred as any)[k] = (speeds as any)[k] + ti.dt_s * k1[k];
      const r2 = stepRate(pred, Wf) ?? r1;
      for (const k of names) (speeds as any)[k] = (speeds as any)[k] + 0.5 * ti.dt_s * (k1[k] + (r2.dN[k] ?? k1[k]));
    }
    if (progress && t - lastProgress >= 0.5) { progress(samples); lastProgress = t; }
  }
  return { samples, design: { Wf: WfDes, ratioUnit: ruDes }, warnings };
}
const Wf0 = (s: { result: EngineResult }) => s.result.components.find((c) => c.id === 'burner')!.values.Wfuel_kgs;
function interpSchedule(tab: { Nc: number; ratioUnit: number }[], nc: number): number {
  const t = tab.slice().sort((a, b) => a.Nc - b.Nc);
  if (!t.length) return 0;
  if (nc <= t[0].Nc) return t[0].ratioUnit;
  for (let i = 1; i < t.length; i++) if (nc <= t[i].Nc) return t[i - 1].ratioUnit + ((t[i].ratioUnit - t[i - 1].ratioUnit) * (nc - t[i - 1].Nc)) / (t[i].Nc - t[i - 1].Nc);
  return t[t.length - 1].ratioUnit;
}
function isaT2(dp: DesignPoint, od: OffDesignInputs): number {
  const amb = isa(od.altitude_m, od.dT_isa);
  return amb.T * (1 + 0.2 * od.mach * od.mach) * (dp ? 1 : 1);
}

function sample(t: number, Wf: number, WfCmd: number, limited: boolean, speeds: { LP: number; IP: number; HP: number }, inp: DesignPoint['inputs'], r: EngineResult, conv: boolean): TransientSample {
  const N: Record<string, number> = {}, Npct: Record<string, number> = {};
  const relevant = (k: string) => (inp.speeds as any)[k] > 0 && (inp.arch === 'turbofan' ? (k !== 'IP' || inp.spools === 3) : k === 'HP');
  for (const k of ['LP', 'IP', 'HP'] as const) if (relevant(k)) { N[k] = speeds[k]; Npct[k] = (100 * speeds[k]) / (inp.speeds as any)[k]; }
  const SM: Record<string, number> = {}, Wc: Record<string, number> = {}, PR: Record<string, number> = {};
  for (const c of r.components) if (c.kind === 'compressor') { SM[c.id] = c.values.surgeMargin_pct; PR[c.id] = c.values.PR; Wc[c.id] = c.values.Wc ?? NaN; }
  return { t, Wf, WfCmd, limited, N, Npct, Fn: r.perf.Fn, T4: r.stations.find((s) => s.id === '4')!.Tt, T5: r.stations.find((s) => s.id === '5')!.Tt, P3: r.stations.find((s) => s.id === '3')!.Pt, SM, Wc, PR, converged: conv };
}
