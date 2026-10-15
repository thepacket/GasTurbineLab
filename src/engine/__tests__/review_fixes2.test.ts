import { describe, it, expect, beforeAll } from 'vitest';
import { defaultInputs } from '../defaults';
import { sanitizeShared, packageMaps } from '../../ui/share';
import { runMonteCarlo, UNCERTAIN } from '../montecarlo';
import { handleRequest } from '../worker';
import { generateCompressorMap, generateStageStackedMap } from '../custommaps';

// minimal localStorage for modules that persist in the browser
beforeAll(() => { const m = new Map<string, string>(); (globalThis as any).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; });

describe('review fixes, third group', () => {
  it('sanitizer keeps valid optional settings', () => {
    const inp = defaultInputs('turbofan'); inp.mixed = true; inp.mixer = { ...inp.mixer, designedStream: 'core', MNbyp: 0.5 }; inp.flight.altIsGeopotential = true; inp.chemistry = 'frozen'; inp.fuel = 'saf';
    const d = sanitizeShared({ inputs: inp, od: { altitude_m: 5000, mach: 0.5, dT_isa: 0, throttle: { mode: 'Fn', value: 30000 }, geometry: { A8scale: 1.1, customerBleed_kgs: 0.5, bogus: 3 }, installation: true, deltas: { hpc: { eff: 0.98 } } } }, defaultInputs)!;
    expect(d.inputs.mixer.designedStream).toBe('core'); expect(d.inputs.mixer.MNbyp).toBe(0.5); expect(d.inputs.flight.altIsGeopotential).toBe(true);
    expect(d.inputs.chemistry).toBe('frozen'); expect(d.inputs.fuel).toBe('saf');
    expect(d.od!.geometry).toEqual({ A8scale: 1.1, customerBleed_kgs: 0.5 }); expect(d.od!.installation).toBe(true); expect(d.od!.deltas).toEqual({ hpc: { eff: 0.98 } });
    expect(d.od!.throttle).toEqual({ mode: 'Fn', value: 30000 });
  });
  it('custom maps referenced by a design or its comparison are packaged centrally', async () => {
    const data = generateCompressorMap({ PRdes: 10, WcDes: 50 });
    const available = [{ id: 'custom:t1', kind: 'compressor' as const, data }, { id: 'custom:t2', kind: 'compressor' as const, data }, { id: 'custom:unused', kind: 'compressor' as const, data }];
    const a = defaultInputs('turbofan'); a.mapIds = { hpc: 'custom:t1' };
    const b = defaultInputs('turbofan'); b.mapIds = { fan: 'custom:t2' };
    const maps = packageMaps({ inputs: a, compare: b }, available);
    expect(maps!.map((m) => m.id).sort()).toEqual(['custom:t1', 'custom:t2']);
    expect(packageMaps({ inputs: defaultInputs('turbojet') }, available)).toBeUndefined();
  });
  it('+1σ sensitivities are bounded and report the perturbation applied', () => {
    const inp = defaultInputs('turbofan'); inp.chemistry = 'frozen';
    const r = runMonteCarlo(inp, { inputs: UNCERTAIN.filter((u) => u.path === 'inlet.ramRecovery').map((u) => ({ ...u, sigma: 0.02 })), samples: 5, seed: 1 });
    const s = r.sensitivity[0];
    console.log('sensitivity: delta', s.delta.toFixed(4), 'bounded', s.bounded, 'dFn', s.dFn_pct.toFixed(3));
    expect(s.bounded).toBe(true);
    expect(Math.abs(s.delta - (1 - inp.inlet.ramRecovery))).toBeLessThan(1e-12);
  });
  it('worker: an off-design request using a custom map fails before registration and succeeds after', () => {
    const data = generateStageStackedMap({ stages: 8, PRdes: 12, WcDes: 50, vsvStages: 4, vsvGain: 0.35 });
    const inputs = defaultInputs('turbofan'); inputs.chemistry = 'frozen'; inputs.mapIds = { hpc: 'custom:worker-test' };
    const od = { altitude_m: inputs.flight.altitude_m, mach: inputs.flight.mach, dT_isa: 0, throttle: { mode: 'T4' as const, value: inputs.burner.T4_K * 0.9 } };
    const out: any[] = [];
    handleRequest({ id: 1, type: 'offdesign', inputs, od }, (r) => out.push(r));
    expect(out[out.length - 1].ok).toBe(false);
    expect(String(out[out.length - 1].error)).toMatch(/unknown compressor map/);
    handleRequest({ id: 2, type: 'maps', maps: [{ id: 'custom:worker-test', kind: 'compressor', data }] }, (r) => out.push(r));
    handleRequest({ id: 3, type: 'offdesign', inputs, od }, (r) => out.push(r));
    const last = out[out.length - 1];
    expect(last.ok).toBe(true);
    expect(last.payload.converged).toBe(true);
  });
});

describe('review fixes, fourth group', () => {
  it('the comparison design survives a share round trip with every setting, and solves identically', async () => {
    const { encodeShare, decodeShare } = await import('../../ui/share');
    const { solveEngine } = await import('../cycle');
    const b = defaultInputs('turbofan'); b.chemistry = 'frozen'; b.mixed = true; b.mixer = { ...b.mixer, designedStream: 'core', MNbyp: 0.5 }; b.flight.altIsGeopotential = true; b.fuel = 'saf'; b.mapIds = { hpc: 'custom:x' };
    const hash = await encodeShare({ inputs: defaultInputs('turbojet'), compare: b });
    const raw = await decodeShare('#d=' + hash);
    const d = sanitizeShared(raw, defaultInputs)!;
    expect(d.compare!.mixer.designedStream).toBe('core'); expect(d.compare!.mixer.MNbyp).toBe(0.5);
    expect(d.compare!.flight.altIsGeopotential).toBe(true); expect(d.compare!.fuel).toBe('saf'); expect(d.compare!.mapIds).toEqual({ hpc: 'custom:x' });
    const before = solveEngine({ ...b, mapIds: undefined }).perf.Fn, after = solveEngine({ ...d.compare!, mapIds: undefined }).perf.Fn;
    expect(after).toBe(before);
  });
  it('a browser worker registers saved custom maps before its first request', async () => {
    const posted: any[] = [];
    (globalThis as any).Worker = class { onmessage: any = null; constructor() { /* fake */ } postMessage(m: any) { posted.push(m); } terminate() { /* noop */ } };
    const { saveCustomMaps } = await import('../custommaps');
    saveCustomMaps([{ id: 'custom:startup', name: 's', kind: 'compressor', data: generateCompressorMap({ PRdes: 8, WcDes: 20 }) }]);
    const { restart, request } = await import('../client');
    restart();
    void request({ type: 'offdesign', inputs: defaultInputs('turbojet'), od: { altitude_m: 0, mach: 0, dT_isa: 0, throttle: { mode: 'T4', value: 1500 } } }).catch(() => {});
    expect(posted[0].type).toBe('maps');
    expect(posted[0].maps.map((m: any) => m.id)).toContain('custom:startup');
    expect(posted[1].type).toBe('offdesign');
  });
});
