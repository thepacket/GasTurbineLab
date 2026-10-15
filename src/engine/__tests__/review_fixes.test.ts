import { describe, it, expect } from 'vitest';
import { defaultInputs } from '../defaults';
import { makeDesignPoint } from '../offdesign';
import { runMission, defaultMission } from '../mission';
import { runOptimization, VARIABLES } from '../optimize';
import { sanitizeShared } from '../../ui/share';
import { esc } from '../../ui/Report';

describe('review fixes', () => {
  it('an undersized engine makes the mission infeasible and the optimiser does not reward it', () => {
    const inp = defaultInputs('turbofan'); inp.chemistry = 'frozen'; // cruise design, ~26 kN
    const dp = makeDesignPoint(inp);
    const m = defaultMission('turbofan'); m.aircraft.mass_kg = 160000; // far too heavy for this engine
    const r = runMission(dp, { aircraft: m.aircraft, segments: m.segments, od: { altitude_m: 11000, mach: 0.8, dT_isa: 0, throttle: { mode: 'T4', value: inp.burner.T4_K } }, pointsPerSegment: 4 });
    console.log('mission feasible', r.feasible, 'max shortfall', (100 * r.maxShortfall).toFixed(0) + '%', 'unconverged', r.unconvergedPoints);
    expect(r.feasible).toBe(false);
    expect(r.maxShortfall).toBeGreaterThan(0.2);
    const o = runOptimization(inp, { variables: VARIABLES.filter((v) => v.path === 'flight.W_kgs'), objective: 'missionFuel', constraints: [], maxEvals: 12, mission: { aircraft: m.aircraft, segments: m.segments, od: { altitude_m: 11000, mach: 0.8, dT_isa: 0, throttle: { mode: 'T4', value: inp.burner.T4_K } }, pointsPerSegment: 3 } });
    expect(o.trace.filter((t) => t.x[0] < 200).every((t) => !t.feasible)).toBe(true); // small-airflow designs are penalised, not favoured
  });
  it('HTML in shared notes is escaped in the report and shared data is sanitised', () => {
    expect(esc('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    const d = sanitizeShared({ inputs: { arch: 'turbofan', BPR: 7, bogus: 1, burner: { T4_K: 'NaN' as any, dPqP: 0.04 }, mapIds: { hpc: 'custom:ok', fan: '<script>' } }, note: '<b>x</b>', mode: 'weird' }, defaultInputs);
    expect(d).not.toBeNull();
    expect((d!.inputs as any).bogus).toBeUndefined();
    expect(d!.inputs.BPR).toBe(7);
    expect(d!.inputs.burner.T4_K).toBe(defaultInputs('turbofan').burner.T4_K);
    expect(d!.inputs.mapIds).toEqual({ hpc: 'custom:ok' });
    expect(d!.mode).toBe('design');
    expect(sanitizeShared({ inputs: 'nope' }, defaultInputs)).toBeNull();
  });
});

import { runLto } from '../certification';
import { solveEngine } from '../cycle';
import { runMonteCarlo, UNCERTAIN } from '../montecarlo';
import { solveOffDesign } from '../offdesign';

describe('review fixes, second group', () => {
  it('LTO uses the OPR of the converged sea-level rating point, not the cruise design OPR', () => {
    const inp = defaultInputs('turbofan'); inp.chemistry = 'frozen'; // cruise design at 11 km
    const dp = makeDesignPoint(inp);
    const r = runLto(dp);
    const sls = solveOffDesign(dp, { altitude_m: 0, mach: 0, dT_isa: 0, throttle: { mode: 'T4', value: inp.burner.T4_K } });
    console.log('LTO reference: design OPR', dp.result.perf.OPR.toFixed(1), 'SLS rating OPR', sls.result.perf.OPR.toFixed(1), 'used', r.OPR.toFixed(1), 'NOx limit', r.limits.NOx.toFixed(1));
    expect(Math.abs(r.OPR - sls.result.perf.OPR)).toBeLessThan(0.05);
    expect(r.OPR).toBeLessThan(dp.result.perf.OPR);
  });
  it('Monte Carlo never samples efficiencies or recoveries above 1 and reports redraws', () => {
    const inp = defaultInputs('turbofan'); inp.chemistry = 'frozen';
    const r = runMonteCarlo(inp, { inputs: UNCERTAIN.filter((u) => ['inlet.ramRecovery', 'fan.eff'].includes(u.path)).map((u) => ({ ...u, sigma: 0.02 })), samples: 300, seed: 3 });
    console.log('MC bounds: truncated', r.truncated, 'failures', r.failures, 'Fn p95', r.stats.Fn.p95.toFixed(0));
    expect(r.truncated).toBeGreaterThan(0);
    expect(r.failures).toBe(0);
    // with recovery capped at 1 the thrust distribution cannot exceed the recovery=1 result by more than the fan-efficiency effect
    const cap = solveEngine({ ...inp, inlet: { ...inp.inlet, ramRecovery: 1 }, fan: { ...inp.fan, eff: 1 } }).perf.Fn;
    expect(Math.max(...r.Fn)).toBeLessThanOrEqual(cap * 1.0001);
  });
});
