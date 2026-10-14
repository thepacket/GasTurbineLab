import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EngineResult } from '../engine/types';
import { Store } from '../state/store';
import { buildGeometry, Geometry, Part, XR, profileAt } from '../viz/geometry';
import { tempColor } from '../viz/color';
import { fmt, kPa } from '../ui/format';
import { canvasToPng } from '../ui/exportImage';

/** Build a twisted, tapered blade: a thin cambered plate stacked along the span. */
function bladeGeometry(span: number, chord: number, twist: number, thickness: number): THREE.BufferGeometry {
  const nSpan = 6, nChord = 10;
  const pos: number[] = [], idx: number[] = [];
  const upper: number[][] = [], lower: number[][] = [];
  for (let i = 0; i <= nSpan; i++) {
    const t = i / nSpan;
    const c = chord * (1 - 0.25 * t);
    const ang = twist * (0.5 - t); // twist about the stacking axis, more at the hub
    const camber = 0.08 * c;
    for (let j = 0; j <= nChord; j++) {
      const u = j / nChord;
      const xc = (u - 0.5) * c;
      const zc = camber * 4 * u * (1 - u);
      const th = thickness * c * 3.5 * Math.sqrt(Math.max(u, 1e-4)) * (1 - u) * (1 - 0.5 * t);
      for (const sgn of [1, -1]) {
        const x = xc, z = zc + sgn * th;
        const xr = x * Math.cos(ang) - z * Math.sin(ang), zr = x * Math.sin(ang) + z * Math.cos(ang);
        pos.push(xr, t * span, zr);
      }
      upper.push([i, j]); lower.push([i, j]);
    }
  }
  const id = (i: number, j: number, s: number) => (i * (nChord + 1) + j) * 2 + s;
  for (let i = 0; i < nSpan; i++) for (let j = 0; j < nChord; j++) {
    for (const s of [0, 1]) {
      const a = id(i, j, s), b = id(i + 1, j, s), c = id(i + 1, j + 1, s), d = id(i, j + 1, s);
      if (s === 0) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c);
    }
    // leading/trailing edges closed by thickness -> 0, fine
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function lathe(profile: XR[], segments = 64, thetaStart = 0, thetaLength = Math.PI * 2): THREE.LatheGeometry {
  const pts = profile.map((p) => new THREE.Vector2(Math.max(p.r, 1e-4), p.x));
  const g = new THREE.LatheGeometry(pts, segments, thetaStart, thetaLength);
  g.rotateZ(-Math.PI / 2); // lathe axis (y) -> x
  return g;
}
function densify(p: XR[], n = 24): XR[] {
  if (p.length < 2) return p;
  const out: XR[] = [];
  const x0 = p[0].x, x1 = p[p.length - 1].x;
  for (let i = 0; i <= n; i++) { const x = x0 + ((x1 - x0) * i) / n; out.push({ x, r: profileAt(p, x) }); }
  return out;
}

const METAL = { color: 0x9aa0a8, metalness: 0.85, roughness: 0.35 };
const DARK = { color: 0x4a4f56, metalness: 0.7, roughness: 0.5 };

function buildScene(geo: Geometry, cutaway: boolean): { group: THREE.Group; pickables: THREE.Object3D[] } {
  const group = new THREE.Group();
  const pickables: THREE.Object3D[] = [];
  const clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0); // keep z<=0 half of casings
  const casingMat = (hex: number, opacity = 1) => new THREE.MeshStandardMaterial({ ...METAL, color: hex, side: THREE.DoubleSide, clippingPlanes: cutaway ? [clip] : [], transparent: opacity < 1, opacity });
  const gasMat = (T: number) => new THREE.MeshStandardMaterial({ color: new THREE.Color(tempColor(T)), emissive: new THREE.Color(tempColor(T)), emissiveIntensity: 0.35, side: THREE.DoubleSide, transparent: true, opacity: 0.3, clippingPlanes: cutaway ? [clip] : [], depthWrite: false });
  const tag = (o: THREE.Object3D, part: Part) => { o.userData.partId = part.id; o.userData.partName = part.name; o.userData.T = part.T; o.userData.P = part.P; pickables.push(o); };

  for (const p of geo.parts) {
    const sub = new THREE.Group();
    const wall = p.kind === 'gearbox' ? 0.0 : 0.012 * geo.rMax;
    if (p.tip.length > 1) {
      // casing shell (tip + wall)
      const outer = densify(p.tip).map((q) => ({ x: q.x, r: q.r + wall }));
      const inner = densify(p.tip).slice().reverse().map((q) => ({ x: q.x, r: q.r + 0.15 * wall }));
      const shell = new THREE.Mesh(lathe([...outer, ...inner]), casingMat(p.kind === 'burner' ? 0x8c6a4a : p.kind === 'turbine' || p.kind === 'afterburner' ? 0x7a6f6a : p.kind === 'gearbox' ? 0x5a6068 : 0x9aa0a8));
      tag(shell, p); sub.add(shell);
      // gas annulus (coloured by temperature)
      if (p.hub.length > 1 && p.kind !== 'gearbox') {
        const gas = new THREE.Mesh(lathe([...densify(p.tip).map((q) => ({ x: q.x, r: q.r * 0.995 })), ...densify(p.hub).slice().reverse().map((q) => ({ x: q.x, r: q.r * 1.005 }))]), gasMat(p.T));
        gas.userData.partId = p.id; sub.add(gas);
      }
    }
    if (p.hub.length > 1 && p.kind !== 'duct') {
      const hubProfile = [{ x: p.hub[0].x, r: geo.shaftR }, ...densify(p.hub), { x: p.hub[p.hub.length - 1].x, r: geo.shaftR }];
      const hub = new THREE.Mesh(lathe(hubProfile, 64), new THREE.MeshStandardMaterial(DARK));
      tag(hub, p); sub.add(hub);
    }
    if (p.kind === 'duct' && p.hub.length > 1) {
      const cowl = densify(p.hub);
      const cowlMesh = new THREE.Mesh(lathe([...cowl.map((q) => ({ x: q.x, r: q.r })), ...cowl.slice().reverse().map((q) => ({ x: q.x, r: q.r * 0.96 }))]), casingMat(0x7f8790));
      tag(cowlMesh, p); sub.add(cowlMesh);
    }
    // blade rows
    for (const row of p.rows) {
      const span = row.rTip - row.rHub;
      const bg = bladeGeometry(span, row.chord, row.twist, row.rotor ? 0.06 : 0.08);
      const mat = new THREE.MeshStandardMaterial({ color: row.rotor ? 0xd9dde3 : 0x8f969e, metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide, emissive: new THREE.Color(tempColor(p.T)), emissiveIntensity: p.kind === 'turbine' ? 0.25 : 0.05 });
      const inst = new THREE.InstancedMesh(bg, mat, row.count);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(1, 1, 1);
      for (let k = 0; k < row.count; k++) {
        const th = (k / row.count) * Math.PI * 2;
        q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), th);
        pos.set(row.x, row.rHub * Math.cos(th), row.rHub * Math.sin(th));
        // blade local y is radial; rotate so y aligns with radial direction at angle th
        const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), th);
        m.compose(pos, rot, scl);
        inst.setMatrixAt(k, m);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.userData.partId = p.id; inst.userData.partName = p.name; inst.userData.T = p.T; inst.userData.P = p.P;
      pickables.push(inst);
      sub.add(inst);
      if (row.rotor && p.kind !== 'propeller') {
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(row.rHub * 1.001, row.rHub * 1.001, row.chord * 1.1, 48), new THREE.MeshStandardMaterial(DARK));
        disc.rotateZ(Math.PI / 2); disc.position.x = row.x; sub.add(disc);
      }
    }
    if (p.kind === 'propeller' && geo.prop) {
      const spinner = new THREE.Mesh(lathe([{ x: geo.prop.x - geo.prop.hubR * 1.6, r: 0.001 }, { x: geo.prop.x - geo.prop.hubR * 0.8, r: geo.prop.hubR * 0.8 }, { x: geo.prop.x + geo.prop.hubR * 0.4, r: geo.prop.hubR }]), new THREE.MeshStandardMaterial(METAL));
      tag(spinner, p); sub.add(spinner);
    }
    if (p.kind === 'burner') {
      // fuel injectors
      const n = 16;
      const rMid = (p.tip[1].r + p.hub[1].r) / 2;
      for (let k = 0; k < n; k++) {
        const th = (k / n) * Math.PI * 2;
        if (cutaway && Math.sin(th) > 0.05) continue;
        const inj = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * rMid, 0.03 * rMid, (p.x1 - p.x0) * 0.25, 10), new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xff9a2a, emissiveIntensity: 0.6 }));
        inj.rotateZ(Math.PI / 2); inj.position.set(p.x0 + (p.x1 - p.x0) * 0.2, rMid * Math.cos(th), rMid * Math.sin(th)); sub.add(inj);
      }
    }
    group.add(sub);
  }
  // shaft
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(geo.shaftR, geo.shaftR, geo.length * 0.95, 32), new THREE.MeshStandardMaterial(DARK));
  shaft.rotateZ(Math.PI / 2); shaft.position.x = geo.length * 0.47; group.add(shaft);
  // nacelle (turbofan)
  if (geo.nacelle) {
    const o = densify(geo.nacelle.outer, 40);
    const nac = new THREE.Mesh(lathe([...o, ...o.slice().reverse().map((q) => ({ x: q.x, r: q.r * 0.985 }))]), casingMat(0xb7bcc3));
    nac.userData.partName = 'Nacelle'; group.add(nac);
  }
  return { group, pickables };
}

