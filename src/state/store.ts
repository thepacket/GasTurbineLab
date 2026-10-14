import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { Architecture, EngineInputs, EngineResult } from '../engine/types';
import { defaultInputs } from '../engine/defaults';
import { solveEngine } from '../engine/cycle';

export type View = 'build' | 'section' | 'model' | 'results' | 'explore' | 'validate';

export interface AppState {
  inputs: EngineInputs;
  selected: string | null; // component or station id highlighted across views
  view: View;
}

type Action =
  | { type: 'set'; path: string; value: unknown }
  | { type: 'arch'; arch: Architecture }
  | { type: 'inputs'; inputs: EngineInputs }
  | { type: 'select'; id: string | null }
  | { type: 'view'; view: View }
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
    case 'set': return { ...s, inputs: setPath(s.inputs, a.path, a.value) };
    case 'arch': return { ...s, inputs: defaultInputs(a.arch), selected: null };
    case 'inputs': return { ...s, inputs: a.inputs, selected: null };
    case 'select': return { ...s, selected: a.id };
    case 'view': return { ...s, view: a.view };
    case 'reset': return { ...s, inputs: defaultInputs(s.inputs.arch), selected: null };
  }
}

function load(): AppState {
  const fallback: AppState = { inputs: defaultInputs('turbofan'), selected: null, view: 'build' };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    // merge with defaults so new fields get sane values
    const inputs = { ...defaultInputs(parsed.inputs?.arch ?? 'turbofan'), ...parsed.inputs };
    return { ...fallback, ...parsed, inputs };
  } catch {
    return fallback;
  }
}

export function useEngineStore() {
  const [state, dispatch] = useReducer(reducer, undefined, load);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ inputs: state.inputs, view: state.view })); } catch { /* ignore */ }
  }, [state.inputs, state.view]);

  const result: EngineResult | { error: string } = useMemo(() => {
    try { return solveEngine(state.inputs); } catch (e: any) { return { error: e?.message ?? String(e) }; }
  }, [state.inputs]);

  const set = useCallback((path: string, value: unknown) => dispatch({ type: 'set', path, value }), []);
  return { state, dispatch, set, result };
}
export type Store = ReturnType<typeof useEngineStore>;
