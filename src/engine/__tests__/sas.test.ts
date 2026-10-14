import { it, expect } from 'vitest';
import { defaultInputs } from '../defaults';
import { makeDesignPoint, solveOffDesign } from '../offdesign';

it('secondary air system reproduces design flows at design and scales them off-design', () => {
  const inp = defaultInputs('turbofan'); inp.chemistry = 'frozen'; inp.sas = { enabled: true, interstageFrac: 0.5, leakFrac: 0.004, cavityPressureFrac: 0.9 }; inp.geometry.customerBleed_kgs = 0.5;
  const dp = makeDesignPoint(inp);
  const des = solveOffDesign(dp, { altitude_m: inp.flight.altitude_m, mach: inp.flight.mach, dT_isa: 0, throttle: { mode: 'T4', value: inp.burner.T4_K } });
  const sasD = des.result.components.find((c) => c.id === 'sas')!.values;
  const W25 = des.result.stations.find((s) => s.id === '25')!.W;
  console.log('SAS design: cool in', (100 * sasD.coolInlet_kgs / W25).toFixed(2), '% exit', (100 * sasD.coolExit_kgs / W25).toFixed(2), '% customer', sasD.customer_kgs.toFixed(3), 'leak', sasD.leak_kgs.toFixed(3), 'seal', sasD.interstageSeal_kgs.toFixed(3), 'Fn', des.result.perf.Fn.toFixed(0), 'vs', dp.result.perf.Fn.toFixed(0));
  expect(Math.abs(sasD.coolInlet_kgs / W25 - inp.coolInletFrac)).toBeLessThan(0.002);
  expect(Math.abs(des.result.perf.Fn / dp.result.perf.Fn - 1)).toBeLessThan(0.005);
  const idle = solveOffDesign(dp, { altitude_m: inp.flight.altitude_m, mach: inp.flight.mach, dT_isa: 0, throttle: { mode: 'T4', value: inp.burner.T4_K * 0.7 } });
  const sasI = idle.result.components.find((c) => c.id === 'sas')!.values;
  console.log('SAS part power: customer', sasI.customer_kgs.toFixed(3), 'kg/s (fixed manifold → falls with P3), cool in frac', (100 * sasI.coolInlet_kgs / idle.result.stations.find((s) => s.id === '25')!.W).toFixed(2), '% seal', sasI.interstageSeal_kgs.toFixed(3), sasI.sealReversed ? 'REVERSED' : '');
  expect(idle.converged).toBe(true);
  expect(sasI.customer_kgs).toBeLessThan(sasD.customer_kgs);
});
