import { describe, it, expect } from 'vitest';
import { defaultInputs } from '../defaults';
import { solveEngine } from '../cycle';
import { FUELS, warFromRH } from '../gas';

describe('fuels, humidity and cooling', () => {
  it('hydrogen needs ~2.8x less fuel mass and emits no CO2', () => {
    const a = solveEngine({ ...defaultInputs('turbofan'), chemistry: 'frozen' });
    const h = solveEngine({ ...defaultInputs('turbofan'), chemistry: 'frozen', fuel: 'hydrogen' });
    const ratio = a.perf.Wfuel / h.perf.Wfuel;
    console.log('fuel mass ratio Jet-A/H2', ratio.toFixed(2), 'CO2', h.perf.CO2_g_s, 'Fn', a.perf.Fn.toFixed(0), h.perf.Fn.toFixed(0));
    expect(ratio).toBeGreaterThan(2.4); expect(ratio).toBeLessThan(3.2);
    expect(h.perf.CO2_g_s).toBe(0);
    expect(Math.abs(h.perf.Fn / a.perf.Fn - 1)).toBeLessThan(0.06);
  });
  it('SAF lowers CO2 per unit thrust', () => {
    const a = solveEngine({ ...defaultInputs('turbofan'), chemistry: 'frozen' });
    const s = solveEngine({ ...defaultInputs('turbofan'), chemistry: 'frozen', fuel: 'saf' });
    expect(s.perf.CO2_g_s / s.perf.Fn).toBeLessThan(a.perf.CO2_g_s / a.perf.Fn);
    expect(FUELS.saf.stoichFAR).toBeLessThan(FUELS.jetA.stoichFAR);
  });
  it('humid air reduces thrust slightly and raises fuel flow', () => {
    const inp = defaultInputs('turbofan'); inp.chemistry = 'frozen'; inp.flight = { altitude_m: 0, mach: 0, dT_isa: 15, W_kgs: 420 };
    const dry = solveEngine(inp);
    const wet = solveEngine({ ...inp, humidity: { relative: 1 } });
    const war = warFromRH(1, 303.15, 101325);
    console.log('WAR at 30C 100%RH', war.toFixed(4), 'Fn dry/wet', dry.perf.Fn.toFixed(0), wet.perf.Fn.toFixed(0), 'Wf', dry.perf.Wfuel.toFixed(3), wet.perf.Wfuel.toFixed(3));
    expect(war).toBeGreaterThan(0.025); expect(war).toBeLessThan(0.03);
    expect(wet.perf.Wfuel).toBeGreaterThan(dry.perf.Wfuel);
  });
  it('computed cooling raises bleed with T4 and reports metal temperature and life', () => {
    const base = defaultInputs('turbofan'); base.chemistry = 'frozen'; base.cooling = { mode: 'computed', targetMetal_K: 1250, effectivenessMax: 0.7, coolantTempRise_K: 60 };
    const lo = solveEngine({ ...base, burner: { ...base.burner, T4_K: 1500 } });
    const hi = solveEngine({ ...base, burner: { ...base.burner, T4_K: 1800 } });
    const cLo = lo.components.find((c) => c.id === 'hpt')!.values, cHi = hi.components.find((c) => c.id === 'hpt')!.values;
    console.log('cooling frac 1500K', cLo.coolingFrac.toFixed(3), 'metal', cLo.metalTemp_K.toFixed(0), 'life', cLo.creepLife_h.toFixed(0), '| 1800K', cHi.coolingFrac.toFixed(3), 'metal', cHi.metalTemp_K.toFixed(0));
    expect(cHi.coolingFrac).toBeGreaterThan(cLo.coolingFrac);
    expect(Math.abs(cLo.metalTemp_K - 1250)).toBeLessThan(2);
    expect(cLo.creepLife_h).toBeGreaterThan(0);
  });
});
