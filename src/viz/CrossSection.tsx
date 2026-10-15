import { useEffect, useMemo, useRef, useState } from 'react';
import { EngineResult } from '../engine/types';
import { Store } from '../state/store';
import { buildGeometry, XR, Part } from './geometry';
import { tempColor, thermalGradient, T_MIN, T_MAX } from './color';
import { fmt, kPa } from '../ui/format';
import { U } from '../ui/units';

type Overlay = 'T' | 'P';

export function CrossSection({ result, store }: { result: EngineResult; store: Store }) {
  const geo = useMemo(() => buildGeometry(result), [result]);
  const [overlay, setOverlay] = useState<Overlay>('T');
  const [hover, setHover] = useState<{ x: number; y: number; title: string; lines: string[] } | null>(null);
  const sel = store.state.selected;
  const u = U(store.state.units);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    const el = wrapRef.current?.parentElement; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 1000)); ro.observe(el); return () => ro.disconnect();
  }, []);
  const k = Math.min(2.4, Math.max(1, 760 / width)); // label scale so callouts stay legible on narrow screens

  // viewBox: x in metres -> px; keep aspect. width 1000 units.
  const W = 1000;
  const padL = 60, padR = 40;
  const scale = (W - padL - padR) / (geo.length * 1.06);
  const rMaxPx = geo.rMax * scale;
  const labelBand = 150 * k; // room for station callouts above and below
  const H = 2 * rMaxPx + 2 * labelBand;
  const cy = H / 2;
  const px = (x: number) => padL + (x + 0.03 * geo.length) * scale;
  const pr = (r: number) => r * scale;

  const pathOf = (hub: XR[], tip: XR[], mirror = 1) => {
    if (tip.length === 0) return '';
    const t = tip.map((p) => `${px(p.x).toFixed(1)},${(cy - mirror * pr(p.r)).toFixed(1)}`);
    const h = (hub.length ? hub : [{ x: tip[tip.length - 1].x, r: 0 }, { x: tip[0].x, r: 0 }]).slice().reverse().map((p) => `${px(p.x).toFixed(1)},${(cy - mirror * pr(p.r)).toFixed(1)}`);
    return `M${t.join('L')}L${h.join('L')}Z`;
  };
  const colorOf = (p: Part) => (overlay === 'T' ? tempColor(p.T) : pressureColor(p.P, geo.parts));
  const pMax = Math.max(...geo.parts.map((p) => p.P));

  const onEnter = (e: React.MouseEvent, title: string, lines: string[]) => {
    const r = (e.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect();
    setHover({ x: e.clientX - r.left, y: e.clientY - r.top, title, lines });
  };
  const pick = (id: string) => store.dispatch({ type: 'select', id: sel === id ? null : id });

  return (
    <>
      <div ref={wrapRef} style={{ display: 'none' }} />
      <svg className="cross" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8f949a" /><stop offset="0.5" stopColor="#5c6166" /><stop offset="1" stopColor="#8f949a" /></linearGradient>
          <linearGradient id="hub" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6a6f75" /><stop offset="0.5" stopColor="#3f4347" /><stop offset="1" stopColor="#6a6f75" /></linearGradient>
        </defs>
        {/* centreline */}
        <line x1={px(-0.05 * geo.length)} x2={px(geo.length * 1.02)} y1={cy} y2={cy} stroke="var(--line)" strokeDasharray="6 6" />

        {/* gas path fills (both halves) */}
        {geo.parts.filter((p) => p.tip.length > 0 && p.kind !== 'gearbox').map((p) => (
          <g key={p.id} className="part" style={{ cursor: 'pointer' }} onClick={() => pick(p.id)} role="button" tabIndex={0} aria-label={`${p.name}: total temperature ${u.temperature(p.T).v} ${u.temperature(p.T).u}, total pressure ${u.pressure(p.P).v} ${u.pressure(p.P).u}`} aria-pressed={sel === p.id}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(p.id); } }}
            onFocus={(e) => { const r = (e.currentTarget as SVGElement).getBoundingClientRect(), o = (e.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect(); setHover({ x: r.left - o.left + r.width / 2, y: r.top - o.top, title: p.name, lines: [`Tt out ${u.temperature(p.T).v} ${u.temperature(p.T).u}`, `Pt out ${u.pressure(p.P).v} ${u.pressure(p.P).u}`] }); }} onBlur={() => setHover(null)}
            onMouseMove={(e) => onEnter(e, p.name, [`Tt out ${u.temperature(p.T).v} ${u.temperature(p.T).u}`, `Pt out ${u.pressure(p.P).v} ${u.pressure(p.P).u}`])}>
            {[1, -1].map((m) => <path key={m} d={pathOf(p.hub, p.tip, m)} fill={colorOf(p)} opacity={p.kind === 'inlet' || p.kind === 'nozzle' || p.kind === 'duct' || p.kind === 'afterburner' ? 0.9 : 0.75} stroke={sel === p.id ? 'var(--text-primary)' : 'none'} strokeWidth={2} />)}
          </g>
        ))}

        {/* casing walls */}
        {geo.parts.filter((p) => p.tip.length > 1).map((p) => [1, -1].map((m) => (
          <polyline key={p.id + m} points={p.tip.map((q) => `${px(q.x)},${cy - m * (pr(q.r) + 1)}`).join(' ')} fill="none" stroke="url(#metal)" strokeWidth={Math.max(4, pr(geo.rMax) * 0.05)} strokeLinejoin="round" />
        )))}
        {geo.nacelle && [1, -1].map((m) => (
          <path key={m} d={`M${geo.nacelle!.outer.map((q) => `${px(q.x)},${cy - m * pr(q.r)}`).join('L')}L${px(geo.nacelle!.outer[geo.nacelle!.outer.length - 1].x)},${cy - m * pr(geo.nacelle!.outer[geo.nacelle!.outer.length - 1].r * 0.97)}`} fill="none" stroke="url(#metal)" strokeWidth={Math.max(5, pr(geo.rMax) * 0.06)} strokeLinecap="round" />
        ))}
        {/* hub / rotor bodies */}
        {geo.parts.filter((p) => p.hub.length > 1 && p.kind !== 'duct').map((p) => [1, -1].map((m) => (
          <path key={p.id + m} d={pathOf([], p.hub, m)} fill="url(#hub)" stroke="#2b2e31" strokeWidth={0.8} />
        )))}
        {geo.parts.filter((p) => p.kind === 'duct').map((p) => [1, -1].map((m) => (
          <polyline key={p.id + m} points={p.hub.map((q) => `${px(q.x)},${cy - m * pr(q.r)}`).join(' ')} fill="none" stroke="url(#metal)" strokeWidth={Math.max(4, pr(geo.rMax) * 0.05)} strokeLinejoin="round" />
        )))}
        {/* shaft */}
        <rect x={px(geo.parts[0].x0)} width={px(geo.length * 0.97) - px(geo.parts[0].x0)} y={cy - pr(geo.shaftR)} height={2 * pr(geo.shaftR)} fill="url(#hub)" />
        {/* gearbox */}
        {geo.parts.filter((p) => p.kind === 'gearbox').map((p) => [1, -1].map((m) => <path key={p.id + m} d={pathOf([], p.tip, m)} fill="#4a4f55" stroke="#2b2e31" />))}
        {/* blade rows */}
        {geo.parts.flatMap((p) => p.rows.map((r, k) => [1, -1].map((m) => (
          <rect key={`${p.id}${k}${m}`} x={px(r.x) - pr(r.chord) / 2} width={Math.max(2, pr(r.chord))} y={m === 1 ? cy - pr(r.rTip) : cy + pr(r.rHub)} height={pr(r.rTip - r.rHub)}
            fill={r.rotor ? '#d8dbe0' : '#9aa0a6'} stroke="#1c1e21" strokeWidth={0.6} rx={1} style={{ pointerEvents: 'none' }} />
        ))))}
        {/* combustor liner detail */}
        {geo.parts.filter((p) => p.kind === 'burner').map((p) => [1, -1].map((m) => {
          const xs = [0.25, 0.45, 0.65].map((f) => p.x0 + f * (p.x1 - p.x0));
          return xs.map((x, k) => <circle key={`${p.id}${m}${k}`} cx={px(x)} cy={cy - m * pr((p.tip[1].r + p.hub[1].r) / 2)} r={Math.max(2, pr(p.tip[1].r - p.hub[1].r) * 0.12)} fill="#ffd27a" opacity={0.85} style={{ pointerEvents: 'none' }} />);
        }))}
        {/* propeller (reduced scale) */}
        {geo.prop && (
          <g>
            <rect x={px(geo.prop.x) - 6} width={12} y={cy - pr(geo.prop.drawn / 2)} height={pr(geo.prop.drawn)} rx={5} fill="#cfd3d8" stroke="#1c1e21" />
            <ellipse cx={px(geo.prop.x) - 4} cy={cy} rx={pr(geo.prop.hubR) * 1.3} ry={pr(geo.prop.hubR) * 0.8} fill="url(#hub)" />
            {geo.prop.drawn < geo.prop.diameter && <text x={px(geo.prop.x) + 40 * k} y={cy - pr(geo.prop.drawn / 2) - 8} textAnchor="start" fontSize={11 * k} fill="var(--text-muted)">propeller Ø {fmt(geo.prop.diameter, 2)} m (not to scale)</text>}
          </g>
        )}

        {/* station callouts, placed greedily to avoid overlaps */}
        {(() => {
          const sorted = geo.marks.map((mk, idx) => ({ mk, idx })).sort((a, b) => a.mk.x - b.mk.x);
          const lastX: Record<string, number> = {};
          const minGap = 74 * k;
          return sorted.map(({ mk, idx }) => {
            const up = mk.stream === 'bypass' ? true : idx % 2 === 0;
            const x = px(mk.x);
            const side = up ? 'u' : 'd';
            let row = 0;
            while (row < 3 && lastX[side + row] !== undefined && x - lastX[side + row] < minGap) row++;
            if (row === 3) row = 2;
            lastX[side + row] = x;
            const yEdge = up ? cy - pr(mk.rOut) : cy + pr(mk.rOut);
            const yLab = up ? (14 + row * 44) * k : H - (46 + row * 44) * k;
            const s = mk.station;
            const id = 'st' + mk.id;
            const active = sel === id;
            return (
              <g key={mk.id} style={{ cursor: 'pointer' }} onClick={() => pick(id)} role="button" tabIndex={0} aria-pressed={active} aria-label={`Station ${s.id} ${s.name}: Pt ${u.pressure(s.Pt).v} ${u.pressure(s.Pt).u}, Tt ${u.temperature(s.Tt).v} ${u.temperature(s.Tt).u}, flow ${u.massflow(s.W).v} ${u.massflow(s.W).u}`} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(id); } }} onMouseMove={(e) => onEnter(e, `Station ${s.id} · ${s.name}`, [`Pt ${u.pressure(s.Pt).v} ${u.pressure(s.Pt).u}   Tt ${u.temperature(s.Tt).v} ${u.temperature(s.Tt).u}`, `W ${u.massflow(s.W).v} ${u.massflow(s.W).u}   M ${fmt(s.MN, 2)}`, `Ps ${u.pressure(s.Ps).v} ${u.pressure(s.Ps).u}   V ${u.velocity(s.V).v} ${u.velocity(s.V).u}`])}>
                <line x1={x} x2={x} y1={cy - pr(mk.rOut)} y2={cy + pr(mk.rOut)} stroke={active ? 'var(--text-primary)' : 'var(--text-muted)'} strokeWidth={active ? 1.5 : 0.8} strokeDasharray="3 3" />
                <line x1={x} x2={x} y1={yEdge} y2={up ? yLab + 30 * k : yLab - 2} stroke={active ? 'var(--text-primary)' : 'var(--line-strong)'} strokeWidth={0.8} />
                <g transform={`translate(${x},${yLab}) scale(${k})`}>
                  <rect x={-34} y={-2} width={68} height={32} rx={5} fill={active ? 'var(--surface-3)' : 'var(--surface-1)'} stroke={active ? 'var(--accent)' : 'var(--line)'} />
                  <text textAnchor="middle" y={11} fontSize={11} fontWeight={700} fill="var(--text-primary)">{s.id}</text>
                  <text textAnchor="middle" y={24} fontSize={9.5} fill="var(--text-secondary)" className="num">{overlay === 'T' ? `${u.temperature(s.Tt).v} ${u.temperature(s.Tt).u}` : `${u.pressure(s.Pt).v} ${u.pressure(s.Pt).u}`}</text>
                </g>
              </g>
            );
          });
        })()}
      </svg>
      <div className="overlay-tl">
        <span className="chip">Colour: <button className={overlay === 'T' ? 'on' : ''} onClick={() => setOverlay('T')}>Tt</button> · <button className={overlay === 'P' ? 'on' : ''} onClick={() => setOverlay('P')}>Pt</button></span>
        <span className="chip">{result.inputs.arch}{result.offDesign ? ' · off-design' : ''} · length ≈ {u.length(geo.length).v} {u.length(geo.length).u} · max Ø {u.length(2 * geo.rMax).v} {u.length(2 * geo.rMax).u}</span>
      </div>
      <div className="legend">
        {overlay === 'T' ? <><span>{T_MIN} K</span><div className="ramp" style={{ background: thermalGradient }} /><span>{T_MAX} K</span></> : <><span>{kPa(result.stations[0].Ps)} kPa</span><div className="ramp" style={{ background: 'linear-gradient(90deg, var(--seq-100), var(--seq-400), var(--seq-700))' }} /><span>{kPa(pMax)} kPa</span></>}
      </div>
      {hover && (
        <div className="tooltip" style={{ left: Math.min(hover.x + 12, (document.body.clientWidth || 800) - 220), top: hover.y + 12 }}>
          <b>{hover.title}</b>{hover.lines.map((l, i) => <div key={i} className="num">{l}</div>)}
        </div>
      )}
    </>
  );
}

function pressureColor(P: number, parts: Part[]): string {
  const lo = Math.log(Math.min(...parts.map((p) => p.P)) * 0.95), hi = Math.log(Math.max(...parts.map((p) => p.P)));
  const t = Math.min(1, Math.max(0, (Math.log(P) - lo) / (hi - lo)));
  // sequential blue ramp (light -> dark)
  const stops = ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'];
  const i = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
  const f = t * (stops.length - 1) - i;
  const h = (c: string) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
  const a = h(stops[i]), b = h(stops[i + 1]);
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`;
}
