/** Magnitude audit: catalogue internals are generic, not measured engine states. */
import { ENGINES, calibrateEngine } from '../src/engine/engines';
import { solveEngine } from '../src/engine/cycle';
import { makeDesignPoint, solveOffDesign } from '../src/engine/offdesign';
import { estimateWeight } from '../src/engine/weight';
import { estimateNoise, runLto } from '../src/engine/certification';
import { coolingModel } from '../src/engine/core';
import { defaultInputs } from '../src/engine/defaults';
import references from './estimate_references.json';
export function auditEstimates() {
  const emissions = references.engines.map(ref => {
    const spec = ENGINES.find(e => e.name === ref.name)!;
    const inp = { ...calibrateEngine(spec).inputs, chemistry: 'frozen' as const };
    const dp = makeDesignPoint(inp);
    const lto = runLto(dp);
    return { name: ref.name, uid: ref.uid, sourceRow: ref.row, referenceOPR: ref.OPR, modelOPR: lto.OPR, referenceRating_kN: ref.ratedThrust_kN, modelRating_kN: lto.Foo_kN, complete: lto.complete, modes: lto.modes.map((m, i) => ({ mode: m.name, converged: m.converged, fuelFlow: { model: m.Wf, reference: ref.fuelFlow_kgs[i] }, NOx: { model: m.EI_NOx, reference: ref.EI_NOx_g_kg[i] }, CO: { model: m.EI_CO, reference: ref.EI_CO_g_kg[i] }, HC: { model: m.EI_HC, reference: ref.EI_HC_g_kg[i] } })), integrated: { model: lto.DpFoo, referenceAverage: ref.DpFooAvg_g_kN }, warnings: lto.warnings };
  });
  const mass = [ ['CFM56-7B27', 2386, 'https://www.easa.europa.eu/en/downloads/7795/en'], ['GE90-115B', 8761, 'https://www.easa.europa.eu/en/downloads/7799/en'], ['PT6A-67D', 233.5, 'https://www.easa.europa.eu/en/downloads/7787/en'] ] as const;
  const weights = mass.map(([name, dryMass_kg, source]) => { const r = solveEngine({ ...calibrateEngine(ENGINES.find(e => e.name === name)!).inputs, chemistry: 'frozen' }); const w = estimateWeight(r); return { name, source, referenceDryMass_kg: dryMass_kg, modelAssemblyMass_kg: w.total_kg, difference_pct: 100 * (w.total_kg / dryMass_kg - 1), caveat: 'Assembly includes heuristic nacelle/accessory allowances; not identical mass scope.' }; });
  const inp = defaultInputs('turbofan'); inp.chemistry = 'frozen'; inp.installation.enabled = true;
  const dp = makeDesignPoint(inp);
  const installation = [0.8, 1].map(f => { const r = solveOffDesign(dp, { ...inp.flight, throttle: { mode: 'T4', value: f * inp.burner.T4_K } }); return { T4fraction: f, converged: r.converged, inletArea_m2: r.result.designInletArea_m2, stationFlowArea_m2: r.result.stations.find(s => s.id === '2')!.A, uninstalledNetThrust_N: r.result.perf.Fn, installedThrust_N: r.result.perf.installedFn, nacelleDrag_N: r.result.perf.nacelleDrag, inletDrag_N: r.result.perf.inletDrag, afterbodyDrag_N: r.result.perf.afterbodyDrag, noise: estimateNoise(r.result) }; });
  const cooling = [1200, 1100, 1000, 900].map(targetMetal_K => ({ targetMetal_K, ...coolingModel(1700, 800, { ...inp.cooling, mode: 'computed', targetMetal_K }, inp.coolInletFrac) }));
  return { description: 'Independent magnitude comparison. No empirical coefficients have been fitted to these references. Emissions compare generic catalogue simulations with measured entries; internal temperatures and combustor technology are not matched.', emissions, weights, installation, cooling };
}
