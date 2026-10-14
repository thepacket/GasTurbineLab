import { describe, it, expect } from 'vitest';
import { defaultInputs } from '../defaults';
import { makeDesignPoint, solveOffDesign } from '../offdesign';
import { runTransient } from '../transient';
import { runMission, defaultMission } from '../mission';

describe('transient and mission', () => {
  it('turbofan accelerates from a reduced-T4 point when fuel is stepped up', () => {
    const inp = defaultInputs('turbofan'); inp.chemistry = 'frozen';
    inp.flight = { altitude_m: 0, mach: 0, dT_isa: 0, W_kgs: 420 }; inp.burner.T4_K = 1650;
    const dp = makeDesignPoint(inp);
    const r = runTransient(dp, { od: { altitude_m: 0, mach: 0, dT_isa: 0, throttle: { mode: 'T4', value: 1650 } }, schedule: { T4start: 1250, WfEndFrac: 1.0, rampStart_s: 0.5, rampDuration_s: 0.5, ratioUnitLimit: 0, ratioUnitFloor: 0 }, duration_s: 6, dt_s: 0.05 });
    const a = r.samples[0], b = r.samples[r.samples.length - 1];
    console.log('transient: N_HP', a.Npct.HP.toFixed(1), '->', b.Npct.HP.toFixed(1), '% N_LP', a.Npct.LP.toFixed(1), '->', b.Npct.LP.toFixed(1), 'Fn', (a.Fn / 1e3).toFixed(1), '->', (b.Fn / 1e3).toFixed(1), 'kN; min SM hpc', Math.min(...r.samples.map((s) => s.SM.hpc)).toFixed(1), 'samples', r.samples.length, 'warnings', r.warnings.length);
    expect(r.samples.length).toBeGreaterThan(100);
    expect(b.Npct.HP).toBeGreaterThan(a.Npct.HP + 3);
    expect(b.Fn).toBeGreaterThan(a.Fn * 1.5);
    // approaches the design speed
    expect(Math.abs(b.Npct.HP - 100)).toBeLessThan(3);
  });
  it('turbojet transient with ratio-unit limiter stays above the unlimited surge margin', () => {
    const inp = defaultInputs('turbojet'); inp.chemistry = 'frozen';
    const dp = makeDesignPoint(inp);
    const base = { od: { altitude_m: 0, mach: 0, dT_isa: 0, throttle: { mode: 'T4' as const, value: 1500 } }, duration_s: 4, dt_s: 0.05 };
    const free = runTransient(dp, { ...base, schedule: { T4start: 1150, WfEndFrac: 1.0, rampStart_s: 0.2, rampDuration_s: 0.1, ratioUnitLimit: 0, ratioUnitFloor: 0 } });
    const lim = runTransient(dp, { ...base, schedule: { T4start: 1150, WfEndFrac: 1.0, rampStart_s: 0.2, rampDuration_s: 0.1, ratioUnitLimit: 1.15, ratioUnitFloor: 0 } });
    const smFree = Math.min(...free.samples.map((s) => s.SM.comp)), smLim = Math.min(...lim.samples.map((s) => s.SM.comp));
    console.log('limiter: min SM free', smFree.toFixed(1), 'limited', smLim.toFixed(1), 'limited steps', lim.samples.filter((s) => s.limited).length);
    expect(smLim).toBeGreaterThan(smFree);
  });
  it('Fn throttle mode matches a thrust target', () => {
    const inp = defaultInputs('turbofan'); inp.chemistry = 'frozen';
    const dp = makeDesignPoint(inp);
    const s = solveOffDesign(dp, { altitude_m: 11000, mach: 0.8, dT_isa: 0, throttle: { mode: 'Fn', value: 20000 } });
    expect(s.converged).toBe(true);
    expect(Math.abs(s.result.perf.Fn / 20000 - 1)).toBeLessThan(1e-5);
  });
  it('mission integrates fuel burn for a turbofan airliner', () => {
    const inp = defaultInputs('turbofan'); inp.chemistry = 'frozen';
    inp.flight = { altitude_m: 0, mach: 0, dT_isa: 0, W_kgs: 420 }; inp.burner.T4_K = 1650;
    const dp = makeDesignPoint(inp);
    const m = defaultMission('turbofan');
    const r = runMission(dp, { aircraft: m.aircraft, segments: m.segments, od: { altitude_m: 0, mach: 0, dT_isa: 0, throttle: { mode: 'T4', value: 1650 } }, pointsPerSegment: 6 });
    console.log('mission: time', (r.totals.time_s / 60).toFixed(1), 'min, fuel', r.totals.fuel_kg.toFixed(0), 'kg, dist', r.totals.dist_km.toFixed(0), 'km; segments', r.segments.map((s) => `${s.label} ${s.fuel_kg.toFixed(0)} kg`).join(', '), '; warnings', r.warnings.length);
    expect(r.totals.fuel_kg).toBeGreaterThan(3000);
    expect(r.totals.fuel_kg).toBeLessThan(25000);
    expect(r.points.every((p) => p.converged)).toBe(true);
    expect(r.warnings.filter((w) => w.includes('did not converge')).length).toBe(0);
  });
  it('bleeds, nozzle area and installation affect results in the expected direction', () => {
    const inp = defaultInputs('turbofan'); inp.chemistry = 'frozen';
    const dp = makeDesignPoint(inp);
    const base = solveOffDesign(dp, { altitude_m: 11000, mach: 0.8, dT_isa: 0, throttle: { mode: 'T4', value: 1500 } });
    const bleed = solveOffDesign(dp, { altitude_m: 11000, mach: 0.8, dT_isa: 0, throttle: { mode: 'T4', value: 1500 }, geometry: { customerBleed_kgs: 1.0 } });
    const inst = solveOffDesign(dp, { altitude_m: 11000, mach: 0.8, dT_isa: 0, throttle: { mode: 'T4', value: 1500 }, installation: true });
    expect(bleed.converged && inst.converged).toBe(true);
    expect(bleed.result.perf.Fn).toBeLessThan(base.result.perf.Fn);
    expect(inst.result.perf.installedFn).toBeLessThan(inst.result.perf.Fn);
    expect(inst.result.perf.EI_NOx_g_kg).toBeGreaterThan(1);
    expect(inst.result.perf.jetNoise_dB).toBeGreaterThan(100);
    console.log('installed: Fn', (inst.result.perf.Fn / 1e3).toFixed(1), 'installed', (inst.result.perf.installedFn / 1e3).toFixed(1), 'kN; EI NOx', inst.result.perf.EI_NOx_g_kg.toFixed(1), 'g/kg; noise', inst.result.perf.jetNoise_dB.toFixed(0), 'dB');
  });
});
