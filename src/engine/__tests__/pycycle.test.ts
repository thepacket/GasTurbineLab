import { describe, it, expect } from 'vitest';
import ref from '../../data/pycycle_reference.json';
import { solveEngine } from '../cycle';
import { defaultInputs } from '../defaults';
import { inputsFromReferenceCase } from '../reference';

describe('pyCycle reference comparison', () => {
  it('frozen chemistry stays within 1 % of pyCycle', () => {
    for (const c of (ref as any).cases) {
      if (c.error) continue;
      const inp = inputsFromReferenceCase(c); inp.chemistry = 'frozen';
      const r = solveEngine(inp);
      const fn = c.perf.Fn_N ?? c.perf.Fn_jet_N;
      const Fn = c.architecture === 'turboprop' ? r.perf.jetThrust : r.perf.Fn;
      expect(Math.abs(Fn / fn - 1)).toBeLessThan(0.01);
      expect(Math.abs(r.perf.Wfuel / c.perf.Wfuel_kgs - 1)).toBeLessThan(0.01);
    }
  });
  for (const c of (ref as any).cases) {
    if (c.error) continue;
    it(c.inputs.name, () => {
      const inp = inputsFromReferenceCase(c);
      const r = solveEngine(inp);
      const lines: string[] = [];
      for (const [id, st] of Object.entries<any>(c.stations)) {
        const mine = r.stations.find((s) => s.id === id);
        if (!mine) continue;
        const dP = (mine.Pt / st.Pt_Pa - 1) * 100, dT = (mine.Tt / st.Tt_K - 1) * 100;
        lines.push(`  st ${id.padEnd(3)} Pt ${dP.toFixed(3).padStart(7)}%  Tt ${dT.toFixed(3).padStart(7)}%  W ${((mine.W / st.W_kgs - 1) * 100).toFixed(3)}%  V ${((mine.V / Math.max(st.V_ms, 1e-3) - 1) * 100).toFixed(2)}%`);
        expect(Math.abs(dP)).toBeLessThan(0.1);
        expect(Math.abs(dT)).toBeLessThan(0.1);
      }
      const p = c.perf;
      const fn = p.Fn_N ?? p.Fn_jet_N;
      const Fn = c.architecture === 'turboprop' ? r.perf.jetThrust : r.perf.Fn;
      lines.push(`  Fn ${Fn.toFixed(0)} vs ${fn.toFixed(0)} (${((Fn / fn - 1) * 100).toFixed(2)}%)  Wf ${r.perf.Wfuel.toFixed(4)} vs ${p.Wfuel_kgs.toFixed(4)} (${((r.perf.Wfuel / p.Wfuel_kgs - 1) * 100).toFixed(2)}%)`);
      console.log(c.inputs.name + '\n' + lines.join('\n'));
      expect(Math.abs(Fn / fn - 1)).toBeLessThan(0.001);
      expect(Math.abs(r.perf.Wfuel / p.Wfuel_kgs - 1)).toBeLessThan(0.001);
    });
  }
  it('defaults solve without warnings', () => {
    for (const a of ['turbojet', 'turbofan', 'turboprop'] as const) {
      const r = solveEngine(defaultInputs(a));
      expect(r.perf.Fn).toBeGreaterThan(0);
    }
  });
});
