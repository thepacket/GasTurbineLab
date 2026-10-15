/** URL sharing: the whole design (inputs, operating point, mode) in the hash as base64url JSON. */
import { EngineInputs } from '../engine/types';
import { OffDesignInputs } from '../engine/offdesign';

export interface Shared { inputs: EngineInputs; od?: OffDesignInputs; mode?: 'design' | 'offdesign'; note?: string | null; compare?: EngineInputs | null; maps?: { id: string; kind: 'compressor' | 'turbine'; data: unknown }[] }

function b64url(bytes: Uint8Array): string {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s: string): Uint8Array {
  const t = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(t); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export async function encodeShare(data: Shared): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(data));
  if (typeof CompressionStream !== 'undefined') {
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter(); w.write(json as unknown as BufferSource); w.close();
    const buf = new Uint8Array(await new Response(cs.readable).arrayBuffer());
    return 'z' + b64url(buf);
  }
  return 'j' + b64url(json);
}
/**
 * Validate shared data against the EngineInputs shape: only keys present in the defaults are kept, numbers must be
 * finite, strings are length-limited, and nested objects are merged key by key. Unknown or malformed fields are dropped.
 */
export function sanitizeShared(raw: any, defaultsFor: (arch: any) => EngineInputs): Shared | null {
  if (!raw || typeof raw !== 'object' || !raw.inputs || typeof raw.inputs !== 'object') return null;
  const inputs = sanitizeInputs(raw.inputs, defaultsFor);
  let od: OffDesignInputs | undefined;
  if (raw.od && typeof raw.od === 'object') {
    od = { altitude_m: num(raw.od.altitude_m, 0), mach: num(raw.od.mach, 0), dT_isa: num(raw.od.dT_isa, 0), throttle: { mode: ['T4', 'Wf', 'NHP', 'NLP', 'Fn'].includes(raw.od.throttle?.mode) ? raw.od.throttle.mode : 'T4', value: num(raw.od.throttle?.value, inputs.burner.T4_K) } };
    for (const key of ['HPX_W', 'propPower_W'] as const) if (typeof raw.od[key] === 'number' && Number.isFinite(raw.od[key])) od[key] = raw.od[key];
    // optional overrides: geometry (numeric keys of the geometry block), installation flag, component deltas
    if (raw.od.geometry && typeof raw.od.geometry === 'object') {
      const g: Partial<EngineInputs['geometry']> = {};
      for (const k of Object.keys(inputs.geometry) as (keyof EngineInputs['geometry'])[]) if (typeof raw.od.geometry[k] === 'number' && Number.isFinite(raw.od.geometry[k])) g[k] = raw.od.geometry[k];
      if (Object.keys(g).length) od.geometry = g;
    }
    if (typeof raw.od.burnerLit === 'boolean') od.burnerLit = raw.od.burnerLit;
    if (typeof raw.od.installation === 'boolean') od.installation = raw.od.installation;
    if (raw.od.deltas && typeof raw.od.deltas === 'object') {
      const d: Record<string, { eff?: number; Wc?: number }> = {};
      for (const [k, v] of Object.entries<any>(raw.od.deltas)) if (/^[a-z]{2,5}$/.test(k) && v && typeof v === 'object') { const e: { eff?: number; Wc?: number } = {}; if (typeof v.eff === 'number' && Number.isFinite(v.eff)) e.eff = v.eff; if (typeof v.Wc === 'number' && Number.isFinite(v.Wc)) e.Wc = v.Wc; d[k] = e; }
      if (Object.keys(d).length) od.deltas = d;
    }
  }
  // the comparison design goes through the same complete sanitizer as the main design
  const compare = raw.compare && typeof raw.compare === 'object' ? sanitizeInputs(raw.compare, defaultsFor) : null;
  const maps = Array.isArray(raw.maps) ? raw.maps.filter((m: any) => m && typeof m.id === 'string' && /^custom:/.test(m.id) && (m.kind === 'compressor' || m.kind === 'turbine') && m.data && typeof m.data === 'object').slice(0, 12) : undefined;
  return { inputs, od, mode: raw.mode === 'offdesign' ? 'offdesign' : 'design', note: typeof raw.note === 'string' ? raw.note.slice(0, 500) : null, compare, maps };
}

/**
 * Validate one EngineInputs object: keys present in the defaults are kept with type checks (numbers finite,
 * strings length-limited, nested objects merged key by key), then the valid optional fields that have no
 * default are added. Anything else is dropped.
 */
