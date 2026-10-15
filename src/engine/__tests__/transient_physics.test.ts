import { afterEach, expect, it, vi } from 'vitest';
import { defaultInputs } from '../defaults';
import * as offdesign from '../offdesign';
import { DEFAULT_CONTROLLER, DEFAULT_THERMAL, runTransient, type TransientInputs } from '../transient';

const inputs = defaultInputs('turbojet'); inputs.chemistry = 'frozen';
const dp = offdesign.makeDesignPoint(inputs);
function config(): TransientInputs {
  return { od: { altitude_m: 0, mach: 0, dT_isa: 0, throttle: { mode: 'T4', value: 1500 } }, schedule: { T4start: 1125, WfEndFrac: 1, rampStart_s: 0, rampDuration_s: 1, ratioUnitLimit: 0, ratioUnitFloor: 0 }, duration_s: 1, dt_s: 0.1 };
}
const initial = offdesign.solveOffDesign(dp, { ...config().od, throttle: { mode: 'T4', value: 1125 } });
afterEach(() => vi.restoreAllMocks());

it('converges to the analytic constant-power rotor energy balance', () => {
  const power = 1e6;
  vi.spyOn(offdesign, 'solveOffDesign').mockReturnValue({ ...initial, result: { ...initial.result, offDesign: { ...initial.result.offDesign!, shaftImbalance_W: { Shaft: power } } } });
  const omega0 = initial.x.N_HP * 2 * Math.PI / 60;
  const exact = Math.sqrt(omega0 ** 2 + 2 * power / inputs.inertia.HP);
  const errors = [0.1, 0.05, 0.025].map(dt_s => {
    const r = runTransient(dp, { ...config(), dt_s });
    expect(r.complete).toBe(true); expect(r.eulerSteps).toBe(0);
    const omega = r.samples.at(-1)!.Npct.HP / 100 * inputs.speeds.HP * 2 * Math.PI / 60;
    return Math.abs(omega - exact);
  });
  expect(errors[1]).toBeLessThan(errors[0] / 3);
  expect(errors[2]).toBeLessThan(errors[1] / 3);
  expect(errors[2] / exact).toBeLessThan(1e-5);
});

it.each([false, true])('preserves component overrides; thermal enabled = %s affects only the compressor', enabled => {
  const ti = config(); ti.duration_s = 0;
  ti.od.deltas = { comp: { eff: 0.98, Wc: 0.97 }, turb: { eff: 0.96 } };
  ti.thermal = { ...DEFAULT_THERMAL, enabled };
  const spy = vi.spyOn(offdesign, 'solveOffDesign').mockReturnValue(initial);
  const r = runTransient(dp, ti);
  expect(r.complete).toBe(true);
  const od = spy.mock.calls.find(call => call[3]?.fixedSpeeds)![1];
  expect(od.deltas?.turb).toEqual(ti.od.deltas.turb);
  const delta = r.samples[0].effDeltaHPC ?? 0;
  expect(od.deltas?.comp?.eff).toBeCloseTo(0.98 * (1 + delta), 12);
  expect(od.deltas?.comp?.Wc).toBeCloseTo(0.97 * (1 + 0.3 * delta), 12);
});

it('stops before publishing an impossible component efficiency', () => {
  vi.spyOn(offdesign, 'solveOffDesign').mockImplementation((_dp, _od, _x, options) => options?.fixedSpeeds ? {
    ...initial, result: { ...initial.result, components: initial.result.components.map(c => c.kind === 'compressor' ? { ...c, values: { ...c.values, eff: 1.01 } } : c) },
  } : initial);
  const r = runTransient(dp, config());
  expect(r.complete).toBe(false); expect(r.samples).toHaveLength(0);
  expect(r.warnings.join(' ')).toContain('efficiency is outside (0, 1]');
});

it('rejects invalid inertia, thermal parameters and inconsistent limiter bounds', () => {
  expect(() => runTransient({ ...dp, inputs: { ...inputs, inertia: { ...inputs.inertia, HP: 0 } } }, config())).toThrow(/inertia/);
  expect(() => runTransient(dp, { ...config(), thermal: { ...DEFAULT_THERMAL, enabled: true, alpha_1perK: -1 } })).toThrow(/Thermal/);
  expect(() => runTransient(dp, { ...config(), controller: { ...DEFAULT_CONTROLLER, decelFloor: 2 } })).toThrow(/floor/);
});

it('integrates PI error over elapsed time, including a fractional final step', () => {
  vi.spyOn(offdesign, 'solveOffDesign').mockReturnValue({ ...initial, result: { ...initial.result, offDesign: { ...initial.result.offDesign!, shaftImbalance_W: {} } } });
  const ti = { ...config(), duration_s: 0.25, controller: { ...DEFAULT_CONTROLLER, mode: 'N2' as const, limiter: 'manual' as const, target: 1, targetRamp_s: 0, Kp: 0, Ki: 0.1 } };
  const r = runTransient(dp, ti);
  expect(r.complete).toBe(true);
  const first = r.samples[0], last = r.samples.at(-1)!;
  const e = 1 - first.Npct.HP / 100;
  expect(first.WfCmd).toBeCloseTo(initial.result.components.find(c => c.id === 'burner')!.values.Wfuel_kgs, 12);
  expect(last.WfCmd - first.WfCmd).toBeCloseTo(r.design.Wf * 0.1 * e * 0.25, 10);
});
