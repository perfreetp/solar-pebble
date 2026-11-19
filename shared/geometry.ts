import type {
  Aisle,
  Box3,
  BOMData,
  BOMRow,
  Entity,
  InterferencePair,
  PartDef,
  Rect2,
  SceneData,
  Size3,
  TopRect,
  TopViewData,
  Vec3,
} from './types';
import { CATEGORY_LABEL, CATEGORY_COLOR } from './types';
import { PART_MAP, partWeight, partVolumeM3 } from './parts';

export const COS30 = Math.sqrt(3) / 2;
const DEG = Math.PI / 180;

export const vec = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const addV = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const subV = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scaleV = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const len2 = (a: Vec3) => Math.hypot(a.x, a.y);

export function roundTo(v: number, step: number): number {
  return Math.round(v / step) * step;
}

/** Screen-space isometric projection in mm. +x → right-down, +y → left-down, +z → up. */
export function project(p: Vec3): { x: number; y: number } {
  return { x: (p.x - p.y) * COS30, y: (p.x + p.y) * 0.5 - p.z };
}

/**
 * Ray through a projected point, marching from above the scene downward — the same
 * direction the isometric camera looks. Anchor at z = 10000 so t grows into the scene
 * and the smallest t is the front-most (nearest-camera) surface.
 */
export function screenRay(u: number, v: number): { o: Vec3; dir: Vec3 } {
  const k = u / Math.sqrt(3);
  const ZTOP = 10000;
  const d = 1 / Math.sqrt(3);
  return { o: { x: v + ZTOP + k, y: v + ZTOP - k, z: ZTOP }, dir: { x: -d, y: -d, z: -d } };
}

export function entitySize(e: Entity, def: PartDef): Size3 {
  return e.size ?? def.size;
}

export function entityYaw(e: Entity): number {
  return (e.rot || 0) * DEG;
}

export interface OBB {
  c: Vec3;
  h: Vec3;
  yaw: number;
}

export function entityOBB(e: Entity, def: PartDef): OBB {
  const s = entitySize(e, def);
  return {
    c: { x: e.pos.x, y: e.pos.y, z: e.pos.z + s.h / 2 },
    h: { x: s.w / 2, y: s.d / 2, z: s.h / 2 },
    yaw: entityYaw(e),
  };
}

export function obbCorners(o: OBB): Vec3[] {
  const c = Math.cos(o.yaw);
  const s = Math.sin(o.yaw);
  const out: Vec3[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const lx = sx * o.h.x;
        const ly = sy * o.h.y;
        out.push({ x: o.c.x + lx * c - ly * s, y: o.c.y + lx * s + ly * c, z: o.c.z + sz * o.h.z });
      }
    }
  }
  return out;
}

/** Footprint (xz plane) corners of an OBB in world coords. */
export function footprint(o: OBB, inset = 0): { x: number; y: number }[] {
  const c = Math.cos(o.yaw);
  const s = Math.sin(o.yaw);
  const hx = Math.max(0, o.h.x - inset);
  const hy = Math.max(0, o.h.y - inset);
  return [
    [-hx, -hy],
    [hx, -hy],
    [hx, hy],
    [-hx, hy],
  ].map(([lx, ly]) => ({ x: o.c.x + lx * c - ly * s, y: o.c.y + lx * s + ly * c }));
}

export function polygonBounds(pts: { x: number; y: number }[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, d: maxY - minY };
}

export function polygonArea(pts: { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function cross2(o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Sutherland–Hodgman clip of subject polygon by a convex clip polygon. */
export function clipPolygon(
  subject: { x: number; y: number }[],
  clip: { x: number; y: number }[],
): { x: number; y: number }[] {
  let out = subject;
  const clockwise = polygonSignedArea(clip) > 0;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const inside = (p: { x: number; y: number }) => {
      const c = cross2(a, b, p);
      return clockwise ? c >= -1e-9 : c <= 1e-9;
    };
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      const curIn = inside(cur);
      const prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) out.push(lineIntersect(prev, cur, a, b));
        out.push(cur);
      } else if (prevIn) {
        out.push(lineIntersect(prev, cur, a, b));
      }
    }
  }
  return out;
}

function polygonSignedArea(pts: { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function lineIntersect(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number },
) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return { x: p2.x, y: p2.y };
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
}

export function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
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

