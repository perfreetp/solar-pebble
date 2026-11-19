import { Application, Container, Graphics, Text } from 'pixi.js';
import type { Entity, PartDef, SceneData, Vec3 } from '../../shared/types';
import { PART_MAP } from '../../shared/parts';
import {
  COS30,
  entityOBB,
  entitySilhouette,
  entitySize,
  footprint,
  polygonBounds,
  project,
  type OBB,
  type PortSnapHit,
} from '../../shared/geometry';
import type { GizmoHandles } from './store';

const DEG = Math.PI / 180;

function hex(c: string): number {
  return parseInt(c.replace('#', ''), 16);
}
function shade(c: string, amt: number): number {
  const n = hex(c);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt >= 0) {
    r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt;
  } else {
    r *= 1 + amt; g *= 1 + amt; b *= 1 + amt;
  }
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}
function flat(pts: { x: number; y: number }[]): number[] {
  const out: number[] = [];
  for (const p of pts) out.push(p.x, p.y);
  return out;
}

export interface RenderState {
  scene: SceneData;
  selection: string[];
  hover: string | null;
  camera: { zoom: number; x: number; y: number };
  gizmo: GizmoHandles | null;
  gizmoHover: string | null;
  snapHint: PortSnapHit | null;
  interfering: Set<string>;
  marquee: { x: number; y: number; w: number; h: number } | null;
  dragging: boolean;
  showPorts: boolean;
  showGrid: boolean;
  drop: { x: number; y: number; z: number; on: string | null } | null;
}

interface EntityNode {
  root: Container;
  body: Graphics;
  overlay: Graphics;
  uid: string;
}

export class IsoRenderer {
  app: Application;
  world: Container;
  ground: Graphics;
  entitiesLayer: Container;
  overlayLayer: Container; // world-space outlines above parts
  screenLayer: Container; // screen-space gizmo / marquee
  gizmoGfx: Graphics;
  gizmoText: Text[] = [];
  marqueeGfx: Graphics;
  nodes = new Map<string, EntityNode>();
  lastState: RenderState | null = null;
  dropGfx: Graphics | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(app: Application) {
    this.app = app;
    this.world = new Container();
    this.ground = new Graphics();
    this.entitiesLayer = new Container();
    this.entitiesLayer.sortableChildren = true;
    this.overlayLayer = new Container();
    this.screenLayer = new Container();
    this.gizmoGfx = new Graphics();
    this.marqueeGfx = new Graphics();
    this.screenLayer.addChild(this.gizmoGfx, this.marqueeGfx);
    this.world.addChild(this.ground, this.entitiesLayer, this.overlayLayer);
    app.stage.addChild(this.world, this.screenLayer);
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.app.destroy(true);
  }

  render(st: RenderState) {
    this.lastState = st;
    const { camera } = st;
    this.world.position.set(camera.x, camera.y);
    this.world.scale.set(camera.zoom);

    this.drawGround(st);
    this.syncEntities(st);
    this.drawDropGhost(st);
    this.drawGizmo(st);
    this.drawMarquee(st);
  }

  private drawDropGhost(st: RenderState) {
    const g = this.overlayLayer.children[0] as Graphics | undefined;
    if (!this.dropGfx) {
      this.dropGfx = new Graphics();
      this.overlayLayer.addChild(this.dropGfx);
    }
    const dg = this.dropGfx;
    dg.clear();
    if (!st.drop) return;
    const w = 1 / st.camera.zoom;
    const c = project({ x: st.drop.x, y: st.drop.y, z: 0 });
    const r = st.drop.on ? 22 : 30;
    dg.poly([
      c.x, c.y - r,
      c.x + r * 1.732, c.y,
      c.x, c.y + r,
      c.x - r * 1.732, c.y,
    ]).fill({ color: 0xe7a94a, alpha: 0.18 }).stroke({ width: 2 * w, color: 0xe7a94a, alpha: 0.95 });
    dg.moveTo(c.x - r * 2.2, c.y).lineTo(c.x + r * 2.2, c.y);
    dg.moveTo(c.x, c.y - r * 1.3).lineTo(c.x, c.y + r * 1.3);
  }

