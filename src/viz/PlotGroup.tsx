import { createContext, useContext, useState, type ReactNode, type CSSProperties } from 'react';
type Selection = { axis: string; x: number } | null;
type Window = { axis: string; lo: number; hi: number } | null;
interface PlotState { cursor: Selection; window: Window; setCursor: (value: Selection) => void; setWindow: (value: Window) => void }
const Context = createContext<PlotState | null>(null);
export const usePlotGroup = () => useContext(Context);
/** Only charts with the same x-axis share inspection and zoom. */
export function PlotGroup({ children, resetKey, style }: { children: ReactNode; resetKey: unknown; style?: CSSProperties }) {
  const [state, setState] = useState<{ key: unknown; cursor: Selection; window: Window }>({ key: resetKey, cursor: null, window: null });
  const current = state.key === resetKey ? state : { key: resetKey, cursor: null, window: null };
  return <Context.Provider value={{ ...current,
    setCursor: cursor => setState(s => ({ ...(s.key === resetKey ? s : current), cursor })),
    setWindow: window => setState(s => ({ ...(s.key === resetKey ? s : current), window })) }}>
    <div className="charts" style={style}>{children}</div>
  </Context.Provider>;
}
