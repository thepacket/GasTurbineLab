/**
 * Spool transients: time-marching integration of the shaft dynamics
 *   I ω dω/dt = P_turbine − P_load
 * with the gas path solved quasi-steadily at each step (fixed speeds, floating
 * flows, R-lines and turbine pressure ratios).  Fuel is scheduled against time
 * (against the time since light-off in a start-up) and, optionally, limited by a
 * ratio-unit (Wf/P3) acceleration schedule.
 *
 * Only converged gas-path solutions feed the dynamics.  A step whose corrector
 * does not converge after the retry chain ends the integration with a warning
 * and `complete = false`; a failed predictor falls back to an explicit Euler step
 * from the converged corrector and is counted.  Before light-off the burner is
 * unlit (zero fuel, zero heat release); if no through-flow solution exists at the
 * starter-driven speed the step is integrated in the starter-only regime
 * (starter torque against friction, no gas-path contribution) and marked
 * `gasPath = false`.
 */
import { DesignPoint, OffDesignInputs, solveOffDesign, designUnknowns, OffDesignSolution } from './offdesign';
import { EngineResult } from './types';
import { isa } from './atmosphere';

export interface FuelSchedule {
  /** start operating point throttle (T4, K) — solved steady-state */
  T4start: number;
  /** final fuel-flow command as a fraction of the design fuel flow, applied as a ramp */
  WfEndFrac: number;
  /** ramp timing; in a start-up both are measured from light-off */
  rampStart_s: number; rampDuration_s: number;
  /** manual acceleration limiter: maximum Wf/P3 as a multiple of the design ratio-unit; 0 disables.  Used when no controller
   *  is supplied or when the controller's `limiter` is 'manual'. */
  ratioUnitLimit: number;
  /** manual deceleration limiter: minimum Wf/P3 as a fraction of the design ratio-unit; 0 disables */
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
  /** which Wf/P3 limits apply: the controller's acceleration schedule and deceleration floor ('schedule', default), or the
   *  manual limit and floor of the fuel schedule ('manual').  Precedence is explicit: the other set is ignored. */
  limiter?: 'schedule' | 'manual';
  accelSchedule: { Nc: number; ratioUnit: number }[]; // max Wf/P3 (× design) vs corrected HP speed fraction
  decelFloor: number; // min Wf/P3 (× design)
  bleedValve: { openBelowN2: number; frac: number }; // handling bleed valve opens below this N2 fraction
  vsvGain: number; // variable-stator flow gain while running (geometry.vsvFlowGain)
}
/** The acceleration schedule starts with a start-up branch (Wf/P3 at or below the design ratio unit while sub-idle) and
 *  opens up through the running range; light-off itself sits near 0.8× the design ratio unit. */
export const DEFAULT_CONTROLLER: Controller = { mode: 'open', target: 1.0, targetRamp_s: 1.0, Kp: 1.5, Ki: 2.0, limiter: 'schedule', accelSchedule: [{ Nc: 0.2, ratioUnit: 1.0 }, { Nc: 0.4, ratioUnit: 1.2 }, { Nc: 0.6, ratioUnit: 1.35 }, { Nc: 0.8, ratioUnit: 1.25 }, { Nc: 1.0, ratioUnit: 1.1 }], decelFloor: 0.25, bleedValve: { openBelowN2: 0.75, frac: 0.06 }, vsvGain: 0 };
/**
 * Heat soak and tip clearance.  Casing and disc temperatures follow the local gas
 * temperature as first-order lags; the clearance is the cold build clearance plus
 * casing growth minus disc growth (thermal) and blade/disc centrifugal growth.
 * Efficiency falls ~ k·(δ/h) and the flow capacity slightly with it.  The computed
 * clearance is reported as is; a non-positive value means blade/casing contact and
 * puts the model outside its valid range (the efficiency correlation is evaluated at
 * a small positive floor so the gas path can still be solved).
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
/** clearance below which the efficiency correlation is evaluated at the floor (numerical guard, not a physical result) */
export const CLEARANCE_FLOOR_MM = 0.05;
export interface TransientInputs { od: OffDesignInputs; schedule: FuelSchedule; duration_s: number; dt_s: number; start?: StartInputs; controller?: Controller; thermal?: ThermalInputs }
export interface TransientSample {
  t: number; Wf: number; WfCmd: number; limited: boolean; lit?: boolean; starter?: boolean;
  /** false: no through-flow solution exists at this starter-driven state; the step used the starter-only regime */
  gasPath: boolean;
  /** the predictor of this step did not converge and an explicit Euler step was taken from the converged corrector */
  eulerStep?: boolean;
  demand?: number; measured?: number; bleedOpen?: boolean;
  Tcasing?: number; Tdisc?: number; clearance_mm?: number; effDeltaHPC?: number;
  /** computed clearance is non-positive: blade/casing contact predicted */
  rub?: boolean;
  N: Record<string, number>; Npct: Record<string, number>; Fn: number; T4: number; T5: number; P3: number;
  SM: Record<string, number>; Wc: Record<string, number>; PR: Record<string, number>; converged: boolean;
}
export interface TransientResult {
  samples: TransientSample[]; design: { Wf: number; ratioUnit: number }; warnings: string[];
  /** the integration reached the requested duration */
  complete: boolean;
  /** time at which the integration stopped when incomplete */
  stoppedAt_s?: number;
  /** number of steps integrated with explicit Euler because the predictor did not converge */
  eulerSteps: number;
  /** number of samples in the starter-only regime (no gas-path solution) */
  starterOnlySteps: number;
  minClearance_mm?: number;
  /** blade/casing contact predicted at some point of the trajectory */
  contact: boolean;
}

