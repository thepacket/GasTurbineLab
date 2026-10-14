import { Store } from '../state/store';
import { SCENARIOS } from './scenarios';

export function Learn({ store }: { store: Store }) {
  const active = store.state.scenario;
  const sc = SCENARIOS.find((s) => s.id === active);
  return (
    <div>
      <div className="prose">
        <h2>Guided scenarios</h2>
        <p>Each scenario loads a design, opens the right view and walks through what to look for. The lab stays fully interactive, so change anything along the way.</p>
      </div>
      <div className="cards">
        {SCENARIOS.map((s) => (
          <button key={s.id} className="card" style={{ textAlign: 'left', cursor: 'pointer', border: active === s.id ? '1px solid var(--accent)' : undefined }} onClick={() => { store.dispatch({ type: 'inputs', inputs: s.setup(), note: `Scenario: ${s.title}` }); store.dispatch({ type: 'scenario', id: s.id }); if (s.explore) store.dispatch({ type: 'mode', mode: s.explore.mode }); }}>
            <div className="k">{s.view}</div>
            <div style={{ fontWeight: 600, marginTop: 4 }}>{s.title}</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 12.5, marginTop: 4 }}>{s.summary}</div>
          </button>
        ))}
      </div>
      {sc && (
        <div className="section">
          <h3>{sc.title}</h3>
          <ol style={{ paddingLeft: 20, color: 'var(--text-secondary)', fontSize: 13.5, lineHeight: 1.5 }}>
            {sc.steps.map((st, k) => <li key={k} style={{ marginBottom: 8 }}><strong style={{ color: 'var(--text-primary)' }}>{st.title}.</strong> {st.text}</li>)}
          </ol>
          <div className="row">
            <button className="btn primary" onClick={() => store.dispatch({ type: 'view', view: sc.view })}>Open {sc.view}</button>
            {sc.explore && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>In Explore, choose “{sc.explore.param === 'od_alt' ? 'Altitude' : sc.explore.param === 'od_T4' ? 'Throttle: T4' : sc.explore.param}” as the sweep parameter ({sc.explore.mode} sweeps).</span>}
          </div>
        </div>
      )}
    </div>
  );
}
