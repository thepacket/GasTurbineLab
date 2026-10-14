/**
 * Spool transients: time-marching integration of the shaft dynamics
 *   I ω dω/dt = P_turbine − P_load
 * with the gas path solved quasi-steadily at each step (fixed speeds, floating
 * flows, R-lines and turbine pressure ratios).  Fuel is scheduled against time
 * and, optionally, limited by a ratio-unit (Wf/P3) acceleration schedule.
 */
import { DesignPoint, OffDesignInputs, solveOffDesign, designUnknowns } from './offdesign';
import { EngineResult } from './types';

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
export interface TransientInputs { od: OffDesignInputs; schedule: FuelSchedule; duration_s: number; dt_s: number; start?: StartInputs }
export interface TransientSample {
  t: number; Wf: number; WfCmd: number; limited: boolean; lit?: boolean; starter?: boolean;
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

  const stepRate = (sp: typeof speeds, WfNow: number): { dN: Record<string, number>; r: EngineResult; conv: boolean; xr: Record<string, number> } | null => {
    const s = solveOffDesign(dp, { ...ti.od, throttle: { mode: 'Wf', value: Math.max(WfNow, 2e-4 * WfDes) } }, x, { fixedSpeeds: sp });
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
  for (let i = 0; i <= n; i++) {
    const t = i * ti.dt_s;
    // fuel command: ramp
    const f = Math.min(1, Math.max(0, (t - ti.schedule.rampStart_s) / Math.max(ti.schedule.rampDuration_s, 1e-6)));
    let WfCmd = st ? (lit ? st.lightOffFuelFrac * WfDes + (WfEnd - st.lightOffFuelFrac * WfDes) * f : 0) : Wf0(start) + (WfEnd - Wf0(start)) * f;
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
    if (ti.schedule.ratioUnitLimit > 0 && WfCmd / P3 > ti.schedule.ratioUnitLimit * ruDes) { WfNow = ti.schedule.ratioUnitLimit * ruDes * P3; limited = true; }
    if (ti.schedule.ratioUnitFloor > 0 && WfCmd / P3 < ti.schedule.ratioUnitFloor * ruDes) { WfNow = ti.schedule.ratioUnitFloor * ruDes * P3; limited = true; }
    if (limited) { const r2 = stepRate(speeds, WfNow); if (r2) r1 = r2; }
    Wf = WfNow; x = r1.xr;
    samples.push({ ...sample(t, Wf, WfCmd, limited, speeds, inp, r1.r, r1.conv), lit, starter: starterOn });
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

function sample(t: number, Wf: number, WfCmd: number, limited: boolean, speeds: { LP: number; IP: number; HP: number }, inp: DesignPoint['inputs'], r: EngineResult, conv: boolean): TransientSample {
  const N: Record<string, number> = {}, Npct: Record<string, number> = {};
  const relevant = (k: string) => (inp.speeds as any)[k] > 0 && (inp.arch === 'turbofan' ? (k !== 'IP' || inp.spools === 3) : k === 'HP');
  for (const k of ['LP', 'IP', 'HP'] as const) if (relevant(k)) { N[k] = speeds[k]; Npct[k] = (100 * speeds[k]) / (inp.speeds as any)[k]; }
  const SM: Record<string, number> = {}, Wc: Record<string, number> = {}, PR: Record<string, number> = {};
  for (const c of r.components) if (c.kind === 'compressor') { SM[c.id] = c.values.surgeMargin_pct; PR[c.id] = c.values.PR; Wc[c.id] = c.values.Wc ?? NaN; }
  return { t, Wf, WfCmd, limited, N, Npct, Fn: r.perf.Fn, T4: r.stations.find((s) => s.id === '4')!.Tt, T5: r.stations.find((s) => s.id === '5')!.Tt, P3: r.stations.find((s) => s.id === '3')!.Pt, SM, Wc, PR, converged: conv };
}