export function rayOBBDistance(o: Vec3, dir: Vec3, obb: OBB): number | null {
  const c = Math.cos(-obb.yaw);
  const s = Math.sin(-obb.yaw);
  const ox = o.x - obb.c.x;
  const oy = o.y - obb.c.y;
  const oz = o.z - obb.c.z;
  const lo = { x: ox * c - oy * s, y: ox * s + oy * c, z: oz };
  const ld = { x: dir.x * c - dir.y * s, y: dir.x * s + dir.y * c, z: dir.z };
  let tmin = -Infinity;
  let tmax = Infinity;
  const axes: [number, number, number][] = [
    [lo.x, ld.x, obb.h.x],
    [lo.y, ld.y, obb.h.y],
    [lo.z, ld.z, obb.h.z],
  ];
  for (const [op, dp, hh] of axes) {
    if (Math.abs(dp) < 1e-12) {
      if (Math.abs(op) > hh) return null;
    } else {
      let t1 = (-hh - op) / dp;
      let t2 = (hh - op) / dp;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  return tmin >= 0 ? tmin : tmax >= 0 ? 0 : null;
}

export interface PickHit {
  uid: string;
  t: number;
}

/** All entities under a projected screen point (mm), nearest first — enables picking occluded parts. */
export function pickAll(scene: SceneData, px: number, py: number): PickHit[] {
  const { o, dir } = screenRay(px, py);
  const hits: PickHit[] = [];
  for (const e of scene.entities) {
    const def = PART_MAP[e.defId];
    if (!def || e.hidden) continue;
    if (scene.layers?.[def.category]?.visible === false) continue;
    const t = rayOBBDistance(o, dir, entityOBB(e, def));
    if (t != null) hits.push({ uid: e.uid, t });
  }
  return hits.sort((a, b) => a.t - b.t);
}

export function polygonIntersectsRect(pts: { x: number; y: number }[], r: Rect2): boolean {
  const rectPts = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.d },
    { x: r.x, y: r.y + r.d },
  ];
  const axes: { x: number; y: number }[] = [];
  for (const poly of [pts, rectPts]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      axes.push({ x: -(b.y - a.y), y: b.x - a.x });
    }
  }
  for (const ax of axes) {
    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (const p of pts) {
      const v = p.x * ax.x + p.y * ax.y;
      minA = Math.min(minA, v); maxA = Math.max(maxA, v);
    }
    for (const p of rectPts) {
      const v = p.x * ax.x + p.y * ax.y;
      minB = Math.min(minB, v); maxB = Math.max(maxB, v);
    }
    if (maxA < minB || maxB < minA) return false;
  }
  return true;
}

/** Projected silhouette of an entity for marquee selection. */
export function entitySilhouette(e: Entity, def: PartDef, pad = 0): { x: number; y: number }[] {
  const obb = entityOBB(e, def);
  const pts = obbCorners(obb).map((p) => project(p));
  if (pad > 0) {
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    return pts.map((p) => {
      const dx = p.x - cx, dy = p.y - cy;
      const l = Math.hypot(dx, dy) || 1;
      return { x: p.x + (dx / l) * pad, y: p.y + (dy / l) * pad };
    });
  }
  return convexHull(pts);
}

export function entityDepth(e: Entity, def: PartDef): number {
  const obb = entityOBB(e, def);
  return (obb.c.x + obb.c.y + obb.c.z) / Math.sqrt(3);
}

export function jointKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function makeJointSet(scene: SceneData): Set<string> {
  const set = new Set<string>();
  for (const j of scene.joints) set.add(jointKey(j.a, j.b));
  return set;
}

