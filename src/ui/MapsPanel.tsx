import { useState } from 'react';
import { Store } from '../state/store';
import { COMPRESSOR_MAPS, TURBINE_MAPS } from '../engine/maps';
import { CustomMap, loadCustomMaps, saveCustomMaps, parseCsvMap, parseJsonMap, generateCompressorMap } from '../engine/custommaps';
import { MAP_FOR } from '../engine/offdesign';
import { request } from '../engine/client';

const COMP_IDS: Record<string, string[]> = { turbojet: ['comp'], turbofan: ['fan', 'lpc', 'ipc', 'hpc'], turboprop: ['comp'] };
const TURB_IDS: Record<string, string[]> = { turbojet: ['turb'], turbofan: ['hpt', 'ipt', 'lpt'], turboprop: ['turb', 'pt'] };

/** Component map assignment, upload (JSON / CSV) and parametric generation. */
export function MapsPanel({ store }: { store: Store }) {
  const inputs = store.state.inputs;
  const [custom, setCustom] = useState<CustomMap[]>(() => loadCustomMaps());
  const [msg, setMsg] = useState<string | null>(null);
  const [gen, setGen] = useState({ name: 'My compressor', PRdes: 10, WcDes: 50, surgeMargin: 0.2 });
  const persist = (list: CustomMap[]) => { setCustom(list); saveCustomMaps(list); request({ type: 'maps', maps: list.map((m) => ({ id: m.id, kind: m.kind, data: m.data })) }).catch(() => { /* worker restarts lazily */ }); };
  const onFile = async (f: File, kind: 'compressor' | 'turbine' | 'auto') => {
    try {
      const text = await f.text();
      let parsed: { kind: 'compressor' | 'turbine'; data: any };
      if (f.name.toLowerCase().endsWith('.json') || text.trim().startsWith('{')) parsed = parseJsonMap(text);
      else parsed = { kind: kind === 'auto' ? 'compressor' : kind, data: parseCsvMap(text, kind === 'auto' ? 'compressor' : kind) };
      const id = `custom:${f.name.replace(/\.[^.]+$/, '')}:${Date.now().toString(36)}`;
      persist([...custom, { id, name: f.name, kind: parsed.kind, data: parsed.data }]);
      setMsg(`Loaded ${parsed.kind} map “${f.name}”.`);
    } catch (e: any) { setMsg(`Could not read map: ${e.message}`); }
  };
  const setMap = (comp: string, id: string) => store.set('mapIds', { ...(inputs.mapIds ?? {}), [comp]: id });
  const compIds = COMP_IDS[inputs.arch].filter((c) => (c !== 'lpc' || inputs.spools === 2) && (c !== 'ipc' || inputs.spools === 3));
  const turbIds = TURB_IDS[inputs.arch].filter((c) => c !== 'ipt' || inputs.spools === 3);
  return (
    <div>
      <div className="prose">
        <h2>Component maps</h2>
        <p>Off-design behaviour follows the maps assigned here, scaled through the design point. Built-in maps are the NPSS-style generic maps distributed with pyCycle. Upload your own as JSON (the same structure as <code>src/data/maps.json</code> entries) or as a CSV grid (compressor: <code>Nc, Rline, Wc, PR, eff</code>; turbine: <code>Np, PR, Wp, eff</code>), or generate a parametric compressor map. Maps are stored in this browser only.</p>
      </div>
      <div className="section">
        <h3>Assignment</h3>
        {compIds.map((c) => (
          <div className="control" key={c}><label>{c.toUpperCase()} compressor</label>
            <select className="select" style={{ width: 'auto' }} value={inputs.mapIds?.[c] ?? MAP_FOR[c]} onChange={(e) => setMap(c, e.target.value)} aria-label={`${c} map`}>
              {COMPRESSOR_MAPS.map((m) => <option key={m} value={m}>built-in {m}</option>)}
              {custom.filter((m) => m.kind === 'compressor').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select></div>
        ))}
        {turbIds.map((c) => (
          <div className="control" key={c}><label>{c.toUpperCase()} turbine</label>
            <select className="select" style={{ width: 'auto' }} value={inputs.mapIds?.[c] ?? MAP_FOR[c]} onChange={(e) => setMap(c, e.target.value)} aria-label={`${c} map`}>
              {TURBINE_MAPS.map((m) => <option key={m} value={m}>built-in {m}</option>)}
              {custom.filter((m) => m.kind === 'turbine').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select></div>
        ))}
      </div>
      <div className="section">
        <h3>Upload</h3>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <label className="btn">JSON or CSV compressor map <input type="file" accept=".json,.csv,.txt" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0], 'compressor')} /></label>
          <label className="btn">CSV turbine map <input type="file" accept=".csv,.txt,.json" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0], 'turbine')} /></label>
          {msg && <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{msg}</span>}
        </div>
        {custom.length > 0 && (
          <div className="kv" style={{ marginTop: 10 }}>
            {custom.map((m) => <span key={m.id} style={{ display: 'contents' }}><span className="k">{m.name} <small style={{ color: 'var(--text-muted)' }}>{m.kind}</small></span><span className="v"><button className="btn" style={{ padding: '2px 8px' }} onClick={() => persist(custom.filter((x) => x.id !== m.id))}>remove</button></span></span>)}
          </div>
        )}
      </div>
      <div className="section">
        <h3>Generate a parametric compressor map</h3>
        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          <label>name <input className="num" aria-label="Map name" value={gen.name} onChange={(e) => setGen({ ...gen, name: e.target.value })} style={{ width: 150 }} /></label>
          <label>design PR <input className="num" aria-label="Design pressure ratio" type="number" value={gen.PRdes} step={0.5} style={{ width: 70 }} onChange={(e) => setGen({ ...gen, PRdes: +e.target.value })} /></label>
          <label>design Wc <input className="num" aria-label="Design corrected flow" type="number" value={gen.WcDes} step={1} style={{ width: 70 }} onChange={(e) => setGen({ ...gen, WcDes: +e.target.value })} /></label>
          <label>stall margin at design <input className="num" aria-label="Stall margin" type="number" value={gen.surgeMargin} step={0.05} style={{ width: 70 }} onChange={(e) => setGen({ ...gen, surgeMargin: +e.target.value })} /></label>
          <button className="btn primary" onClick={() => { const data = generateCompressorMap({ PRdes: gen.PRdes, WcDes: gen.WcDes, surgeMargin: gen.surgeMargin }); const id = `custom:gen:${Date.now().toString(36)}`; persist([...custom, { id, name: gen.name, kind: 'compressor', data }]); setMsg(`Generated “${gen.name}”.`); }}>Generate</button>
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>Elliptical speed-line model: flow range and stall pressure ratio scale with corrected speed; efficiency peaks mid-map. Absolute values are rescaled to the design point anyway, so the shape is what matters.</div>
      </div>
    </div>
  );
}
