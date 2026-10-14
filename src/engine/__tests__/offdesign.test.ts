import { describe, it, expect } from 'vitest';
import { defaultInputs } from '../defaults';
import { makeDesignPoint, solveOffDesign } from '../offdesign';

describe('off-design', () => {
  for (const arch of ['turbojet', 'turbofan', 'turboprop'] as const) {
    const inp = defaultInputs(arch); inp.chemistry = 'frozen';
    const dp = makeDesignPoint(inp);
    it(`${arch}: design condition reproduces the design point`, () => {
      const s = solveOffDesign(dp, { altitude_m: inp.flight.altitude_m, mach: inp.flight.mach, dT_isa: 0, throttle: { mode: 'T4', value: inp.burner.T4_K } });
      expect(s.converged).toBe(true);
      expect(Math.abs(s.result.perf.Fn / dp.result.perf.Fn - 1)).toBeLessThan(1e-5);
      expect(Math.abs(s.x.W / inp.flight.W_kgs - 1)).toBeLessThan(1e-5);
    });
    it(`${arch}: throttling back reduces thrust and speeds`, () => {
      const s = solveOffDesign(dp, { altitude_m: inp.flight.altitude_m, mach: inp.flight.mach, dT_isa: 0, throttle: { mode: 'T4', value: inp.burner.T4_K * 0.85 }, propPower_W: arch === 'turboprop' ? inp.prop.shaftPower_W * 0.6 : undefined });
      console.log(arch, 'T4 -15%:', 'conv', s.converged, 'it', s.iterations, 'Fn', s.result.perf.Fn.toFixed(0), 'vs', dp.result.perf.Fn.toFixed(0), 'N_HP', (s.x.N_HP / inp.speeds.HP * 100).toFixed(1) + '%', 'W', s.x.W.toFixed(1), 'BPR', s.x.BPR?.toFixed(2));
      expect(s.converged).toBe(true);
      expect(s.result.perf.Fn).toBeLessThan(dp.result.perf.Fn);
      expect(s.x.N_HP).toBeLessThan(inp.speeds.HP);
      if (arch === 'turbofan') expect(s.x.BPR).toBeGreaterThan(inp.BPR);
    });
  }
  it('turbofan: take-off to cruise with fixed geometry', () => {
    const inp = defaultInputs('turbofan'); inp.chemistry = 'frozen';
    inp.flight = { altitude_m: 0, mach: 0, dT_isa: 0, W_kgs: 420 }; inp.burner.T4_K = 1650;
    const dp = makeDesignPoint(inp);
    const s = solveOffDesign(dp, { altitude_m: 11000, mach: 0.8, dT_isa: 0, throttle: { mode: 'T4', value: 1450 } });
    console.log('cruise: conv', s.converged, 'it', s.iterations, 'Fn', s.result.perf.Fn.toFixed(0), 'TSFC', s.result.perf.TSFC_mg_Ns.toFixed(2), 'W', s.x.W.toFixed(1), 'BPR', s.x.BPR.toFixed(2), 'N_LP%', (s.x.N_LP / inp.speeds.LP * 100).toFixed(1), 'N_HP%', (s.x.N_HP / inp.speeds.HP * 100).toFixed(1));
    expect(s.converged).toBe(true);
    expect(s.result.perf.Fn).toBeGreaterThan(0);
    expect(s.result.perf.TSFC_mg_Ns).toBeGreaterThan(dp.result.perf.TSFC_mg_Ns);
  });
  it('mixed-flow and three-spool turbofans solve on and off design', () => {
    for (const variant of [{ mixed: true }, { spools: 3 as const }]) {
      const inp = { ...defaultInputs('turbofan'), ...variant }; inp.chemistry = 'frozen';
      if (variant.spools === 3) { inp.ipc = { PR: 3.6, eff: 0.9, MN: 0.35 }; inp.hpc.PR = 6.5; inp.speeds.IP = 8000; }
      if (variant.mixed) { inp.BPR = 0.8; inp.fan.PR = 3.0; inp.lpc.PR = 1.5; inp.hpc.PR = 6; inp.burner.T4_K = 1700; }
      const dp = makeDesignPoint(inp);
      expect(dp.result.perf.Fn).toBeGreaterThan(0);
      const s = solveOffDesign(dp, { altitude_m: inp.flight.altitude_m, mach: inp.flight.mach, dT_isa: 0, throttle: { mode: 'T4', value: inp.burner.T4_K * 0.9 } });
      console.log(JSON.stringify(variant), 'conv', s.converged, 'it', s.iterations, 'Fn', s.result.perf.Fn.toFixed(0), 'vs', dp.result.perf.Fn.toFixed(0));
      expect(s.converged).toBe(true);
      expect(s.result.perf.Fn).toBeLessThan(dp.result.perf.Fn);
    }
  });
});