interface Rate { dN: Record<string, number>; r: EngineResult; conv: boolean; xr: Record<string, number>; norm: number; gasPath: boolean }

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
  let xGood: Record<string, number> | null = st ? null : { ...x };
  let lit = !st;
  let tLit = 0; // the fuel schedule and the controller demand are referenced to light-off in a start-up
  let starterOn = !!st;
  const samples: TransientSample[] = [];
  const inertia = inp.inertia;
  const names = Object.keys(speeds).filter((k) => (inertia as any)[k] > 0 && (inp.speeds as any)[k] > 0 && (inp.arch === 'turbofan' ? (k !== 'IP' || inp.spools === 3) : k === 'HP'));

  const ctl = ti.controller && ti.controller.mode !== 'open' ? ti.controller : null;
  const sched = ti.controller;
  const useSchedule = !!sched && (sched.limiter ?? 'schedule') === 'schedule';
  let geomOverride: Partial<typeof inp.geometry> = {};
  // thermal states: start in equilibrium with the start operating point
  const th = ti.thermal?.enabled ? ti.thermal : null;
  const hotId = inp.arch === 'turbofan' ? 'hpc' : 'comp';
  const T3of = (r: EngineResult) => r.stations.find((q) => q.id === '3')!.Tt;
  const T2 = isaT2(dp, ti.od);
  const T3start = T3of(start.result);
  let Tcasing = st ? T2 : T3start, Tdisc = st ? T2 : T3start;
  const T3des = dp.result.stations.find((q) => q.id === '3')!.Tt;
  let minClearance = Infinity, contact = false;
  const clearanceOf = (Tc: number, Td: number, nHP: number) => {
    if (!th) return { delta_mm: NaN, effDelta: 0, rub: false };
    const growthCasing = th.alpha_1perK * (Tc - 288.15) * th.rCasing_mm;
    const growthDisc = th.alpha_1perK * (Td - 288.15) * th.rCasing_mm * 0.92 + th.centrifugalGrowth_mm * nHP * nHP;
    const delta = th.coldClearance_mm + growthCasing - growthDisc; // reported as computed; may be ≤ 0 (contact)
    // efficiency relative to the design-point clearance (so the design point carries no penalty)
    const gcD = th.alpha_1perK * (T3des - 288.15) * th.rCasing_mm, gdD = th.alpha_1perK * (T3des - 288.15) * th.rCasing_mm * 0.92 + th.centrifugalGrowth_mm;
    const deltaDes = Math.max(CLEARANCE_FLOOR_MM, th.coldClearance_mm + gcD - gdD);
    const effDelta = -th.effPerClearance * (Math.max(CLEARANCE_FLOOR_MM, delta) - deltaDes) / th.bladeHeight_mm;
    return { delta_mm: delta, effDelta, rub: delta <= 0 };
  };
  let deltas: Record<string, { eff?: number; Wc?: number }> | undefined;

  /** sub-idle initial guess for a fixed-speed solve: flow ∝ speed, turbine expansion ratios ∝ speed² */
  const subIdleGuess = (spd: typeof speeds, litNow: boolean): Record<string, number> => {
    const n = Math.max(0.01, spd.HP / inp.speeds.HP);
    const g = designUnknowns(dp);
    g.W = inp.flight.W_kgs * n * 0.6;
    if (!litNow) g.FAR = 1e-3;
    for (const k of Object.keys(g)) if (k.startsWith('PR_')) g[k] = 1 + (g[k] - 1) * n * n * 0.5;
    return g;
  };
  const shaftOf = (k: string) => (k === 'HP' ? (inp.arch === 'turbofan' || inp.arch === 'turboprop' ? 'HP shaft' : 'Shaft') : k === 'LP' ? 'LP shaft' : 'IP shaft');
  const starterPower = (spd: typeof speeds) => {
    if (!st) return 0;
    const omegaHP = (2 * Math.PI * spd.HP) / 60;
    return (starterOn ? st.starterTorque_Nm * omegaHP : 0) - st.frictionPower_W * Math.pow(spd.HP / inp.speeds.HP, 2);
  };
  const ratesFromPower = (spd: typeof speeds, power: Record<string, number>) => {
    const dN: Record<string, number> = {};
    for (const k of names) {
      const omega = (2 * Math.PI * (spd as any)[k]) / 60;
      const domega = (power[k] ?? 0) / ((inertia as any)[k] * Math.max(omega, 1));
      dN[k] = (domega * 60) / (2 * Math.PI);
    }
    return dN;
  };
  /** gas path at fixed speeds and fuel; tries the warm start, the last converged state, a sub-idle guess and the design guess */
  const stepRate = (spd: typeof speeds, WfNow: number, litNow: boolean): Rate | null => {
    const od: OffDesignInputs = { ...ti.od, geometry: { ...(ti.od.geometry ?? {}), ...geomOverride }, deltas, throttle: { mode: 'Wf', value: litNow ? WfNow : 0 }, burnerLit: litNow };
    const guesses: Record<string, number>[] = [x];
    if (xGood) guesses.push(xGood);
    guesses.push(subIdleGuess(spd, litNow), designUnknowns(dp));
    let best: OffDesignSolution | null = null;
    for (const g of guesses) {
      let s: OffDesignSolution;
      try { s = solveOffDesign(dp, od, g, { fixedSpeeds: spd }); } catch { continue; }
      if (!Number.isFinite(s.norm)) continue;
      if (!best || s.converged || s.norm < best.norm) best = s;
      if (s.converged) break;
    }
    if (!best) return null;
    const imb = best.result.offDesign?.shaftImbalance_W ?? {};
    const power: Record<string, number> = {};
    for (const k of names) power[k] = (imb[shaftOf(k)] ?? 0) + (k === 'HP' ? starterPower(spd) : 0);
    return { dN: ratesFromPower(spd, power), r: best.result, conv: best.converged, xr: best.x, norm: best.norm, gasPath: true };
  };
  /** starter-only regime: no through-flow, the HP spool sees the starter and friction only */
  const starterOnlyRate = (spd: typeof speeds): Rate => {
    const power: Record<string, number> = {};
    for (const k of names) power[k] = k === 'HP' ? starterPower(spd) : 0;
    return { dN: ratesFromPower(spd, power), r: noFlowResult(dp, T2), conv: false, xr: x, norm: NaN, gasPath: false };
  };

  const n = Math.round(ti.duration_s / ti.dt_s);
  let lastProgress = 0;
  // closed-loop state
  let integ = 0, lastMeasured = NaN, demand = NaN;
  let WfBase = st ? 0 : Wf0(start);
  const measure = (r: EngineResult, spd: typeof speeds) => (ctl!.mode === 'N1' ? spd.LP / inp.speeds.LP : ctl!.mode === 'N2' ? spd.HP / inp.speeds.HP : r.perf.Fn);
  let startMeasured = ctl && !st ? measure(start.result, speeds) : NaN;
  let complete = true, stoppedAt: number | undefined, eulerSteps = 0, starterOnlySteps = 0;
  let lastP3 = st ? NaN : start.result.stations.find((s) => s.id === '3')!.Pt; // P3 of the last converged gas path, for the limiter
  const stop = (t: number, why: string) => { warnings.push(`${why} The trajectory stops at t = ${t.toFixed(2)} s of ${ti.duration_s} s; the samples shown are all converged solutions.`); complete = false; stoppedAt = t; };
  const describe = (r: Rate) => { const v = r.r.offDesign?.mapViolations ?? []; return `residual ${r.norm.toExponential(1)}${v.length ? `, outside the supported range: ${v.join(', ')}` : ''}`; };

  for (let i = 0; i <= n; i++) {
    const t = i * ti.dt_s;
    // actuators: bleed valve and variable stators from the schedule
    if (sched) {
      const n2 = speeds.HP / inp.speeds.HP;
      const bleedOpen = n2 < sched.bleedValve.openBelowN2 && sched.bleedValve.frac > 0;
      geomOverride = { handlingBleedFrac: bleedOpen ? sched.bleedValve.frac : (ti.od.geometry?.handlingBleedFrac ?? inp.geometry.handlingBleedFrac), vsvFlowGain: sched.vsvGain };
    }
    // thermal state → clearance → efficiency deltas for this step
    let clr = { delta_mm: NaN, effDelta: 0, rub: false };
    if (th) {
      clr = clearanceOf(Tcasing, Tdisc, speeds.HP / inp.speeds.HP);
      deltas = { [hotId]: { eff: 1 + clr.effDelta, Wc: 1 + 0.3 * clr.effDelta }, [inp.arch === 'turbofan' ? 'hpt' : 'turb']: { eff: 1 + 0.6 * clr.effDelta } };
      minClearance = Math.min(minClearance, clr.delta_mm);
      if (clr.rub && !contact) { contact = true; warnings.push(`Tip clearance closes to ${clr.delta_mm.toFixed(3)} mm at t = ${t.toFixed(1)} s: blade/casing contact predicted. The clearance model is outside its valid range from here on (efficiency evaluated at the ${CLEARANCE_FLOOR_MM} mm floor).`); }
    }
    // fuel command: open-loop ramp (from light-off in a start-up), or PI controller on the demanded quantity
    const tRef = st ? t - tLit : t;
    const f = Math.min(1, Math.max(0, (tRef - ti.schedule.rampStart_s) / Math.max(ti.schedule.rampDuration_s, 1e-6)));
    let WfCmd = st ? (lit ? st.lightOffFuelFrac * WfDes + (WfEnd - st.lightOffFuelFrac * WfDes) * f : 0) : Wf0(start) + (WfEnd - Wf0(start)) * f;
    if (ctl && lit) {
      const fr = Math.min(1, Math.max(0, (tRef - ti.schedule.rampStart_s) / Math.max(ctl.targetRamp_s, 1e-6)));
      demand = startMeasured + (ctl.target - startMeasured) * fr;
      const meas = Number.isFinite(lastMeasured) ? lastMeasured : startMeasured;
      const e = (demand - meas) / Math.max(Math.abs(demand), 1e-9);
      integ += e * ti.dt_s;
      integ = Math.max(-0.5, Math.min(0.5, integ)); // anti-windup
      WfCmd = Math.max(0.02 * WfDes, WfBase + WfDes * (ctl.Kp * e + ctl.Ki * integ));
    }
    // ratio-unit limiter on the commanded fuel, using P3 of the last converged gas path (refined below once this step is
    // solved); precedence: controller schedule or manual values, never both.  Nothing is limited while unlit.
    const limitFuel = (cmd: number, P3: number): { Wf: number; limited: boolean } => {
      let ruMax = ti.schedule.ratioUnitLimit, ruMin = ti.schedule.ratioUnitFloor;
      if (useSchedule) {
        const nc = speeds.HP / Math.sqrt(T2 / 288.15) / (inp.speeds.HP / Math.sqrt(dp.result.stations.find((q) => q.id === '2')!.Tt / 288.15));
        ruMax = interpSchedule(sched!.accelSchedule, nc); ruMin = sched!.decelFloor;
      }
      let w = cmd, limited = false;
      if (ruMax > 0 && w / P3 > ruMax * ruDes) { w = ruMax * ruDes * P3; limited = true; }
      if (ruMin > 0 && w / P3 < ruMin * ruDes) { w = ruMin * ruDes * P3; limited = true; }
      return { Wf: w, limited };
    };
    let limited = false;
    let WfNow = lit ? Math.max(WfCmd, 2e-4 * WfDes) : 0;
    if (lit && Number.isFinite(lastP3)) ({ Wf: WfNow, limited } = limitFuel(WfNow, lastP3));
    // evaluate at the current state with the (limited) fuel; no fuel while unlit
    let r1 = stepRate(speeds, WfNow, lit);
    if (!r1 || !r1.conv) {
      if (!lit && st) { r1 = starterOnlyRate(speeds); starterOnlySteps++; }
      else { stop(t, r1 ? `Gas path did not converge (${describe(r1)}).` : 'Gas path could not be evaluated.'); break; }
    }
    if (st) {
      const nHP = speeds.HP / inp.speeds.HP;
      if (!lit && r1.gasPath && nHP >= st.lightOffSpeed) {
        const T3 = T3of(r1.r);
        if (T3 >= st.lightOffT3min_K) {
          lit = true; tLit = t;
          warnings.push(`Light-off at t = ${t.toFixed(1)} s, N2 ${(100 * nHP).toFixed(0)} %, T3 ${T3.toFixed(0)} K.`);
          WfCmd = st.lightOffFuelFrac * WfDes;
          WfNow = WfCmd;
          const r1b = stepRate(speeds, WfCmd, true);
          if (!r1b || !r1b.conv) { stop(t, r1b ? `Gas path did not converge at light-off (${describe(r1b)}).` : 'Gas path could not be evaluated at light-off.'); break; }
          r1 = r1b;
          if (ctl) { startMeasured = measure(r1.r, speeds); WfBase = 0; }
        }
      }
      if (starterOn && nHP >= st.starterCutout) { starterOn = false; warnings.push(`Starter cut-out at t = ${t.toFixed(1)} s.`); }
      if (!lit && !starterOn && (r1.dN.HP ?? 0) <= 0) {
        warnings.push(`Hung start: no light-off before the starter cut out (t = ${t.toFixed(1)} s)${r1.gasPath ? '' : '; no through-flow solution was found at the starter-driven speed'}.`);
        samples.push({ ...sample(t, 0, 0, false, speeds, inp, r1.r, r1.conv), gasPath: r1.gasPath, lit, starter: starterOn });
        break;
      }
    }
    // refine the limiter with P3 of this step's solution and re-solve once if the limit moved
    if (lit && r1.gasPath) {
      const P3 = r1.r.stations.find((s) => s.id === '3')!.Pt;
      const lim = limitFuel(Math.max(WfCmd, 2e-4 * WfDes), P3);
      if (lim.limited && Math.abs(lim.Wf / WfNow - 1) > 5e-3) {
        const r2 = stepRate(speeds, lim.Wf, true);
        if (!r2 || !r2.conv) { stop(t, r2 ? `Gas path did not converge at the limited fuel flow (${describe(r2)}).` : 'Gas path could not be evaluated at the limited fuel flow.'); break; }
        r1 = r2; WfNow = lim.Wf;
      }
      limited = lim.limited;
      if (limited && ctl) integ -= 0.5 * (demand - (Number.isFinite(lastMeasured) ? lastMeasured : startMeasured)) / Math.max(Math.abs(demand), 1e-9) * ti.dt_s; // back off the integrator while limited
    }
    Wf = WfNow;
    if (r1.gasPath) { x = r1.xr; xGood = { ...r1.xr }; lastP3 = r1.r.stations.find((s) => s.id === '3')!.Pt; }
    if (ctl && lit) lastMeasured = measure(r1.r, speeds);
    const smp: TransientSample = { ...sample(t, Wf, WfCmd, limited, speeds, inp, r1.r, r1.conv), gasPath: r1.gasPath, lit, starter: starterOn, demand: ctl && lit ? demand : undefined, measured: ctl && lit ? lastMeasured : undefined, bleedOpen: sched ? (geomOverride.handlingBleedFrac ?? 0) > (ti.od.geometry?.handlingBleedFrac ?? inp.geometry.handlingBleedFrac) : undefined, Tcasing: th ? Tcasing : undefined, Tdisc: th ? Tdisc : undefined, clearance_mm: th ? clr.delta_mm : undefined, effDeltaHPC: th ? clr.effDelta : undefined, rub: th ? clr.rub : undefined };
    samples.push(smp);
    if (th) { const T3 = r1.gasPath ? T3of(r1.r) : T2; Tcasing += (ti.dt_s / th.tauCasing_s) * (T3 - Tcasing); Tdisc += (ti.dt_s / th.tauDisc_s) * (T3 - Tdisc); }
    // Heun (RK2) step on speeds; a failed predictor falls back to explicit Euler from the converged corrector
    if (i < n) {
      const k1 = r1.dN;
      const pred: typeof speeds = { ...speeds };
      for (const k of names) (pred as any)[k] = (speeds as any)[k] + ti.dt_s * k1[k];
      let r2: Rate | null = r1.gasPath ? stepRate(pred, Wf, lit) : starterOnlyRate(pred);
      if (r2 && r1.gasPath && !r2.conv) r2 = null;
      if (r2) for (const k of names) (speeds as any)[k] = (speeds as any)[k] + 0.5 * ti.dt_s * (k1[k] + (r2.dN[k] ?? k1[k]));
      else { for (const k of names) (speeds as any)[k] = (speeds as any)[k] + ti.dt_s * k1[k]; eulerSteps++; smp.eulerStep = true; }
    }
    if (progress && t - lastProgress >= 0.5) { progress(samples); lastProgress = t; }
  }
  if (eulerSteps) warnings.push(`${eulerSteps} predictor step(s) did not converge; those steps were integrated with explicit Euler from the converged corrector (marked in the samples).`);
  if (starterOnlySteps) warnings.push(`${starterOnlySteps} sample(s) in the starter-only regime: no through-flow solution exists at the starter-driven speed, so the spool was integrated with starter torque and friction only (no gas-path quantities).`);
  return { samples, design: { Wf: WfDes, ratioUnit: ruDes }, warnings, complete, stoppedAt_s: stoppedAt, eulerSteps, starterOnlySteps, minClearance_mm: th ? minClearance : undefined, contact };
}
const Wf0 = (s: { result: EngineResult }) => s.result.components.find((c) => c.id === 'burner')!.values.Wfuel_kgs;
function interpSchedule(tab: { Nc: number; ratioUnit: number }[], nc: number): number {
  const t = tab.slice().sort((a, b) => a.Nc - b.Nc);
  if (!t.length) return 0;
  if (nc <= t[0].Nc) return t[0].ratioUnit;
  for (let i = 1; i < t.length; i++) if (nc <= t[i].Nc) return t[i - 1].ratioUnit + ((t[i].ratioUnit - t[i - 1].ratioUnit) * (nc - t[i - 1].Nc)) / (t[i].Nc - t[i - 1].Nc);
  return t[t.length - 1].ratioUnit;
}
function isaT2(_dp: DesignPoint, od: OffDesignInputs): number {
  const amb = isa(od.altitude_m, od.dT_isa);
  return amb.T * (1 + 0.2 * od.mach * od.mach);
}
/** placeholder result for the starter-only regime: ambient total conditions, no flow, no thrust */
function noFlowResult(dp: DesignPoint, T2: number): EngineResult {
  const base = dp.result;
  const amb = isa(dp.inputs.flight.altitude_m, dp.inputs.flight.dT_isa);
  const stations = base.stations.map((s) => ({ ...s, Pt: amb.P, Tt: T2, W: 0, V: 0, MN: 0 }));
  const components = base.components.map((c) => c.kind === 'compressor' ? { ...c, values: { ...c.values, PR: 1, surgeMargin_pct: NaN, Wc: NaN, Nc_pct: NaN } } : c.kind === 'burner' ? { ...c, values: { ...c.values, FAR: 0, Wfuel_kgs: 0, T4: T2 } } : c);
  return { ...base, stations, components, perf: { ...base.perf, Fn: 0, Fg: 0, Wfuel: 0 } as EngineResult['perf'], warnings: [], offDesign: { converged: false, iterations: 0, residualNorm: NaN, throttle: 'starter only', x: {} } };
}

