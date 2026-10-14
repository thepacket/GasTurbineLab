/** Main-thread client for the engine worker. */
import type { WorkerRequest, WorkerResponse } from './worker';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; onProgress?: (p: any) => void }>();

function get(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = pending.get(e.data.id); if (!p) return;
      if ('progress' in e.data) { p.onProgress?.(e.data.progress); return; }
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.payload); else p.reject(new Error(e.data.error));
    };
  }
  return worker;
}
type Req = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;
export function request<T>(msg: Req, onProgress?: (p: any) => void): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => { pending.set(id, { resolve, reject, onProgress }); get().postMessage({ ...msg, id } as WorkerRequest); });
}
/** Cancel all outstanding requests by restarting the worker (used when inputs change rapidly). */
export function restart() { if (worker) { worker.terminate(); worker = null; } for (const p of pending.values()) p.reject(new Error('cancelled')); pending.clear(); }
