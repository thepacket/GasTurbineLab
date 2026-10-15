import { expect, it } from 'vitest';
import { defaultInputs } from '../defaults';
import { makeDesignPoint, solveOffDesign } from '../offdesign';
import { coolingModel } from '../core';
import { estimateNoise, runLto } from '../certification';
import { estimateWeight } from '../weight';

it('keeps nacelle geometry and friction drag fixed as throttle changes', () => {
  const inp = defaultInputs('turbofan'); inp.chemistry = 'frozen'; inp.installation.enabled = true;
  const dp = makeDesignPoint(inp);
  const run = (fraction: number) => solveOffDesign(dp, { ...inp.flight, throttle: { mode: 'T4', value: inp.burner.T4_K * fraction } });
  const high = run(1), low = run(0.8);
  expect(high.converged && low.converged).toBe(true);
  expect(low.result.perf.nacelleDrag).toBeCloseTo(high.result.perf.nacelleDrag, 8);
  expect(low.result.designInletArea_m2).toBe(dp.result.stations.find(s => s.id === '2')!.A);
  expect(low.result.perf.inletDrag).toBeGreaterThan(high.result.perf.inletDrag);
  const target = solveOffDesign(dp, { ...inp.flight, throttle: { mode: 'Fn', value: high.result.perf.installedFn } });
  expect(target.converged).toBe(true);
  expect(target.result.perf.installedFn).toBeCloseTo(high.result.perf.installedFn, 2);
  // Omitting an override inherits the installed setting; explicit false requests uninstalled thrust.
  const uninstalled = solveOffDesign(dp, { ...inp.flight, installation: false, throttle: { mode: 'Fn', value: high.result.perf.Fn } });
  expect(uninstalled.converged).toBe(true);
  expect(uninstalled.result.perf.Fn).toBeCloseTo(high.result.perf.Fn, 2);
  expect(() => estimateWeight(low.result)).toThrow(/design point/);
});

it('uses hardware fan radius for off-design tip Mach', () => {
  const inp = defaultInputs('turbofan'); inp.chemistry = 'frozen';
  const dp = makeDesignPoint(inp), r = solveOffDesign(dp, { ...inp.flight, throttle: { mode: 'T4', value: 1240 } }).result;
  const n = estimateNoise(r), st = r.stations.find(s => s.id === '2')!;
  const radius = Math.sqrt(dp.result.stations.find(s => s.id === '2')!.A / (Math.PI * 0.91));
  const rpm = r.shafts.find(s => s.name === 'LP shaft')!.rpm / inp.fanGear.ratio;
  const expected = Math.hypot(2 * Math.PI * rpm / 60 * radius, st.V) / Math.sqrt(1.4 * 287.05 * st.Ts);
  expect(n.tipMach).toBeCloseTo(expected, 12);
  expect(n.notes.join(' ')).toContain('Uncalibrated');
});

it('saturates computed cooling continuously and reports an unreachable target', () => {
  const inp = defaultInputs('turbofan');
  let lastFlow = 0, lastMetal = Infinity;
  for (let target = 1600; target >= 900; target -= 5) {
    const c = coolingModel(1700, 800, { ...inp.cooling, mode: 'computed', targetMetal_K: target }, 0);
    expect(c.inletFrac).toBeLessThanOrEqual(0.25);
    expect(c.inletFrac).toBeGreaterThanOrEqual(lastFlow - 1e-12);
    expect(c.metal_K).toBeLessThanOrEqual(lastMetal + 1e-9);
    if (!c.infeasible) expect(c.metal_K).toBeCloseTo(target, 8);
    else expect(c.metal_K).toBeGreaterThan(target);
    lastFlow = c.inletFrac; lastMetal = c.metal_K;
  }
  const hotCoolant = coolingModel(1000, 1050, { ...inp.cooling, mode: 'computed', targetMetal_K: 900 }, 0);
  expect(hotCoolant.infeasible).toBe(true); expect(hotCoolant.inletFrac).toBe(0);
});

it('computes uninstalled LTO reference modes even when installation is enabled', () => {
  const inp = defaultInputs('turbofan'); inp.chemistry = 'frozen'; inp.installation.enabled = true;
  const a = runLto(makeDesignPoint(inp));
  inp.installation.enabled = false;
  const b = runLto(makeDesignPoint(inp));
  expect(a.complete && b.complete).toBe(true);
  expect(a.DpFoo.NOx).toBeCloseTo(b.DpFoo.NOx, 8);
});
