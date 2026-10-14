import { it, expect } from 'vitest';
import { defaultInputs } from '../defaults';
import { makeDesignPoint } from '../offdesign';
import { runTransient, DEFAULT_THERMAL } from '../transient';

it('heat soak: clearance opens on a slam acceleration and efficiency dips before recovering', () => {
  const inp = defaultInputs('turbofan'); inp.chemistry = 'frozen';
  inp.flight = { altitude_m: 0, mach: 0, dT_isa: 0, W_kgs: 420 }; inp.burner.T4_K = 1650;
  const dp = makeDesignPoint(inp);
  const base = { od: { altitude_m: 0, mach: 0, dT_isa: 0, throttle: { mode: 'T4' as const, value: 1650 } }, schedule: { T4start: 1250, WfEndFrac: 1.0, rampStart_s: 0.5, rampDuration_s: 0.3, ratioUnitLimit: 0, ratioUnitFloor: 0 }, duration_s: 40, dt_s: 0.1 };
  const r = runTransient(dp, { ...base, thermal: { ...DEFAULT_THERMAL, enabled: true } });
  const cold = runTransient(dp, base);
  const dEff = r.samples.map((s) => s.effDeltaHPC ?? 0);
  const iMin = dEff.indexOf(Math.min(...dEff));
  const last = r.samples[r.samples.length - 1];
  console.log('thermal: clearance', r.samples[0].clearance_mm?.toFixed(3), '->', r.samples[iMin].clearance_mm?.toFixed(3), '(t', r.samples[iMin].t, 's) ->', last.clearance_mm?.toFixed(3), 'mm; eff delta min', (100 * Math.min(...dEff)).toFixed(2), '% end', (100 * (last.effDeltaHPC ?? 0)).toFixed(2), '%; Tcasing', last.Tcasing?.toFixed(0), 'Tdisc', last.Tdisc?.toFixed(0), '; Fn hot/cold at end', last.Fn.toFixed(0), cold.samples[cold.samples.length - 1].Fn.toFixed(0));
  expect(Math.min(...dEff)).toBeLessThan(-0.002);
  expect(last.effDeltaHPC!).toBeGreaterThan(Math.min(...dEff) + 0.001);
  expect(last.Tdisc!).toBeGreaterThan(r.samples[0].Tdisc! + 50);
});
