import { useEffect, useRef, useState } from 'react';
import { isolatedRequest, type RequestMessage } from '../engine/client';

/** One cancellable worker per mounted analysis; never interrupts the live engine. */
export function useAnalysisJob() {
  const current = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { current.current?.abort(); current.current = null; }, []);
  const cancel = () => { current.current?.abort(); current.current = null; setBusy(false); };
  const run = <T,>(message: RequestMessage, progress: ((value: any) => void) | undefined, done: (value: T) => void, error: (message: string) => void) => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller; setBusy(true);
    isolatedRequest<T>(message, controller.signal, value => { if (current.current === controller) progress?.(value); })
      .then(value => { if (current.current === controller) done(value); })
      .catch(e => { if (current.current === controller && !controller.signal.aborted) error(e.message); })
      .finally(() => { if (current.current === controller) { current.current = null; setBusy(false); } });
  };
  return { busy, run, cancel };
}

export function AnalysisProgress({ value, max, cancel }: { value?: number; max?: number; cancel: () => void }) {
  const determinate = value !== undefined && max !== undefined && max > 0;
  return <span className="analysis-progress">
    <progress aria-label="Analysis progress" value={determinate ? Math.max(0, Math.min(value, max)) : undefined} max={max ?? 1} />
    <button className="iconbtn" onClick={cancel} aria-label="Cancel analysis" title="Cancel analysis"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg></button>
  </span>;
}
