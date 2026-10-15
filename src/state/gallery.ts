import type { EngineInputs } from '../engine/types';
import type { OffDesignInputs } from '../engine/offdesign';
import { defaultInputs } from '../engine/defaults';
import { sanitizeShared, packageMaps, type Shared } from '../ui/share';
import { loadCustomMaps, saveCustomMaps } from '../engine/custommaps';
import { validateCompressor, validateTurbine } from '../engine/mapValidation';
import type { CompressorMapData, TurbineMapData } from '../engine/maps';
import { request } from '../engine/client';

export interface SavedDesign { id: string; name: string; savedAt: string; inputs: EngineInputs; od?: OffDesignInputs; mode?: 'design' | 'offdesign'; maps?: Shared['maps']; note?: string | null; summary: { arch: string; Fn_kN: number; TSFC: number; T4: number } }
const KEY = 'gtl.gallery.v1';

export function parseGallery(raw: unknown): SavedDesign[] {
  if (!Array.isArray(raw)) throw new Error('Expected a list of saved designs.');
  const ids = new Set<string>();
  return raw.map((entry, i) => {
    const data = sanitizeShared(entry, defaultInputs);
    if (!data || Array.isArray(entry.inputs)) throw new Error(`Design ${i + 1} has no valid inputs.`);
    for (const m of data.maps ?? []) {
      if (m.kind === 'compressor') validateCompressor(m.data as CompressorMapData);
      else validateTurbine(m.data as TurbineMapData);
    }
    let id = typeof entry.id === 'string' && entry.id.length <= 200 ? entry.id : crypto.randomUUID();
    if (ids.has(id)) id = crypto.randomUUID();
    ids.add(id);
    const numeric = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : NaN;
    return { id, name: typeof entry.name === 'string' ? entry.name.slice(0, 200) : `Design ${i + 1}`, savedAt: typeof entry.savedAt === 'string' && Number.isFinite(Date.parse(entry.savedAt)) ? entry.savedAt : '1970-01-01T00:00:00Z', inputs: data.inputs, od: data.od, mode: data.mode, maps: data.maps, note: data.note, summary: { arch: data.inputs.arch, Fn_kN: numeric(entry.summary?.Fn_kN), TSFC: numeric(entry.summary?.TSFC), T4: data.inputs.burner.T4_K } };
  });
}
export function loadGallery(): SavedDesign[] {
  try { return parseGallery(JSON.parse(localStorage.getItem(KEY) ?? '[]')); } catch { return []; }
}
export function saveGallery(list: SavedDesign[]) {
  // Let the caller report storage failure rather than claiming a successful save.
  localStorage.setItem(KEY, JSON.stringify(list));
}

/** Old entries may predate embedded maps; fill those snapshots from local storage on export. */
export function galleryForExport(list: SavedDesign[]): SavedDesign[] {
  const available = loadCustomMaps();
  return list.map(d => ({ ...d, maps: d.maps ?? packageMaps({ inputs: d.inputs }, available) }));
}
export async function restoreGalleryMaps(design: SavedDesign) {
  if (!design.maps?.length) return;
  const saved = loadCustomMaps();
  const merged = [...saved.filter(m => !design.maps!.some(n => n.id === m.id)), ...design.maps.map(m => ({ ...m, name: m.id, data: m.data as CompressorMapData | TurbineMapData }))];
  saveCustomMaps(merged);
  await request({ type: 'maps', maps: merged });
}