export function sanitizeInputs(ri: any, defaultsFor: (arch: any) => EngineInputs): EngineInputs {
  const arch = ['turbojet', 'turbofan', 'turboprop'].includes(ri?.arch) ? ri.arch : 'turbofan';
  const clean = (ref: any, val: any): any => {
    if (typeof ref === 'number') return typeof val === 'number' && Number.isFinite(val) ? val : ref;
    if (typeof ref === 'boolean') return typeof val === 'boolean' ? val : ref;
    if (typeof ref === 'string') return typeof val === 'string' ? val.slice(0, 200) : ref;
    if (ref && typeof ref === 'object' && !Array.isArray(ref)) {
      const out: any = { ...ref };
      if (val && typeof val === 'object') for (const k of Object.keys(ref)) out[k] = clean(ref[k], val[k]);
      return out;
    }
    return ref;
  };
  const inputs: EngineInputs = clean(defaultsFor(arch), ri ?? {});
  inputs.arch = arch;
  const defaults = defaultsFor(arch);
  inputs.chemistry = ['frozen', 'equilibrium'].includes(ri?.chemistry) ? ri.chemistry : defaults.chemistry;
  inputs.fuel = ['jetA', 'saf', 'hydrogen', 'methane'].includes(ri?.fuel) ? ri.fuel : defaults.fuel;
  inputs.spools = ri?.spools === 3 ? 3 : 2;
  inputs.cooling.mode = ri?.cooling?.mode === 'computed' ? 'computed' : 'fixed';
  inputs.coreNozzle.type = ['CV', 'CD'].includes(ri?.coreNozzle?.type) ? ri.coreNozzle.type : defaults.coreNozzle.type;
  inputs.bypNozzle.type = ['CV', 'CD'].includes(ri?.bypNozzle?.type) ? ri.bypNozzle.type : defaults.bypNozzle.type;
  if (!ri || typeof ri !== 'object') return inputs;
  if (ri.mapIds && typeof ri.mapIds === 'object') {
    inputs.mapIds = {};
    for (const [k, v] of Object.entries(ri.mapIds)) if (typeof v === 'string' && (v.startsWith('custom:') ? v.length <= 512 && !/[\u0000-\u001f\u007f]/.test(v) : v.length < 120 && /^[\w:.-]+$/.test(v))) inputs.mapIds[k.slice(0, 20)] = v;
  }
  if (ri.mixer && typeof ri.mixer === 'object') {
    if (ri.mixer.designedStream === 'core' || ri.mixer.designedStream === 'bypass') inputs.mixer.designedStream = ri.mixer.designedStream;
    if (typeof ri.mixer.MNbyp === 'number' && Number.isFinite(ri.mixer.MNbyp)) inputs.mixer.MNbyp = Math.min(1, Math.max(0.05, ri.mixer.MNbyp));
  }
  if (ri.flight && typeof ri.flight.altIsGeopotential === 'boolean') inputs.flight.altIsGeopotential = ri.flight.altIsGeopotential;
  if (ri.chemistry === 'frozen' || ri.chemistry === 'equilibrium') inputs.chemistry = ri.chemistry;
  if (['jetA', 'saf', 'hydrogen', 'methane'].includes(ri.fuel)) inputs.fuel = ri.fuel;
  return inputs;
}
const num = (v: any, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export async function decodeShare(hash: string): Promise<Shared | null> {
  const h = hash.replace(/^#/, '');
  if (!h.startsWith('d=')) return null;
  const payload = h.slice(2);
  if (payload.length > 4 * 1024 * 1024 || !['z', 'j'].includes(payload[0])) return null;
  try {
    const kind = payload[0], body = payload.slice(1);
    let bytes = unb64url(body);
    if (kind === 'z') {
      const ds = new DecompressionStream('deflate-raw');
      const w = ds.writable.getWriter();
      const read = async () => {
        const reader = ds.readable.getReader(); const chunks: Uint8Array[] = []; let size = 0;
        try {
          while (true) {
            const { value, done } = await reader.read(); if (done) break;
            size += value.length;
            if (size > 4 * 1024 * 1024) throw new Error('Shared design is too large.');
            chunks.push(value);
          }
        } catch (error) { await reader.cancel().catch(() => {}); throw error; }
        const all = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
        return all;
      };
      const [decoded] = await Promise.all([read(), (async () => { await w.write(bytes as unknown as BufferSource); await w.close(); })()]);
      bytes = decoded;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}
/** Custom maps referenced by the design (and the comparison design), taken from the available list, travel inside the link. */
export function packageMaps(data: Shared, available: { id: string; kind: 'compressor' | 'turbine'; data: unknown }[]): Shared['maps'] {
  const ids = new Set<string>();
  for (const inp of [data.inputs, data.compare]) for (const id of Object.values(inp?.mapIds ?? {})) if (typeof id === 'string' && id.startsWith('custom:')) ids.add(id);
  if (!ids.size) return undefined;
  const maps = available.filter((m) => ids.has(m.id)).map((m) => ({ id: m.id, kind: m.kind, data: m.data }));
  return maps.length ? maps : undefined;
}
export async function shareUrl(data: Shared): Promise<string> {
  // the map store is loaded lazily so this module stays free of the map tables
  const { loadCustomMaps } = await import('../engine/custommaps');
  const maps = data.maps ?? packageMaps(data, loadCustomMaps());
  return `${location.origin}${location.pathname}#d=${await encodeShare({ ...data, maps })}`;
}
