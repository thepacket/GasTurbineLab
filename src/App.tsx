import { useEffect, useState } from 'react';
import { useEngineStore, View } from './state/store';
import { useBreakpoint } from './ui/useBreakpoint';
import { Controls } from './ui/Controls';
import { Results } from './ui/Results';
import { CrossSection } from './viz/CrossSection';
import { Engine3D } from './three/Engine3D';
import { Explore } from './viz/Explore';
import { Validation } from './ui/Validation';
import { EngineResult } from './engine/types';

const VIEWS: { id: View; label: string; icon: string }[] = [
  { id: 'build', label: 'Build', icon: 'M4 6h16M4 12h10M4 18h7' },
  { id: 'section', label: 'Section', icon: 'M3 12h18M6 8c3-3 9-3 12 0M6 16c3 3 9 3 12 0' },
  { id: 'model', label: '3D', icon: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zm0 0v18M4 7.5l8 4.5 8-4.5' },
  { id: 'results', label: 'Results', icon: 'M4 20V10m6 10V4m6 16v-7m4 7H2' },
  { id: 'explore', label: 'Explore', icon: 'M3 17l6-6 4 4 8-8M14 7h7v7' },
  { id: 'validate', label: 'Validate', icon: 'M9 12l2 2 4-4m-3-7l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3z' },
];

const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;

export default function App() {
  const store = useEngineStore();
  const bp = useBreakpoint();
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('gtl.theme') as any) || 'dark');
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('gtl.theme', theme); }, [theme]);
  const res = store.result;
  const ok = !('error' in res);
  const result = ok ? (res as EngineResult) : null;
  const view = store.state.view;
  const setView = (v: View) => store.dispatch({ type: 'view', view: v });

  const errBox = !ok && <div className="err">Could not solve this cycle: {(res as any).error}</div>;

  const header = (
    <header className="header">
      <div className="brand">
        <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="13" stroke="var(--accent)" strokeWidth="2" /><path d="M16 5c3 4 3 8 0 11s-3 7 0 11M5 16c4-3 8-3 11 0s7 3 11 0" stroke="var(--series-2)" strokeWidth="2" strokeLinecap="round" /><circle cx="16" cy="16" r="2.5" fill="var(--text-primary)" /></svg>
        <span>Gas Turbine Lab</span>{bp === 'desktop' && <small>design-point cycle analysis</small>}
      </div>
      <div className="spacer" />
      {bp === 'tablet' && (
        <div className="segmented">{VIEWS.filter((v) => v.id !== 'build').map((v) => <button key={v.id} className={view === v.id || (view === 'build' && v.id === 'section') ? 'on' : ''} onClick={() => setView(v.id)}>{v.label}</button>)}</div>
      )}
      {bp === 'desktop' && (
        <div className="segmented">{(['section', 'explore', 'validate'] as View[]).map((v) => <button key={v} className={(view === v || (v === 'section' && !['explore', 'validate'].includes(view))) ? 'on' : ''} onClick={() => setView(v)}>{VIEWS.find((x) => x.id === v)!.label}</button>)}</div>
      )}
      <button className="iconbtn" title="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle colour theme">
        {theme === 'dark' ? <Icon d="M12 3a9 9 0 1 0 9 9c-5 1-9-3-9-9z" /> : <Icon d="M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7l1.4-1.4M4.9 19.1l1.4-1.4m0-11.4L4.9 4.9m14.2 14.2l-1.4-1.4M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z" />}
      </button>
    </header>
  );

  const section = result && <div className="vizwrap fill"><CrossSection result={result} store={store} /></div>;
  const model = result && <div className="vizwrap fill"><Engine3D result={result} store={store} /></div>;

  let main: React.ReactNode;
  if (bp === 'desktop') {
    const centre = view === 'explore' ? <div className="pane fill">{result && <Explore inputs={store.state.inputs} />}</div>
      : view === 'validate' ? <div className="pane fill"><Validation /></div>
      : <div className="center">{section}{model}</div>;
    main = (
      <div className="main desktop">
        <aside className="pane controls"><Controls store={store} /></aside>
        <section className="centercol">{errBox}{centre}</section>
        <aside className="pane results">{result && <Results store={store} result={result} />}</aside>
      </div>
    );
  } else if (bp === 'tablet') {
    const v = view === 'build' ? 'section' : view;
    main = (
      <div className="main tablet">
        <aside className="pane controls"><Controls store={store} /></aside>
        <section className="pane fill" style={{ display: 'grid', gridTemplateRows: v === 'section' || v === 'model' ? '1fr' : 'auto' }}>
          {errBox}
          {v === 'section' && section}
          {v === 'model' && model}
          {v === 'results' && result && <Results store={store} result={result} />}
          {v === 'explore' && result && <Explore inputs={store.state.inputs} />}
          {v === 'validate' && <Validation />}
        </section>
      </div>
    );
  } else {
    main = (
      <div className="main phone">
        <section className="pane fill" style={{ display: 'grid', gridTemplateRows: view === 'section' || view === 'model' ? '1fr' : 'auto' }}>
          {errBox}
          {view === 'build' && <Controls store={store} />}
          {view === 'section' && section}
          {view === 'model' && model}
          {view === 'results' && result && <Results store={store} result={result} />}
          {view === 'explore' && result && <Explore inputs={store.state.inputs} />}
          {view === 'validate' && <Validation />}
        </section>
        <nav className="tabbar">{VIEWS.map((v) => <button key={v.id} className={view === v.id ? 'on' : ''} onClick={() => setView(v.id)}><Icon d={v.icon} />{v.label}</button>)}</nav>
      </div>
    );
  }
  return <div className="app">{header}{main}</div>;
}