function sample(t: number, Wf: number, WfCmd: number, limited: boolean, speeds: { LP: number; IP: number; HP: number }, inp: DesignPoint['inputs'], r: EngineResult, conv: boolean): Omit<TransientSample, 'gasPath'> {
  const N: Record<string, number> = {}, Npct: Record<string, number> = {};
  const relevant = (k: string) => (inp.speeds as any)[k] > 0 && (inp.arch === 'turbofan' ? (k !== 'IP' || inp.spools === 3) : k === 'HP');
  for (const k of ['LP', 'IP', 'HP'] as const) if (relevant(k)) { N[k] = speeds[k]; Npct[k] = (100 * speeds[k]) / (inp.speeds as any)[k]; }
  const SM: Record<string, number> = {}, Wc: Record<string, number> = {}, PR: Record<string, number> = {};
  for (const c of r.components) if (c.kind === 'compressor') { SM[c.id] = c.values.surgeMargin_pct; PR[c.id] = c.values.PR; Wc[c.id] = c.values.Wc ?? NaN; }
  return { t, Wf, WfCmd, limited, N, Npct, Fn: r.perf.Fn, T4: r.stations.find((s) => s.id === '4')!.Tt, T5: r.stations.find((s) => s.id === '5')!.Tt, P3: r.stations.find((s) => s.id === '3')!.Pt, SM, Wc, PR, converged: conv };
}