export function Engine3D({ result, store }: { result: EngineResult; store: Store }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [cutaway, setCutaway] = useState(true);
  const [spin, setSpin] = useState(true);
  const [orbit, setOrbit] = useState(false);
  const touch = typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false);
  const nudge = (dir: 'left' | 'right' | 'up' | 'down' | 'in' | 'out') => {
    const st = sceneRef.current; if (!st) return;
    const c = st.controls, cam = st.camera;
    const off = cam.position.clone().sub(c.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    if (dir === 'left') sph.theta -= 0.25; if (dir === 'right') sph.theta += 0.25;
    if (dir === 'up') sph.phi = Math.max(0.1, sph.phi - 0.18); if (dir === 'down') sph.phi = Math.min(Math.PI - 0.1, sph.phi + 0.18);
    if (dir === 'in') sph.radius *= 0.8; if (dir === 'out') sph.radius *= 1.25;
    cam.position.copy(c.target).add(new THREE.Vector3().setFromSpherical(sph));
    cam.lookAt(c.target);
  };
  const [hover, setHover] = useState<{ x: number; y: number; name: string; T: number; P: number } | null>(null);
  const sceneRef = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; engine?: THREE.Group; pickables: THREE.Object3D[]; rotors: THREE.Object3D[] } | null>(null);
  const spinRef = useRef(spin); spinRef.current = spin;
  const selRef = useRef(store.state.selected);

  // renderer setup
  useEffect(() => {
    const canvas = ref.current!, el = wrap.current!;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.localClippingEnabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    controls.autoRotateSpeed = 1.2;
    scene.add(new THREE.HemisphereLight(0xdfe6f0, 0x1a1c20, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(2, 3, 4); scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fb7ff, 0.8); fill.position.set(-3, -1, -2); scene.add(fill);
    const grid = new THREE.GridHelper(10, 20, 0x3a3d42, 0x26282c); grid.position.y = -1.0; scene.add(grid);
    const st = { renderer, scene, camera, controls, pickables: [] as THREE.Object3D[], rotors: [] as THREE.Object3D[] };
    sceneRef.current = st;
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    let raf = 0; const clock = new THREE.Clock();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const dt = clock.getDelta();
      if (spinRef.current) for (const r of st.rotors) r.rotateX(dt * (r.userData.speed ?? 1.5));
      controls.update();
      renderer.render(scene, camera);
    };
    loop();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); };
  }, []);

  // (re)build engine when result / cutaway changes
  useEffect(() => {
    const st = sceneRef.current; if (!st) return;
    const geo = buildGeometry(result);
    if (st.engine) { st.scene.remove(st.engine); st.engine.traverse((o: any) => { o.geometry?.dispose?.(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => m.dispose()); }); }
    const { group, pickables } = buildScene(geo, cutaway);
    // normalise size: engine length -> 4 units, centred
    const s = 4 / geo.length;
    group.scale.setScalar(s); group.position.x = -2;
    st.scene.add(group); st.engine = group; st.pickables = pickables;
    st.rotors = [];
    group.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh && o.userData.partId) { const p = geo.parts.find((q) => q.id === o.userData.partId); const row = p?.rows.find(() => true); if (row && (p!.kind === 'fan' || p!.kind === 'compressor' || p!.kind === 'turbine' || p!.kind === 'propeller')) { /* rotate rotor rows only */ } } });
    // rotors: InstancedMesh rows where rotor=true -> detect by material colour
    group.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) { const m = (o as THREE.InstancedMesh).material as THREE.MeshStandardMaterial; if (m.color.getHex() === 0xd9dde3) { o.userData.speed = o.userData.partId === 'prop' ? 1.2 : 3.5; st.rotors.push(o); } } });
    const first = !st.camera.userData.placed;
    if (first) { st.camera.position.set(-3.4, 1.5, 4.2 * geo.rMax / geo.length * 4 + 2.6); st.controls.target.set(0, 0, 0); st.camera.userData.placed = true; }
  }, [result, cutaway]);

  // selection highlight
  useEffect(() => {
    selRef.current = store.state.selected;
    const st = sceneRef.current; if (!st?.engine) return;
    st.engine.traverse((o: any) => {
      if (!o.material || !o.userData.partId) return;
      const m = o.material as THREE.MeshStandardMaterial;
      const on = store.state.selected === o.userData.partId;
      if (!m.userData.baseEmissive) m.userData.baseEmissive = m.emissive.clone();
      if (!m.userData.baseI) m.userData.baseI = m.emissiveIntensity;
      if (on) { m.emissive.set(0x3987e5); m.emissiveIntensity = 0.9; } else { m.emissive.copy(m.userData.baseEmissive); m.emissiveIntensity = m.userData.baseI; }
    });
  }, [store.state.selected, result, cutaway]);

  const raycaster = useRef(new THREE.Raycaster());
  const pickAt = (e: React.PointerEvent) => {
    const st = sceneRef.current; if (!st) return null;
    const r = ref.current!.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.current.setFromCamera(v, st.camera);
    const hits = raycaster.current.intersectObjects(st.pickables, false);
    return hits.length ? hits[0].object : null;
  };
  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const o = pickAt(e);
    const r = wrap.current!.getBoundingClientRect();
    setHover(o ? { x: e.clientX - r.left, y: e.clientY - r.top, name: o.userData.partName, T: o.userData.T, P: o.userData.P } : null);
  };
  const downPos = useRef<[number, number]>([0, 0]);
  const onDown = (e: React.PointerEvent) => { downPos.current = [e.clientX, e.clientY]; };
  const onUp = (e: React.PointerEvent) => {
    const [x, y] = downPos.current; if (Math.hypot(e.clientX - x, e.clientY - y) > 6) return;
    const o = pickAt(e);
    store.dispatch({ type: 'select', id: o ? (selRef.current === o.userData.partId ? null : o.userData.partId) : null });
  };

  return (
    <div ref={wrap} className="fill" style={{ position: 'relative' }}>
      <canvas ref={ref} className="canvas3d" onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp} onPointerLeave={() => setHover(null)} />
      <div className="overlay-tl">
        <span className="chip"><button className={cutaway ? 'on' : ''} onClick={() => setCutaway(!cutaway)}>{cutaway ? 'Cutaway' : 'Full casing'}</button></span>
        <span className="chip"><button className={spin ? 'on' : ''} onClick={() => setSpin(!spin)}>{spin ? 'Rotating' : 'Static'}</button></span>
        <span className="chip"><button className={orbit ? 'on' : ''} onClick={() => { const st = sceneRef.current; if (st) st.controls.autoRotate = !orbit; setOrbit(!orbit); }}>{orbit ? 'Orbiting' : 'Auto-orbit'}</button></span>
        <span className="chip"><button onClick={() => { const st = sceneRef.current; if (st) { st.camera.userData.placed = false; st.camera.position.set(-3.4, 1.5, 4.8); st.controls.target.set(0, 0, 0); } }}>Reset view</button></span>
        <span className="chip"><button onClick={() => { const c = ref.current; if (c) canvasToPng(c, 'gas-turbine-lab-3d.png'); }} aria-label="Export 3D view as PNG">PNG</button></span>
        {!touch && <span className="chip">drag to orbit · wheel / pinch to zoom · click a part</span>}
      </div>
      {touch && (
        <div className="touchpad" aria-label="3D view controls">
          <button onClick={() => nudge('left')} aria-label="Rotate left">⟲</button>
          <button onClick={() => nudge('right')} aria-label="Rotate right">⟳</button>
          <button onClick={() => nudge('up')} aria-label="Tilt up">▲</button>
          <button onClick={() => nudge('down')} aria-label="Tilt down">▼</button>
          <button onClick={() => nudge('in')} aria-label="Zoom in">＋</button>
          <button onClick={() => nudge('out')} aria-label="Zoom out">－</button>
        </div>
      )}
      {hover && <div className="tooltip" style={{ left: hover.x + 12, top: hover.y + 12 }}><b>{hover.name}</b><div className="num">Tt {fmt(hover.T, 0)} K · Pt {kPa(hover.P)} kPa</div></div>}
    </div>
  );
}
