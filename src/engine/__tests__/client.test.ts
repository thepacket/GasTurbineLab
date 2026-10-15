import { afterEach, expect, it, vi } from 'vitest';
import { request, restart, isolatedRequest } from '../client';
import { defaultInputs } from '../defaults';
import { generateCompressorMap } from '../custommaps';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onerror?: (event: { message: string }) => void;
  onmessageerror?: () => void;
  onmessage?: (event: { data: unknown }) => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
}
afterEach(() => { restart(); vi.unstubAllGlobals(); FakeWorker.instances = []; });
it('rejects outstanding requests on a worker crash and creates a fresh worker for retry', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const inputs = defaultInputs('turbojet');
  const message = { type: 'lto' as const, inputs };
  const a = request(message), b = request(message);
  const assertions = [expect(a).rejects.toThrow('crashed'), expect(b).rejects.toThrow('crashed')];
  FakeWorker.instances[0].onerror!({ message: 'crashed' });
  await Promise.all(assertions);
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();
  const retry = request(message);
  expect(FakeWorker.instances.length).toBe(2);
  const w = FakeWorker.instances[1];
  const id = w.postMessage.mock.calls[0][0].id;
  w.onmessage!({ data: { id, ok: true, payload: 'recovered' } });
  await expect(retry).resolves.toBe('recovered');
});
it('synchronises maps imported after worker creation before the next solve', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  let stored = '[]';
  vi.stubGlobal('localStorage', { getItem: () => stored });
  const message = { type: 'lto' as const, inputs: defaultInputs('turbojet') };
  const first = request(message);
  const w = FakeWorker.instances[0];
  w.onmessage!({ data: { id: w.postMessage.mock.calls[0][0].id, ok: true, payload: 1 } });
  await first;
  stored = JSON.stringify([{ id: 'custom:late', name: 'Late', kind: 'compressor', data: generateCompressorMap({ PRdes: 10, WcDes: 50 }) }]);
  const second = request(message);
  expect(w.postMessage.mock.calls[1][0].type).toBe('maps');
  expect(w.postMessage.mock.calls[1][0].maps[0].id).toBe('custom:late');
  expect(w.postMessage.mock.calls[2][0].type).toBe('lto');
  w.onmessage!({ data: { id: w.postMessage.mock.calls[2][0].id, ok: true, payload: 2 } });
  await expect(second).resolves.toBe(2);
});

it('cancels an isolated analysis without stopping the shared worker and ignores late progress', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const message = { type: 'lto' as const, inputs: defaultInputs('turbojet') };
  const live = request(message);
  const shared = FakeWorker.instances[0];
  const controller = new AbortController();
  const progress = vi.fn();
  const analysis = isolatedRequest(message, controller.signal, progress);
  const isolated = FakeWorker.instances[1];
  const rejected = expect(analysis).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await rejected;
  expect(isolated.terminate).toHaveBeenCalledOnce();
  expect(shared.terminate).not.toHaveBeenCalled();
  isolated.onmessage!({ data: { id: 1, progress: 25 } });
  expect(progress).not.toHaveBeenCalled();
  shared.onmessage!({ data: { id: shared.postMessage.mock.calls[0][0].id, ok: true, payload: 'live' } });
  await expect(live).resolves.toBe('live');
});

it('registers saved maps before an isolated analysis and terminates on completion', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('localStorage', { getItem: () => JSON.stringify([{ id: 'custom:isolated', name: 'Isolated', kind: 'compressor', data: generateCompressorMap({ PRdes: 10, WcDes: 50 }) }]) });
  const controller = new AbortController();
  const analysis = isolatedRequest({ type: 'lto', inputs: defaultInputs('turbojet') }, controller.signal);
  const w = FakeWorker.instances[0];
  expect(w.postMessage.mock.calls.map(([m]) => m.type)).toEqual(['maps', 'lto']);
  expect(w.postMessage.mock.calls[0][0].maps[0].id).toBe('custom:isolated');
  w.onmessage!({ data: { id: 1, ok: true, payload: 'complete' } });
  await expect(analysis).resolves.toBe('complete');
  controller.abort();
  expect(w.terminate).toHaveBeenCalledOnce();
});
