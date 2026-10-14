import { describe, it, expect } from 'vitest';
import ref from '../../data/pycycle_offdesign.json';
import { makeDesignPoint, solveOffDesign } from '../offdesign';
import { solveEngine } from '../cycle';
import { turbojetInputs, hbtfInputs, mixedInputs } from '../reference_od';

const R = ref as any;

function compareStations(mine: ReturnType<typeof solveEngine>, st: Record<string, any>, tol: number, label: string) {
  const lines: string[] = []; let worst = 0;
  for (const [id, s] of Object.entries<any>(st)) {
    const m = mine.stations.find((x) => x.id === id); if (!m || id === '0') continue;
    const dP = (m.Pt / s.Pt_Pa - 1) * 100, dT = (m.Tt / s.Tt_K - 1) * 100, dW = (m.W / s.W_kgs - 1) * 100;
    worst = Math.max(worst, Math.abs(dP), Math.abs(dT), Math.abs(dW));
    lines.push(`    st ${id.padEnd(3)} Pt ${dP.toFixed(3).padStart(7)}%  Tt ${dT.toFixed(3).padStart(7)}%  W ${dW.toFixed(3).padStart(7)}%`);
  }
  console.log(label + '\n' + lines.join('\n'));
  expect(worst).toBeLessThan(tol);
}

describe('pyCycle off-design and mixed-flow comparison', () => {
  it('turbojet: design and three off-design points', () => {
    const inp = turbojetInputs(); const dp = makeDesignPoint(inp);
    compareStations(dp.result, R.turbojet.design.stations, 0.1, 'turbojet design');
    expect(Math.abs(dp.result.perf.Fn / R.turbojet.design.perf.Fn_N - 1)).toBeLessThan(1e-3);
    for (const od of R.turbojet.od) {
      const s = solveOffDesign(dp, { altitude_m: od.inputs.alt_m, mach: od.inputs.mach, dT_isa: 0, throttle: { mode: 'T4', value: od.inputs.T4_K } });
      expect(s.converged).toBe(true);
      const dFn = (s.result.perf.Fn / od.perf.Fn_N - 1) * 100, dW = (s.x.W / od.W_kgs - 1) * 100, dN = (s.x.N_HP / od.Nmech - 1) * 100, dWf = (s.result.perf.Wfuel / od.perf.Wfuel_kgs - 1) * 100;
      console.log(`  turbojet OD ${od.inputs.alt_m} m M${od.inputs.mach} T4 ${od.inputs.T4_K}: Fn ${dFn.toFixed(2)}%  W ${dW.toFixed(2)}%  N ${dN.toFixed(2)}%  Wf ${dWf.toFixed(2)}%  (pyc Rline ${od.comp.Rline.toFixed(3)} mine ${s.x.Rl_comp.toFixed(3)})`);
      compareStations(s.result, od.stations, 0.1, '  stations');
      expect(Math.abs(dFn)).toBeLessThan(0.1); expect(Math.abs(dW)).toBeLessThan(0.1); expect(Math.abs(dN)).toBeLessThan(0.1);
    }
  });
  it('turbofan: design and three off-design points', () => {
    const inp = hbtfInputs(); const dp = makeDesignPoint(inp);
    compareStations(dp.result, R.hbtf.design.stations, 0.1, 'hbtf design');
    for (const od of R.hbtf.od) {
      const s = solveOffDesign(dp, { altitude_m: od.inputs.alt_m, mach: od.inputs.mach, dT_isa: 0, throttle: { mode: 'T4', value: od.inputs.T4_K } });
      expect(s.converged).toBe(true);
      const dFn = (s.result.perf.Fn / od.perf.Fn_N - 1) * 100, dW = (s.x.W / od.W_kgs - 1) * 100, dBPR = (s.x.BPR / od.BPR - 1) * 100, dNl = (s.x.N_LP / od.LP_Nmech - 1) * 100, dNh = (s.x.N_HP / od.HP_Nmech - 1) * 100;
      console.log(`  hbtf OD ${od.inputs.alt_m} m M${od.inputs.mach} T4 ${od.inputs.T4_K}: Fn ${dFn.toFixed(2)}%  W ${dW.toFixed(2)}%  BPR ${dBPR.toFixed(2)}%  N1 ${dNl.toFixed(2)}%  N2 ${dNh.toFixed(2)}%`);
      compareStations(s.result, od.stations, 0.1, '  stations');
      expect(Math.abs(dFn)).toBeLessThan(0.1); expect(Math.abs(dW)).toBeLessThan(0.1); expect(Math.abs(dNl)).toBeLessThan(0.1); expect(Math.abs(dNh)).toBeLessThan(0.1);
    }
  });
  it('mixed-flow turbofan design point', () => {
    const r = solveEngine(mixedInputs());
    const dFn = (r.perf.Fn / R.mixed.perf.Fn_N - 1) * 100, dWf = (r.perf.Wfuel / R.mixed.perf.Wfuel_kgs - 1) * 100;
    const mx = r.components.find((c) => c.id === 'mixer')!.values;
    console.log(`  mixed: Fn ${dFn.toFixed(2)}%  Wf ${dWf.toFixed(2)}%  hpt PR ${r.shafts[0].turbinePR.toFixed(3)} vs ${R.mixed.perf.hpt_PR.toFixed(3)}  lpt PR ${r.shafts[1].turbinePR.toFixed(3)} vs ${R.mixed.perf.lpt_PR.toFixed(3)}  MNbyp ${mx.MNbyp.toFixed(3)} MNmixed ${mx.MNmixed.toFixed(3)}`);
    compareStations(r, R.mixed.stations, 0.1, '  stations');
    expect(Math.abs(dFn)).toBeLessThan(0.1); expect(Math.abs(dWf)).toBeLessThan(0.1);
  });
});
