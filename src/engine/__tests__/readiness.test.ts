import { describe, expect, it, vi } from 'vitest';
import { defaultInputs } from '../defaults';
import { generateCompressorMap, generateGeometryTurbineMap, parseCsvMap, parseJsonMap } from '../custommaps';
import { registerCustomMap, replaceCustomMaps, listCustomMaps } from '../maps';
import { runTransient } from '../transient';
import { runOptimization, VARIABLES } from '../optimize';
import { runMonteCarlo, UNCERTAIN } from '../montecarlo';
import { solveEngine } from '../cycle';
import * as od from '../offdesign';
import { runMission, defaultMission } from '../mission';
import { caep8NOxLimit, runLto } from '../certification';

const inp = { ...defaultInputs('turbojet'), chemistry: 'frozen' as const };

describe('engine input domains', () => {
  it('rejects unphysical efficiency, zero flow and non-finite targets before numerical solving', () => {
    expect(() => solveEngine({ ...inp, comp: { ...inp.comp, eff: 1.1 } })).toThrow(/efficiency/);
    expect(() => solveEngine({ ...inp, flight: { ...inp.flight, W_kgs: 0 } })).toThrow(/mass flow/);
    expect(() => solveEngine({ ...inp, burner: { ...inp.burner, T4_K: 300 } })).toThrow(/Combustor cannot/);
    const dp = od.makeDesignPoint(inp);
    expect(() => od.solveOffDesign(dp, { ...inp.flight, throttle: { mode: 'Fn', value: NaN } })).toThrow(/throttle/);
    expect(() => od.solveOffDesign(dp, { ...inp.flight, throttle: { mode: 'Wf', value: 0 } })).toThrow(/throttle/);
  });
});

describe('map integrity', () => {
  it('generates finite efficiencies on the overspeed lines and round-trips the map', () => {
    const data = generateCompressorMap({ PRdes: 12, WcDes: 50 });
    expect(data.effMap.flat(2).every(v => Number.isFinite(v) && v > 0 && v <= 1)).toBe(true);
    expect(() => parseJsonMap(JSON.stringify(data))).not.toThrow();
  });
  it('rejects malformed data at registration as well as import', () => {
    const data = generateCompressorMap({ PRdes: 12, WcDes: 50 });
    data.NcMap[1] = data.NcMap[0];
    expect(() => parseJsonMap(JSON.stringify(data))).toThrow(/increasing/);
    expect(() => registerCustomMap('custom:invalid', 'compressor', data)).toThrow(/increasing/);
    const turbine = generateGeometryTurbineMap({ stages: 2, rMean_m: 0.3, bladeHeight_m: 0.1, nozzleExitAngle_deg: 60, Ndes_rpm: 12000, PRdes: 4 });
    turbine.effMap[0][0][0] = NaN;
    expect(() => registerCustomMap('custom:invalid', 'turbine', turbine)).toThrow(/finite/);
  });
  it('rejects corrupt and duplicate CSV rows instead of silently discarding them', () => {
    expect(() => parseCsvMap('Nc,Rline,Wc,PR,eff\n1,1,50,12,bad', 'compressor')).toThrow(/finite numeric/);
    expect(() => parseCsvMap('1,1,50,12,.9\n1,1,60,12,.9', 'compressor')).toThrow(/Duplicate/);
    const csv = parseCsvMap('Nc,Rline,Wc,PR,eff\n80,1,40,12,.8\n80,2,50,10,.9\n100,1,50,15,.8\n100,2,60,12,.9', 'compressor');
    expect(csv.defaults.NcMap).toBe(100);
  });
  it('applies map removals and leaves the registry unchanged after an invalid batch', () => {
    const data = generateCompressorMap({ PRdes: 12, WcDes: 50 });
    replaceCustomMaps([{ id: 'custom:retained', kind: 'compressor', data }]);
    const invalid = structuredClone(data); invalid.effMap[0][0][0] = NaN;
    expect(() => replaceCustomMaps([{ id: 'custom:bad', kind: 'compressor', data: invalid }])).toThrow();
    expect(listCustomMaps()).toEqual(['custom:retained']);
    replaceCustomMaps([]);
    expect(listCustomMaps()).toEqual([]);
  });
});

describe('optimisation and uncertainty contracts', () => {
  it('honours the budget and returns exactly the model and bounded coordinates evaluated', () => {
    const r = runOptimization({ ...inp, chemistry: 'equilibrium' }, { variables: VARIABLES.filter(v => v.path === 'comp.PR'), objective: 'tsfc', constraints: [], maxEvals: 5 });
    expect(r.evals).toBeLessThanOrEqual(5);
    expect(r.trace.length).toBe(r.evals - 1); // baseline is included in the budget
    expect(r.best.chemistry).toBe('frozen');
    expect(solveEngine(r.best).perf.TSFC_mg_Ns).toBeCloseTo(r.objective, 8);
    for (const t of r.trace) expect(t.x[0]).toBeGreaterThanOrEqual(4);
    for (const t of r.trace) expect(t.x[0]).toBeLessThanOrEqual(30);
  });
  it('rejects empty or degenerate optimiser searches', () => {
    expect(() => runOptimization(inp, { variables: [], objective: 'tsfc', constraints: [], maxEvals: 5 })).toThrow(/variable/);
    expect(() => runOptimization(inp, { variables: [{ ...VARIABLES[4], min: 10, max: 10 }], objective: 'tsfc', constraints: [], maxEvals: 5 })).toThrow(/bounds/);
  });
  it('rejects invalid uncertainties and does not replace unsuccessful random draws with the mean', () => {
    const u = UNCERTAIN.find(u => u.path === 'comp.eff')!;
    expect(() => runMonteCarlo(inp, { samples: 2, seed: 4, inputs: [{ ...u, sigma: -1 }] })).toThrow(/standard deviation/);
    expect(() => runMonteCarlo(inp, { samples: 0, seed: 4, inputs: [] })).toThrow(/samples/);
    expect(() => runMonteCarlo(inp, { samples: 2, seed: 4, inputs: [{ ...u, sigma: 1e12 }] })).toThrow(/No valid/);
  });
});

