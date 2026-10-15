/** URL sharing: the whole design (inputs, operating point, mode) in the hash as base64url JSON. */
import { EngineInputs } from '../engine/types';
import { OffDesignInputs } from '../engine/offdesign';
import { loadCustomMaps } from '../engine/custommaps';

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
  const arch = ['turbojet', 'turbofan', 'turboprop'].includes(raw.inputs.arch) ? raw.inputs.arch : 'turbofan';
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
  const inputs: EngineInputs = clean(defaultsFor(arch), raw.inputs);
  inputs.arch = arch;
  // optional fields that have no default value but are valid settings
  const ri = raw.inputs;
  if (ri.mixer && typeof ri.mixer === 'object') {
    if (ri.mixer.designedStream === 'core' || ri.mixer.designedStream === 'bypass') inputs.mixer.designedStream = ri.mixer.designedStream;
    if (typeof ri.mixer.MNbyp === 'number' && Number.isFinite(ri.mixer.MNbyp)) inputs.mixer.MNbyp = Math.min(1, Math.max(0.05, ri.mixer.MNbyp));
  }
  if (ri.flight && typeof ri.flight.altIsGeopotential === 'boolean') inputs.flight.altIsGeopotential = ri.flight.altIsGeopotential;
  if (ri.chemistry === 'frozen' || ri.chemistry === 'equilibrium') inputs.chemistry = ri.chemistry;
  if (['jetA', 'saf', 'hydrogen', 'methane'].includes(ri.fuel)) inputs.fuel = ri.fuel;
  if (raw.inputs.mapIds && typeof raw.inputs.mapIds === 'object') {
    inputs.mapIds = {};
    for (const [k, v] of Object.entries(raw.inputs.mapIds)) if (typeof v === 'string' && v.length < 120 && /^[\w:.-]+$/.test(v)) inputs.mapIds[k.slice(0, 20)] = v;
  }
  let od: OffDesignInputs | undefined;
  if (raw.od && typeof raw.od === 'object') {
    od = { altitude_m: num(raw.od.altitude_m, 0), mach: num(raw.od.mach, 0), dT_isa: num(raw.od.dT_isa, 0), throttle: { mode: ['T4', 'Wf', 'NHP', 'NLP', 'Fn'].includes(raw.od.throttle?.mode) ? raw.od.throttle.mode : 'T4', value: num(raw.od.throttle?.value, inputs.burner.T4_K) }, HPX_W: num(raw.od.HPX_W, 0), propPower_W: num(raw.od.propPower_W, inputs.prop.shaftPower_W) };
    // optional overrides: geometry (numeric keys of the geometry block), installation flag, component deltas
    if (raw.od.geometry && typeof raw.od.geometry === 'object') {
      const g: Partial<EngineInputs['geometry']> = {};
      for (const k of Object.keys(inputs.geometry) as (keyof EngineInputs['geometry'])[]) if (typeof raw.od.geometry[k] === 'number' && Number.isFinite(raw.od.geometry[k])) g[k] = raw.od.geometry[k];
      if (Object.keys(g).length) od.geometry = g;
    }
    if (typeof raw.od.installation === 'boolean') od.installation = raw.od.installation;
    if (raw.od.deltas && typeof raw.od.deltas === 'object') {
      const d: Record<string, { eff?: number; Wc?: number }> = {};
      for (const [k, v] of Object.entries<any>(raw.od.deltas)) if (/^[a-z]{2,5}$/.test(k) && v && typeof v === 'object') { const e: { eff?: number; Wc?: number } = {}; if (typeof v.eff === 'number' && Number.isFinite(v.eff)) e.eff = v.eff; if (typeof v.Wc === 'number' && Number.isFinite(v.Wc)) e.Wc = v.Wc; d[k] = e; }
      if (Object.keys(d).length) od.deltas = d;
    }
  }
  const compare = raw.compare && typeof raw.compare === 'object' ? (clean(defaultsFor(['turbojet', 'turbofan', 'turboprop'].includes(raw.compare.arch) ? raw.compare.arch : 'turbofan'), raw.compare) as EngineInputs) : null;
  const maps = Array.isArray(raw.maps) ? raw.maps.filter((m: any) => m && typeof m.id === 'string' && /^custom:/.test(m.id) && (m.kind === 'compressor' || m.kind === 'turbine') && m.data && typeof m.data === 'object').slice(0, 12) : undefined;
  return { inputs, od, mode: raw.mode === 'offdesign' ? 'offdesign' : 'design', note: typeof raw.note === 'string' ? raw.note.slice(0, 500) : null, compare, maps };
}
const num = (v: any, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export async function decodeShare(hash: string): Promise<Shared | null> {
  const h = hash.replace(/^#/, '');
  if (!h.startsWith('d=')) return null;
  const payload = h.slice(2);
  try {
    const kind = payload[0], body = payload.slice(1);
    let bytes = unb64url(body);
    if (kind === 'z') {
      const ds = new DecompressionStream('deflate-raw');
      const w = ds.writable.getWriter(); w.write(bytes as unknown as BufferSource); w.close();
      bytes = new Uint8Array(await new Response(ds.readable).arrayBuffer());
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}
/** Custom maps referenced by the design (and the comparison design) travel inside the link. */
export function packageMaps(data: Shared): Shared['maps'] {
  const ids = new Set<string>();
  for (const inp of [data.inputs, data.compare]) for (const id of Object.values(inp?.mapIds ?? {})) if (typeof id === 'string' && id.startsWith('custom:')) ids.add(id);
  if (!ids.size) return undefined;
  const maps = loadCustomMaps().filter((m) => ids.has(m.id)).map((m) => ({ id: m.id, kind: m.kind, data: m.data as unknown }));
  return maps.length ? maps : undefined;
}
export async function shareUrl(data: Shared): Promise<string> {
  const maps = data.maps ?? packageMaps(data);
  return `${location.origin}${location.pathname}#d=${await encodeShare({ ...data, maps })}`;
}
