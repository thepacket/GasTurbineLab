/**
 * Mission analysis: a flight profile flown off-design with the engine's fixed
 * geometry.  A simple aircraft (mass, wing area, parabolic drag polar, engine
 * count) sets the thrust required in each segment; the throttle is solved to
 * match it and fuel burn is integrated as mass decreases.
 */
import { DesignPoint, OffDesignInputs, solveOffDesign } from './offdesign';
import { isa } from './atmosphere';

export interface Aircraft { mass_kg: number; wingArea_m2: number; CD0: number; k: number; engines: number; installed: boolean }
export type SegmentKind = 'takeoff' | 'climb' | 'cruise' | 'descent' | 'hold';
export interface Segment {
  kind: SegmentKind; label: string;
  alt0_m: number; alt1_m: number; mach: number;
  /** duration (s) for take-off/hold, distance (km) for cruise, rate of climb/descent (m/s) for climb/descent */
  value: number;
  /** throttle override: fraction of design T4 (take-off); otherwise thrust is matched to the aircraft */
  T4frac?: number;
}
export interface Ratings { NLPmax: number; NHPmax: number; T4max_K: number } // engine limits applied when matching thrust
export interface MissionInputs { aircraft: Aircraft; segments: Segment[]; od: OffDesignInputs; pointsPerSegment: number; ratings?: Ratings }
export interface MissionPoint { t_s: number; dist_km: number; alt_m: number; mach: number; mass_kg: number; FnReq: number; Fn: number; Wf: number; T4: number; NHPpct: number; NLPpct: number; TSFC: number; converged: boolean; segment: string; limited: string | null }
export interface MissionResult {
  points: MissionPoint[]; segments: { label: string; time_s: number; fuel_kg: number; dist_km: number }[];
  totals: { time_s: number; fuel_kg: number; dist_km: number; blockFuelFrac: number }; warnings: string[];
  /** every point converged and delivered the required thrust (within 2 %) */
  feasible: boolean;
  /** largest relative thrust shortfall over the mission, 0 when none */
  maxShortfall: number;
  unconvergedPoints: number;
  ratingViolations: number;
  operabilityViolations: number;
}

