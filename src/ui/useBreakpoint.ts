import { useEffect, useState } from 'react';
export type Breakpoint = 'phone' | 'tablet' | 'desktop';
const bp = (w: number): Breakpoint => (w < 760 ? 'phone' : w < 1180 ? 'tablet' : 'desktop');
export function useBreakpoint(): Breakpoint {
  const [b, setB] = useState<Breakpoint>(() => bp(window.innerWidth));
  useEffect(() => {
    const on = () => setB(bp(window.innerWidth));
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return b;
}
