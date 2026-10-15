import { defaultInputs } from '../src/engine/defaults';
import { makeDesignPoint, solveOffDesign } from '../src/engine/offdesign';
import { defaultMission, runMission, scaledAircraftMass } from '../src/engine/mission';
import { isa } from '../src/engine/atmosphere';
export function auditMissions() {
  return (['turbojet', 'turbofan', 'turboprop'] as const).map(arch => {
    const inputs = { ...defaultInputs(arch), chemistry: 'frozen' as const };
    const dp = makeDesignPoint(inputs);
    const sls = solveOffDesign(dp, { altitude_m: 0, mach: 0, dT_isa: 0, throttle: { mode: 'T4', value: inputs.burner.T4_K } });
    const profile = defaultMission(arch);
    const estimatedThrust = dp.result.perf.Fn * (101325 / isa(inputs.flight.altitude_m).P) * (inputs.flight.mach > 0.3 ? .75 : 1);
    const estimatedMass = scaledAircraftMass(arch, estimatedThrust, profile.aircraft.engines, inputs.prop.shaftPower_W);
    return { arch, estimatedMass, slsConverged: sls.converged, slsThrust_N: sls.result.perf.Fn,
      massFromSolvedRating: scaledAircraftMass(arch, sls.result.perf.Fn, profile.aircraft.engines, inputs.prop.shaftPower_W),
      refinement: [4, 8, 16, 32].map(pointsPerSegment => {
        try {
          const r = runMission(dp, { ...profile, aircraft: { ...profile.aircraft, mass_kg: estimatedMass },
            pointsPerSegment, od: { altitude_m: 0, mach: 0, dT_isa: 0, throttle: { mode: 'T4', value: inputs.burner.T4_K } } });
          return { pointsPerSegment, ...r.totals, complete: r.complete, feasible: r.feasible,
            maxShortfall: r.maxShortfall, ratingViolations: r.ratingViolations, operabilityViolations: r.operabilityViolations,
            trajectoryViolations: r.trajectoryViolations, unconvergedPoints: r.unconvergedPoints };
        } catch (e) { return { pointsPerSegment, error: String(e) }; }
      }) };
  });
}