export function runMission(dp: DesignPoint, mi: MissionInputs, progress?: (p: MissionPoint[]) => void): MissionResult {
  const ac = mi.aircraft;
  if (![ac.mass_kg, ac.wingArea_m2, ac.engines].every(v => Number.isFinite(v) && v > 0) || !Number.isInteger(ac.engines) || ![ac.CD0, ac.k].every(v => Number.isFinite(v) && v >= 0)) throw new Error('Invalid aircraft mass, wing area, engine count or drag polar.');
  if (!mi.segments.length || !Number.isInteger(mi.pointsPerSegment) || mi.pointsPerSegment < 2 || mi.pointsPerSegment > 10000) throw new Error('A mission needs segments and 2–10000 points per segment.');
  if (mi.ratings && !Object.values(mi.ratings).every(v => Number.isFinite(v) && v > 0)) throw new Error('Engine ratings must be finite and positive.');
  for (const seg of mi.segments) {
    if (![seg.alt0_m, seg.alt1_m, seg.mach, seg.value].every(Number.isFinite) || seg.mach <= 0 || seg.value <= 0 || (seg.T4frac !== undefined && (!Number.isFinite(seg.T4frac) || seg.T4frac <= 0))) throw new Error(`Invalid mission segment: ${seg.label}.`);
    if ((seg.kind === 'climb' && seg.alt1_m <= seg.alt0_m) || (seg.kind === 'descent' && seg.alt1_m >= seg.alt0_m)) throw new Error(`Altitude direction conflicts with ${seg.kind}: ${seg.label}.`);
    if ((seg.kind === 'climb' || seg.kind === 'descent') && seg.value >= seg.mach * Math.min(isa(seg.alt0_m, mi.od.dT_isa).a, isa(seg.alt1_m, mi.od.dT_isa).a)) throw new Error(`Vertical speed must be below airspeed: ${seg.label}.`);
  }
  const warnings: string[] = [];
  const points: MissionPoint[] = [];
  const segOut: MissionResult['segments'] = [];
  let t = 0, dist = 0, mass = ac.mass_kg;
  let warm: Record<string, number> | undefined;
  const g = 9.80665;
  let ratingViolations = 0, operabilityViolations = 0;
  for (const seg of mi.segments) {
    const n = Math.max(2, mi.pointsPerSegment);
    let segFuel = 0, segT = 0, segD = 0;
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      const alt = seg.alt0_m + (seg.alt1_m - seg.alt0_m) * f;
      const amb = isa(alt, mi.od.dT_isa, dp.inputs.flight.altIsGeopotential);
      const V = seg.mach * amb.a;
      const q = 0.5 * amb.rho * V * V;
      // thrust required (per engine): drag + climb component (climb: T = D + W sin γ with sin γ = ROC/V)
      const CL = q > 0 ? (mass * g) / (q * ac.wingArea_m2) : 0;
      const D = q * ac.wingArea_m2 * (ac.CD0 + ac.k * CL * CL);
      let dt: number, dd: number, FnReqTot: number;
      if (seg.kind === 'takeoff' || seg.kind === 'hold') { dt = seg.value / (n - 1); dd = (V * dt) / 1000; FnReqTot = D; }
      else if (seg.kind === 'cruise') { dd = seg.value / (n - 1); dt = (dd * 1000) / Math.max(V, 1); FnReqTot = D; }
      else { const roc = seg.value * (seg.kind === 'descent' ? -1 : 1); const dh = (seg.alt1_m - seg.alt0_m) / (n - 1); dt = Math.abs(dh / (roc || 1e-6)); dd = (Math.sqrt(Math.max(V * V - roc * roc, 0)) * dt) / 1000; FnReqTot = D + mass * g * (roc / Math.max(V, 1)); }
      const FnReq = Math.max(FnReqTot / ac.engines, 0);
      const rt = mi.ratings ?? { NLPmax: 1.04, NHPmax: 1.02, T4max_K: dp.inputs.burner.T4_K };
      const base: OffDesignInputs = { ...mi.od, altitude_m: alt, mach: seg.mach, installation: ac.installed, throttle: seg.T4frac ? { mode: 'T4', value: seg.T4frac * dp.inputs.burner.T4_K } : { mode: 'Fn', value: Math.max(FnReq, 0.02 * dp.result.perf.Fn) } };
      let s = solveOffDesign(dp, base, warm);
      let limited: string | null = null;
      // apply the engine ratings: if the matched point exceeds a limit, run at that limit instead (thrust shortfall is reported)
      const over = (sol: typeof s) => {
        const nlp = (sol.x.N_LP ?? dp.inputs.speeds.LP) / dp.inputs.speeds.LP, nhp = sol.x.N_HP / dp.inputs.speeds.HP, t4 = sol.result.stations.find((q) => q.id === '4')!.Tt;
        if (dp.inputs.arch === 'turbofan' && nlp > rt.NLPmax + 1e-3) return { mode: 'NLP' as const, value: rt.NLPmax, label: 'N1 redline' };
        if (nhp > rt.NHPmax + 1e-3) return { mode: 'NHP' as const, value: rt.NHPmax, label: 'N2 redline' };
        if (t4 > rt.T4max_K + 0.5) return { mode: 'T4' as const, value: rt.T4max_K, label: 'T4 limit' };
        return null;
      };
      if (!s.converged && !seg.T4frac) {
        // thrust matching failed (often an overspeed region): run at the redlines instead
        for (const lim of [{ mode: 'NLP' as const, value: rt.NLPmax, label: 'N1 redline' }, { mode: 'NHP' as const, value: rt.NHPmax, label: 'N2 redline' }]) {
          if (lim.mode === 'NLP' && dp.inputs.arch !== 'turbofan') continue;
          const s2 = solveOffDesign(dp, { ...base, throttle: { mode: lim.mode, value: lim.value } }, warm);
          if (s2.converged) { s = s2; limited = lim.label; break; }
        }
      }
      for (let k = 0; k < 3; k++) {
        const lim = s.converged ? over(s) : null;
        if (!lim) break;
        const s2 = solveOffDesign(dp, { ...base, throttle: { mode: lim.mode, value: lim.value } }, s.converged ? s.x : warm);
        if (!s2.converged) break;
        s = s2; limited = lim.label;
      }
      const violation = s.converged ? over(s) : null;
      if (violation) { ratingViolations++; warnings.push(`${seg.label}: point ${i + 1} exceeds ${violation.label}; no converged point within all ratings was found.`); }
      if (s.converged && s.result.components.some(c => c.kind === 'compressor' && (!Number.isFinite(c.values.surgeMargin_pct) || c.values.surgeMargin_pct < 0))) {
        operabilityViolations++; warnings.push(`${seg.label}: point ${i + 1} has a compressor at negative or undefined surge margin; steady mission operation is not feasible.`);
      }
      if (s.converged) warm = s.x; else warnings.push(`${seg.label}: point ${i + 1} did not converge (Fn required ${(FnReq / 1000).toFixed(1)} kN).`);
      const Fn = ac.installed ? s.result.perf.installedFn : s.result.perf.Fn;
      if (!seg.T4frac && Fn < FnReq * 0.98 && s.converged) warnings.push(`${seg.label}: thrust required ${(FnReq / 1000).toFixed(1)} kN exceeds available ${(Fn / 1000).toFixed(1)} kN at ${alt.toFixed(0)} m${limited ? ` (${limited})` : ''}.`);
      const Wf = s.result.perf.Wfuel * ac.engines;
      if (!Number.isFinite(Wf) || Wf < 0 || !Number.isFinite(Fn)) throw new Error(`${seg.label}: gas path returned invalid fuel flow or thrust.`);
      if (i > 0) { const dFuel = Wf * dt; if (dFuel >= mass) throw new Error(`${seg.label}: fuel consumption exhausts the aircraft mass; the mission cannot be integrated.`); mass -= dFuel; segFuel += dFuel; segT += dt; segD += dd; t += dt; dist += dd; }
      points.push({ t_s: t, dist_km: dist, alt_m: alt, mach: seg.mach, mass_kg: mass, FnReq, Fn, Wf, T4: s.result.stations.find((x) => x.id === '4')!.Tt, NHPpct: (100 * (s.x.N_HP ?? dp.inputs.speeds.HP)) / dp.inputs.speeds.HP, NLPpct: (100 * (s.x.N_LP ?? dp.inputs.speeds.LP)) / Math.max(dp.inputs.speeds.LP, 1), TSFC: s.result.perf.TSFC_mg_Ns, converged: s.converged, segment: seg.label, limited });
    }
    segOut.push({ label: seg.label, time_s: segT, fuel_kg: segFuel, dist_km: segD });
    progress?.(points);
  }
  const fuel = ac.mass_kg - mass;
  const shortfalls = points.map((p) => (p.FnReq > 0 ? Math.max(0, 1 - p.Fn / p.FnReq) : 0));
  const maxShortfall = Math.max(0, ...shortfalls);
  const unconvergedPoints = points.filter((p) => !p.converged).length;
  const feasible = unconvergedPoints === 0 && ratingViolations === 0 && operabilityViolations === 0 && maxShortfall <= 0.02;
  if (!feasible) warnings.unshift(`Mission infeasible: ${unconvergedPoints} unconverged point(s), ${ratingViolations} rating violation(s), ${operabilityViolations} surge-margin violation(s), maximum thrust shortfall ${(100 * maxShortfall).toFixed(0)} %. Fuel and time totals are for the flown profile and do not represent a completed mission.`);
  return { points, segments: segOut, totals: { time_s: t, fuel_kg: fuel, dist_km: dist, blockFuelFrac: fuel / ac.mass_kg }, warnings, feasible, maxShortfall, unconvergedPoints, ratingViolations, operabilityViolations };
}

