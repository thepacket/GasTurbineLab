import { it, expect } from 'vitest';
import { defaultInputs } from '../defaults';
import { makeDesignPoint } from '../offdesign';
import { runTransient, DEFAULT_CONTROLLER } from '../transient';

it('N1 controller reaches its target without exceeding the acceleration schedule', () => {
  const inp = defaultInputs('turbofan'); inp.chemistry = 'frozen';
  inp.flight = { altitude_m: 0, mach: 0, dT_isa: 0, W_kgs: 420 }; inp.burner.T4_K = 1650;
  const dp = makeDesignPoint(inp);
  const r = runTransient(dp, { od: { altitude_m: 0, mach: 0, dT_isa: 0, throttle: { mode: 'T4', value: 1650 } }, schedule: { T4start: 1250, WfEndFrac: 1, rampStart_s: 0.5, rampDuration_s: 0.3, ratioUnitLimit: 0, ratioUnitFloor: 0 }, duration_s: 12, dt_s: 0.05,
    controller: { ...DEFAULT_CONTROLLER, mode: 'N1', target: 0.95, targetRamp_s: 0.5, Kp: 2.0, Ki: 1.5 } });
  const last = r.samples[r.samples.length - 1];
  const overshoot = Math.max(...r.samples.map((s) => s.Npct.LP)) - 95;
  const minSM = Math.min(...r.samples.map((s) => s.SM.hpc));
  console.log('FADEC N1: start', r.samples[0].Npct.LP.toFixed(1), 'end', last.Npct.LP.toFixed(1), 'overshoot', overshoot.toFixed(2), 'min HPC SM', minSM.toFixed(1), 'limited', r.samples.filter((s) => s.limited).length, 'bleed open', r.samples.filter((s) => s.bleedOpen).length);
  expect(Math.abs(last.Npct.LP - 95)).toBeLessThan(1.0);
  expect(overshoot).toBeLessThan(3);
  expect(minSM).toBeGreaterThan(8);
});

it('thrust controller holds a thrust demand', () => {
  const inp = defaultInputs('turbojet'); inp.chemistry = 'frozen';
  const dp = makeDesignPoint(inp);
  const r = runTransient(dp, { od: { altitude_m: 0, mach: 0, dT_isa: 0, throttle: { mode: 'T4', value: 1500 } }, schedule: { T4start: 1200, WfEndFrac: 1, rampStart_s: 0.3, rampDuration_s: 0.3, ratioUnitLimit: 0, ratioUnitFloor: 0 }, duration_s: 8, dt_s: 0.05,
    controller: { ...DEFAULT_CONTROLLER, mode: 'Fn', target: 35000, targetRamp_s: 1.0, Kp: 1.0, Ki: 2.0 } });
  const last = r.samples[r.samples.length - 1];
  console.log('FADEC Fn: end', last.Fn.toFixed(0), 'N2', last.Npct.HP.toFixed(1));
  expect(Math.abs(last.Fn / 35000 - 1)).toBeLessThan(0.02);
});
