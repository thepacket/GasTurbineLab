import { useMemo } from 'react';
import { Store } from '../state/store';
import { EngineResult } from '../engine/types';
import { solveEngine } from '../engine/cycle';
import { PRESETS } from '../engine/presets';
import { ENGINES, calibrateEngine } from '../engine/engines';
import { LineChart } from '../viz/charts';
import { fmt, kN, kW, pct, kPa } from './format';

/** Side-by-side comparison of the current design (A) with a pinned or catalogue design (B). */
export function Compare({ store, a }: { store: Store; a: EngineResult }) {
  const bInputs = store.state.compare;
  const b = useMemo(() => { if (!bInputs) return null; try { return solveEngine(bInputs); } catch { return null; } }, [bInputs]);
  const pick = (name: string) => {
    const p = PRESETS.find((x) => x.name === name); if (p) { store.dispatch({ type: 'compare', inputs: JSON.parse(JSON.stringify(p.inputs)), label: p.name }); return; }
    const e = ENGINES.find((x) => x.name === name); if (e) store.dispatch({ type: 'compare', inputs: calibrateEngine(e).inputs, label: `${e.maker} ${e.name}` });
  };
  return (
    <div>
      <div className="explore-controls">
        <button className="btn" onClick={() => store.dispatch({ type: 'compare', inputs: JSON.parse(JSON.stringify(store.state.inputs)), label: `Snapshot · ${new Date().toLocaleTimeString()}` })}>Pin current design as B</button>
        <label>or load B from <select value="" onChange={(e) => pick(e.target.value)}>
          <option value="">catalogue…</option>
          <optgroup label="Generic presets">{PRESETS.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</optgroup>
          <optgroup label="Commercial engines">{ENGINES.map((e) => <option key={e.name} value={e.name}>{e.maker} {e.name}</option>)}</optgroup>
        </select></label>
        {bInputs && <button className="btn" onClick={() => store.dispatch({ type: 'compare', inputs: null, label: null })}>Clear B</button>}
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>A is the live design-point result of the controls. B is a frozen design; both are design points.</span>
      </div>
      {!b ? (
        <div className="prose"><p>Pin the current design, or choose one from the catalogue, to compare.</p></div>
      ) : (
        <>
          <div className="section">
            <h3>A · {store.state.note ? store.state.note.split(' — ')[0] : `${a.inputs.arch} (current)`} &nbsp;vs&nbsp; B · {store.state.compareLabel}</h3>
            <table className="stations">
              <thead><tr><th>Quantity</th><th>A</th><th>B</th><th>Δ A−B</th></tr></thead>
              <tbody>{metrics(a, b).map((m) => <tr key={m.k}><td>{m.k}</td><td className="num">{m.a}</td><td className="num">{m.b}</td><td className="num">{m.d}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="charts">
            <LineChart title="Temperature–entropy diagrams" sub="core stream, total conditions" series={[ts(a, 'A', 'var(--series-1)'), ts(b, 'B', 'var(--series-2)')]} xLabel="Δs (kJ/kg·K)" yLabel="Tt (K)" labelPoints xFmt={(v) => fmt(v, 2)} yFmt={(v) => fmt(v, 0)} />
            <LineChart title="Total pressure along the core" series={[prof(a, 'Pt', 'A', 'var(--series-1)'), prof(b, 'Pt', 'B', 'var(--series-2)')]} xLabel="station index" yLabel="kPa" markers xFmt={(v) => a.stations.filter((s) => s.stream !== 'bypass')[Math.round(v)]?.id ?? ''} yFmt={(v) => kPa(v * 1000)} />
            <LineChart title="Total temperature along the core" series={[prof(a, 'Tt', 'A', 'var(--series-1)'), prof(b, 'Tt', 'B', 'var(--series-2)')]} xLabel="station index" yLabel="K" markers xFmt={(v) => a.stations.filter((s) => s.stream !== 'bypass')[Math.round(v)]?.id ?? ''} yFmt={(v) => fmt(v, 0)} />
          </div>
        </>
      )}
    </div>
  );
}
const ts = (r: EngineResult, name: string, color: string) => { const core = r.stations.filter((s) => s.stream !== 'bypass'); const s0 = core[0].s; return { name, color, points: core.map((s) => ({ x: (s.s - s0) / 1000, y: s.Tt, label: s.id })) }; };
const prof = (r: EngineResult, key: 'Pt' | 'Tt', name: string, color: string) => { const core = r.stations.filter((s) => s.stream !== 'bypass'); return { name, color, points: core.map((s, i) => ({ x: i, y: key === 'Pt' ? s.Pt / 1000 : s.Tt, label: s.id })) }; };

function metrics(a: EngineResult, b: EngineResult) {
  const row = (k: string, va: number, vb: number, f: (v: number) => string, rel = true) => ({ k, a: f(va), b: f(vb), d: Number.isFinite(va) && Number.isFinite(vb) ? (rel && vb !== 0 ? `${((va / vb - 1) * 100 >= 0 ? '+' : '')}${fmt((va / vb - 1) * 100, 1)} %` : f(va - vb)) : '–' });
  const in_ = (r: EngineResult) => r.inputs;
  const out = [
    row('Architecture', 0, 0, () => '', false), // placeholder replaced below
    row('Net thrust (kN)', a.perf.Fn / 1000, b.perf.Fn / 1000, (v) => kN(v * 1000)),
    row('TSFC (mg/N·s)', a.perf.TSFC_mg_Ns, b.perf.TSFC_mg_Ns, (v) => fmt(v, 2)),
    row('Specific thrust (N·s/kg)', a.perf.specificThrust, b.perf.specificThrust, (v) => fmt(v, 1)),
    row('Fuel flow (kg/s)', a.perf.Wfuel, b.perf.Wfuel, (v) => fmt(v, 3)),
    row('Overall pressure ratio', a.perf.OPR, b.perf.OPR, (v) => fmt(v, 1)),
    row('Turbine inlet temperature (K)', in_(a).burner.T4_K, in_(b).burner.T4_K, (v) => fmt(v, 0)),
    row('Inlet mass flow (kg/s)', in_(a).flight.W_kgs, in_(b).flight.W_kgs, (v) => fmt(v, 1)),
    row('Bypass ratio', in_(a).arch === 'turbofan' ? in_(a).BPR : NaN, in_(b).arch === 'turbofan' ? in_(b).BPR : NaN, (v) => fmt(v, 2)),
    row('Thermal efficiency', a.perf.thermalEff, b.perf.thermalEff, (v) => pct(v)),
    row('Propulsive efficiency', a.perf.propulsiveEff, b.perf.propulsiveEff, (v) => pct(v)),
    row('Overall efficiency', a.perf.overallEff, b.perf.overallEff, (v) => pct(v)),
    row('Shaft power (turboprop)', a.perf.shaftPower_W, b.perf.shaftPower_W, (v) => (v ? kW(v) : '–')),
    row('Altitude (m) · Mach', in_(a).flight.altitude_m, in_(b).flight.altitude_m, (v) => fmt(v, 0), false),
  ];
  out[0] = { k: 'Architecture', a: in_(a).arch, b: in_(b).arch, d: '' };
  out[out.length - 1] = { k: 'Flight condition', a: `${fmt(in_(a).flight.altitude_m, 0)} m · M ${fmt(in_(a).flight.mach, 2)}`, b: `${fmt(in_(b).flight.altitude_m, 0)} m · M ${fmt(in_(b).flight.mach, 2)}`, d: '' };
  return out;
}
