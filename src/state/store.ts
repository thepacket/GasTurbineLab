import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Architecture, EngineInputs, EngineResult } from '../engine/types';
import { defaultInputs } from '../engine/defaults';
import { solveEngine } from '../engine/cycle';
import { OffDesignInputs } from '../engine/offdesign';
import { request } from '../engine/client';
import { decodeShare } from '../ui/share';
import { loadCustomMaps } from '../engine/custommaps';
loadCustomMaps();

export type View = 'build' | 'section' | 'model' | 'results' | 'explore' | 'compare' | 'transient' | 'mission' | 'maps' | 'learn' | 'validate';

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
    // merge with defaults so new fields get sane values
    const d = defaultInputs(parsed.inputs?.arch ?? 'turbofan');
    const inputs = { ...d, ...parsed.inputs };
    for (const k of ['ipc', 'ipt', 'mixer', 'fanGear', 'speeds', 'prop', 'afterburner', 'geometry', 'installation', 'inertia'] as const) (inputs as any)[k] = { ...(d as any)[k], ...(parsed.inputs?.[k] ?? {}) };
    const od = { ...fallback.od, ...(parsed.od ?? {}) };
    return { ...fallback, ...parsed, inputs, od };
  } catch {
    return fallback;
  }
}

export function useEngineStore() {
  const [state, dispatch] = useReducer(reducer, undefined, load);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ inputs: state.inputs, view: state.view, note: state.note, mode: state.mode, od: state.od, compare: state.compare, compareLabel: state.compareLabel, units: state.units })); } catch { /* ignore */ }
  }, [state.inputs, state.view, state.note, state.mode, state.od, state.compare, state.compareLabel, state.units]);

  // a shared link (#d=...) overrides the stored state once
  useEffect(() => {
    if (!location.hash.startsWith('#d=')) return;
    decodeShare(location.hash).then((d) => {
      if (!d) return;
      const inputs = { ...defaultInputs(d.inputs.arch), ...d.inputs };
      dispatch({ type: 'load', state: { inputs, od: d.od ?? odFromDesign(inputs), mode: d.mode ?? 'design', note: d.note ?? null, compare: d.compare ?? null } });
      history.replaceState(null, '', location.pathname);
    });
  }, []);

  const design: EngineResult | { error: string } = useMemo(() => {
    try { return solveEngine(state.inputs); } catch (e: any) { return { error: e?.message ?? String(e) }; }
  }, [state.inputs]);

  // off-design solution comes from the worker; keep the last good one while a new one is computed
  const [odResult, setOdResult] = useState<EngineResult | { error: string } | null>(null);
  const [odBusy, setOdBusy] = useState(false);
  const reqId = useRef(0);
  useEffect(() => {
    if (state.mode !== 'offdesign' || 'error' in design) return;
    const id = ++reqId.current;
    setOdBusy(true);
    const t = setTimeout(() => {
      request<{ result: EngineResult; converged: boolean }>({ type: 'offdesign', inputs: state.inputs, od: state.od })
        .then((r) => { if (id === reqId.current) { setOdResult(r.converged ? r.result : { ...r.result, warnings: ['Off-design solver did not converge at this operating point; showing the closest iterate.', ...r.result.warnings] }); setOdBusy(false); } })
        .catch((e) => { if (id === reqId.current) { setOdResult({ error: e.message }); setOdBusy(false); } });
    }, 120);
    return () => clearTimeout(t);
  }, [state.inputs, state.od, state.mode, design]);

  const result = state.mode === 'offdesign' && odResult ? odResult : design;
  const set = useCallback((path: string, value: unknown) => dispatch({ type: 'set', path, value }), []);
  const setOd = useCallback((path: string, value: unknown) => dispatch({ type: 'od', path, value }), []);
  return { state, dispatch, set, setOd, result, design, odBusy };
}
export type Store = ReturnType<typeof useEngineStore>;
