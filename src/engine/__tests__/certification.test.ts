import { it, expect } from 'vitest';
import { defaultInputs } from '../defaults';
import { makeDesignPoint } from '../offdesign';
import { runLto, caep8NOxLimit, estimateNoise } from '../certification';
import { solveEngine } from '../cycle';

it('LTO cycle produces Dp/Foo values in the expected range for a modern turbofan', () => {
  const inp = defaultInputs('turbofan'); inp.chemistry = 'frozen';
  inp.flight = { altitude_m: 0, mach: 0, dT_isa: 0, W_kgs: 420 }; inp.burner.T4_K = 1650;
  const dp = makeDesignPoint(inp);
  const r = runLto(dp);
  console.log('LTO: Foo', r.Foo_kN.toFixed(1), 'kN OPR', r.OPR.toFixed(1), 'Dp/Foo NOx', r.DpFoo.NOx.toFixed(1), 'limit', r.limits.NOx.toFixed(1), 'margin', r.margins.NOx.toFixed(0) + '%', 'CO', r.DpFoo.CO.toFixed(1), 'HC', r.DpFoo.HC.toFixed(2), 'fuel', r.fuel_kg.toFixed(0), 'kg', r.warnings);
  for (const m of r.modes) console.log('  ', m.name.padEnd(12), 'Fn', (m.Fn / 1e3).toFixed(1), 'Wf', m.Wf.toFixed(3), 'EI NOx', m.EI_NOx.toFixed(1), 'EI CO', m.EI_CO.toFixed(1), 'T3', m.T3.toFixed(0), m.converged ? '' : 'NOT CONV');
  expect(r.modes.every((m) => m.converged)).toBe(true);
  expect(r.DpFoo.NOx).toBeGreaterThan(20); expect(r.DpFoo.NOx).toBeLessThan(120);
  expect(caep8NOxLimit(30, 120)).toBeCloseTo(50.12, 1);
});
it('noise estimate separates fan and jet contributions', () => {
  const r = solveEngine({ ...defaultInputs('turbofan'), chemistry: 'frozen' });
  const n = estimateNoise(r);
  console.log('noise: fan', n.fanInlet_dB.toFixed(0), 'tone', n.fanTone_dB.toFixed(0), 'jet', n.jet_dB.toFixed(0), 'total', n.total_dB.toFixed(0), 'tip Mach', n.tipMach.toFixed(2));
  expect(n.total_dB).toBeGreaterThan(100); expect(n.total_dB).toBeLessThan(170);
});
