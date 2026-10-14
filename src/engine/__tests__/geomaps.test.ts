import { it, expect } from 'vitest';
import { generateGeometryCompressorMap, generateGeometryTurbineMap, defaultStageGeometry } from '../custommaps';
import { registerCustomMap } from '../maps';
import { defaultInputs } from '../defaults';
import { makeDesignPoint, solveOffDesign } from '../offdesign';

it('geometry-based compressor and turbine maps are well-formed and solve off-design', () => {
  const comp = generateGeometryCompressorMap({ stages: defaultStageGeometry({ stages: 6, Ndes_rpm: 14000, WcDes: 50, rMean_m: 0.3 }), Ndes_rpm: 14000, WcDes: 50 });
  const n = comp.NcMap.indexOf(1.0);
  console.log('geo comp PR @Nc=1', comp.PRmap[0][n].map((v) => v.toFixed(2)).join(' '), '| Wc', comp.WcMap[0][n].map((v) => v.toFixed(1)).join(' '), '| eff', comp.effMap[0][n].map((v) => v.toFixed(3)).join(' '));
  for (let i = 1; i < comp.RlineMap.length; i++) expect(comp.WcMap[0][n][i]).toBeGreaterThan(comp.WcMap[0][n][i - 1]);
  expect(comp.PRmap[0][n][0]).toBeGreaterThan(comp.PRmap[0][n][comp.RlineMap.length - 1]);
  const turb = generateGeometryTurbineMap({ stages: 2, rMean_m: 0.32, bladeHeight_m: 0.05, nozzleExitAngle_deg: 70, Ndes_rpm: 14000, PRdes: 4 });
  expect(turb.WpMap[0][4][turb.PRmap.length - 1]).toBeGreaterThan(turb.WpMap[0][4][0]);
  registerCustomMap('custom:test-geo', 'compressor', comp); registerCustomMap('custom:test-tgeo', 'turbine', turb);
  const inp = defaultInputs('turbofan'); inp.chemistry = 'frozen'; inp.mapIds = { hpc: 'custom:test-geo', hpt: 'custom:test-tgeo' };
  const dp = makeDesignPoint(inp);
  const s = solveOffDesign(dp, { altitude_m: inp.flight.altitude_m, mach: inp.flight.mach, dT_isa: 0, throttle: { mode: 'T4', value: inp.burner.T4_K * 0.88 } });
  console.log('geo maps off-design conv', s.converged, 'HPC SM', s.result.components.find((c) => c.id === 'hpc')!.values.surgeMargin_pct.toFixed(1), 'Fn', s.result.perf.Fn.toFixed(0), 'vs', dp.result.perf.Fn.toFixed(0));
  expect(s.converged).toBe(true);
});