describe('mission and LTO validity', () => {
  const dp = od.makeDesignPoint(inp);
  it.each(['redline', 'surge'] as const)('does not call a mission feasible with a %s violation', violation => {
    const solution = od.solveOffDesign(dp, { ...inp.flight, throttle: { mode: 'T4', value: inp.burner.T4_K } });
    const spy = vi.spyOn(od, 'solveOffDesign').mockImplementation((_dp, request) => violation === 'redline' ? ({ ...solution, converged: request.throttle.mode === 'Fn', x: { ...solution.x, N_HP: inp.speeds.HP * 1.2 } }) : ({ ...solution, result: { ...solution.result, components: solution.result.components.map(c => c.kind === 'compressor' ? { ...c, values: { ...c.values, surgeMargin_pct: -2 } } : c) } }));
    try {
      const m = defaultMission('turbojet');
      const r = runMission(dp, { aircraft: { ...m.aircraft, mass_kg: 1000 }, segments: [{ kind: 'hold', label: 'Test', alt0_m: 0, alt1_m: 0, mach: 0.2, value: 1 }], od: { ...inp.flight, throttle: { mode: 'T4', value: 1500 } }, pointsPerSegment: 2 });
      expect(r.unconvergedPoints).toBe(0);
      expect(r.maxShortfall).toBe(0);
      expect(violation === 'redline' ? r.ratingViolations : r.operabilityViolations).toBe(2);
      expect(r.feasible).toBe(false);
    } finally { spy.mockRestore(); }
  });
  it('uses the common high-OPR CAEP/8 branch for small and large thrust ratings', () => {
    expect(caep8NOxLimit(110, 50)).toBeCloseTo(208, 10);
    expect(caep8NOxLimit(110, 100)).toBeCloseTo(208, 10);
  });
  it('withholds integrated emissions and margins if a mode fails', () => {
    const solve = od.solveOffDesign;
    const spy = vi.spyOn(od, 'solveOffDesign').mockImplementation((...args) => ({ ...solve(...args), converged: false }));
    try {
      const r = runLto(dp);
      expect(r.complete).toBe(false);
      expect(Number.isNaN(r.margins.NOx)).toBe(true);
      expect(Number.isNaN(r.fuel_kg)).toBe(true);
    } finally { spy.mockRestore(); }
  });
  it('uses the pressure ratio at an overridden rating and emits no HC from hydrogen', () => {
    const thrust = dp.result.perf.Fn * 0.9;
    const ref = od.solveOffDesign(dp, { ...inp.flight, throttle: { mode: 'Fn', value: thrust } });
    const rated = runLto(dp, thrust);
    expect(rated.OPR).toBeCloseTo(ref.result.perf.OPR, 8);
    const hydrogen = runLto(od.makeDesignPoint({ ...inp, fuel: 'hydrogen' }));
    expect(hydrogen.modes.every(m => m.EI_HC === 0 && m.EI_CO === 0)).toBe(true);
    expect(hydrogen.applicable).toBe(false);
  });
  it('does not burn afterburner fuel in an unlit gas path', () => {
    const afterburning = od.makeDesignPoint({ ...inp, afterburner: { ...inp.afterburner, enabled: true } });
    const s = od.solveOffDesign(afterburning, { ...inp.flight, burnerLit: false, throttle: { mode: 'Wf', value: 0 } }, undefined, { fixedSpeeds: { LP: 0, IP: 0, HP: inp.speeds.HP * 0.3 } });
    expect(s.result.perf.Wfuel).toBe(0);
    expect(s.result.components.some(c => c.kind === 'afterburner')).toBe(false);
  });
  it('ends transients at the requested time and rejects a zero time step', () => {
    const ti = { od: { ...inp.flight, throttle: { mode: 'T4' as const, value: 1500 } }, schedule: { T4start: 1200, WfEndFrac: 0.6, rampStart_s: 1, rampDuration_s: 1, ratioUnitLimit: 0, ratioUnitFloor: 0 }, duration_s: 0.105, dt_s: 0.04 };
    const r = runTransient(dp, ti);
    expect(r.complete).toBe(true);
    expect(r.samples.at(-1)!.t).toBe(ti.duration_s);
    expect(() => runTransient(dp, { ...ti, dt_s: 0 })).toThrow(/time step/);
  });
});
