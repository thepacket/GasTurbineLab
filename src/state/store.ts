import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Architecture, EngineInputs, EngineResult } from '../engine/types';
import { defaultInputs } from '../engine/defaults';
import { solveEngine } from '../engine/cycle';
import { OffDesignInputs } from '../engine/offdesign';
import { request } from '../engine/client';
import { decodeShare, sanitizeShared } from '../ui/share';
import { loadCustomMaps, saveCustomMaps } from '../engine/custommaps';
loadCustomMaps();

export type View = 'build' | 'section' | 'model' | 'results' | 'explore' | 'compare' | 'transient' | 'mission' | 'optimize' | 'uncertainty' | 'maps' | 'gallery' | 'learn' | 'validate';

export interface AppState {
  inputs: EngineInputs;
  selected: string | null; // component or station id highlighted across views
  view: View;
  note: string | null; // provenance note of the loaded preset
  mode: 'design' | 'offdesign';
  od: OffDesignInputs;
  compare: EngineInputs | null;
  compareLabel: string | null;
  units: 'SI' | 'imperial';
  scenario: string | null;
}

type Action =
  | { type: 'set'; path: string; value: unknown }
  | { type: 'arch'; arch: Architecture }
  | { type: 'inputs'; inputs: EngineInputs; note?: string }
  | { type: 'select'; id: string | null }
  | { type: 'view'; view: View }
  | { type: 'mode'; mode: 'design' | 'offdesign' }
  | { type: 'od'; path: string; value: unknown }
  | { type: 'compare'; inputs: EngineInputs | null; label: string | null }
  | { type: 'load'; state: Partial<AppState> }
  | { type: 'units'; units: 'SI' | 'imperial' }
  | { type: 'scenario'; id: string | null }
  | { type: 'reset' };

const KEY = 'gtl.state.v1';

function setPath(obj: any, path: string, value: unknown): any {
  const [head, ...rest] = path.split('.');
  const copy = Array.isArray(obj) ? [...obj] : { ...obj };
  copy[head] = rest.length ? setPath(obj[head] ?? {}, rest.join('.'), value) : value;
  return copy;
}

function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'set': return { ...s, inputs: setPath(s.inputs, a.path, a.value), note: s.note && !s.note.startsWith('Modified') ? 'Modified from: ' + s.note : s.note };
    case 'arch': return { ...s, inputs: defaultInputs(a.arch), selected: null, note: null };
    case 'inputs': return { ...s, inputs: a.inputs, selected: null, note: a.note ?? null };
    case 'select': return { ...s, selected: a.id };
    case 'view': return { ...s, view: a.view };
    case 'mode': return { ...s, mode: a.mode, od: a.mode === 'offdesign' && s.od.throttle.value === 0 ? odFromDesign(s.inputs) : s.od };
    case 'od': return { ...s, od: setPath(s.od, a.path, a.value) };
    case 'compare': return { ...s, compare: a.inputs, compareLabel: a.label };
    case 'load': return { ...s, ...a.state };
    case 'units': return { ...s, units: a.units };
    case 'scenario': return { ...s, scenario: a.id };
    case 'reset': return { ...s, inputs: defaultInputs(s.inputs.arch), selected: null, note: null };
  }
}

export function odFromDesign(i: EngineInputs): OffDesignInputs {
  return { altitude_m: i.flight.altitude_m, mach: i.flight.mach, dT_isa: i.flight.dT_isa, throttle: { mode: 'T4', value: i.burner.T4_K }, HPX_W: i.HPX_W, propPower_W: i.prop.shaftPower_W };
}

