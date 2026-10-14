import { EngineResult } from '../engine/types';
import { Store } from '../state/store';
import { fmt, kN, kW, pct, kPa } from './format';
import { Diagrams } from '../viz/Diagrams';
import { MapCharts } from '../viz/MapChart';
import { exportStationsCsv } from './csv';

export function Results({ store, result }: { store: Store; result: EngineResult }) {
  const p = result.perf;
  const arch = result.inputs.arch;
  const sel = store.state.selected;
  return (
    <div>
      {result.offDesign && (
        <div className="section" style={{ paddingBottom: 8 }}>
          <h3>Off-design operating point</h3>
          <div className="kv">
            <span className="k">Throttle</span><span className="v">{result.offDesign.throttle}</span>
            <span className="k">Solver</span><span className="v">{result.offDesign.converged ? 'converged' : 'not converged'} · {result.offDesign.iterations} iterations · residual {result.offDesign.residualNorm.toExponential(1)}</span>
            {Object.entries(result.offDesign.x).map(([k, v]) => <ValueRow key={k} k={k} v={v} />)}
          </div>
        </div>
      )}
      {result.warnings.map((w, k) => <div className="warn" key={k}><span>⚠</span><span>{w}</span></div>)}
      <div className="cards">
        {arch === 'turboprop' ? (
          <>
            <div className="card hero"><div className="k">Shaft power delivered</div><div className="v">{kW(p.shaftPower_W)}</div></div>
            <div className="card"><div className="k">Propeller thrust</div><div className="v">{kN(p.propThrust)}<small>kN</small></div></div>
            <div className="card"><div className="k">Net jet thrust</div><div className="v">{kN(p.jetThrust)}<small>kN</small></div></div>
            <div className="card"><div className="k">Total net thrust</div><div className="v">{kN(p.Fn)}<small>kN</small></div></div>
            <div className="card"><div className="k">PSFC</div><div className="v">{fmt(p.PSFC_kg_kWh, 3)}<small>kg/kWh</small></div></div>
            <div className="card"><div className="k">Equivalent power</div><div className="v">{kW(p.ESHP_W)}</div></div>
            <div className="card"><div className="k">Fuel flow</div><div className="v">{fmt(p.Wfuel, 4)}<small>kg/s</small></div></div>
          </>
        ) : (
          <>
            <div className="card hero"><div className="k">Net thrust</div><div className="v">{kN(p.Fn)}<small>kN</small></div></div>
            <div className="card"><div className="k">TSFC</div><div className="v">{fmt(p.TSFC_mg_Ns, 2)}<small>mg/(N·s)</small></div></div>
            <div className="card"><div className="k">TSFC</div><div className="v">{fmt(p.TSFC_kg_Nh, 4)}<small>kg/(N·h)</small></div></div>
            <div className="card"><div className="k">Specific thrust</div><div className="v">{fmt(p.specificThrust, 1)}<small>N·s/kg</small></div></div>
            <div className="card"><div className="k">Gross thrust</div><div className="v">{kN(p.Fg)}<small>kN</small></div></div>
            <div className="card"><div className="k">Ram drag</div><div className="v">{kN(p.ramDrag)}<small>kN</small></div></div>
            {arch === 'turbofan' && !result.inputs.mixed && <div className="card"><div className="k">Bypass share of gross thrust</div><div className="v">{pct(p.Fg_byp / p.Fg, 0)}</div></div>}
            <div className="card"><div className="k">Fuel flow</div><div className="v">{fmt(p.Wfuel, 3)}<small>kg/s</small></div></div>
          </>
        )}
        <div className="card"><div className="k">Overall pressure ratio</div><div className="v">{fmt(p.OPR, 1)}</div></div>
        <div className="card"><div className="k">Fuel/air ratio</div><div className="v">{fmt(p.FAR, 4)}</div></div>
        <div className="card"><div className="k">Thermal efficiency</div><div className="v">{pct(p.thermalEff)}</div></div>
        <div className="card"><div className="k">Propulsive efficiency</div><div className="v">{p.V0 > 0 ? pct(p.propulsiveEff) : '–'}</div></div>
        <div className="card"><div className="k">Overall efficiency</div><div className="v">{p.V0 > 0 ? pct(p.overallEff) : '–'}</div></div>
      </div>

      <div className="section">
        <h3>Shaft power balance</h3>
        {result.shafts.map((s) => {
          const max = Math.max(s.powerIn_W, s.powerOut_W, 1);
          return (
            <div className="shaft" key={s.name}>
              <div className="kv"><span className="k">{s.name}</span><span className="v">turbine PR {fmt(s.turbinePR, 3)} · {fmt(s.rpm, 0)} rpm{s.outputRpm ? ` → ${fmt(s.outputRpm, 0)} rpm` : ''}</span></div>
              <div className="kv"><span className="k">Turbine supplies</span><span className="v">{kW(s.powerIn_W)}</span></div>
              <div className="bar"><i style={{ width: `${(100 * s.powerIn_W) / max}%` }} /></div>
              <div className="kv"><span className="k">Compressors + extraction absorb</span><span className="v">{kW(s.powerOut_W)}</span></div>
              <div className="bar"><i className="b" style={{ width: `${(100 * s.powerOut_W) / max}%` }} /></div>
            </div>
          );
        })}
      </div>

      <Diagrams result={result} />
      <MapCharts design={store.state.inputs} result={result} />

      <div className="section" style={{ padding: 0 }}>
        <h3 style={{ padding: '12px 14px 0' }}>Stations<span className="hint"><button className="btn" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => exportStationsCsv(result)}>Export CSV</button></span></h3>
        <div style={{ overflowX: 'auto' }}>
          <table className="stations">
            <thead><tr><th>St.</th><th>Pt kPa</th><th>Tt K</th><th>W kg/s</th><th>Ps kPa</th><th>M</th><th>V m/s</th><th>A m²</th></tr></thead>
            <tbody>
              {result.stations.map((s) => (
                <tr key={s.id} className={sel === 'st' + s.id ? 'sel' : ''} onClick={() => store.dispatch({ type: 'select', id: sel === 'st' + s.id ? null : 'st' + s.id })} title={s.name}>
                  <td><span style={{ color: 'var(--text-muted)' }}>{s.id}</span> {s.name}</td>
                  <td className="num">{kPa(s.Pt)}</td><td className="num">{fmt(s.Tt, 1)}</td><td className="num">{fmt(s.W, 2)}</td>
                  <td className="num">{kPa(s.Ps)}</td><td className="num">{fmt(s.MN, 2)}</td><td className="num">{fmt(s.V, 0)}</td><td className="num">{Number.isFinite(s.A) ? fmt(s.A, 3) : '∞'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section">
        <h3>Components</h3>
        {result.components.map((c) => (
          <details key={c.id} open={sel === c.id} onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) store.dispatch({ type: 'select', id: c.id }); }}>
            <summary style={{ cursor: 'pointer', padding: '4px 0', color: sel === c.id ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{c.name}</summary>
            <div className="kv" style={{ padding: '2px 0 8px 12px' }}>
              {Object.entries(c.values).map(([k, v]) => <ValueRow key={k} k={k} v={v} />)}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function ValueRow({ k, v }: { k: string; v: number }) {
  let label = k, text = fmt(v, 3);
  if (k.endsWith('_W')) { label = k.slice(0, -2); text = kW(v); }
  else if (k.endsWith('_N')) { label = k.slice(0, -2); text = kN(v) + ' kN'; }
  else if (k.endsWith('_kgs')) { label = k.slice(0, -4); text = fmt(v, 3) + ' kg/s'; }
  else if (k.endsWith('_m2')) { label = k.slice(0, -3); text = fmt(v, 4) + ' m²'; }
  else if (k.endsWith('_ms')) { label = k.slice(0, -3); text = fmt(v, 1) + ' m/s'; }
  else if (k.endsWith('_m')) { label = k.slice(0, -2); text = fmt(v, 2) + ' m'; }
  else if (k.endsWith('_W_m2')) { label = k.slice(0, -5); text = fmt(v / 1000, 1) + ' kW/m²'; }
  else if (k === 'choked') text = v ? 'yes' : 'no';
  else if (k.endsWith('_pct')) { label = k.slice(0, -4); text = fmt(v, 1) + ' %'; }
  else if (k === 'rpm' || k.endsWith('_rpm') || k.startsWith('N_')) text = fmt(v, 0) + ' rpm';
  else if (k.endsWith('_Pa')) { label = k.slice(0, -3); text = kPa(v) + ' kPa'; }
  else if (k.startsWith('Tt') || k.startsWith('T4') || k.startsWith('T7')) text = fmt(v, 1) + ' K';
  else if (k.startsWith('V')) text = fmt(v, 1) + ' m/s';
  label = label.replace(/_/g, ' ');
  return <><span className="k">{label}</span><span className="v">{text}</span></>;
}
