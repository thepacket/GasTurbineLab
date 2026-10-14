/**
 * Shared parametric engine geometry, derived from the solved flow areas so that
 * annulus heights scale with the actual cycle.  Used by both the SVG
 * cross-section and the Three.js model.  Coordinates: x along the axis in
 * metres, r radius in metres.
 */
import { EngineResult, Station } from '../engine/types';

export interface XR { x: number; r: number }
export interface BladeRow { x: number; rHub: number; rTip: number; chord: number; count: number; rotor: boolean; twist: number }
export interface Part {
  id: string; // matches component id where applicable
  name: string;
  kind: 'inlet' | 'fan' | 'compressor' | 'burner' | 'turbine' | 'nozzle' | 'duct' | 'propeller' | 'gearbox' | 'afterburner' | 'spinner' | 'casing';
  x0: number; x1: number;
  hub: XR[]; // hub (inner flow boundary) profile
  tip: XR[]; // tip (outer flow boundary) profile
  rows: BladeRow[];
  stream: 'core' | 'bypass';
  T: number; // representative gas total temperature, K (exit)
  P: number; // Pa
}
export interface StationMark { id: string; x: number; rIn: number; rOut: number; stream: Station['stream']; station: Station }
export interface Geometry {
  length: number; rMax: number;
  parts: Part[];
  marks: StationMark[];
  nacelle?: { outer: XR[]; inner: XR[] }; // turbofan nacelle / bypass outer wall
  prop?: { x: number; diameter: number; drawn: number; blades: number; hubR: number };
  shaftR: number;
}

const PI = Math.PI;
const rTip = (A: number, nu: number) => Math.sqrt(A / (PI * (1 - nu * nu)));
const lin = (a: number, b: number, t: number) => a + (b - a) * t;

function st(res: EngineResult, id: string): Station { return res.stations.find((s) => s.id === id)!; }

