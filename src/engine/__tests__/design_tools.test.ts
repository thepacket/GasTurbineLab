import { describe, it, expect } from 'vitest';
import { defaultInputs } from '../defaults';
import { runOptimization, VARIABLES } from '../optimize';
import { runMonteCarlo, UNCERTAIN } from '../montecarlo';
import { estimateWeight } from '../weight';
import { solveEngine } from '../cycle';
import { calibrateEngine, ENGINES } from '../engines';

describe('design tools', () => {
  it('optimiser lowers TSFC within bounds and constraints', () => {
    const inp = defaultInputs('turbofan'); inp.chemistry = 'frozen';
    const vars = VARIABLES.filter((v) => ['BPR', 'fan.PR'].includes(v.path));
    const r = runOptimization(inp, { variables: vars, objective: 'tsfc', constraints: [{ kind: 'T3max', value: 950 }], maxEvals: 120 });
    console.log('optimiser: baseline', r.baseline.toFixed(3), 'best', r.objective.toFixed(3), 'x', r.bestX.map((v) => v.toFixed(3)).join(', '), 'evals', r.evals, 'conv', r.converged);
    expect(r.objective).toBeLessThan(r.baseline);
    expect(r.bestX[0]).toBeGreaterThanOrEqual(2); expect(r.bestX[0]).toBeLessThanOrEqual(14);
  });
  it('monte carlo produces sensible spreads', () => {
    const inp = defaultInputs('turbofan'); inp.chemistry = 'frozen';
    const r = runMonteCarlo(inp, { inputs: UNCERTAIN.filter((u) => ['fan.eff', 'hpc.eff', 'hpt.eff'].includes(u.path)), samples: 200, seed: 7 });
    console.log('MC: Fn mean', r.stats.Fn.mean.toFixed(0), 'sd', r.stats.Fn.sd.toFixed(0), 'TSFC sd %', (100 * r.stats.TSFC.sd / r.stats.TSFC.mean).toFixed(2), 'failures', r.failures, 'sens', r.sensitivity.map((s) => `${s.label} ${s.dTSFC_pct.toFixed(2)}%`).join('; '));
    expect(r.failures).toBe(0);
    expect(r.stats.TSFC.sd / r.stats.TSFC.mean).toBeGreaterThan(0.002);
    expect(r.stats.TSFC.sd / r.stats.TSFC.mean).toBeLessThan(0.03);
  });
  it('weight heuristics have plausible magnitude, without asserting dry-weight accuracy', () => {
    // EASA TCDS E.004, IM.E.002 and IM.E.008; assembly/dry-engine scopes differ.
    const cases: [string, number][] = [['CFM56-7B27', 2386], ['GE90-115B', 8761], ['PT6A-67D', 233.5]];
    for (const [name, pub] of cases) {
      const e = ENGINES.find((x) => x.name === name)!;
      const r = solveEngine({ ...calibrateEngine(e).inputs, chemistry: 'frozen' });
      const w = estimateWeight(r);
      console.log(`weight ${name}: ${w.total_kg.toFixed(0)} kg vs published ${pub} kg (${((w.total_kg / pub - 1) * 100).toFixed(0)} %), L ${w.length_m.toFixed(2)} m, D ${w.diameter_m.toFixed(2)} m, T/W ${w.thrustToWeight.toFixed(1)}`);
      expect(w.total_kg / pub).toBeGreaterThan(0.6); expect(w.total_kg / pub).toBeLessThan(1.6);
    }
  });
});
