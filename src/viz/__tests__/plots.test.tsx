import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LineChart } from '../charts';
import { axisLabels, extent, linePath, niceAxis, pointAtX } from '../plotData';
import { MapCharts, MapTrajectory } from '../MapChart';
import { Histogram } from '../../ui/UncertaintyView';
import { defaultInputs } from '../../engine/defaults';
import { solveEngine } from '../../engine/cycle';
import { registerCustomMap } from '../../engine/maps';
import { generateCompressorMap } from '../../engine/custommaps';
import { Compare } from '../../ui/Compare';
import { Diagrams } from '../Diagrams';

const chart = (points: { x: number; y: number }[]) => renderToStaticMarkup(<LineChart title="test" series={[{ name: 'a', color: 'red', points }]} xLabel="x" yLabel="y" />);
describe('plot boundaries and correspondence', () => {
  it('renders an explicit empty state for empty and invalid data', () => {
    for (const points of [[], [{ x: 0, y: NaN }], [{ x: Infinity, y: 2 }]]) {
      const html = chart(points);
      expect(html).toContain('No valid data');
      expect(html).not.toMatch(/NaN|Infinity|<svg/);
    }
  });
  it('bounds tick counts for microscopic ranges, and expands constant data', () => {
    for (const pair of [[0, 1e-12], [1, 1 + 1e-10], [0, 0], [-5, -5], [NaN, Infinity]]) {
      const axis = niceAxis(pair[0], pair[1]);
      expect(axis.hi).toBeGreaterThan(axis.lo);
      expect(axis.ticks.length).toBeLessThan(20);
      expect(axis.ticks.every(Number.isFinite)).toBe(true);
      const labels = axisLabels(axis.ticks, v => v.toFixed(0));
      expect(new Set(labels).size).toBe(labels.length);
    }
    expect(chart([{ x: 2, y: 3 }])).toContain('<circle');
    expect(extent(Array.from({ length: 200000 }, (_, i) => i))).toEqual([0, 199999]);
  });
  it('breaks lines on invalid x as well as y', () => {
    expect(linePath([{ x: 0, y: 1 }, { x: NaN, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 4 }], x => x, y => y))
      .toBe('M0.000,1.000M2.000,3.000L3.000,4.000');
  });
  it('does not pair unrelated comparison points by index', () => {
    const points = [{ x: 0, y: 1 }, { x: 2, y: 8 }];
    expect(pointAtX(points, 1)).toBeUndefined();
    expect(pointAtX(points, 2)?.y).toBe(8);
  });
  it('plots constant histograms and single successful samples with a finite range', () => {
    for (const values of [[5], [5, 5, 5]]) {
      const html = renderToStaticMarkup(<Histogram title="constant" values={values} stats={{ mean: 5, sd: 0, p5: 5, p50: 5, p95: 5 }} unit="K" />);
      expect(html).toContain('<svg'); expect(html).toContain('count'); expect(html).not.toMatch(/NaN|Infinity/);
    }
  });
  it('normalizes custom-map speed labels against the actual reference speed', () => {
    const map = generateCompressorMap({ PRdes: 10, WcDes: 50, surgeMargin: 0.2 });
    map.NcMap = map.NcMap.map(n => n * 10000); map.defaults.NcMap *= 10000;
    registerCustomMap('plot-test-rpm', 'compressor', map);
    const inputs = defaultInputs('turbojet'); inputs.mapIds = { ...inputs.mapIds, comp: 'plot-test-rpm' };
    const html = renderToStaticMarkup(<MapCharts design={inputs} result={solveEngine(inputs)} />);
    expect(html).toContain('110%'); expect(html).not.toContain('1100000%'); expect(html).not.toMatch(/NaN|Infinity/);
  });
  it('aligns station profiles across architectures and renders all default diagram variants', () => {
    const a = solveEngine(defaultInputs('turbofan')), b = defaultInputs('turbojet');
    const html = renderToStaticMarkup(<Compare store={{ state: { compare: b, inputs: a.inputs }, dispatch: () => {} } as any} a={a} />);
    expect(html).not.toMatch(/NaN|Infinity/);
    expect(html).toContain('station');
    for (const arch of ['turbofan', 'turbojet', 'turboprop'] as const) {
      expect(renderToStaticMarkup(<Diagrams result={solveEngine(defaultInputs(arch))} />)).not.toMatch(/NaN|Infinity/);
    }
  });
  it('does not connect map trajectories across unsolved intervals', () => {
    const inputs = defaultInputs('turbojet');
    const sample = (gasPath: boolean, Wc: number) => ({ gasPath, converged: gasPath, Wc: { comp: Wc }, PR: { comp: 2 } }) as any;
    const html = renderToStaticMarkup(<MapTrajectory design={inputs} samples={[sample(true, 10), sample(false, 11), sample(true, 12)]} />);
    const trajectory = html.match(/d="([^"]+)" fill="none" stroke="var\(--series-2\)" stroke-width="2.5"/);
    expect(trajectory).not.toBeNull(); expect(trajectory![1]).not.toContain('L'); expect(trajectory![1].match(/M/g)).toHaveLength(2);
  });
});
