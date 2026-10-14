import { lazy, Suspense, useEffect, useState } from 'react';
import { useEngineStore, View } from './state/store';
import { useBreakpoint } from './ui/useBreakpoint';
import { Controls } from './ui/Controls';
import { Results } from './ui/Results';
import { CrossSection } from './viz/CrossSection';
const Engine3D = lazy(() => import('./three/Engine3D').then((m) => ({ default: m.Engine3D })));
const Explore = lazy(() => import('./viz/Explore').then((m) => ({ default: m.Explore })));
const Validation = lazy(() => import('./ui/Validation').then((m) => ({ default: m.Validation })));
const Compare = lazy(() => import('./ui/Compare').then((m) => ({ default: m.Compare })));
const TransientView = lazy(() => import('./ui/TransientView').then((m) => ({ default: m.TransientView })));
const MissionView = lazy(() => import('./ui/MissionView').then((m) => ({ default: m.MissionView })));
const MapsPanel = lazy(() => import('./ui/MapsPanel').then((m) => ({ default: m.MapsPanel })));
const Learn = lazy(() => import('./ui/Learn').then((m) => ({ default: m.Learn })));
const OptimizeView = lazy(() => import('./ui/OptimizeView').then((m) => ({ default: m.OptimizeView })));
const UncertaintyView = lazy(() => import('./ui/UncertaintyView').then((m) => ({ default: m.UncertaintyView })));
const Gallery = lazy(() => import('./ui/Gallery').then((m) => ({ default: m.Gallery })));
import { shareUrl } from './ui/share';
import { t, getLang, setLang, initLang, onLangChange } from './ui/i18n';
import { openReport } from './ui/Report';
import { svgToPng } from './ui/exportImage';
initLang();
import { EngineResult } from './engine/types';

