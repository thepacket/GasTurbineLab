import { useMemo } from 'react';
import ref from '../data/pycycle_reference.json';
import { solveEngine } from '../engine/cycle';
import { inputsFromReferenceCase } from '../engine/reference';
import { fmt } from './format';

interface Row { label: string; pyc: number; lab: number; unit: string; tol: number }

export function Validation() {
  const cases = useMemo(() => (ref as any).cases.filter((c: any) => !c.error).map((c: any) => {
    const r = solveEngine(inputsFromReferenceCase(c));
    const rows: Row[] = [];
    const p = c.perf;
    const fn = c.architecture === 'turboprop' ? r.perf.jetThrust : r.perf.Fn;
    rows.push({ label: c.architecture === 'turboprop' ? 'Net jet thrust' : 'Net thrust', pyc: p.Fn_N ?? p.Fn_jet_N, lab: fn, unit: 'N', tol: 1 });
    rows.push({ label: 'Fuel flow', pyc: p.Wfuel_kgs, lab: r.perf.Wfuel, unit: 'kg/s', tol: 1 });
    rows.push({ label: 'Fuel/air ratio', pyc: p.FAR, lab: r.perf.FAR, unit: '', tol: 1 });
    if (p.TSFC_kg_per_N_h) rows.push({ label: 'TSFC', pyc: p.TSFC_kg_per_N_h, lab: r.perf.TSFC_kg_Nh, unit: 'kg/(N·h)', tol: 1 });
    if (p.shaft_power_W) rows.push({ label: 'Shaft power', pyc: p.shaft_power_W, lab: r.perf.shaftPower_W, unit: 'W', tol: 0.5 });
    for (const sh of r.shafts) {
      const key = sh.name === 'HP shaft' ? (c.architecture === 'turbofan' ? 'hpt_PR' : 'turb_PR') : sh.name === 'LP shaft' ? 'lpt_PR' : sh.name === 'Power shaft' ? 'pt_PR' : 'turb_PR';
      if (p[key]) rows.push({ label: `${sh.name} turbine PR`, pyc: p[key], lab: sh.turbinePR, unit: '', tol: 1.5 });
    }
    for (const [id, st] of Object.entries<any>(c.stations)) {
      const mine = r.stations.find((s) => s.id === id);
      if (!mine || id === '0') continue;
      rows.push({ label: `Pt station ${id}`, pyc: st.Pt_Pa, lab: mine.Pt, unit: 'Pa', tol: 1.2 });
      rows.push({ label: `Tt station ${id}`, pyc: st.Tt_K, lab: mine.Tt, unit: 'K', tol: 1.2 });
    }
    return { c, rows, worst: Math.max(...rows.map((x) => Math.abs(x.lab / x.pyc - 1) * 100)) };
  }), []);

  return (
    <div>
      <div className="prose">
        <h2>Validation against pyCycle</h2>
        <p>
          The reference values were produced by NASA's <code>pyCycle</code> ({(ref as any).generator}) running the design-point models in <code>reference/pycycle_reference.py</code>. pyCycle solves chemical equilibrium (CEA) at every station; this lab uses the same NASA polynomials and air/fuel composition but assumes frozen, fully-oxidised products. The residual differences (fuel flow 0.1–0.7 % low, turbine exit temperature 0.1–0.6 % low) are the dissociation enthalpy that equilibrium chemistry absorbs at high T4. Status: <span className="status good" />within 0.5 %, <span className="status warn" />within tolerance, <span className="status bad" />outside tolerance.
        </p>
      </div>
      {cases.map(({ c, rows, worst }: any) => (
        <details key={c.inputs.name} className="section" open={false}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            <span className={`status ${worst < 0.5 ? 'good' : worst < 1.5 ? 'warn' : 'bad'}`} />{c.inputs.name}
            <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8 }}>{c.architecture} · worst deviation {fmt(worst, 2)} %</span>
          </summary>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table className="stations">
              <thead><tr><th>Quantity</th><th>pyCycle</th><th>This lab</th><th>Δ %</th><th></th></tr></thead>
              <tbody>
                {rows.map((r: Row) => {
                  const d = (r.lab / r.pyc - 1) * 100;
                  const st = Math.abs(d) < 0.5 ? 'good' : Math.abs(d) < r.tol ? 'warn' : 'bad';
                  return (
                    <tr key={r.label}><td>{r.label}</td><td className="num">{smart(r.pyc)} {r.unit}</td><td className="num">{smart(r.lab)} {r.unit}</td><td className="num">{d >= 0 ? '+' : ''}{fmt(d, 3)}</td><td><span className={`status ${st}`} /></td></tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      ))}
      <div className="prose">
        <h3>Reproducing the reference</h3>
        <p>Install <code>om-pycycle</code> in a Python 3.11 environment with <code>numpy&lt;2</code>, then run the script in <code>reference/</code>. It writes <code>src/data/pycycle_reference.json</code>, which is bundled into this static app; nothing runs on a server.</p>
      </div>
    </div>
  );
}
const smart = (v: number) => (Math.abs(v) >= 1e5 ? fmt(v, 0) : Math.abs(v) >= 100 ? fmt(v, 1) : Math.abs(v) >= 1 ? fmt(v, 3) : fmt(v, 5));
