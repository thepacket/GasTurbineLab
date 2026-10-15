/** Main-thread client for the engine worker. */
import type { WorkerRequest, WorkerResponse } from './worker';
import { loadCustomMaps } from './custommaps';

let worker: Worker | null = null;
let registeredMaps = '';
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; onProgress?: (p: any) => void }>();

function failed(w: Worker, error: Error) {
  if (worker !== w) return;
  w.terminate(); worker = null;
  for (const p of pending.values()) p.reject(error);
  pending.clear();
}

function get(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const current = worker;
    current.onerror = (event) => failed(current, new Error(event.message || 'Engine worker failed. Please retry.'));
    current.onmessageerror = () => failed(current, new Error('Engine worker response could not be decoded. Please retry.'));
    // a fresh worker has no custom maps: register the saved ones before any request runs (messages are ordered)
    const maps = loadCustomMaps();
    const data = maps.map((m) => ({ id: m.id, kind: m.kind, data: m.data }));
    registeredMaps = JSON.stringify(data);
    if (maps.length) worker.postMessage({ id: 0, type: 'maps', maps: data } as WorkerRequest);
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = pending.get(e.data.id); if (!p) return;
      if ('progress' in e.data) { p.onProgress?.(e.data.progress); return; }
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.payload); else p.reject(new Error(e.data.error));
    };
  } else {
    // A shared link or Gallery load can change maps after this worker was created.
    // Synchronise before the analysis request, including removals and same-id edits.
    const maps = loadCustomMaps().map(m => ({ id: m.id, kind: m.kind, data: m.data }));
    const key = JSON.stringify(maps);
    if (key !== registeredMaps) { worker.postMessage({ id: 0, type: 'maps', maps } as WorkerRequest); registeredMaps = key; }
  }
  return worker;
}
type Req = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;
export function request<T>(msg: Req, onProgress?: (p: any) => void): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    try { get().postMessage({ ...msg, id } as WorkerRequest); }
    catch (error) { pending.delete(id); reject(error instanceof Error ? error : new Error(String(error))); }
  });
}
/** Cancel all outstanding requests by restarting the worker (used when inputs change rapidly). */
export function restart() { if (worker) { worker.terminate(); worker = null; } for (const p of pending.values()) p.reject(new Error('cancelled')); pending.clear(); }

export type RequestMessage = Req;
/** Isolated analyses can be stopped even while a synchronous solver occupies their worker. */
export function isolatedRequest<T>(msg: Req, signal: AbortSignal, onProgress?: (p: any) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const cleanup = () => { settled = true; signal.removeEventListener('abort', abort); w.terminate(); };
    const fail = (error: Error) => { if (settled) return; cleanup(); reject(error); };
    const abort = () => fail(new DOMException('Cancelled', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    w.onerror = event => fail(new Error(event.message || 'Engine worker failed. Please retry.'));
    w.onmessageerror = () => fail(new Error('Engine worker response could not be decoded. Please retry.'));
    w.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (settled || event.data.id !== 1) return;
      if ('progress' in event.data) { onProgress?.(event.data.progress); return; }
      cleanup();
      if (event.data.ok) resolve(event.data.payload as T); else reject(new Error(event.data.error));
    };
    try {
      const maps = loadCustomMaps().map(({ id, kind, data }) => ({ id, kind, data }));
      if (maps.length) w.postMessage({ id: 0, type: 'maps', maps } satisfies WorkerRequest);
      w.postMessage({ ...msg, id: 1 } as WorkerRequest);
    } catch (e) { fail(e instanceof Error ? e : new Error(String(e))); }
  });
}