const VIEWS: { id: View; label: string; icon: string }[] = [
  { id: 'build', label: 'Build', icon: 'M4 6h16M4 12h10M4 18h7' },
  { id: 'section', label: 'Section', icon: 'M3 12h18M6 8c3-3 9-3 12 0M6 16c3 3 9 3 12 0' },
  { id: 'model', label: '3D', icon: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zm0 0v18M4 7.5l8 4.5 8-4.5' },
  { id: 'results', label: 'Results', icon: 'M4 20V10m6 10V4m6 16v-7m4 7H2' },
  { id: 'explore', label: 'Explore', icon: 'M3 17l6-6 4 4 8-8M14 7h7v7' },
  { id: 'compare', label: 'Compare', icon: 'M4 5h7v14H4zM13 5h7v14h-7z' },
  { id: 'transient', label: 'Transient', icon: 'M3 18c3 0 3-12 6-12s3 12 6 12 3-12 6-12' },
  { id: 'mission', label: 'Mission', icon: 'M3 20l4-8 4 4 4-10 6 6' },
  { id: 'optimize', label: 'Optimise', icon: 'M4 18l5-8 4 5 7-11M15 4h5v5' },
  { id: 'uncertainty', label: 'Uncertainty', icon: 'M4 18c2 0 2-6 4-6s2 6 4 6 2-10 4-10 2 10 4 10' },
  { id: 'gallery', label: 'Gallery', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { id: 'maps', label: 'Maps', icon: 'M4 18c4-2 6-8 8-8s4 6 8 4M4 12c4-2 6-6 8-6s4 4 8 2' },
  { id: 'learn', label: 'Learn', icon: 'M4 6h16v12H4zM8 10h8M8 14h5' },
  { id: 'validate', label: 'Validate', icon: 'M9 12l2 2 4-4m-3-7l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3z' },
];
const PHONE_TABS: View[] = ['build', 'section', 'model', 'results', 'explore', 'learn'];
const MORE_TABS: View[] = ['compare', 'transient', 'mission', 'optimize', 'uncertainty', 'maps', 'gallery', 'validate'];
const TOOL_VIEWS: View[] = ['transient', 'mission', 'optimize', 'uncertainty', 'maps', 'gallery'];

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
  const [copied, setCopied] = useState(false);
  const [more, setMore] = useState(false);
  const [, setLangTick] = useState(0);
  useEffect(() => onLangChange(() => setLangTick((x) => x + 1)), []);
  const exportSection = () => { const svg = document.querySelector('svg.cross') as SVGSVGElement | null; if (svg) svgToPng(svg, 'gas-turbine-lab-section.png').catch(() => {}); };
  const share = async () => {
    const url = await shareUrl({ inputs: store.state.inputs, od: store.state.od, mode: store.state.mode, note: store.state.note, compare: store.state.compare });
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { prompt('Copy this link', url); }
  };

  const header = (
    <header className="header">
      <div className="brand">
        <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="13" stroke="var(--accent)" strokeWidth="2" /><path d="M16 5c3 4 3 8 0 11s-3 7 0 11M5 16c4-3 8-3 11 0s7 3 11 0" stroke="var(--series-2)" strokeWidth="2" strokeLinecap="round" /><circle cx="16" cy="16" r="2.5" fill="var(--text-primary)" /></svg>
        <span>Gas Turbine Lab</span>{bp === 'desktop' && <small>{t('cycle, off-design, transient and mission analysis')}</small>}
      </div>
      <div className="spacer" />
      {bp === 'tablet' && (
        <select className="select" style={{ width: 'auto' }} value={view === 'build' ? 'section' : view} onChange={(e) => setView(e.target.value as View)} aria-label="View">{VIEWS.filter((v) => v.id !== 'build').map((v) => <option key={v.id} value={v.id}>{t(v.label)}</option>)}</select>
      )}
      {bp === 'desktop' && (
        <>
        <div className="segmented">{(['section', 'explore', 'compare', 'learn', 'validate'] as View[]).map((v) => <button key={v} className={(view === v || (v === 'section' && ['build', 'model', 'results', 'section'].includes(view))) ? 'on' : ''} onClick={() => setView(v)}>{t(VIEWS.find((x) => x.id === v)!.label)}</button>)}</div>
        <select className="select" style={{ width: 'auto', borderColor: TOOL_VIEWS.includes(view) ? 'var(--accent)' : undefined }} value={TOOL_VIEWS.includes(view) ? view : ''} onChange={(e) => e.target.value && setView(e.target.value as View)} aria-label="Analysis tools">
          <option value="">{t('Tools')}…</option>
          {VIEWS.filter((v) => TOOL_VIEWS.includes(v.id)).map((v) => <option key={v.id} value={v.id}>{t(v.label)}</option>)}
        </select>
        </>
      )}
      <button className="iconbtn" style={{ width: 'auto', padding: '0 8px', fontSize: 12, fontWeight: 600 }} title={t('Language')} aria-label={t('Language')} onClick={() => setLang(getLang() === 'en' ? 'fr' : 'en')}>{getLang().toUpperCase()}</button>
      {result && <button className="iconbtn" title={t('Open a printable engineering report')} aria-label={t('Report')} onClick={() => openReport(result, store)}><Icon d="M6 3h9l5 5v13H6zM14 3v6h6M9 13h6M9 17h6" /></button>}
      {bp !== 'phone' && <button className="iconbtn" title={t('Export section as PNG')} aria-label={t('Export section as PNG')} onClick={exportSection}><Icon d="M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M15 9h.01" /></button>}
      <button className="iconbtn" style={{ width: 'auto', padding: '0 8px', fontSize: 12, fontWeight: 600 }} title="Toggle display units" aria-pressed={store.state.units === 'imperial'} onClick={() => store.dispatch({ type: 'units', units: store.state.units === 'SI' ? 'imperial' : 'SI' })}>{store.state.units === 'SI' ? 'SI' : 'US'}</button>
      <button className="iconbtn" title={copied ? 'Link copied' : 'Copy a link to this design'} onClick={share} aria-label="Copy share link">{copied ? <Icon d="M5 12l5 5L20 7" /> : <Icon d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />}</button>
      <button className="iconbtn" title="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle colour theme">
        {theme === 'dark' ? <Icon d="M12 3a9 9 0 1 0 9 9c-5 1-9-3-9-9z" /> : <Icon d="M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7l1.4-1.4M4.9 19.1l1.4-1.4m0-11.4L4.9 4.9m14.2 14.2l-1.4-1.4M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z" />}
      </button>
    </header>
  );

  const section = result && <div className="vizwrap fill"><CrossSection result={result} store={store} /></div>;
  const model = result && <div className="vizwrap fill"><Engine3D result={result} store={store} /></div>;

  let main: React.ReactNode;
  if (bp === 'desktop') {
    const centre = view === 'explore' ? <div className="pane fill">{result && <Explore inputs={store.state.inputs} od={store.state.od} initialMode={store.state.mode} />}</div>
      : view === 'compare' ? <div className="pane fill">{result && <Compare store={store} a={ok && !('error' in store.design) ? store.design : result} />}</div>
      : view === 'transient' ? <div className="pane fill"><TransientView store={store} /></div>
      : view === 'mission' ? <div className="pane fill"><MissionView store={store} /></div>
      : view === 'maps' ? <div className="pane fill"><MapsPanel store={store} /></div>
      : view === 'learn' ? <div className="pane fill"><Learn store={store} /></div>
      : view === 'optimize' ? <div className="pane fill"><OptimizeView store={store} /></div>
      : view === 'uncertainty' ? <div className="pane fill"><UncertaintyView store={store} /></div>
      : view === 'gallery' ? <div className="pane fill"><Gallery store={store} /></div>
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
          {v === 'explore' && result && <Explore inputs={store.state.inputs} od={store.state.od} initialMode={store.state.mode} />}
          {v === 'compare' && !('error' in store.design) && <Compare store={store} a={store.design} />}
          {v === 'transient' && <TransientView store={store} />}
          {v === 'mission' && <MissionView store={store} />}
          {v === 'maps' && <MapsPanel store={store} />}
          {v === 'learn' && <Learn store={store} />}
          {v === 'optimize' && <OptimizeView store={store} />}
          {v === 'uncertainty' && <UncertaintyView store={store} />}
          {v === 'gallery' && <Gallery store={store} />}
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
          {view === 'explore' && result && <Explore inputs={store.state.inputs} od={store.state.od} initialMode={store.state.mode} />}
          {view === 'compare' && !('error' in store.design) && <Compare store={store} a={store.design} />}
          {view === 'transient' && <TransientView store={store} />}
          {view === 'mission' && <MissionView store={store} />}
          {view === 'maps' && <MapsPanel store={store} />}
          {view === 'learn' && <Learn store={store} />}
          {view === 'optimize' && <OptimizeView store={store} />}
          {view === 'uncertainty' && <UncertaintyView store={store} />}
          {view === 'gallery' && <Gallery store={store} />}
          {view === 'validate' && <Validation />}
        </section>
        <nav className="tabbar" aria-label="Views">
          {VIEWS.filter((v) => PHONE_TABS.includes(v.id)).map((v) => <button key={v.id} className={view === v.id ? 'on' : ''} aria-current={view === v.id ? 'page' : undefined} onClick={() => setView(v.id)}><Icon d={v.icon} />{t(v.label)}</button>)}
          <button className={MORE_TABS.includes(view) ? 'on' : ''} onClick={() => setMore(!more)} aria-expanded={more}><Icon d="M5 12h.01M12 12h.01M19 12h.01" />{t('More')}</button>
          {more && <div className="moremenu">{VIEWS.filter((v) => MORE_TABS.includes(v.id)).map((v) => <button key={v.id} onClick={() => { setView(v.id); setMore(false); }}><Icon d={v.icon} />{t(v.label)}</button>)}</div>}
        </nav>
      </div>
    );
  }
  return <div className="app">{header}<Suspense fallback={<div className="main" style={{ display: 'grid', placeItems: 'center', color: 'var(--text-muted)' }}>Loading…</div>}>{main}</Suspense></div>;
}