  private drawGround(st: RenderState) {
    const g = this.ground;
    g.clear();
    if (!st.showGrid) {
      // plain working mat
      const b = this.sceneExtent(st.scene);
      const pad = 700;
      const pts = [
        { x: b.minX - pad, y: b.minY - pad },
        { x: b.maxX + pad, y: b.minY - pad },
        { x: b.maxX + pad, y: b.maxY + pad },
        { x: b.minX - pad, y: b.maxY + pad },
      ].map((p) => project({ x: p.x, y: p.y, z: 0 }));
      g.poly(flat(pts)).fill({ color: 0x1b232e, alpha: 0.55 });
      return;
    }
    const b = this.sceneExtent(st.scene);
    const minX = Math.floor((b.minX - 1200) / 500) * 500;
    const maxX = Math.ceil((b.maxX + 1200) / 500) * 500;
    const minY = Math.floor((b.minY - 1200) / 500) * 500;
    const maxY = Math.ceil((b.maxY + 1200) / 500) * 500;

    const matPts = [
      project({ x: minX, y: minY, z: 0 }),
      project({ x: maxX, y: minY, z: 0 }),
      project({ x: maxX, y: maxY, z: 0 }),
      project({ x: minX, y: maxY, z: 0 }),
    ];
    g.poly(flat(matPts)).fill({ color: 0x18202a, alpha: 0.9 });

    // minor grid
    for (let x = minX; x <= maxX; x += 500) {
      const a = project({ x, y: minY, z: 0 });
      const c = project({ x, y: maxY, z: 0 });
      g.moveTo(a.x, a.y).lineTo(c.x, c.y);
    }
    for (let y = minY; y <= maxY; y += 500) {
      const a = project({ x: minX, y, z: 0 });
      const c = project({ x: maxX, y, z: 0 });
      g.moveTo(a.x, a.y).lineTo(c.x, c.y);
    }
    g.stroke({ width: 1 / st.camera.zoom, color: 0x334152, alpha: 0.55 });

    // major grid
    for (let x = Math.ceil(minX / 1000) * 1000; x <= maxX; x += 1000) {
      const a = project({ x, y: minY, z: 0 });
      const c = project({ x, y: maxY, z: 0 });
      g.moveTo(a.x, a.y).lineTo(c.x, c.y);
    }
    for (let y = Math.ceil(minY / 1000) * 1000; y <= maxY; y += 1000) {
      const a = project({ x: minX, y, z: 0 });
      const c = project({ x: maxX, y, z: 0 });
      g.moveTo(a.x, a.y).lineTo(c.x, c.y);
    }
    g.stroke({ width: 1.4 / st.camera.zoom, color: 0x405266, alpha: 0.8 });

    // axes
    const o = project({ x: 0, y: 0, z: 0 });
    const ax = project({ x: 800, y: 0, z: 0 });
    const ay = project({ x: 0, y: 800, z: 0 });
    g.moveTo(o.x, o.y).lineTo(ax.x, ax.y).stroke({ width: 2.4 / st.camera.zoom, color: 0xc9634f, alpha: 0.9 });
    g.moveTo(o.x, o.y).lineTo(ay.x, ay.y).stroke({ width: 2.4 / st.camera.zoom, color: 0x5e9e6d, alpha: 0.9 });
  }

  private sceneExtent(scene: SceneData) {
    let minX = -2000, maxX = 2000, minY = -2000, maxY = 2000;
    if (scene.entities.length) {
      const pts: { x: number; y: number }[] = [];
      for (const e of scene.entities) {
        const d = PART_MAP[e.defId];
        if (!d) continue;
        pts.push(...footprint(entityOBB(e, d)));
      }
      if (pts.length) {
        const b = polygonBounds(pts);
        minX = b.minX; maxX = b.maxX; minY = b.minY; maxY = b.maxY;
      }
    }
    return { minX, maxX, minY, maxY };
  }

  private syncEntities(st: RenderState) {
    const seen = new Set<string>();
    const w = 1 / st.camera.zoom;
    for (const e of st.scene.entities) {
      const def = PART_MAP[e.defId];
      if (!def) continue;
      const vis = !e.hidden && st.scene.layers?.[def.category]?.visible !== false;
      if (!vis) {
        const n = this.nodes.get(e.uid);
        if (n) n.root.visible = false;
        continue;
      }
      seen.add(e.uid);
      let node = this.nodes.get(e.uid);
      if (!node) {
        const root = new Container();
        const body = new Graphics();
        const overlay = new Graphics();
        root.addChild(body, overlay);
        this.entitiesLayer.addChild(root);
        node = { root, body, overlay, uid: e.uid };
        this.nodes.set(e.uid, node);
      }
      node.root.visible = true;
      const obb = entityOBB(e, def);
      node.root.zIndex = (obb.c.x + obb.c.y + obb.c.z) / 1000;
      this.drawEntity(node.body, e, def, obb, st, w);
      this.drawEntityOverlays(node.overlay, e, def, obb, st, w);
    }
    for (const [uidStr, n] of this.nodes) {
      if (!seen.has(uidStr)) {
        n.root.destroy({ children: true });
        this.nodes.delete(uidStr);
      }
    }
  }

