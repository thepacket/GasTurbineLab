import { expect, it, vi, afterEach } from 'vitest';
import { parseGallery, loadGallery, saveGallery, galleryForExport } from '../../state/gallery';
import { decodeShare, encodeShare, sanitizeShared } from '../../ui/share';
import { defaultInputs } from '../defaults';
import { loadCustomMaps, saveCustomMaps, generateCompressorMap } from '../custommaps';

afterEach(() => vi.unstubAllGlobals());
it('sanitizes saved enums and incomplete nested inputs', () => {
  const data = sanitizeShared({ inputs: { arch: 'turbojet', fuel: 'invalid', chemistry: 'invalid', cooling: { mode: 'invalid' }, burner: { T4_K: 1400 } } }, defaultInputs)!;
  expect(data.inputs.fuel).toBe('jetA');
  expect(data.inputs.chemistry).toBe(defaultInputs('turbojet').chemistry);
  expect(data.inputs.burner.eff).toBeGreaterThan(0);
  expect(data.inputs.cooling.mode).toBe('fixed');
  expect(data.inputs.coreNozzle.type).toBe(defaultInputs('turbojet').coreNozzle.type);
});
it('rejects malformed gallery entries, restores missing summaries, and avoids duplicate ids', () => {
  expect(() => parseGallery([null])).toThrow();
  expect(() => parseGallery({})).toThrow();
  const entry = { id: 'same', name: 'Saved', inputs: defaultInputs('turbojet') };
  const parsed = parseGallery([entry, entry]);
  expect(parsed[0].summary.arch).toBe('turbojet');
  expect(parsed[0].summary.T4).toBe(entry.inputs.burner.T4_K);
  expect(parsed[0].id).not.toBe(parsed[1].id);
});
it('recovers from corrupt storage and reports write failure', () => {
  vi.stubGlobal('localStorage', { getItem: () => '{broken', setItem: () => { throw new Error('quota'); } });
  expect(loadGallery()).toEqual([]);
  expect(() => saveGallery([])).toThrow('quota');
});
it('keeps valid stored maps when another entry is corrupted and rejects invalid saves before writing', () => {
  const good = { id: 'custom:good', name: 'Good', kind: 'compressor' as const, data: generateCompressorMap({ PRdes: 10, WcDes: 50 }) };
  const bad = { ...good, id: 'custom:bad', data: {} };
  const setItem = vi.fn();
  vi.stubGlobal('localStorage', { getItem: () => JSON.stringify([good, bad]), setItem });
  expect(loadCustomMaps().map(m => m.id)).toEqual(['custom:good']);
  expect(() => saveCustomMaps([good, bad as typeof good])).toThrow();
  expect(setItem).not.toHaveBeenCalled();
});
it('round-trips shared designs and handles corrupt compressed payloads without rejection', async () => {
  const input = { inputs: defaultInputs('turbojet'), note: 'ΔT test' };
  const hash = await encodeShare(input);
  expect((await decodeShare('#d=' + hash))?.note).toBe(input.note);
  expect(await decodeShare('#d=zAAAA')).toBeNull();
  expect(await decodeShare('#d=xAAAA')).toBeNull();
});
it('exports referenced custom maps and preserves operating mode through a Gallery round trip', () => {
  const map = { id: 'custom:portable', name: 'Portable', kind: 'compressor' as const, data: generateCompressorMap({ PRdes: 10, WcDes: 50 }) };
  vi.stubGlobal('localStorage', { getItem: () => JSON.stringify([map]), setItem: vi.fn() });
  const inputs = { ...defaultInputs('turbojet'), mapIds: { comp: map.id } };
  const saved = parseGallery([{ id: 'saved', inputs, mode: 'offdesign' }]);
  const restored = parseGallery(JSON.parse(JSON.stringify(galleryForExport(saved))));
  expect(restored[0].maps?.[0].data).toEqual(map.data);
  expect(restored[0].mode).toBe('offdesign');
});