/** Pairwise OBB interference within the scene, skipping connected parts. */
export function computeInterference(scene: SceneData): InterferencePair[] {
  const joints = makeJointSet(scene);
  const list: InterferencePair[] = [];
  const ents = scene.entities.filter((e) => {
    const def = PART_MAP[e.defId];
    return def && !e.hidden && scene.layers?.[def.category]?.visible !== false;
  });
  // Broad phase: precompute AABBs once, then skip pairs whose boxes can't touch.
  const boxes = ents.map((e) => {
    const def = PART_MAP[e.defId];
    const o = entityOBB(e, def);
    const fp = polygonBounds(footprint(o));
    return { aabb: fp, zMin: o.c.z - o.h.z, zMax: o.c.z + o.h.z };
  });
  for (let i = 0; i < ents.length; i++) {
    for (let k = i + 1; k < ents.length; k++) {
      const a = ents[i];
      const b = ents[k];
      if (joints.has(jointKey(a.uid, b.uid))) continue;
      const ba = boxes[i], bb = boxes[k];
      // AABB reject (with a small tolerance, same as the z test below)
      if (ba.zMax - bb.zMin <= 0.5 || bb.zMax - ba.zMin <= 0.5) continue;
      if (ba.aabb.maxX < bb.aabb.minX || bb.aabb.maxX < ba.aabb.minX) continue;
      if (ba.aabb.maxY < bb.aabb.minY || bb.aabb.maxY < ba.aabb.minY) continue;
      const da = PART_MAP[a.defId];
      const db = PART_MAP[b.defId];
      const oa = entityOBB(a, da);
      const ob = entityOBB(b, db);
      const zOver = Math.min(oa.c.z + oa.h.z, ob.c.z + ob.h.z) - Math.max(oa.c.z - oa.h.z, ob.c.z - ob.h.z);
      if (zOver <= 0.5) continue;
      const clipped = clipPolygon(footprint(oa), footprint(ob));
      if (clipped.length < 3) continue;
      const area = polygonArea(clipped);
      if (area <= 1) continue;
      list.push({
        a: a.uid,
        b: b.uid,
        nameA: `${da.name} ${da.partNo}`,
        nameB: `${db.name} ${db.partNo}`,
        overlap: { x: 0, y: 0, z: zOver },
        volume: (area * zOver) / 1e9,
        depth: Math.min(zOver, Math.sqrt(area)),
      });
    }
  }
  return list.sort((x, y) => y.volume - x.volume);
}

export function makeBOM(scene: SceneData): BOMData {
  const map = new Map<string, BOMRow>();
  for (const e of scene.entities) {
    const def = PART_MAP[e.defId];
    if (!def) continue;
    const size = entitySize(e, def);
    const weight = partWeight(def, size);
    const vol = partVolumeM3(size);
    let row = map.get(e.defId);
    if (!row) {
      row = {
        defId: def.id,
        partNo: def.partNo,
        name: def.name,
        spec: def.spec,
        category: def.category,
        material: def.material,
        qty: 0,
        unitWeight: weight,
        totalWeight: 0,
        unitVolume: vol,
        totalVolume: 0,
        color: e.color ?? def.color,
      };
      map.set(e.defId, row);
    }
    row.qty++;
    row.totalWeight += weight;
    row.totalVolume += vol;
  }
  const rows = [...map.values()].sort((a, b) => a.partNo.localeCompare(b.partNo));
  const byCategoryMap = new Map<string, { category: any; label: string; qty: number; weight: number }>();
  for (const r of rows) {
    let c = byCategoryMap.get(r.category);
    if (!c) {
      c = { category: r.category, label: CATEGORY_LABEL[r.category], qty: 0, weight: 0 };
      byCategoryMap.set(r.category, c);
    }
    c.qty += r.qty;
    c.weight += r.totalWeight;
  }
  return {
    rows,
    totalParts: rows.reduce((s, r) => s + r.qty, 0),
    totalTypes: rows.length,
    totalWeight: rows.reduce((s, r) => s + r.totalWeight, 0),
    totalVolume: rows.reduce((s, r) => s + r.totalVolume, 0),
    byCategory: [...byCategoryMap.values()],
  };
}