  private drawEntity(g: Graphics, e: Entity, def: PartDef, obb: OBB, st: RenderState, w: number) {
    g.clear();
    const base = e.color ?? def.color;
    const sel = st.selection.includes(e.uid);
    const hov = st.hover === e.uid && !sel;

    // contact shadow, offset along the light direction and softened by a second pass
    const shadowFoot = footprint(obb);
    const sh1 = shadowFoot.map((p) => project({ x: p.x + 26, y: p.y + 26, z: 0.6 }));
    const sh2 = shadowFoot.map((p) => project({ x: p.x + 13, y: p.y + 13, z: obb.c.z - obb.h.z + 0.6 }));
    g.poly(flat(sh1)).fill({ color: 0x000000, alpha: 0.16 });
    g.poly(flat(sh2)).fill({ color: 0x000000, alpha: 0.2 });

    if (def.shape === 'cyl') {
      this.drawCylinder(g, e, def, obb, base, w);
    } else {
      this.drawBox(g, e, def, obb, base, w);
    }

    // subtle edge highlight for definition
    if (sel || hov) {
      const sil = entitySilhouette(e, def);
      const edgeCol = hov ? 0x9cc9ee : shade(base, -0.42);
      g.poly(flat(sil)).stroke({ width: 1.1 * w, color: edgeCol, alpha: 0.8, join: 'round' });
    }
  }

  private drawBox(g: Graphics, e: Entity, def: PartDef, obb: OBB, base: string, w: number) {
    const c = Math.cos(obb.yaw), s = Math.sin(obb.yaw);
    const corners: Record<string, { x: number; y: number; z: number }> = {};
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const lx = sx * obb.h.x, ly = sy * obb.h.y, lz = sz * obb.h.z;
      corners[`${sx}${sy}${sz}`] = {
        x: obb.c.x + lx * c - ly * s,
        y: obb.c.y + lx * s + ly * c,
        z: obb.c.z + lz,
      };
    }
    const P = (k: string) => project(corners[k]);
    const face = (keys: string[], color: number, alpha = 1) => {
      const pts = keys.map(P);
      g.poly(flat(pts)).fill({ color, alpha });
      g.poly(flat(pts)).stroke({ width: 0.9 * w, color, alpha });
    };
    // far faces first
    face(['-1-1-1', '-11-1', '-111', '-1-11'], shade(base, -0.46)); // -x
    face(['1-1-1', '-1-1-1', '-1-11', '1-11'], shade(base, -0.3)); // -y
    // near faces
    face(['11-1', '1-1-1', '1-11', '111'], shade(base, 0.04)); // +x
    face(['11-1', '111', '-111', '-11-1'], shade(base, -0.12)); // +y
    // top
    face(['111', '-111', '-1-11', '1-11'], shade(base, 0.22));