export function buildGeometry(res: EngineResult): Geometry {
  const arch = res.inputs.arch;
  const parts: Part[] = [];
  const marks: StationMark[] = [];
  const S = (id: string) => st(res, id);

  const mark = (id: string, x: number, rIn: number, rOut: number) => {
    const s = S(id); if (s) marks.push({ id, x, rIn, rOut, stream: s.stream, station: s });
  };
  const rows = (x0: number, x1: number, n: number, hub0: number, hub1: number, tip0: number, tip1: number, count: number, rotorFirst = true, twist = 0.6): BladeRow[] => {
    const out: BladeRow[] = [];
    const pitch = (x1 - x0) / n;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      out.push({ x: x0 + pitch * (k + 0.5), rHub: lin(hub0, hub1, t), rTip: lin(tip0, tip1, t), chord: pitch * 0.55, count: count + k * 4, rotor: rotorFirst ? k % 2 === 0 : k % 2 === 1, twist });
    }
    return out;
  };

  if (arch === 'turbofan') {
    const A2 = S('2').A, A21 = S('21').A, A22 = S('22').A, A25 = S('25').A, A3 = S('3').A, A4 = S('4').A, A45 = S('45').A, A5 = S('5').A, A9 = S('9').A, A13 = S('13').A, A19 = S('19').A;
    const rFan = rTip(A2, 0.3);
    const L = 3.6 * rFan;
    const X = (f: number) => f * L;
    // fan
    const rFanHub = 0.3 * rFan, rFanExitTip = rTip(A21, 0.42), rFanExitHub = 0.42 * rFanExitTip;
    parts.push({ id: 'inlet', name: 'Inlet', kind: 'inlet', x0: X(0.0), x1: X(0.12), hub: [{ x: X(0.0), r: 0 }, { x: X(0.06), r: rFanHub * 0.5 }, { x: X(0.12), r: rFanHub }], tip: [{ x: X(0.0), r: rFan * 1.04 }, { x: X(0.12), r: rFan }], rows: [], stream: 'core', T: S('2').Tt, P: S('2').Pt });
    parts.push({ id: 'fan', name: 'Fan', kind: 'fan', x0: X(0.12), x1: X(0.22), hub: [{ x: X(0.12), r: rFanHub }, { x: X(0.22), r: rFanExitHub }], tip: [{ x: X(0.12), r: rFan }, { x: X(0.22), r: rFanExitTip }], rows: [{ x: X(0.15), rHub: rFanHub, rTip: rFan, chord: X(0.045), count: 22, rotor: true, twist: 0.9 }, { x: X(0.20), rHub: rFanExitHub, rTip: rFanExitTip * 0.995, chord: X(0.03), count: 48, rotor: false, twist: 0.4 }], stream: 'core', T: S('21').Tt, P: S('21').Pt });
    // core flow path radii
    const nuC = 0.72;
    const r22 = rTip(A22, nuC), r25 = rTip(A25, 0.78), r3 = rTip(A3, 0.86), r4 = rTip(A4, 0.78), r45 = rTip(A45, 0.8), r5 = rTip(A5, 0.62), r9 = Math.sqrt(A9 / PI);
    const cowl = (r: number) => r * 1.12 + 0.03 * rFan; // core cowl outer radius
    // bypass outer radius so that annulus area = A13 outside the cowl
    const rByp = (A: number, rc: number) => Math.sqrt(A / PI + rc * rc);
    const r13o = rByp(A13, cowl(r22)), r19o = rByp(A19, cowl(r5) * 0.98);
    mark('0', X(-0.02), 0, rFan * 1.02); mark('2', X(0.12), rFanHub, rFan); mark('21', X(0.22), rFanExitHub, rFanExitTip);
    mark('13', X(0.27), cowl(r22), r13o); mark('22', X(0.27), nuC * r22, r22);
    parts.push({ id: 'splitter', name: 'Splitter / bypass duct', kind: 'duct', x0: X(0.22), x1: X(0.78), hub: [{ x: X(0.24), r: cowl(r22) }, { x: X(0.5), r: cowl(r3) * 1.05 }, { x: X(0.62), r: cowl(r45) }, { x: X(0.78), r: cowl(r5) * 0.98 }], tip: [{ x: X(0.22), r: rFanExitTip }, { x: X(0.3), r: r13o }, { x: X(0.6), r: r13o * 0.98 }, { x: X(0.78), r: r19o }], rows: [], stream: 'bypass', T: S('17').Tt, P: S('17').Pt });
    mark('17', X(0.62), cowl(r45), r13o * 0.98); mark('19', X(0.78), cowl(r5) * 0.98, r19o);
    parts.push({ id: 'lpc', name: 'Booster', kind: 'compressor', x0: X(0.26), x1: X(0.36), hub: [{ x: X(0.26), r: nuC * r22 }, { x: X(0.36), r: 0.78 * r25 }], tip: [{ x: X(0.26), r: r22 }, { x: X(0.36), r: r25 }], rows: rows(X(0.27), X(0.355), 4, nuC * r22, 0.78 * r25, r22, r25, 60), stream: 'core', T: S('25').Tt, P: S('25').Pt });
    mark('25', X(0.36), 0.78 * r25, r25);
    parts.push({ id: 'hpc', name: 'HP compressor', kind: 'compressor', x0: X(0.37), x1: X(0.50), hub: [{ x: X(0.37), r: 0.78 * r25 }, { x: X(0.50), r: 0.86 * r3 }], tip: [{ x: X(0.37), r: r25 }, { x: X(0.50), r: r3 }], rows: rows(X(0.375), X(0.495), 10, 0.78 * r25, 0.86 * r3, r25, r3, 50), stream: 'core', T: S('3').Tt, P: S('3').Pt });
    mark('3', X(0.50), 0.86 * r3, r3);
    parts.push({ id: 'burner', name: 'Combustor', kind: 'burner', x0: X(0.50), x1: X(0.59), hub: [{ x: X(0.50), r: 0.86 * r3 }, { x: X(0.53), r: 0.72 * r4 }, { x: X(0.59), r: 0.78 * r4 }], tip: [{ x: X(0.50), r: r3 }, { x: X(0.53), r: r4 * 1.04 }, { x: X(0.59), r: r4 }], rows: [], stream: 'core', T: S('4').Tt, P: S('4').Pt });
    mark('4', X(0.59), 0.78 * r4, r4);
    parts.push({ id: 'hpt', name: 'HP turbine', kind: 'turbine', x0: X(0.59), x1: X(0.66), hub: [{ x: X(0.59), r: 0.78 * r4 }, { x: X(0.66), r: 0.8 * r45 }], tip: [{ x: X(0.59), r: r4 }, { x: X(0.66), r: r45 }], rows: rows(X(0.595), X(0.655), 4, 0.78 * r4, 0.8 * r45, r4, r45, 40, false, -0.6), stream: 'core', T: S('45').Tt, P: S('45').Pt });
    mark('45', X(0.66), 0.8 * r45, r45);
    parts.push({ id: 'lpt', name: 'LP turbine', kind: 'turbine', x0: X(0.66), x1: X(0.76), hub: [{ x: X(0.66), r: 0.8 * r45 }, { x: X(0.76), r: 0.62 * r5 }], tip: [{ x: X(0.66), r: r45 }, { x: X(0.76), r: r5 }], rows: rows(X(0.665), X(0.755), 8, 0.8 * r45, 0.62 * r5, r45, r5, 60, false, -0.7), stream: 'core', T: S('5').Tt, P: S('5').Pt });
    mark('5', X(0.76), 0.62 * r5, r5);
    parts.push({ id: 'core_nozz', name: 'Core nozzle', kind: 'nozzle', x0: X(0.76), x1: X(1.0), hub: [{ x: X(0.76), r: 0.62 * r5 }, { x: X(0.9), r: 0.4 * r5 }, { x: X(1.0), r: 0 }], tip: [{ x: X(0.76), r: r5 }, { x: X(0.9), r: Math.max(r9, 0.5 * r5) }, { x: X(0.97), r: r9 }], rows: [], stream: 'core', T: S('9').Tt, P: S('9').Pt });
    mark('9', X(0.97), 0, r9);
    const rMax = Math.max(rFan * 1.12, r13o * 1.06);
    return { length: L, rMax, parts, marks, nacelle: { outer: [{ x: X(-0.04), r: rFan * 1.06 }, { x: X(0.1), r: rMax }, { x: X(0.55), r: rMax }, { x: X(0.78), r: r19o * 1.02 }], inner: [{ x: X(-0.04), r: rFan * 1.04 }, { x: X(0.0), r: rFan * 1.04 }] }, shaftR: 0.12 * rFan };
  }

  if (arch === 'turbojet') {
    const A2 = S('2').A, A3 = S('3').A, A4 = S('4').A, A5 = S('5').A, A9 = S('9').A;
    const ab = res.inputs.afterburner.enabled;
    const r2 = rTip(A2, 0.45);
    const L = (ab ? 7.0 : 5.6) * r2;
    const X = (f: number) => f * L;
    const r3 = rTip(A3, 0.85), r4 = rTip(A4, 0.72), r5 = rTip(A5, 0.6), r9 = Math.sqrt(A9 / PI);
    const xN0 = ab ? 0.82 : 0.68;
    parts.push({ id: 'inlet', name: 'Inlet', kind: 'inlet', x0: X(0), x1: X(0.17), hub: [{ x: X(0.02), r: 0 }, { x: X(0.1), r: 0.3 * r2 }, { x: X(0.17), r: 0.45 * r2 }], tip: [{ x: X(0), r: r2 * 1.03 }, { x: X(0.17), r: r2 }], rows: [], stream: 'core', T: S('2').Tt, P: S('2').Pt });
    mark('0', X(-0.02), 0, r2 * 1.02); mark('2', X(0.17), 0.45 * r2, r2);
    parts.push({ id: 'comp', name: 'Compressor', kind: 'compressor', x0: X(0.17), x1: X(0.42), hub: [{ x: X(0.17), r: 0.45 * r2 }, { x: X(0.42), r: 0.85 * r3 }], tip: [{ x: X(0.17), r: r2 }, { x: X(0.42), r: r3 }], rows: rows(X(0.18), X(0.415), 12, 0.45 * r2, 0.85 * r3, r2, r3, 30), stream: 'core', T: S('3').Tt, P: S('3').Pt });
    mark('3', X(0.42), 0.85 * r3, r3);
    parts.push({ id: 'burner', name: 'Combustor', kind: 'burner', x0: X(0.42), x1: X(0.56), hub: [{ x: X(0.42), r: 0.85 * r3 }, { x: X(0.46), r: 0.65 * r4 }, { x: X(0.56), r: 0.72 * r4 }], tip: [{ x: X(0.42), r: r3 }, { x: X(0.46), r: 1.05 * r4 }, { x: X(0.56), r: r4 }], rows: [], stream: 'core', T: S('4').Tt, P: S('4').Pt });
    mark('4', X(0.56), 0.72 * r4, r4);
    parts.push({ id: 'turb', name: 'Turbine', kind: 'turbine', x0: X(0.56), x1: X(0.68), hub: [{ x: X(0.56), r: 0.72 * r4 }, { x: X(0.68), r: 0.6 * r5 }], tip: [{ x: X(0.56), r: r4 }, { x: X(0.68), r: r5 }], rows: rows(X(0.57), X(0.675), 4, 0.72 * r4, 0.6 * r5, r4, r5, 40, false, -0.6), stream: 'core', T: S('5').Tt, P: S('5').Pt });
    mark('5', X(0.68), 0.6 * r5, r5);
    if (ab) {
      const A7 = S('7').A; const r7 = Math.sqrt(A7 / PI);
      parts.push({ id: 'ab', name: 'Afterburner', kind: 'afterburner', x0: X(0.68), x1: X(0.82), hub: [{ x: X(0.68), r: 0.6 * r5 }, { x: X(0.74), r: 0 }], tip: [{ x: X(0.68), r: r5 }, { x: X(0.72), r: r7 }, { x: X(0.82), r: r7 }], rows: [], stream: 'core', T: S('7').Tt, P: S('7').Pt });
      mark('7', X(0.82), 0, r7);
      parts.push({ id: 'nozz', name: 'Nozzle', kind: 'nozzle', x0: X(0.82), x1: X(1.0), hub: [], tip: [{ x: X(0.82), r: r7 }, { x: X(0.9), r: Math.min(r7, r9) * 0.98 }, { x: X(1.0), r: r9 }], rows: [], stream: 'core', T: S('9').Tt, P: S('9').Pt });
    } else {
      parts.push({ id: 'nozz', name: 'Nozzle', kind: 'nozzle', x0: X(xN0), x1: X(1.0), hub: [{ x: X(xN0), r: 0.6 * r5 }, { x: X(0.8), r: 0 }], tip: [{ x: X(xN0), r: r5 }, { x: X(0.88), r: res.inputs.coreNozzle.type === 'CD' ? Math.min(r5, r9) * 0.95 : Math.max(r9, 0.6 * r5) }, { x: X(1.0), r: r9 }], rows: [], stream: 'core', T: S('9').Tt, P: S('9').Pt });
    }
    mark('9', X(1.0), 0, r9);
    return { length: L, rMax: Math.max(r2, r3, r4, r5, r9) * 1.1, parts, marks, shaftR: 0.18 * r2 };
  }

  // turboprop
  const A2 = S('2').A, A3 = S('3').A, A4 = S('4').A, A45 = S('45').A, A5 = S('5').A, A9 = S('9').A;
  const r2 = rTip(A2, 0.5);
  const L = 7.5 * r2;
  const X = (f: number) => f * L;
  const r3 = rTip(A3, 0.8), r4 = rTip(A4, 0.7), r45 = rTip(A45, 0.72), r5 = rTip(A5, 0.6), r9 = Math.sqrt(A9 / PI);
  const dProp = res.inputs.prop.diameter_m;
  const drawn = Math.min(dProp, 0.9 * L); // drawn (reduced) diameter so the core stays legible; the label says 'not to scale'
  parts.push({ id: 'prop', name: 'Propeller', kind: 'propeller', x0: X(0.05), x1: X(0.09), hub: [], tip: [], rows: [{ x: X(0.07), rHub: 0.9 * r2, rTip: drawn / 2, chord: X(0.06), count: 6, rotor: true, twist: 1.1 }], stream: 'core', T: S('0').Tt, P: S('0').Pt });
  parts.push({ id: 'gearbox', name: 'Reduction gearbox', kind: 'gearbox', x0: X(0.09), x1: X(0.27), hub: [], tip: [{ x: X(0.09), r: 0.9 * r2 }, { x: X(0.14), r: 1.25 * r2 }, { x: X(0.27), r: 1.25 * r2 }], rows: [], stream: 'core', T: S('0').Tt, P: S('0').Pt });
  parts.push({ id: 'inlet', name: 'Inlet', kind: 'inlet', x0: X(0.22), x1: X(0.30), hub: [{ x: X(0.22), r: 0.6 * r2 }, { x: X(0.30), r: 0.5 * r2 }], tip: [{ x: X(0.22), r: 1.25 * r2 }, { x: X(0.30), r: r2 }], rows: [], stream: 'core', T: S('2').Tt, P: S('2').Pt });
  mark('0', X(-0.02), 0, r2); mark('2', X(0.30), 0.5 * r2, r2);
  parts.push({ id: 'comp', name: 'Compressor', kind: 'compressor', x0: X(0.30), x1: X(0.50), hub: [{ x: X(0.30), r: 0.5 * r2 }, { x: X(0.50), r: 0.8 * r3 }], tip: [{ x: X(0.30), r: r2 }, { x: X(0.50), r: r3 }], rows: rows(X(0.31), X(0.495), 8, 0.5 * r2, 0.8 * r3, r2, r3, 24), stream: 'core', T: S('3').Tt, P: S('3').Pt });
  mark('3', X(0.50), 0.8 * r3, r3);
  parts.push({ id: 'burner', name: 'Combustor', kind: 'burner', x0: X(0.50), x1: X(0.62), hub: [{ x: X(0.50), r: 0.8 * r3 }, { x: X(0.54), r: 0.62 * r4 }, { x: X(0.62), r: 0.7 * r4 }], tip: [{ x: X(0.50), r: r3 }, { x: X(0.54), r: 1.06 * r4 }, { x: X(0.62), r: r4 }], rows: [], stream: 'core', T: S('4').Tt, P: S('4').Pt });
  mark('4', X(0.62), 0.7 * r4, r4);
  parts.push({ id: 'turb', name: 'Gas-generator turbine', kind: 'turbine', x0: X(0.62), x1: X(0.72), hub: [{ x: X(0.62), r: 0.7 * r4 }, { x: X(0.72), r: 0.72 * r45 }], tip: [{ x: X(0.62), r: r4 }, { x: X(0.72), r: r45 }], rows: rows(X(0.63), X(0.715), 2, 0.7 * r4, 0.72 * r45, r4, r45, 36, false, -0.6), stream: 'core', T: S('45').Tt, P: S('45').Pt });
  mark('45', X(0.72), 0.72 * r45, r45);
  parts.push({ id: 'pt', name: 'Power turbine', kind: 'turbine', x0: X(0.72), x1: X(0.84), hub: [{ x: X(0.72), r: 0.72 * r45 }, { x: X(0.84), r: 0.6 * r5 }], tip: [{ x: X(0.72), r: r45 }, { x: X(0.84), r: r5 }], rows: rows(X(0.73), X(0.835), 4, 0.72 * r45, 0.6 * r5, r45, r5, 44, false, -0.7), stream: 'core', T: S('5').Tt, P: S('5').Pt });
  mark('5', X(0.84), 0.6 * r5, r5);
  parts.push({ id: 'nozz', name: 'Exhaust', kind: 'nozzle', x0: X(0.84), x1: X(1.0), hub: [{ x: X(0.84), r: 0.6 * r5 }, { x: X(0.95), r: 0 }], tip: [{ x: X(0.84), r: r5 }, { x: X(1.0), r: r9 }], rows: [], stream: 'core', T: S('9').Tt, P: S('9').Pt });
  mark('9', X(1.0), 0, r9);
  return { length: L, rMax: Math.max(1.25 * r2, r4 * 1.1, drawn / 2), parts, marks, prop: { x: X(0.07), diameter: dProp, drawn, blades: 6, hubR: 0.9 * r2 }, shaftR: 0.2 * r2 };
}

/** Linear interpolation of a profile at x. */
export function profileAt(p: XR[], x: number): number {
  if (p.length === 0) return 0;
  if (x <= p[0].x) return p[0].r;
  for (let i = 1; i < p.length; i++) if (x <= p[i].x) return lin(p[i - 1].r, p[i].r, (x - p[i - 1].x) / (p[i].x - p[i - 1].x));
  return p[p.length - 1].r;
}
