import { useMemo, useState } from 'react';
/**
 * Tracks whether an analysis result still matches the inputs it was computed from.
 * `snapshot()` records the current key when a run starts; `stale` is true once the key changes.
 */
export function useStale(key: unknown) {
  const current = useMemo(() => JSON.stringify(key), [key]);
  const [taken, setTaken] = useState<string | null>(null);
  return { stale: taken !== null && taken !== current, snapshot: () => setTaken(current), has: taken !== null };
}
export function StaleBanner({ what }: { what: string }) {
  return <div className="warn"><span>⚠</span><span>The design or operating point has changed since this {what} was computed. The results below belong to the previous inputs; run it again to refresh.</span></div>;
}
