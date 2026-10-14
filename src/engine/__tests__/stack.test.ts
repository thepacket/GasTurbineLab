import { it, expect } from 'vitest';
import { generateStageStackedMap } from '../custommaps';
import { registerCustomMap } from '../maps';
import { defaultInputs } from '../defaults';
import { makeDesignPoint, solveOffDesign } from '../offdesign';
it('stage-stacked map is monotonic and usable off-design', () => {
  const m = generateStageStackedMap({ stages: 8, PRdes: 12, WcDes: 50, vsvStages: 4, vsvGain: 0.35 });
  const n = m.NcMap.indexOf(1.0);
  console.log('stack PR @Nc=1', m.PRmap[0][n].map((v) => v.toFixed(2)).join(' '), '| Wc', m.WcMap[0][n].map((v) => v.toFixed(1)).join(' '), '| eff', m.effMap[0][n].map((v) => v.toFixed(3)).join(' '));
  for (let i = 1; i < m.RlineMap.length; i++) { expect(m.WcMap[0][n][i]).toBeGreaterThan(m.WcMap[0][n][i - 1]); expect(m.PRmap[0][n][i]).toBeLessThan(m.PRmap[0][n][i - 1] + 1e-9); }
  registerCustomMap('custom:test-stack', 'compressor', m);
  const inp = defaultInputs('turbofan'); inp.chemistry = 'frozen'; inp.mapIds = { hpc: 'custom:test-stack' };
  const dp = makeDesignPoint(inp);
  const s = solveOffDesign(dp, { altitude_m: inp.flight.altitude_m, mach: inp.flight.mach, dT_isa: 0, throttle: { mode: 'T4', value: inp.burner.T4_K * 0.85 } });
  console.log('stacked HPC off-design conv', s.converged, 'SM', s.result.components.find((c) => c.id === 'hpc')!.values.surgeMargin_pct.toFixed(1));
  expect(s.converged).toBe(true);
});
