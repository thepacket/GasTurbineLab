import { describe, expect, it, vi } from 'vitest';
import { defaultInputs } from '../defaults';
import * as offdesign from '../offdesign';
import { isa } from '../atmosphere';
import { DEFAULT_CONTROLLER, runTransient, type TransientInputs } from '../transient';

function startup(): TransientInputs {
  return {
    od: { altitude_m: 0, mach: 0, dT_isa: 0, throttle: { mode: 'T4', value: 1500 } },
    schedule: { T4start: 1125, WfEndFrac: 0.5, rampStart_s: 0, rampDuration_s: 20, ratioUnitLimit: 0, ratioUnitFloor: 0 },
    duration_s: 20, dt_s: 0.1,
    start: { enabled: true, starterTorque_Nm: 720, starterCutout: 0.45, lightOffSpeed: 0.18, lightOffT3min_K: 290, lightOffFuelFrac: 0.06, frictionPower_W: 7500 },
    controller: { ...DEFAULT_CONTROLLER, mode: 'N2', target: 0.8, targetRamp_s: 20 },
  };
}
const inp = defaultInputs('turbojet');
inp.chemistry = 'frozen';
const dp = offdesign.makeDesignPoint(inp);

describe('transient control state transitions', () => {
  it('releases a fuel limit when the newly solved pressure permits the full command', () => {
    const ti = startup(); ti.start = undefined; ti.controller = undefined; ti.duration_s = 0;
    ti.schedule.ratioUnitLimit = 1;
    const initial = offdesign.solveOffDesign(dp, { ...ti.od, throttle: { mode: 'T4', value: ti.schedule.T4start } });
    const P3 = dp.result.stations.find(s => s.id === '3')!.Pt;
    const spy = vi.spyOn(offdesign, 'solveOffDesign').mockImplementation((_dp, _od, _x, options) => ({
      ...initial, result: { ...initial.result, stations: initial.result.stations.map(s => s.id === '3' ? { ...s, Pt: P3 * (options?.fixedSpeeds ? 1 : 0.1) } : s) },
    }));
    try {
      const r = runTransient(dp, ti);
      expect(r.complete).toBe(true);
      expect(r.samples[0].Wf).toBeCloseTo(r.samples[0].WfCmd, 10);
      expect(r.samples[0].limited).toBe(false);
    } finally { spy.mockRestore(); }
  });
  it.each(['N2', 'Fn'] as const)('transfers bumplessly to %s control and then responds to its feedback', mode => {
    const ti = startup();
    ti.controller = { ...ti.controller!, mode, target: mode === 'Fn' ? 18000 : 0.8 };
    // Hold the ignition setpoint briefly so transfer can be checked independently of tracking.
    ti.schedule.rampStart_s = 0.5;
    const r = runTransient(dp, ti);
    const i = r.samples.findIndex(s => s.lit);
    expect(i).toBeGreaterThan(0);
    expect(r.samples.length).toBeGreaterThan(i + 1);
    const ignition = r.samples[i], next = r.samples[i + 1];
    expect(Number.isFinite(ignition.demand)).toBe(true);
    expect(ignition.demand).toBeCloseTo(ignition.measured!, 10);
    if (mode === 'N2') {
      // The starter continues accelerating: current-speed feedback must respond immediately.
      const e = (next.demand! - next.Npct.HP / 100) / next.demand!;
      const integral = Math.max(-0.5, Math.min(0.5, e * (next.t - ignition.t)));
      expect(next.WfCmd).toBeCloseTo(Math.max(0, ignition.Wf + r.design.Wf * (ti.controller!.Kp * e + ti.controller!.Ki * integral)), 8);
    } else expect(next.WfCmd).toBeCloseTo(ignition.Wf, 8);
    for (const s of r.samples.filter(s => s.lit)) {
      expect(Number.isFinite(s.demand)).toBe(true);
      expect(Number.isFinite(s.WfCmd)).toBe(true);
    }
  });

  it('marks a hung start incomplete and removes starter torque at cut-out', () => {
    const ti = startup();
    ti.controller = undefined;
    ti.od.altitude_m = 2000;
    ti.start = { ...ti.start!, lightOffSpeed: 0.9, starterCutout: 0.06 };
    // Force starter-only operation to isolate the mechanical switching event.
    const solve = offdesign.solveOffDesign;
    const spy = vi.spyOn(offdesign, 'solveOffDesign').mockImplementation((...args) => {
      const s = solve(...args);
      return args[3]?.fixedSpeeds ? { ...s, converged: false } : s;
    });
    try {
      const r = runTransient(dp, ti);
      expect(r.complete).toBe(false);
      const cutout = r.samples.findIndex(s => !s.starter);
      expect(cutout).toBe(r.samples.length - 1);
      expect(r.stoppedAt_s).toBe(r.samples[cutout].t);
      expect(r.samples[0].P3).toBeCloseTo(isa(2000, 0).P, 6);
      expect(r.warnings.some(w => w.startsWith('Hung start'))).toBe(true);
    } finally { spy.mockRestore(); }
  });

  it('does not integrate a running transient from a failed steady initial condition', () => {
    const ti = startup();
    ti.start = undefined;
    const solve = offdesign.solveOffDesign;
    const spy = vi.spyOn(offdesign, 'solveOffDesign').mockImplementation((...args) => {
      const s = solve(...args);
      return args[3]?.fixedSpeeds ? s : { ...s, converged: false };
    });
    try {
      const r = runTransient(dp, ti);
      expect(r.complete).toBe(false);
      expect(r.stoppedAt_s).toBe(0);
      expect(r.samples).toEqual([]);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
  });

  it.each([
    { target: 1, ratioUnitLimit: 0.2, ratioUnitFloor: 0 },
    { target: 0.8, ratioUnitLimit: 0, ratioUnitFloor: 2 },
    { target: 0.1, ratioUnitLimit: 0, ratioUnitFloor: 0 }, // controller's minimum fuel
  ])('does not wind up against a sustained fuel limit ($target speed demand)', limits => {
    const ti = startup();
    ti.start = undefined;
    ti.duration_s = 1;
    ti.schedule = { ...ti.schedule, ...limits };
    ti.controller = { ...DEFAULT_CONTROLLER, mode: 'N2', limiter: 'manual', target: limits.target, targetRamp_s: 0.1 };
    // A stationary plant isolates the integrator from changes in error and pressure.
    // Both upper and lower saturation must freeze integration into the active limit.
    const initial = offdesign.solveOffDesign(dp, { ...ti.od, throttle: { mode: 'T4', value: ti.schedule.T4start } });
    expect(initial.converged).toBe(true);
    const spy = vi.spyOn(offdesign, 'solveOffDesign').mockImplementation(() => ({
      ...initial,
      result: { ...initial.result, offDesign: { ...initial.result.offDesign!, shaftImbalance_W: {} } },
    }));
    try {
      const r = runTransient(dp, ti);
      expect(r.complete).toBe(true);
      const saturated = r.samples.filter(s => s.t >= 0.2);
      expect(saturated.every(s => s.limited)).toBe(true);
      expect(Math.max(...saturated.map(s => s.WfCmd)) - Math.min(...saturated.map(s => s.WfCmd))).toBeLessThan(1e-10);
    } finally { spy.mockRestore(); }
  });
});
