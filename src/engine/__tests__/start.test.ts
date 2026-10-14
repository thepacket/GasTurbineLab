import { it, expect } from 'vitest';
import { defaultInputs } from '../defaults';
import { makeDesignPoint } from '../offdesign';
import { runTransient } from '../transient';

it('turbojet starts from shutdown with a starter and lights off', () => {
  const inp = defaultInputs('turbojet'); inp.chemistry = 'frozen';
  const dp = makeDesignPoint(inp);
  const r = runTransient(dp, { od: { altitude_m: 0, mach: 0, dT_isa: 0, throttle: { mode: 'T4', value: 1500 } }, schedule: { T4start: 1150, WfEndFrac: 0.35, rampStart_s: 0, rampDuration_s: 20, ratioUnitLimit: 1.3, ratioUnitFloor: 0 }, duration_s: 60, dt_s: 0.1, start: { enabled: true, starterTorque_Nm: 700, starterCutout: 0.45, lightOffSpeed: 0.18, lightOffT3min_K: 290, lightOffFuelFrac: 0.06, frictionPower_W: 7500 } });
  const a = r.samples[0], b = r.samples[r.samples.length - 1];
  const lit = r.samples.findIndex((s) => s.lit);
  console.log('start: N2', a.Npct.HP.toFixed(1), '->', b.Npct.HP.toFixed(1), '% light-off idx', lit, 't', lit >= 0 ? r.samples[lit].t : '-', 'samples', r.samples.length, 'warnings', r.warnings);
  expect(lit).toBeGreaterThan(0);
  expect(b.Npct.HP).toBeGreaterThan(50);
});