/** Top-view wireframe with aisle detection between part clusters. */
export function computeTopView(scene: SceneData, opts?: { minAisle?: number; walkway?: number; clusterGap?: number; maxAisle?: number }): TopViewData {
  const minAisle = opts?.minAisle ?? 800;
  const walkway = opts?.walkway ?? 900;
  const clusterGap = opts?.clusterGap ?? 280;
  const maxAisle = opts?.maxAisle ?? 3200;
  const rects: TopRect[] = [];
  for (const e of scene.entities) {
    const def = PART_MAP[e.defId];
    if (!def || e.hidden) continue;
    if (scene.layers?.[def.category]?.visible === false) continue;
    const obb = entityOBB(e, def);
    const size = entitySize(e, def);
    const fp = footprint(obb);
    const b = polygonBounds(fp);
    rects.push({
      uid: e.uid,
      defId: def.id,
      name: def.name,
      partNo: def.partNo,
      category: def.category,
      color: e.color ?? def.color,
      x: b.minX,
      y: b.minY,
      w: b.w,
      d: b.d,
      rot: e.rot || 0,
      z: e.pos.z,
      h: size.h,
      corners: fp,
    });
  }
  if (!rects.length) {
    return { rects, aisles: [], minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, depth: 0 };
  }

  // Cluster footprints by proximity so a bundle of tubes reads as one object.
  const boxes = rects.map((r) => ({ minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.d }));
  const parent = boxes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const CLUSTER_GAP = clusterGap;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const gapX = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
      const gapY = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY));
      if (gapX <= CLUSTER_GAP && gapY <= CLUSTER_GAP) union(i, j);
    }
  }
  const clusterMap = new Map<number, { minX: number; minY: number; maxX: number; maxY: number; n: number }>();
  for (let i = 0; i < boxes.length; i++) {
    const root = find(i);
    const b = boxes[i];
    let c = clusterMap.get(root);
    if (!c) {
      c = { ...b, n: 0 };
      clusterMap.set(root, c);
    } else {
      c.minX = Math.min(c.minX, b.minX);
      c.minY = Math.min(c.minY, b.minY);
      c.maxX = Math.max(c.maxX, b.maxX);
      c.maxY = Math.max(c.maxY, b.maxY);
    }
    c.n++;
  }
  const clusters = [...clusterMap.values()];

  const aisles: Aisle[] = [];
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const a = clusters[i], b = clusters[j];
      const overlapY0 = Math.max(a.minY, b.minY);
      const overlapY1 = Math.min(a.maxY, b.maxY);
      const overlapX0 = Math.max(a.minX, b.minX);
      const overlapX1 = Math.min(a.maxX, b.maxX);
      // Vertical corridor: separated in x, aligned in y.
      if (overlapY1 - overlapY0 > 50) {
        const gap = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
        if (gap >= 320 && gap <= maxAisle) {
          const x1 = Math.min(a.maxX, b.maxX);
          aisles.push({
            dir: 'v',
            width: gap,
            x1,
            y1: overlapY0,
            x2: x1 + gap,
            y2: overlapY1,
            labelX: x1 + gap / 2,
            labelY: (overlapY0 + overlapY1) / 2,
            narrow: gap < minAisle,
          });
        }
      }
      if (overlapX1 - overlapX0 > 50) {
        const gap = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY));
        if (gap >= 320 && gap <= maxAisle) {
          const y1 = Math.min(a.maxY, b.maxY);
          aisles.push({
            dir: 'h',
            width: gap,
            x1: overlapX0,
            y1,
            x2: overlapX1,
            y2: y1 + gap,
            labelX: (overlapX0 + overlapX1) / 2,
            labelY: y1 + gap / 2,
            narrow: gap < minAisle,
          });
        }
      }
    }
  }

  const b = boxes.reduce(
    (acc, r) => ({
      minX: Math.min(acc.minX, r.minX),
      minY: Math.min(acc.minY, r.minY),
      maxX: Math.max(acc.maxX, r.maxX),
      maxY: Math.max(acc.maxY, r.maxY),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );

  // Outer working walkway, drawn as a labelled offset border.
  aisles.push({
    dir: 'h',
    width: walkway,
    x1: b.minX,
    y1: b.maxY,
    x2: b.maxX,
    y2: b.maxY + walkway,
    labelX: (b.minX + b.maxX) / 2,
    labelY: b.maxY + walkway / 2,
    narrow: false,
  });
  aisles.push({
    dir: 'v',
    width: walkway,
    x1: b.maxX,
    y1: b.minY,
    x2: b.maxX + walkway,
    y2: b.maxY,
    labelX: b.maxX + walkway / 2,
    labelY: (b.minY + b.maxY) / 2,
    narrow: false,
  });

  return {
    rects,
    aisles,
    minX: b.minX - walkway,
    minY: b.minY - walkway,
    maxX: b.maxX + walkway,
    maxY: b.maxY + walkway + 350,
    width: b.maxX - b.minX,
    depth: b.maxY - b.minY,
  };
}

export interface PortSnapHit {
  movingUid: string;
  targetUid: string;
  portWorld: Vec3;
  socketWorld: Vec3;
  distance: number;
  label: string;
  yawTarget: number | null;
}

/** Find the nearest pin→socket alignment while dragging. */
export function findPortSnap(
  scene: SceneData,
  movingUids: Set<string>,
  radius = 120,
): PortSnapHit | null {
  const others = scene.entities.filter((e) => !movingUids.has(e.uid));
  let best: (PortSnapHit & { apply: { dx: number; dy: number; dz: number } }) | null = null;
  for (const m of scene.entities) {
    if (!movingUids.has(m.uid)) continue;
    const md = PART_MAP[m.defId];
    if (!md) continue;
    const mObb = entityOBB(m, md);
    for (const mp of md.ports) {
      const pw = portWorld(m, mp.offset);
      for (const t of others) {
        const td = PART_MAP[t.defId];
        if (!td) continue;
        for (const sp of td.ports) {
          if (!(mp.kind === 'pin' && sp.kind === 'socket') && !(mp.kind === 'socket' && sp.kind === 'pin')) continue;
          if (Math.abs(mp.dia - sp.dia) > 6) continue;
          const sw = portWorld(t, sp.offset);
          const dist = Math.hypot(pw.x - sw.x, pw.y - sw.y, pw.z - sw.z);
          if (dist > radius) continue;
          if (!best || dist < best.distance) {
            // Rotate the moving part so its port axis follows the socket axis.
            let yawTarget: number | null = null;
            if (mp.axis !== 'z' || sp.axis !== 'z') {
              const sAxis = axisWorld(sp.axis, entityYaw(t));
              const mAxisLocal = mp.axis;
              const angle = Math.atan2(sAxis.y, sAxis.x);
              const local = mAxisLocal === 'x' ? 0 : mAxisLocal === 'y' ? Math.PI / 2 : 0;
              let target = ((angle - local) / DEG) % 360;
              target = Math.round(target / 15) * 15;
              if (target > 180) target -= 360;
              if (target < -180) target += 360;
              if (Math.abs(target - (m.rot || 0)) > 0.1) yawTarget = target;
            }
            best = {
              movingUid: m.uid,
              targetUid: t.uid,
              portWorld: pw,
              socketWorld: sw,
              distance: dist,
              label: `${md.name} ↔ ${td.name}`,
              yawTarget,
              apply: { dx: sw.x - pw.x, dy: sw.y - pw.y, dz: sw.z - pw.z },
            };
          }
        }
      }
    }
  }
  return best;
}

export function axisWorld(axis: 'x' | 'y' | 'z', yaw: number): Vec3 {
  if (axis === 'x') return { x: Math.cos(yaw), y: Math.sin(yaw), z: 0 };
  if (axis === 'y') return { x: -Math.sin(yaw), y: Math.cos(yaw), z: 0 };
  return { x: 0, y: 0, z: 1 };
}

export function portWorld(e: Entity, offset: Vec3): Vec3 {
  const yaw = entityYaw(e);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return {
    x: e.pos.x + offset.x * c - offset.y * s,
    y: e.pos.y + offset.x * s + offset.y * c,
    z: e.pos.z + offset.z,
  };
}

/** Surface height (ground or top of any part underneath) nearest to the dropped pose. */
export function supportHeight(
  scene: SceneData,
  uid: string,
  pos: Vec3,
  rot: number,
  def: PartDef,
  maxLift = 400,
): { z: number; on: string | null } {
  const size = entitySize({ pos, rot } as Entity, def);
  const obb: OBB = {
    c: { x: pos.x, y: pos.y, z: pos.z + size.h / 2 },
    h: { x: size.w / 2, y: size.d / 2, z: size.h / 2 },
    yaw: (rot * DEG),
  };
  const mine = footprint(obb);
  let bestZ = 0;
  let on: string | null = null;
  let bestDist = Math.abs(pos.z - 0);
  for (const e of scene.entities) {
    if (e.uid === uid) continue;
    const d = PART_MAP[e.defId];
    if (!d || e.hidden) continue;
    if (scene.layers?.[d.category]?.visible === false) continue;
    const o = entityOBB(e, d);
    const top = o.c.z + o.h.z;
    if (top > pos.z + maxLift) continue;
    const clipped = clipPolygon(mine, footprint(o));
    if (clipped.length < 3) continue;
    const area = polygonArea(clipped);
    const myArea = polygonArea(mine);
    if (area < Math.min(2000, myArea * 0.05)) continue;
    const dist = Math.abs(top - pos.z);
    if (dist < bestDist) {
      bestDist = dist;
      bestZ = top;
      on = e.uid;
    }
  }
  return { z: bestZ, on };
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function boxCenter(e: Entity, def: PartDef): Vec3 {
  const s = entitySize(e, def);
  return { x: e.pos.x, y: e.pos.y, z: e.pos.z + s.h / 2 };
}

export function box3Of(e: Entity, def: PartDef): Box3 {
  const b = polygonBounds(footprint(entityOBB(e, def)));
  const s = entitySize(e, def);
  return {
    min: { x: b.minX, y: b.minY, z: e.pos.z },
    max: { x: b.maxX, y: b.maxY, z: e.pos.z + s.h },
  };
}

export function colorFor(e: Entity, def: PartDef): string {
  return e.color ?? def.color ?? CATEGORY_COLOR[def.category];
}
