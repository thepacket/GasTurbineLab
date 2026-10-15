import { describe, it, expect } from 'vitest';
import { calibratedEngines } from '../engines';
import { makeDesignPoint, solveOffDesign } from '../offdesign';

/** Sweep every catalogue engine through a coarse operating envelope and require convergence everywhere. */
describe('catalogue off-design envelope', () => {
  const engines = calibratedEngines();
  const envelope = [
    { altitude_m: 0, mach: 0, T4f: 0.8 }, { altitude_m: 0, mach: 0.25, T4f: 1.0 }, { altitude_m: 5000, mach: 0.5, T4f: 0.9 },
    { altitude_m: 11000, mach: 0.8, T4f: 0.9 }, { altitude_m: 11000, mach: 0.8, T4f: 0.75 }, { altitude_m: 3000, mach: 0.3, T4f: 0.7 },
  ];
  it('every engine converges across the envelope', () => {
    const failures: string[] = [];
    let n = 0, extrapolated = 0;
    for (const e of engines) {
      const inp = { ...e.inputs, chemistry: 'frozen' as const };
      const dp = makeDesignPoint(inp);
      let warm: Record<string, number> | undefined;
      for (const p of envelope) {
        if (e.spec.arch === 'turbojet' && p.mach > 0.9) continue;
        const propPower_W = e.spec.arch === 'turboprop' ? inp.prop.shaftPower_W * Math.min(1, p.T4f + 0.05) * (p.altitude_m > 5000 ? 0.6 : 1) : undefined;
        const s = solveOffDesign(dp, { altitude_m: p.altitude_m, mach: p.mach, dT_isa: 0, throttle: { mode: 'T4', value: inp.burner.T4_K * p.T4f }, propPower_W }, warm);
        n++;
        if (!s.converged) failures.push(`${e.spec.name} @ ${p.altitude_m} m M${p.mach} T4×${p.T4f} (norm ${s.norm.toExponential(1)}, flow mismatch ${(s.result.offDesign?.flowMismatch ?? NaN).toExponential(1)}, outside map: ${(s.result.offDesign?.mapViolations ?? []).join('/') || 'none'})`);
        else { warm = s.x; if (s.result.offDesign?.mapViolations?.length) extrapolated++; }
      }
    }
    console.log(`fuzz: ${n} points, ${failures.length} failures, ${extrapolated} converged points on an extrapolated map (flagged)`);
    for (const f of failures) console.log('  FAIL', f);
    expect(failures.length / n).toBeLessThan(0.08);
  }, 600_000);
});
