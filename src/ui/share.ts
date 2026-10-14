/** URL sharing: the whole design (inputs, operating point, mode) in the hash as base64url JSON. */
import { EngineInputs } from '../engine/types';
import { OffDesignInputs } from '../engine/offdesign';

export interface Shared { inputs: EngineInputs; od?: OffDesignInputs; mode?: 'design' | 'offdesign'; note?: string | null; compare?: EngineInputs | null }

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
export async function shareUrl(data: Shared): Promise<string> {
  return `${location.origin}${location.pathname}#d=${await encodeShare(data)}`;
}