function load(): AppState {
  const fallback: AppState = { inputs: defaultInputs('turbofan'), selected: null, view: 'build', note: null, mode: 'design', od: odFromDesign(defaultInputs('turbofan')), compare: null, compareLabel: null, units: 'SI', scenario: null };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    const safe = sanitizeShared(parsed, defaultInputs);
    if (!safe) return fallback;
    const views: View[] = ['build', 'section', 'model', 'results', 'explore', 'compare', 'transient', 'mission', 'optimize', 'uncertainty', 'maps', 'gallery', 'learn', 'validate'];
    return { ...fallback, inputs: safe.inputs, od: safe.od ?? odFromDesign(safe.inputs), mode: safe.mode ?? 'design', note: safe.note ?? null, compare: safe.compare ?? null, compareLabel: typeof parsed.compareLabel === 'string' ? parsed.compareLabel.slice(0, 200) : null, view: views.includes(parsed.view) ? parsed.view : 'build', units: parsed.units === 'imperial' ? 'imperial' : 'SI' };
  } catch {
    return fallback;
  }
}

export function useEngineStore() {
  const [state, dispatch] = useReducer(reducer, undefined, load);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ inputs: state.inputs, view: state.view, note: state.note, mode: state.mode, od: state.od, compare: state.compare, compareLabel: state.compareLabel, units: state.units })); } catch { /* ignore */ }
  }, [state.inputs, state.view, state.note, state.mode, state.od, state.compare, state.compareLabel, state.units]);

  // a shared link (#d=...) overrides the stored state once
  useEffect(() => {
    if (!location.hash.startsWith('#d=')) return;
    decodeShare(location.hash).then((raw) => {
      const d = sanitizeShared(raw, defaultInputs);
      if (!d) throw new Error('Invalid or unsupported shared design');
      const inputs = d.inputs;
      if (d.maps?.length) { // custom maps carried by the link: register and keep them
        const existing = loadCustomMaps();
        const merged = [...existing.filter((m) => !d.maps!.some((n) => n.id === m.id)), ...d.maps.map((m) => ({ id: m.id, name: m.id.split(':')[1] ?? m.id, kind: m.kind, data: m.data as any }))];
        saveCustomMaps(merged);
      }
      dispatch({ type: 'load', state: { inputs, od: d.od ?? odFromDesign(inputs), mode: d.mode ?? 'design', note: d.note ?? null, compare: d.compare ?? null } });
      history.replaceState(null, '', location.pathname);
    }).catch((e) => { setLoadError(`Could not load shared design: ${e.message}`); });
  }, []);

  const design: EngineResult | { error: string } = useMemo(() => {
    try { return solveEngine(state.inputs); } catch (e: any) { return { error: e?.message ?? String(e) }; }
  }, [state.inputs]);

  // Only expose worker results whose source inputs still match the current operating state.
  const [odResult, setOdResult] = useState<EngineResult | { error: string } | null>(null);
  const [odSource, setOdSource] = useState<{ inputs: EngineInputs; od: OffDesignInputs } | null>(null);
  const reqId = useRef(0);
  useEffect(() => {
    if (state.mode !== 'offdesign' || 'error' in design) return;
    const id = ++reqId.current;
    let active = true;
    const t = setTimeout(() => {
      request<{ result: EngineResult; converged: boolean }>({ type: 'offdesign', inputs: state.inputs, od: state.od })
        .then((r) => { if (active && id === reqId.current) { setOdResult(r.converged ? r.result : { ...r.result, warnings: ['Off-design solver did not converge at this operating point; showing the closest iterate.', ...r.result.warnings] }); setOdSource({ inputs: state.inputs, od: state.od }); } })
        .catch((e) => { if (active && id === reqId.current) { setOdResult({ error: e.message }); setOdSource({ inputs: state.inputs, od: state.od }); } });
    }, 120);
    return () => { active = false; clearTimeout(t); };
  }, [state.inputs, state.od, state.mode, design]);

  const odPending = state.mode === 'offdesign' && !('error' in design) && (!odSource || odSource.inputs !== state.inputs || odSource.od !== state.od);
  const result = 'error' in design ? design : state.mode === 'offdesign' ? (odPending || !odResult ? { error: 'Computing off-design result for the current inputs…' } : odResult) : design;
  const set = useCallback((path: string, value: unknown) => dispatch({ type: 'set', path, value }), []);
  const setOd = useCallback((path: string, value: unknown) => dispatch({ type: 'od', path, value }), []);
  return { state, dispatch, set, setOd, result, design, odBusy: odPending, odPending, loadError };
}
export type Store = ReturnType<typeof useEngineStore>;
