/// <reference lib="webworker" />
import { EngineInputs } from './types';
import { makeDesignPoint, solveOffDesign, OffDesignInputs, DesignPoint } from './offdesign';
import { solveEngine } from './cycle';

export type WorkerRequest =
  | { id: number; type: 'offdesign'; inputs: EngineInputs; od: OffDesignInputs }
  | { id: number; type: 'sweep'; inputs: EngineInputs; mode: 'design' | 'offdesign'; od?: OffDesignInputs; param: string; values: number[]; families?: { param: string; values: number[] } };
export type WorkerResponse = { id: number; ok: true; payload: unknown } | { id: number; ok: false; error: string };

let cache: { key: string; dp: DesignPoint } | null = null;
function designPoint(inputs: EngineInputs): DesignPoint {
  const key = JSON.stringify(inputs);
  if (cache && cache.key === key) return cache.dp;
  const dp = makeDesignPoint(inputs);
  cache = { key, dp };
  return dp;
}
function setPath(obj: any, path: string, value: unknown): any {
  const [h, ...rest] = path.split('.'); const c = { ...obj };
  c[h] = rest.length ? setPath(obj[h] ?? {}, rest.join('.'), value) : value; return c;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'offdesign') {
      const dp = designPoint(msg.inputs);
      const s = solveOffDesign(dp, msg.od);
      post({ id: msg.id, ok: true, payload: { result: s.result, converged: s.converged, iterations: s.iterations, x: s.x } });
    } else if (msg.type === 'sweep') {
      const fam = msg.families ? msg.families.values : [null];
      const out: { level: number | null; pts: any[] }[] = [];
      for (const lv of fam) {
        const pts: any[] = [];
        let warm: Record<string, number> | undefined;
        for (const v of msg.values) {
          try {
            if (msg.mode === 'design') {
              let inp = setPath(msg.inputs, msg.param, v);
              if (msg.families && lv !== null) inp = setPath(inp, msg.families.param, lv);
              pts.push({ x: v, r: slim(solveEngine(inp)) });
            } else {
              const dp = designPoint(msg.inputs);
              let od: any = { ...msg.od! };
              od = setPath(od, msg.param, v);
              if (msg.families && lv !== null) od = setPath(od, msg.families.param, lv);
              const s = solveOffDesign(dp, od, warm);
              if (s.converged) warm = s.x;
              pts.push({ x: v, r: s.converged ? slim(s.result) : null });
            }
          } catch { pts.push({ x: v, r: null }); }
        }
        out.push({ level: lv, pts });
      }
      post({ id: msg.id, ok: true, payload: out });
    }
  } catch (err: any) {
    post({ id: msg.id, ok: false, error: err?.message ?? String(err) });
  }
};
function post(r: WorkerResponse) { (self as unknown as Worker).postMessage(r); }
/** Only what the explorer plots, to keep messages small. */
function slim(r: ReturnType<typeof solveEngine>) {
  const bad = r.warnings.some((w) => w.includes('cannot'));
  const sh = Object.fromEntries(r.shafts.map((s) => [s.name, s.rpm]));
  const comps = Object.fromEntries(r.components.filter((c) => c.kind === 'compressor').map((c) => [c.id, { Nc_pct: c.values.Nc_pct, SM: c.values.surgeMargin_pct, PR: c.values.PR }]));
  return { Fn: r.perf.Fn, TSFC: r.perf.TSFC_mg_Ns, spec: r.perf.specificThrust, eth: r.perf.thermalEff * 100, eo: r.perf.overallEff * 100, ep: r.perf.propulsiveEff * 100, Wf: r.perf.Wfuel, OPR: r.perf.OPR, shp: r.perf.shaftPower_W, psfc: r.perf.PSFC_kg_kWh, T4: r.stations.find((s) => s.id === '4')?.Tt, T5: r.stations.find((s) => s.id === '5')?.Tt, W: r.stations[0].W, BPR: r.components.find((c) => c.id === 'splitter')?.values.BPR, shafts: sh, comps, bad };
}
