/** Reproducible plausibility audit, not a fit or validation against another engine. */
import { defaultInputs } from '../src/engine/defaults';
import { makeDesignPoint, solveOffDesign } from '../src/engine/offdesign';
import { DEFAULT_CONTROLLER, DEFAULT_THERMAL, runTransient, type TransientInputs } from '../src/engine/transient';

export function auditTransients() {
  const rows: object[] = [];
  for (const arch of ['turbojet', 'turbofan'] as const) {
    const inputs = defaultInputs(arch); inputs.chemistry = 'frozen';
    const dp = makeDesignPoint(inputs);
    const od = { ...inputs.flight, throttle: { mode: 'T4' as const, value: inputs.burner.T4_K } };
    const rated = solveOffDesign(dp, od);
    const idle = solveOffDesign(dp, { ...od, throttle: { mode: 'Fn', value: rated.result.perf.Fn * 0.15 } });
    rows.push({ case: `${arch}:15%-thrust-initialization`, converged: idle.converged, thrustFraction: idle.result.perf.Fn / rated.result.perf.Fn, norm: idle.norm, mapViolations: idle.result.offDesign?.mapViolations });
    const sls = { altitude_m: 0, mach: 0, dT_isa: 0, throttle: { mode: 'T4' as const, value: inputs.burner.T4_K } };
    const ratingSLS = solveOffDesign(dp, sls);
    const idleSLS = solveOffDesign(dp, { ...sls, throttle: { mode: 'Fn', value: 0.15 * ratingSLS.result.perf.Fn } });
    if (ratingSLS.converged && idleSLS.converged) {
      const WfDes = dp.result.components.find(c => c.id === 'burner')!.values.Wfuel_kgs;
      const WfSLS = ratingSLS.result.components.find(c => c.id === 'burner')!.values.Wfuel_kgs;
      for (const dt of [0.04, 0.02, 0.01]) {
      const r = runTransient(dp, { od: sls, schedule: { T4start: idleSLS.result.stations.find(s => s.id === '4')!.Tt, WfEndFrac: WfSLS / WfDes, rampStart_s: 0.5, rampDuration_s: 0.3, ratioUnitLimit: 0, ratioUnitFloor: 0 }, duration_s: 12, dt_s: dt, controller: { ...DEFAULT_CONTROLLER } });
      rows.push({ case: `${arch}:SLS-15%-to-rated`, condition: { altitude_m: 0, mach: 0 }, ratingThrust_N: ratingSLS.result.perf.Fn, dt_s: dt, complete: r.complete, initialThrustFraction: r.samples[0]?.Fn / ratingSLS.result.perf.Fn, endThrustFraction: r.samples.at(-1)?.Fn / ratingSLS.result.perf.Fn, t95AfterCommand_s: (r.samples.find(s => s.t >= 0.5 && s.Fn >= 0.95 * ratingSLS.result.perf.Fn)?.t ?? NaN) - 0.5, minSurgeMargin_pct: Object.fromEntries(Object.keys(dp.comps).map(k => [k, Math.min(...r.samples.map(s => s.SM[k]).filter(Number.isFinite))])), peakT4_K: Math.max(...r.samples.map(s => s.T4)), warnings: r.warnings });
    }
    } else rows.push({ case: `${arch}:SLS-15%-to-rated`, available: false, ratingConverged: ratingSLS.converged, idleConverged: idleSLS.converged });
    for (const kind of ['default', 'deceleration', 'N2', 'thermal', 'startup'] as const) {
      const ti: TransientInputs = { od, schedule: { T4start: inputs.burner.T4_K * (kind === 'deceleration' ? 1 : 0.75), WfEndFrac: kind === 'deceleration' ? 0.5 : 1, rampStart_s: 0.5, rampDuration_s: 0.3, ratioUnitLimit: 0, ratioUnitFloor: 0 }, duration_s: kind === 'thermal' ? 40 : kind === 'startup' ? 30 : 12, dt_s: 0.04, controller: { ...DEFAULT_CONTROLLER } };
      if (kind === 'N2') ti.controller = { ...DEFAULT_CONTROLLER, mode: 'N2', target: 0.98 };
      if (kind === 'thermal') ti.thermal = { ...DEFAULT_THERMAL, enabled: true };
      if (kind === 'startup') {
        ti.od = { ...od, altitude_m: 0, mach: 0 }; ti.dt_s = 0.1;
        ti.start = { enabled: true, starterTorque_Nm: inputs.inertia.HP * 60, starterCutout: 0.45, lightOffSpeed: 0.18, lightOffT3min_K: 290, lightOffFuelFrac: 0.06, frictionPower_W: inputs.flight.W_kgs * 150 };
        ti.schedule = { ...ti.schedule, WfEndFrac: 0.5, rampStart_s: 0, rampDuration_s: 20 };
      }
      const r = runTransient(dp, ti), first = r.samples[0], last = r.samples.at(-1);
      const gas = r.samples.filter(s => s.gasPath && s.converged);
      const min = (values: number[]) => values.some(Number.isFinite) ? Math.min(...values.filter(Number.isFinite)) : null;
      const max = (values: number[]) => values.some(Number.isFinite) ? Math.max(...values.filter(Number.isFinite)) : null;
      rows.push({ case: `${arch}:${kind}`, condition: { altitude_m: ti.od.altitude_m, mach: ti.od.mach }, thrustNormalization_N: rated.result.perf.Fn, thrustNormalizationCondition: { altitude_m: od.altitude_m, mach: od.mach }, complete: r.complete, stop_s: r.stoppedAt_s, samples: r.samples.length, initialThrustFraction: first ? first.Fn / rated.result.perf.Fn : null, endThrustFraction: last ? last.Fn / rated.result.perf.Fn : null, t95AfterCommand_s: kind === 'default' && first && first.Fn < 0.95 * rated.result.perf.Fn ? (gas.find(s => s.t >= 0.5 && s.Fn >= 0.95 * rated.result.perf.Fn)?.t ?? NaN) - 0.5 : null, endN_pct: last?.Npct, minSurgeMargin_pct: Object.fromEntries(Object.keys(first?.SM ?? {}).map(k => [k, min(gas.map(s => s.SM[k]))])), minClearance_mm: r.minClearance_mm, maxClearance_mm: max(r.samples.map(s => s.clearance_mm ?? NaN)), minEffDelta: min(r.samples.map(s => s.effDeltaHPC ?? NaN)), peakT4_K: max(gas.map(s => s.T4)), eulerSteps: r.eulerSteps, starterOnlySamples: r.starterOnlySteps, warnings: r.warnings });
    }
  }
  return { description: 'Generic-model plausibility audit. Default acceleration is NOT an idle-to-takeoff certification test. SLS cases use their SLS rating; other thrust fractions use the design-condition rating, including startup. NASA comparisons require matching operating conditions, map data, inertias and controller.', rows };
}