/** Aircraft mass scaled so the engines give a thrust/weight ratio of ~0.28 at sea level (power loading ~ 0.17 kW/kg for turboprops). */
export function scaledAircraftMass(arch: string, FnSLS_N: number, engines: number, shaftPower_W = 0): number {
  if (arch === 'turboprop') return Math.round((engines * shaftPower_W) / 170 / 100) * 100;
  return Math.round((engines * FnSLS_N) / (9.80665 * 0.28) / 500) * 500;
}

export function defaultMission(arch: string): { aircraft: Aircraft; segments: Segment[] } {
  if (arch === 'turboprop') {
    return {
      aircraft: { mass_kg: 22000, wingArea_m2: 61, CD0: 0.025, k: 0.045, engines: 2, installed: false },
      segments: [
        { kind: 'takeoff', label: 'Take-off', alt0_m: 0, alt1_m: 0, mach: 0.15, value: 60, T4frac: 1.0 },
        { kind: 'climb', label: 'Climb', alt0_m: 0, alt1_m: 7000, mach: 0.35, value: 8 },
        { kind: 'cruise', label: 'Cruise', alt0_m: 7000, alt1_m: 7000, mach: 0.45, value: 600 },
        { kind: 'descent', label: 'Descent', alt0_m: 7000, alt1_m: 0, mach: 0.35, value: 6 },
      ],
    };
  }
  if (arch === 'turbojet') {
    return {
      aircraft: { mass_kg: 90000, wingArea_m2: 226, CD0: 0.018, k: 0.055, engines: 4, installed: false },
      segments: [
        { kind: 'takeoff', label: 'Take-off', alt0_m: 0, alt1_m: 0, mach: 0.25, value: 60, T4frac: 1.0 },
        { kind: 'climb', label: 'Climb', alt0_m: 0, alt1_m: 10000, mach: 0.7, value: 10 },
        { kind: 'cruise', label: 'Cruise', alt0_m: 10000, alt1_m: 10000, mach: 0.82, value: 2500 },
        { kind: 'descent', label: 'Descent', alt0_m: 10000, alt1_m: 0, mach: 0.6, value: 8 },
      ],
    };
  }
  return {
    aircraft: { mass_kg: 62000, wingArea_m2: 122, CD0: 0.022, k: 0.042, engines: 2, installed: false },
    segments: [
      { kind: 'takeoff', label: 'Take-off', alt0_m: 0, alt1_m: 0, mach: 0.25, value: 60, T4frac: 1.0 },
      { kind: 'climb', label: 'Climb', alt0_m: 0, alt1_m: 11000, mach: 0.72, value: 10 },
      { kind: 'cruise', label: 'Cruise', alt0_m: 11000, alt1_m: 11000, mach: 0.78, value: 2000 },
      { kind: 'descent', label: 'Descent', alt0_m: 11000, alt1_m: 0, mach: 0.6, value: 8 },
      { kind: 'hold', label: 'Hold', alt0_m: 1500, alt1_m: 1500, mach: 0.35, value: 1800 },
    ],
  };
}
