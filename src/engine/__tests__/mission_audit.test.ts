import { afterEach, describe, expect, it, vi } from 'vitest';
import { isa } from '../atmosphere';
import { defaultInputs } from '../defaults';
import * as od from '../offdesign';
import { defaultMission, runMission, type MissionInputs, scaledAircraftMass } from '../mission';

const inputs = { ...defaultInputs('turbojet'), chemistry: 'frozen' as const };
const dp = od.makeDesignPoint(inputs);
const baseline = od.solveOffDesign(dp, { ...inputs.flight, throttle: { mode: 'T4', value: inputs.burner.T4_K } });
const mission = (): MissionInputs => ({
  aircraft: { mass_kg: 10000, wingArea_m2: 100, CD0: 0.02, k: 0.04, engines: 1, installed: false },
  segments: [{ kind: 'hold', label: 'Hold', alt0_m: 0, alt1_m: 0, mach: 0.3, value: 100 }],
  pointsPerSegment: 3, od: { ...inputs.flight, throttle: { mode: 'T4', value: inputs.burner.T4_K } },
});
function solution(thrust: number, flow = 1) {
  const s = structuredClone(baseline);
  s.converged = true; s.x.N_HP = inputs.speeds.HP;
  s.result.stations.find(q => q.id === '4')!.Tt = inputs.burner.T4_K;
  s.result.perf.Fn = thrust; s.result.perf.installedFn = thrust; s.result.perf.Wfuel = flow;
  s.result.components.filter(c => c.kind === 'compressor').forEach(c => { c.values.surgeMargin_pct = 20; });
  return s;
}
afterEach(() => vi.restoreAllMocks());
describe('mission integration and feasibility audit', () => {
  it('integrates linearly varying endpoint fuel flow exactly and uses installed TSFC', () => {
    vi.spyOn(od, 'solveOffDesign').mockImplementation((_dp, req) => solution(req.throttle.value, 1 + req.altitude_m / 1000));
    const mi = mission(); mi.aircraft.installed = true;
    mi.segments = [{ kind: 'climb', label: 'Climb', alt0_m: 0, alt1_m: 1000, mach: 0.3, value: 10 }];
    const r = runMission(dp, mi);
    expect(r.complete).toBe(true); expect(r.totals.time_s).toBe(100);
    expect(r.totals.fuel_kg).toBeCloseTo(150, 6);
    expect(r.points.at(-1)!.mass_kg).toBeCloseTo(9850, 6);
    expect(r.points.at(-1)!.TSFC).toBeCloseTo(2e6 / r.points.at(-1)!.Fn, 6);
  });
  it('couples mass-dependent fuel burn with second-order refinement', () => {
    vi.spyOn(od, 'solveOffDesign').mockImplementation((_dp, req) => solution(req.throttle.value, req.throttle.value * 1e-4));
    const mi = mission(); mi.aircraft.CD0 = 0; mi.aircraft.wingArea_m2 = 10;
    const errors = [3, 5, 9].map(pointsPerSegment => {
      const r = runMission(dp, { ...mi, pointsPerSegment });
      // Pure induced drag makes fuel flow proportional to mass squared.
      const alpha = r.points[0].Wf / mi.aircraft.mass_kg ** 2;
      const exact = mi.aircraft.mass_kg / (1 + alpha * mi.aircraft.mass_kg * 100);
      return Math.abs(r.points.at(-1)!.mass_kg - exact);
    });
    expect(errors[1]).toBeLessThan(errors[0] / 3.5);
    expect(errors[2]).toBeLessThan(errors[1] / 3.5);
  });
  it('uses the weight component normal to an isothermal climb for induced drag', () => {
    vi.spyOn(od, 'solveOffDesign').mockImplementation((_dp, req) => solution(req.throttle.value, 0));
    const mi = mission(); mi.segments = [{ kind: 'climb', label: 'Climb', alt0_m: 12000, alt1_m: 13000, mach: 0.4, value: 50 }];
    const p = runMission(dp, mi).points[0];
    const amb = isa(12000, 0, inputs.flight.altIsGeopotential), speed = 0.4 * amb.a;
    const weight = mi.aircraft.mass_kg * 9.80665, sinGamma = 50 / speed;
    const qS = 0.5 * amb.rho * speed ** 2 * mi.aircraft.wingArea_m2;
    const drag = qS * mi.aircraft.CD0 + mi.aircraft.k * weight ** 2 * (1 - sinGamma ** 2) / qS;
    expect(p.FnReq).toBeCloseTo(drag + weight * sinGamma, 5);
  });
  it('keeps a small positive aircraft mass and rejects missing ratings', () => {
    expect(scaledAircraftMass('turbojet', 1, 1)).toBeGreaterThan(0);
    expect(scaledAircraftMass('turboprop', 0, 1, 1)).toBeGreaterThan(0);
    const mi = mission(); mi.ratings = { NLPmax: 1, NHPmax: 1, T4max_K: undefined! };
    expect(() => runMission(dp, mi)).toThrow(/ratings/);
  });
  it('finds the T4 boundary when thrust and speed solves fail', () => {
    vi.spyOn(od, 'solveOffDesign').mockImplementation((_dp, req) => {
      const s = solution(1000); s.converged = req.throttle.mode === 'T4'; return s;
    });
    const r = runMission(dp, mission());
    expect(r.complete).toBe(true); expect(r.unconvergedPoints).toBe(0);
    expect(r.points.every(p => p.limited === 'T4 limit')).toBe(true);
  });
  it('rejects a speed-boundary candidate that violates T4', () => {
    vi.spyOn(od, 'solveOffDesign').mockImplementation((_dp, req) => {
      const s = solution(req.throttle.mode === 'NHP' ? 50000 : 1000);
      s.converged = req.throttle.mode !== 'Fn';
      if (req.throttle.mode === 'NHP') s.result.stations.find(q => q.id === '4')!.Tt = inputs.burner.T4_K + 100;
      return s;
    });
    const r = runMission(dp, mission());
    expect(r.ratingViolations).toBe(0);
    expect(r.points.every(p => p.limited === 'T4 limit' && p.Fn === 1000)).toBe(true);
  });
  it('does not replace a failed explicit throttle with a different command', () => {
    const spy = vi.spyOn(od, 'solveOffDesign').mockImplementation(() => ({ ...solution(1000), converged: false }));
    const mi = mission(); mi.segments[0].T4frac = 0.5;
    expect(runMission(dp, mi).complete).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('stops before a failed interval and reports partial totals', () => {
    vi.spyOn(od, 'solveOffDesign').mockImplementation((_dp, req) => {
      const s = solution(req.throttle.value); s.converged = req.altitude_m < 500; return s;
    });
    const mi = mission(); mi.segments = [{ kind: 'climb', label: 'Climb', alt0_m: 0, alt1_m: 1000, mach: 0.3, value: 10 }];
    const r = runMission(dp, mi);
    expect(r.complete).toBe(false); expect(r.feasible).toBe(false);
    expect(r.totals.fuel_kg).toBe(0); expect(r.totals.time_s).toBe(0);
    expect(r.warnings[0]).toContain('partial');
  });
  it('rejects an unmodeled braking requirement on steep descent', () => {
    vi.spyOn(od, 'solveOffDesign').mockImplementation((_dp, req) => solution(req.throttle.value));
    const mi = mission(); mi.segments = [{ kind: 'descent', label: 'Descent', alt0_m: 1000, alt1_m: 0, mach: 0.3, value: 40 }];
    const r = runMission(dp, mi);
    expect(r.points.some(p => p.FnReq < 0)).toBe(true);
    expect(r.trajectoryViolations).toBeGreaterThan(0); expect(r.feasible).toBe(false);
  });
  it('includes the 2% boundary without floating-point misclassification', () => {
    vi.spyOn(od, 'solveOffDesign').mockImplementation((_dp, req) => solution(0.98 * req.throttle.value));
    expect(runMission(dp, mission()).feasible).toBe(true);
  });
  it('rejects altitude jumps and changing-altitude level segments', () => {
    const mi = mission(); mi.segments.push({ ...mi.segments[0], alt0_m: 100, alt1_m: 100 });
    expect(() => runMission(dp, mi)).toThrow(/discontinuous/);
    mi.segments = [{ ...mi.segments[0], alt1_m: 100 }];
    expect(() => runMission(dp, mi)).toThrow(/Level segment/);
    for (const arch of ['turbofan', 'turbojet', 'turboprop']) {
      const segs = defaultMission(arch).segments;
      expect(segs.slice(1).every((s, i) => s.alt0_m === segs[i].alt1_m)).toBe(true);
    }
  });
});
