import { describe, it, expect } from 'vitest';
import { calibratedEngines } from '../engines';

describe('commercial engine presets', () => {
  const all = calibratedEngines();
  for (const c of all) {
    it(`${c.spec.name} reproduces its published rating`, () => {
      const r = c.spec.arch === 'turboprop' ? Math.abs(c.achieved / c.target - 1) : Math.abs(c.achieved / c.target - 1);
      console.log(`${c.spec.name.padEnd(28)} ${c.spec.arch.padEnd(9)} target ${c.target.toFixed(2)} achieved ${c.achieved.toFixed(2)}  T4 ${c.inputs.burner.T4_K} K`);
      expect(r).toBeLessThan(0.005);
      expect(c.inputs.burner.T4_K).toBeGreaterThan(1050);
      expect(c.inputs.burner.T4_K).toBeLessThan(2050);
    });
  }
});
