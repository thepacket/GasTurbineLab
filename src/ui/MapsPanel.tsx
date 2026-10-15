import { useState } from 'react';
import { Store } from '../state/store';
import { COMPRESSOR_MAPS, TURBINE_MAPS } from '../engine/maps';
import { CustomMap, loadCustomMaps, saveCustomMaps, parseCsvMap, parseJsonMap, generateCompressorMap, generateStageStackedMap, generateGeometryCompressorMap, generateGeometryTurbineMap, defaultStageGeometry, StageGeometry } from '../engine/custommaps';
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
  const [geo, setGeo] = useState<{ name: string; Ndes: number; WcDes: number; vsvGain: number; stages: StageGeometry[] }>({ name: 'Geometry HPC', Ndes: 14000, WcDes: 50, vsvGain: 0.3, stages: defaultStageGeometry({ stages: 6, Ndes_rpm: 14000, WcDes: 50, rMean_m: 0.3 }) });
  const [tgeo, setTgeo] = useState({ name: 'Geometry HPT', stages: 2, rMean_m: 0.32, bladeHeight_m: 0.05, nozzleExitAngle_deg: 70, Ndes: 14000, PRdes: 4 });
  const [stk, setStk] = useState({ name: 'Stage-stacked HPC', stages: 8, PRdes: 12, WcDes: 50, vsvStages: 4, vsvGain: 0.35, stageLoading: 0.4 });
  const persist = (list: CustomMap[]) => {
    try { saveCustomMaps(list); setCustom(list); request({ type: 'maps', maps: list.map((m) => ({ id: m.id, kind: m.kind, data: m.data })) }).catch((e) => setMsg(`Could not register maps: ${e.message}`)); return true; }
    catch (e: any) { setMsg(e.message); return false; }
  };
  const onFile = async (f: File, kind: 'compressor' | 'turbine' | 'auto') => {
    try {
      const text = await f.text();
      let parsed: { kind: 'compressor' | 'turbine'; data: any };
      if (f.name.toLowerCase().endsWith('.json') || text.trim().startsWith('{')) parsed = parseJsonMap(text);
      else parsed = { kind: kind === 'auto' ? 'compressor' : kind, data: parseCsvMap(text, kind === 'auto' ? 'compressor' : kind) };
      const id = `custom:import:${crypto.randomUUID()}`;
      if (!persist([...custom, { id, name: f.name, kind: parsed.kind, data: parsed.data }])) return;
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
          <button className="btn primary" onClick={() => { const data = generateCompressorMap({ PRdes: gen.PRdes, WcDes: gen.WcDes, surgeMargin: gen.surgeMargin }); const id = `custom:gen:${Date.now().toString(36)}`; if (!persist([...custom, { id, name: gen.name, kind: 'compressor', data }])) return; setMsg(`Generated “${gen.name}”.`); }}>Generate</button>
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>Elliptical speed-line model: flow range and stall pressure ratio scale with corrected speed; efficiency peaks mid-map. Absolute values are rescaled to the design point anyway, so the shape is what matters.</div>
      </div>
      <div className="section">
        <h3>Stage-stacked compressor map</h3>
        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          <label>name <input className="num" aria-label="Stacked map name" value={stk.name} onChange={(e) => setStk({ ...stk, name: e.target.value })} style={{ width: 150 }} /></label>
          <label>stages <input className="num" aria-label="Stages" type="number" value={stk.stages} step={1} style={{ width: 55 }} onChange={(e) => setStk({ ...stk, stages: +e.target.value })} /></label>
          <label>design PR <input className="num" aria-label="Stacked design PR" type="number" value={stk.PRdes} step={0.5} style={{ width: 65 }} onChange={(e) => setStk({ ...stk, PRdes: +e.target.value })} /></label>
          <label>design Wc <input className="num" aria-label="Stacked design flow" type="number" value={stk.WcDes} step={1} style={{ width: 65 }} onChange={(e) => setStk({ ...stk, WcDes: +e.target.value })} /></label>
          <label>stage loading ψ <input className="num" aria-label="Stage loading" type="number" value={stk.stageLoading} step={0.02} style={{ width: 60 }} onChange={(e) => setStk({ ...stk, stageLoading: +e.target.value })} /></label>
          <label>VSV stages <input className="num" aria-label="VSV stages" type="number" value={stk.vsvStages} step={1} style={{ width: 55 }} onChange={(e) => setStk({ ...stk, vsvStages: +e.target.value })} /></label>
          <label>VSV gain <input className="num" aria-label="VSV gain" type="number" value={stk.vsvGain} step={0.05} style={{ width: 60 }} onChange={(e) => setStk({ ...stk, vsvGain: +e.target.value })} /></label>
          <button className="btn primary" onClick={() => { const data = generateStageStackedMap(stk); const id = `custom:stack:${Date.now().toString(36)}`; if (!persist([...custom, { id, name: stk.name, kind: 'compressor', data }])) return; setMsg(`Generated stage-stacked map “${stk.name}”.`); }}>Stack stages</button>
        </div>
      </div>
      <div className="section">
        <h3>Compressor map from blade geometry</h3>
        <div className="row" style={{ flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
          <label>name <input className="num" aria-label="Geometry map name" value={geo.name} onChange={(e) => setGeo({ ...geo, name: e.target.value })} style={{ width: 140 }} /></label>
          <label>design speed <input className="num" aria-label="Design speed" type="number" value={geo.Ndes} step={100} style={{ width: 80 }} onChange={(e) => setGeo({ ...geo, Ndes: +e.target.value })} /> rpm</label>
          <label>design Wc <input className="num" aria-label="Geometry design flow" type="number" value={geo.WcDes} step={1} style={{ width: 65 }} onChange={(e) => setGeo({ ...geo, WcDes: +e.target.value })} /> kg/s</label>
          <label>VSV gain <input className="num" aria-label="Geometry VSV gain" type="number" value={geo.vsvGain} step={0.05} style={{ width: 60 }} onChange={(e) => setGeo({ ...geo, vsvGain: +e.target.value })} /></label>
          <button className="btn" onClick={() => setGeo({ ...geo, stages: defaultStageGeometry({ stages: geo.stages.length, Ndes_rpm: geo.Ndes, WcDes: geo.WcDes, rMean_m: geo.stages[0]?.rMean_m ?? 0.3 }) })}>Consistent defaults</button>
          <button className="btn" onClick={() => setGeo({ ...geo, stages: [...geo.stages, { ...geo.stages[geo.stages.length - 1], vsv: false }] })}>Add stage</button>
          <button className="btn" onClick={() => setGeo({ ...geo, stages: geo.stages.slice(0, -1) })} disabled={geo.stages.length < 2}>Remove stage</button>
          <button className="btn primary" onClick={() => { try { const data = generateGeometryCompressorMap({ stages: geo.stages, Ndes_rpm: geo.Ndes, WcDes: geo.WcDes, vsvGain: geo.vsvGain }); const id = `custom:geo:${Date.now().toString(36)}`; if (!persist([...custom, { id, name: geo.name, kind: 'compressor', data }])) return; setMsg(`Generated geometry map “${geo.name}”.`); } catch (e: any) { setMsg(`Geometry map failed: ${e.message}`); } }}>Build from geometry</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="stations">
            <thead><tr><th>Stage</th><th>r mean (m)</th><th>blade height (m)</th><th>rotor inlet angle (°)</th><th>rotor exit angle (°)</th><th>stator exit angle (°)</th><th>solidity</th><th>VSV</th></tr></thead>
            <tbody>{geo.stages.map((st, i) => {
              const set = (patch: Partial<StageGeometry>) => setGeo({ ...geo, stages: geo.stages.map((q, k) => (k === i ? { ...q, ...patch } : q)) });
              const cell = (k: keyof StageGeometry, step: number) => <td><input className="num" aria-label={`Stage ${i + 1} ${k}`} type="number" style={{ width: 70 }} value={st[k] as number} step={step} onChange={(e) => set({ [k]: +e.target.value } as any)} /></td>;
              return <tr key={i}><td>{i + 1}</td>{cell('rMean_m', 0.01)}{cell('bladeHeight_m', 0.005)}{cell('rotorInletAngle_deg', 1)}{cell('rotorExitAngle_deg', 1)}{cell('statorExitAngle_deg', 1)}{cell('solidity', 0.05)}<td><input type="checkbox" aria-label={`Stage ${i + 1} variable stator`} checked={!!st.vsv} onChange={(e) => set({ vsv: e.target.checked })} /></td></tr>;
            })}</tbody>
          </table>
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>Mean-line velocity triangles per stage: Carter's deviation at the rotor exit, Lieblein diffusion-factor and incidence losses, continuity on density between stages; variable stators add inlet swirl at low speed. Angles from axial.</div>
      </div>
      <div className="section">
        <h3>Turbine map from geometry</h3>
        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          <label>name <input className="num" aria-label="Turbine geometry map name" value={tgeo.name} onChange={(e) => setTgeo({ ...tgeo, name: e.target.value })} style={{ width: 140 }} /></label>
          <label>stages <input className="num" aria-label="Turbine stages" type="number" value={tgeo.stages} step={1} style={{ width: 50 }} onChange={(e) => setTgeo({ ...tgeo, stages: +e.target.value })} /></label>
          <label>r mean <input className="num" aria-label="Turbine mean radius" type="number" value={tgeo.rMean_m} step={0.01} style={{ width: 65 }} onChange={(e) => setTgeo({ ...tgeo, rMean_m: +e.target.value })} /> m</label>
          <label>blade height <input className="num" aria-label="Turbine blade height" type="number" value={tgeo.bladeHeight_m} step={0.005} style={{ width: 65 }} onChange={(e) => setTgeo({ ...tgeo, bladeHeight_m: +e.target.value })} /> m</label>
          <label>nozzle exit angle <input className="num" aria-label="Nozzle exit angle" type="number" value={tgeo.nozzleExitAngle_deg} step={1} style={{ width: 60 }} onChange={(e) => setTgeo({ ...tgeo, nozzleExitAngle_deg: +e.target.value })} /> °</label>
          <label>design speed <input className="num" aria-label="Turbine design speed" type="number" value={tgeo.Ndes} step={100} style={{ width: 80 }} onChange={(e) => setTgeo({ ...tgeo, Ndes: +e.target.value })} /> rpm</label>
          <label>design PR <input className="num" aria-label="Turbine design PR" type="number" value={tgeo.PRdes} step={0.1} style={{ width: 60 }} onChange={(e) => setTgeo({ ...tgeo, PRdes: +e.target.value })} /></label>
          <button className="btn primary" onClick={() => { const data = generateGeometryTurbineMap({ stages: tgeo.stages, rMean_m: tgeo.rMean_m, bladeHeight_m: tgeo.bladeHeight_m, nozzleExitAngle_deg: tgeo.nozzleExitAngle_deg, Ndes_rpm: tgeo.Ndes, PRdes: tgeo.PRdes }); const id = `custom:tgeo:${Date.now().toString(36)}`; if (!persist([...custom, { id, name: tgeo.name, kind: 'turbine', data }])) return; setMsg(`Generated turbine map “${tgeo.name}”.`); }}>Build turbine map</button>
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>Nozzle throat area sets the choking flow; the flow unchokes below the critical pressure ratio; efficiency follows a Smith-chart surface in stage loading and flow coefficient.</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>Each stage has a linear work characteristic and a parabolic loss bucket; stages are stacked on a mean line. Variable stators rotate the front stages' design flow coefficient with speed (gain 0 = fixed geometry), which is what keeps the front stages off stall at low corrected speed. Assign the result to the HPC to see the effect on the running line and surge margin off-design.</div>
      </div>
    </div>
  );
}