    // carton: add tape band on top
    if (def.category === 'carton') {
      const a = project({ x: obb.c.x - obb.h.x * c, y: obb.c.y - obb.h.x * s, z: obb.c.z + obb.h.z });
      const b = project({ x: obb.c.x + obb.h.x * c, y: obb.c.y + obb.h.x * s, z: obb.c.z + obb.h.z });
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 10 * w, color: 0xe6d3b3, alpha: 0.55 });
    }
    if (def.category === 'board') {
      // wood grain hint on top
      for (let i = 1; i < 4; i++) {
        const t = -1 + (2 * i) / 4;
        const ly = t * obb.h.y * 0.9;
        const a = project({ x: obb.c.x + (-obb.h.x * 0.94) * c - ly * s, y: obb.c.y + (-obb.h.x * 0.94) * s + ly * c, z: obb.c.z + obb.h.z });
        const b = project({ x: obb.c.x + (obb.h.x * 0.94) * c - ly * s, y: obb.c.y + (obb.h.x * 0.94) * s + ly * c, z: obb.c.z + obb.h.z });
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1 * w, color: 0x8f6b43, alpha: 0.35 });
      }
    }
  }

  private drawCylinder(g: Graphics, e: Entity, def: PartDef, obb: OBB, base: string, w: number) {
    const s = entitySize(e, def);
    // axis: use the declared cylinder axis, else the longest dimension
    const order = [
      { ax: 'x' as const, len: s.w, r: Math.max(s.d, s.h) / 2 },
      { ax: 'y' as const, len: s.d, r: Math.max(s.w, s.h) / 2 },
      { ax: 'z' as const, len: s.h, r: Math.max(s.w, s.d) / 2 },
    ];
    const axis = order.find((o) => o.ax === (def.axis ?? '')) ?? order.reduce((a, b) => (b.len > a.len ? b : a));
    const r = axis.r;
    const c = Math.cos(obb.yaw), sn = Math.sin(obb.yaw);
    const N = 24;
    const ring = (t: number) => {
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const u = Math.cos(a) * r;
        const v = Math.sin(a) * r;
        let p: Vec3;
        if (axis.ax === 'x') {
          const lx = t, ly = u, lz = v;
          p = { x: obb.c.x + lx * c - ly * sn, y: obb.c.y + lx * sn + ly * c, z: obb.c.z + lz };
        } else if (axis.ax === 'y') {
          const lx = u, ly = t, lz = v;
          p = { x: obb.c.x + lx * c - ly * sn, y: obb.c.y + lx * sn + ly * c, z: obb.c.z + lz };
        } else {
          const lx = u, ly = v, lz = t;
          p = { x: obb.c.x + lx * c - ly * sn, y: obb.c.y + lx * sn + ly * c, z: obb.c.z + lz };
        }
        pts.push(project(p));
      }
      return pts;
    };
    const halfLen = axis.len / 2;
    const ringA = ring(-halfLen);
    const ringB = ring(halfLen);
    const hull = convexHull([...ringA, ...ringB]);

    // Body: a set of longitudinal strips, each shaded by its surface normal opposite the light.
    // The light comes from the upper-left-front, so the left/top of a tube catches a sheen.
    const LIGHT = { x: -0.55, y: -0.45, z: 0.7 };
    const normalAt = (theta: number): Vec3 => {
      const u = Math.cos(theta), v = Math.sin(theta);
      if (axis.ax === 'x') return { x: 0, y: u, z: v };
      if (axis.ax === 'y') return { x: u, y: 0, z: v };
      return { x: u, y: v, z: 0 };
    };
    const endScreens: { p: { x: number; y: number } }[] = [];
    const stripCount = 20;
    for (let i = 0; i < stripCount; i++) {
      const t0 = (i / stripCount) * Math.PI * 2;
      const t1 = ((i + 1) / stripCount) * Math.PI * 2;
      const n0 = normalAt(t0);
      const n1 = normalAt(t1);
      const nm = { x: (n0.x + n1.x) / 2, y: (n0.y + n1.y) / 2, z: (n0.z + n1.z) / 2 };
      const lum = Math.max(-1, Math.min(1, nm.x * LIGHT.x + nm.y * LIGHT.y + nm.z * LIGHT.z));
      const color = shade(base, lum * 0.34 + 0.02);
      const pa0 = this.pointOnCyl(obb, axis.ax, -halfLen, Math.cos(t0) * r, Math.sin(t0) * r);
      const pa1 = this.pointOnCyl(obb, axis.ax, -halfLen, Math.cos(t1) * r, Math.sin(t1) * r);
      const pb0 = this.pointOnCyl(obb, axis.ax, halfLen, Math.cos(t0) * r, Math.sin(t0) * r);
      const pb1 = this.pointOnCyl(obb, axis.ax, halfLen, Math.cos(t1) * r, Math.sin(t1) * r);
      const quad = [project(pa0), project(pa1), project(pb1), project(pb0)];
      g.poly(flat(quad)).fill({ color });
    }
    // silhouette outline over the strips
    g.poly(flat(hull)).stroke({ width: 0.9 * w, color: shade(base, -0.42), alpha: 0.85, join: 'round' });

    // Visible end cap: evaluate which ring's axis end points toward the camera (+x+y+z view).
    const axisWorldDir: Vec3 = axis.ax === 'x' ? { x: c, y: sn, z: 0 } : axis.ax === 'y' ? { x: -sn, y: c, z: 0 } : { x: 0, y: 0, z: 1 };
    const facing = axisWorldDir.x + axisWorldDir.y + axisWorldDir.z;
    const capRing = facing >= 0 ? ringB : ringA;
    const capBase = facing >= 0 ? halfLen : -halfLen;
    // Only draw a cap when the tube is thick enough on screen to read.
    if (r * w * 2 > 2.5) {
      const capShaded = stripCount;
      for (let i = 0; i < 16; i++) {
        const t0 = (i / 16) * Math.PI * 2;
        const t1 = ((i + 1) / 16) * Math.PI * 2;
        const n0 = normalAt(t0);
        const nm = { x: n0.x + normalAt(t1).x, y: n0.y + normalAt(t1).y, z: n0.z + normalAt(t1).z };
        const lum = (nm.x * LIGHT.x + nm.y * LIGHT.y + nm.z * LIGHT.z) / 2;
        const p0 = project(this.pointOnCyl(obb, axis.ax, capBase, Math.cos(t0) * r, Math.sin(t0) * r));
        const p1 = project(this.pointOnCyl(obb, axis.ax, capBase, Math.cos(t1) * r, Math.sin(t1) * r));
        const center = project(this.pointOnCyl(obb, axis.ax, capBase, 0, 0));
        g.poly(flat([center, p0, p1])).fill({ color: shade(base, lum * 0.22 + 0.16) });
      }
      g.poly(flat(capRing)).stroke({ width: 0.9 * w, color: shade(base, -0.34), alpha: 0.9, join: 'round' });
      // hollow bore for larger tubes
      if (r > 14) {
        const inner = this.scaleRing(capRing, (r - Math.max(2, r * 0.24)) / r);
        g.poly(flat(inner)).fill({ color: shade(base, -0.42), alpha: 0.6 });
      }
    }
  }

  private pointOnCyl(obb: OBB, ax: 'x' | 'y' | 'z', t: number, u: number, v: number): Vec3 {
    const c = Math.cos(obb.yaw), s = Math.sin(obb.yaw);
    if (ax === 'x') return { x: obb.c.x + t * c - u * s, y: obb.c.y + t * s + u * c, z: obb.c.z + v };
    if (ax === 'y') return { x: obb.c.x + u * c - t * s, y: obb.c.y + u * s + t * c, z: obb.c.z + v };
    return { x: obb.c.x + u * c - v * s, y: obb.c.y + u * s + v * c, z: obb.c.z + t };
  }

  private scaleRing(ring: { x: number; y: number }[], f: number) {
    const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length;
    const cy = ring.reduce((s, p) => s + p.y, 0) / ring.length;
    return ring.map((p) => ({ x: cx + (p.x - cx) * f, y: cy + (p.y - cy) * f }));
  }

  private drawEntityOverlays(g: Graphics, e: Entity, def: PartDef, obb: OBB, st: RenderState, w: number) {
    g.clear();
    const sel = st.selection.includes(e.uid);
    const bad = st.interfering.has(e.uid);
    if (sel) {
      const sil = entitySilhouette(e, def, 3);
      g.poly(flat(sil)).stroke({ width: 2.6 * w, color: 0xe7a94a, alpha: 1, join: 'round' });
      g.poly(flat(sil)).stroke({ width: 8 * w, color: 0xe7a94a, alpha: 0.16, join: 'round' });
    }
    if (bad) {
      const sil = entitySilhouette(e, def, 4);
      g.poly(flat(sil)).stroke({ width: 3 * w, color: 0xff5a52, alpha: 1, join: 'round' });
      g.poly(flat(sil)).fill({ color: 0xff5a52, alpha: 0.14 });
    }
    if (sel && st.showPorts) {
      for (const p of def.ports) {
        const yaw = obb.yaw;
        const c = Math.cos(yaw), s = Math.sin(yaw);
        const wp = {
          x: e.pos.x + p.offset.x * c - p.offset.y * s,
          y: e.pos.y + p.offset.x * s + p.offset.y * c,
          z: e.pos.z + p.offset.z,
        };
        const sp = project(wp);
        const isPin = p.kind === 'pin';
        g.circle(sp.x, sp.y, (isPin ? 7 : 9) * w)
          .fill({ color: isPin ? 0x6fd3a0 : 0x7fb6e8, alpha: 0.95 })
          .stroke({ width: 1.6 * w, color: 0x0e151d, alpha: 0.8 });
      }
    }
  }

  private drawOverlays(_st: RenderState) {
    // per-entity overlays are drawn inside syncEntities; screen overlays in drawGizmo
  }

  private drawGizmo(st: RenderState) {
    const g = this.gizmoGfx;
    g.clear();
    for (const t of this.gizmoText) t.destroy();
    this.gizmoText = [];
    if (!st.gizmo || st.dragging) {
      if (st.snapHint) this.drawSnapHint(st);
      return;
    }
    const { center, axis, axisY, z, rotate } = st.gizmo;
    const hi = st.gizmoHover;

    // rotate ring
    const ringHi = hi === 'rot';
    g.circle(rotate.x, rotate.y, rotate.r)
      .stroke({ width: ringHi ? 2.6 : 1.4, color: ringHi ? 0xe7a94a : 0x8fa4bb, alpha: ringHi ? 1 : 0.45 });
    g.circle(rotate.x, rotate.y - rotate.r, 4.5).fill({ color: ringHi ? 0xe7a94a : 0x8fa4bb });

    // center dot
    g.circle(center.x, center.y, 5).fill({ color: 0xf2f5f8, alpha: 0.9 }).stroke({ width: 1.5, color: 0x0e151d });

    const arrow = (to: { x: number; y: number }, color: number, key: string, label: string) => {
      const on = hi === key;
      const wdt = on ? 3.4 : 2.2;
      g.moveTo(center.x, center.y).lineTo(to.x, to.y).stroke({ width: wdt, color, alpha: on ? 1 : 0.85 });
      const dx = to.x - center.x, dy = to.y - center.y;
      const l = Math.hypot(dx, dy) || 1;
      const ux = dx / l, uy = dy / l;
      const tip = { x: to.x + ux * 10, y: to.y + uy * 10 };
      const px = -uy, py = ux;
      g.poly([
        tip.x, tip.y,
        to.x + px * 5.5 - ux * 2, to.y + py * 5.5 - uy * 2,
        to.x - px * 5.5 - ux * 2, to.y - py * 5.5 - uy * 2,
      ]).fill({ color });
      // hit disc for easier grabbing
      g.circle(to.x + ux * 6, to.y + uy * 6, 11).fill({ color: 0xffffff, alpha: 0.001 });
      const t = new Text({ text: label, style: { fontFamily: 'Segoe UI, system-ui', fontSize: 11, fill: on ? 0xffffff : color, fontWeight: '700' } });
      t.anchor.set(0.5);
      t.position.set(to.x + ux * 18, to.y + uy * 14);
      this.gizmoText.push(t);
      this.screenLayer.addChild(t);
    };
    arrow(axis, 0xd9664f, 'x', 'X');
    arrow(axisY, 0x62b07a, 'y', 'Y');
    arrow(z, 0x6aa8e0, 'z', 'Z');

    if (st.snapHint) this.drawSnapHint(st);
  }

  private drawSnapHint(st: RenderState) {
    const h = st.snapHint!;
    const g = this.gizmoGfx;
    const cam = st.camera;
    const p = (v: Vec3) => {
      const q = project(v);
      return { x: q.x * cam.zoom + cam.x, y: q.y * cam.zoom + cam.y };
    };
    const a = p(h.portWorld);
    const b = p(h.socketWorld);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1.6, color: 0x6fd3a0, alpha: 0.9 });
    g.circle(b.x, b.y, 11).stroke({ width: 2, color: 0x6fd3a0, alpha: 0.95 });
    g.circle(b.x, b.y, 4).fill({ color: 0x6fd3a0 });
    g.circle(a.x, a.y, 6).fill({ color: 0x6fd3a0, alpha: 0.85 });
    const t = new Text({
      text: `${h.label}  ${Math.round(h.distance)}mm`,
      style: { fontFamily: 'Segoe UI, system-ui', fontSize: 11, fill: 0x0b1116, fontWeight: '600' },
    });
    t.anchor.set(0, 1);
    t.position.set(b.x + 14, b.y - 8);
    g.roundRect(b.x + 8, b.y - 32, t.width + 14, 22, 4).fill({ color: 0x6fd3a0, alpha: 0.95 });
    this.screenLayer.addChild(t);
    this.gizmoText.push(t);
  }

  private drawMarquee(st: RenderState) {
    const g = this.marqueeGfx;
    g.clear();
    if (!st.marquee) return;
    const { x, y, w, h } = st.marquee;
    g.rect(x, y, w, h).fill({ color: 0x4a9eff, alpha: 0.1 }).stroke({ width: 1.2, color: 0x6fb3ff, alpha: 0.95 });
  }
}

function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const pts = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (pts.length <= 2) return pts;
  const cross = (o: any, a: any, b: any) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: any[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: any[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
