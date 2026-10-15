import { useState } from 'react';
import { Store, odFromDesign } from '../state/store';
import { type SavedDesign, loadGallery, saveGallery, parseGallery, galleryForExport, restoreGalleryMaps } from '../state/gallery';
import { shareUrl } from './share';
import { fmt } from './format';
import { solveEngine } from '../engine/cycle';


/** Named saved designs in this browser, with sharing links and import/export as JSON. */
export function Gallery({ store }: { store: Store }) {
  const [list, setList] = useState<SavedDesign[]>(loadGallery);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const persist = (l: SavedDesign[]) => { try { const valid = parseGallery(l); saveGallery(valid); setList(valid); return true; } catch (e: any) { setMsg(`Save failed: ${e.message}`); return false; } };
  const save = () => {
    const inputs = store.state.inputs;
    let summary = { arch: inputs.arch, Fn_kN: NaN, TSFC: NaN, T4: inputs.burner.T4_K };
    try { const r = solveEngine(inputs); summary = { ...summary, Fn_kN: r.perf.Fn / 1000, TSFC: r.perf.TSFC_mg_Ns }; } catch { /* keep NaN */ }
    const d: SavedDesign = galleryForExport([{ id: Date.now().toString(36), name: name.trim() || `${inputs.arch} · ${new Date().toLocaleString()}`, savedAt: new Date().toISOString(), inputs: JSON.parse(JSON.stringify(inputs)), od: store.state.od, mode: store.state.mode, note: store.state.note, summary }])[0];
    if (persist([d, ...list])) { setName(''); setMsg(`Saved “${d.name}”.`); }
  };
  const load = async (d: SavedDesign) => { try { await restoreGalleryMaps(d); store.dispatch({ type: 'load', state: { inputs: JSON.parse(JSON.stringify(d.inputs)), selected: null, od: d.od ?? odFromDesign(d.inputs), mode: d.mode ?? 'design', note: d.note ?? `Loaded: ${d.name}` } }); setMsg(`Loaded “${d.name}”.`); } catch (e: any) { setMsg(`Load failed: ${e.message}`); } };
  const link = async (d: SavedDesign) => { const url = await shareUrl({ inputs: d.inputs, od: d.od, mode: d.mode ?? 'design', maps: d.maps, note: d.note }); try { await navigator.clipboard.writeText(url); setMsg('Link copied.'); } catch { prompt('Copy this link', url); } };
  const exportAll = () => { const blob = new Blob([JSON.stringify(galleryForExport(list), null, 1)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'gas-turbine-lab-designs.json'; a.click(); };
  const importFile = async (f: File) => { try { const arr = parseGallery(JSON.parse(await f.text())); if (persist([...arr, ...list])) setMsg(`Imported ${arr.length} designs.`); } catch (e: any) { setMsg(`Import failed: ${e.message}`); } };
  return (
    <div>
      <div className="prose"><h2>Saved designs</h2><p>Designs are stored in this browser. Export the list as JSON to move it elsewhere or share it; each entry can also be copied as a link.</p></div>
      <div className="explore-controls">
        <input className="num" aria-label="Design name" placeholder="name this design" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 240 }} />
        <button className="btn primary" onClick={save}>Save current design</button>
        <button className="btn" onClick={exportAll} disabled={!list.length}>Export JSON</button>
        <label className="btn">Import JSON <input type="file" accept=".json" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} /></label>
        {msg && <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{msg}</span>}
      </div>
      {list.length === 0 ? <div className="prose"><p>No saved designs yet.</p></div> : (
        <div className="cards">
          {list.map((d) => (
            <div className="card" key={d.id}>
              <div style={{ fontWeight: 600 }}>{d.name}</div>
              <div className="k" style={{ textTransform: 'none', letterSpacing: 0, marginTop: 2 }}>{d.summary.arch} · {new Date(d.savedAt).toLocaleString()}</div>
              <div className="kv" style={{ marginTop: 6 }}>
                <span className="k">Net thrust</span><span className="v">{fmt(d.summary.Fn_kN, 1)} kN</span>
                <span className="k">TSFC</span><span className="v">{fmt(d.summary.TSFC, 2)} mg/(N·s)</span>
                <span className="k">T4</span><span className="v">{fmt(d.summary.T4, 0)} K</span>
              </div>
              <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                <button className="btn" onClick={() => load(d)}>Load</button>
                <button className="btn" onClick={() => store.dispatch({ type: 'compare', inputs: JSON.parse(JSON.stringify(d.inputs)), label: d.name })}>Compare as B</button>
                <button className="btn" onClick={() => link(d)}>Copy link</button>
                <button className="btn" onClick={() => persist(list.filter((x) => x.id !== d.id))}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
