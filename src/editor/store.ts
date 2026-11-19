import { createRoot, createSignal, createMemo, batch } from 'solid-js';
import { createStore, produce } from 'solid-js/store';import type {
  BOMData,
  Entity,
  InterferencePair,
  LayerId,
  PartDef,
  SceneData,
  Size3,
  TopViewData,
  Vec3,
} from '../../shared/types';
import { PART_MAP } from '../../shared/parts';
import {
  clipPolygon,
  colorFor,
  computeInterference,
  computeTopView,
  entityOBB,
  entitySilhouette,
  entitySize,
  findPortSnap,
  footprint,
  makeBOM,
  polygonArea,
  polygonIntersectsRect,
  portWorld,
  project,
  roundTo,
  screenRay,
  supportHeight,
  clamp,
  type OBB,
  type PortSnapHit,
} from '../../shared/geometry';
import { buildStarterScene, DEFAULT_LAYERS, cloneScene, uid } from '../../shared/scene';

export type Tool = 'select';
export type DragMode = 'none' | 'pending' | 'move' | 'axis' | 'rotate' | 'marquee' | 'pan';

export interface Toast {
  id: number;
  kind: 'info' | 'warn' | 'ok';
  text: string;
}

export interface MarqueeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DragState {
  mode: DragMode;
  axis?: 'x' | 'y' | 'z';
  startScreen: { x: number; y: number };
  startMM: { x: number; y: number };
  /** Base z of the dragged group (mm). */
  planeZ: number;
  originals: Map<string, { pos: Vec3; rot: number }>;
  marquee: MarqueeRect | null;
  startAngle: number;
  baseRot: number;
  moved: boolean;
  colliding: boolean;
}

const emptyDrag = (): DragState => ({
  mode: 'none',
  startScreen: { x: 0, y: 0 },
  startMM: { x: 0, y: 0 },
  planeZ: 0,
  originals: new Map(),
  marquee: null,
  startAngle: 0,
  baseRot: 0,
  moved: false,
  colliding: false,
});

export const [scene, setScene] = createStore<SceneData>(buildStarterScene());
export const [selection, setSelection] = createSignal<string[]>([]);
export const [hoverUid, setHoverUid] = createSignal<string | null>(null);
export const [camera, setCamera] = createSignal({ zoom: 0.26, x: 0, y: 0 });
export const [drag, setDrag] = createSignal<DragState>(emptyDrag());
export const [snapHint, setSnapHint] = createSignal<PortSnapHit | null>(null);
export const [dropHint, setDropHint] = createSignal<{ x: number; y: number; z: number; on: string | null } | null>(null);
export const [toasts, setToasts] = createSignal<Toast[]>([]);
export const [gizmoHover, setGizmoHover] = createSignal<string | null>(null);
export const [snapGrid, setSnapGrid] = createSignal(true);
export const [snapAngle, setSnapAngle] = createSignal(true);
export const [snapPorts, setSnapPorts] = createSignal(true);
export const [interferingUids, setInterferingUids] = createSignal<Set<string>>(new Set());
export const [undoSeq, setUndoSeq] = createSignal(0);
export const [view, setView] = createSignal<'iso' | 'top'>('iso');
export const [dirtySinceSave, setDirtySinceSave] = createSignal(false);

// Memos live in a detached root so they persist for the app's lifetime.
let activeUidMemo!: () => string | null;
let activeEntityMemo!: () => Entity | null;
let bomMemo!: () => BOMData;
let topviewMemo!: () => TopViewData;
let interferenceMemo!: () => InterferencePair[];
createRoot(() => {
  activeUidMemo = createMemo(() => selection().at(-1) ?? null);
  activeEntityMemo = createMemo(() => {
    const id = activeUidMemo();
    return id ? scene.entities.find((e) => e.uid === id) ?? null : null;
  });
  bomMemo = createMemo<BOMData>(() => makeBOM(scene));
  topviewMemo = createMemo<TopViewData>(() => computeTopView(scene));
  interferenceMemo = createMemo<InterferencePair[]>(() => computeInterference(scene));
});

export const activeUid = () => activeUidMemo();
export const activeEntity = () => activeEntityMemo();
export const bomData = () => bomMemo();
export const topviewData = () => topviewMemo();
export const interferenceReport = () => interferenceMemo();

let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info') {
  const id = ++toastId;
  setToasts((t) => [...t, { id, kind, text }]);
  setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
}

const undoStack: string[] = [];
const redoStack: string[] = [];
function snapshot() {
  undoStack.push(JSON.stringify(scene));
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
  setUndoSeq((n) => n + 1);
}
export function undo() {
  const s = undoStack.pop();
  if (!s) return;
  redoStack.push(JSON.stringify(scene));
  const data = JSON.parse(s) as SceneData;
  batch(() => {
    setScene(data);
    setSelection((sel) => sel.filter((id) => data.entities.some((e) => e.uid === id)));
  });
  setUndoSeq((n) => n + 1);
  setDirtySinceSave(true);
}
export function redo() {
  const s = redoStack.pop();
  if (!s) return;
  undoStack.push(JSON.stringify(scene));
  const data = JSON.parse(s) as SceneData;
  batch(() => {
    setScene(data);
    setSelection((sel) => sel.filter((id) => data.entities.some((e) => e.uid === id)));
  });
  setDirtySinceSave(true);
}
export function canUndo() {
  undoSeq();
  return undoStack.length > 0;
}
export function canRedo() {
  undoSeq();
  return redoStack.length > 0;
}
export function markSaved() {
  setDirtySinceSave(false);
}

// ---------- coordinate helpers ----------
export function worldToScreen(p: { x: number; y: number }, cam = camera()): { x: number; y: number } {
  return { x: p.x * cam.zoom + cam.x, y: p.y * cam.zoom + cam.y };
}
export function mmToScreen(p: Vec3, cam = camera()) {
  const q = project(p);
  return { x: q.x * cam.zoom + cam.x, y: q.y * cam.zoom + cam.y };
}
export function screenToGround(sx: number, sy: number, z = 0): { x: number; y: number } {
  const cam = camera();
  const u = (sx - cam.x) / cam.zoom;
  const v = (sy - cam.y) / cam.zoom + z;
  const k = u / (2 * Math.cos(Math.PI / 6));
  return { x: v + k, y: v - k };
}
export function screenToMM(sx: number, sy: number, z: number) {
  return screenToGround(sx, sy, z);
}
export function mmToScreenRect(p: Vec3, cam = camera()) {
  return project(p);
}

export function centerOnScene() {
  const c = viewportSize();
  setCamera({ zoom: 0.28, x: c.w / 2, y: c.h / 2 + 40 });
}

/** Frame the whole scene (all visible entities) in the viewport. */
export function fitToScene() {
  const uids = scene.entities.filter((e) => {
    const d = PART_MAP[e.defId];
    return d && !e.hidden && scene.layers?.[d.category]?.visible !== false;
  });
  if (!uids.length) return;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const e of uids) {
    const d = PART_MAP[e.defId];
    const obb = entityOBB(e, d);
    for (const c of footprint(obb)) {
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
    }
  }
  const pts = [
    project({ x: minX, y: minY, z: 0 }),
    project({ x: maxX, y: minY, z: 0 }),
    project({ x: maxX, y: maxY, z: 0 }),
    project({ x: minX, y: maxY, z: 0 }),
    project({ x: minX, y: minY, z: 1200 }),
    project({ x: maxX, y: maxY, z: 1200 }),
  ];
  const pb = polygonBoundsStatic(pts);
  const vp = viewportSize();
  const z = clamp(Math.min((vp.w - 120) / pb.w, (vp.h - 120) / pb.d), 0.05, 2);
  setCamera({ zoom: z, x: vp.w / 2 - ((pb.minX + pb.maxX) / 2) * z, y: vp.h / 2 - ((pb.minY + pb.maxY) / 2) * z });
}

function polygonBoundsStatic(pts: { x: number; y: number }[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, w: Math.max(1, maxX - minX), d: Math.max(1, maxY - minY) };
}

export const [viewport, setViewport] = createSignal({ w: 1200, h: 800 });
export function viewportSize() {
  return viewport();
}

// ---------- selection ----------
export function selectOnly(uidStr: string) {
  setSelection([uidStr]);
}
export function toggleSelect(uidStr: string) {
  setSelection((sel) => (sel.includes(uidStr) ? sel.filter((x) => x !== uidStr) : [...sel, uidStr]));
}
export function clearSelection() {
  setSelection([]);
}
export function isSelected(uidStr: string) {
  return selection().includes(uidStr);
}

export function entityById(uidStr: string): { ent: Entity; def: PartDef; index: number } | null {
  const index = scene.entities.findIndex((e) => e.uid === uidStr);
  if (index < 0) return null;
  const ent = scene.entities[index];
  const def = PART_MAP[ent.defId];
  if (!def) return null;
  return { ent, def, index };
}

function layerVisible(cat: LayerId) {
  return scene.layers?.[cat]?.visible !== false;
}
function layerLocked(cat: LayerId) {
  return scene.layers?.[cat]?.locked === true;
}
export function isEditable(uidStr: string) {
  const f = entityById(uidStr);
  if (!f) return false;
  return !f.ent.locked && !layerLocked(f.def.category) && layerVisible(f.def.category);
}

/** Hit-test all entities at a screen point, front to back. */
export function pickAt(sx: number, sy: number): string[] {
  const cam = camera();
  const u = (sx - cam.x) / cam.zoom;
  const v = (sy - cam.y) / cam.zoom;
  const { o, dir } = screenRay(u, v);
  const hits: { uid: string; t: number }[] = [];
  for (const ent of scene.entities) {
    const def = PART_MAP[ent.defId];
    if (!def || ent.hidden || !layerVisible(def.category)) continue;
    const obb = entityOBB(ent, def);
    const t = rayOBBDistanceLocal(o, dir, obb);
    if (t != null) hits.push({ uid: ent.uid, t });
  }
  return hits.sort((a, b) => a.t - b.t).map((h) => h.uid);
}

function rayOBBDistanceLocal(o: Vec3, dir: Vec3, obb: OBB): number | null {
  const c = Math.cos(-obb.yaw);
  const s = Math.sin(-obb.yaw);
  const ox = o.x - obb.c.x, oy = o.y - obb.c.y, oz = o.z - obb.c.z;
  const lo = { x: ox * c - oy * s, y: ox * s + oy * c, z: oz };
  const ld = { x: dir.x * c - dir.y * s, y: dir.x * s + dir.y * c, z: dir.z };
  let tmin = -Infinity, tmax = Infinity;
  for (const [op, dp, hh] of [
    [lo.x, ld.x, obb.h.x],
    [lo.y, ld.y, obb.h.y],
    [lo.z, ld.z, obb.h.z],
  ] as const) {
    if (Math.abs(dp) < 1e-12) {
      if (Math.abs(op) > hh) return null;
    } else {
      let t1 = (-hh - op) / dp, t2 = (hh - op) / dp;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin >= 0 ? tmin : tmax >= 0 ? 0 : null;
}

// ---------- collision ----------
function entitiesCollide(a: Entity, da: PartDef, b: Entity, db: PartDef): boolean {
  const oa = entityOBB(a, da);
  const ob = entityOBB(b, db);
  const zOver = Math.min(oa.c.z + oa.h.z, ob.c.z + ob.h.z) - Math.max(oa.c.z - oa.h.z, ob.c.z - ob.h.z);
  if (zOver <= 0.75) return false;
  const clipped = clipPolygon(footprint(oa), footprint(ob));
  if (clipped.length < 3) return false;
  return polygonArea(clipped) > 1;
}

function jointSet() {
  const s = new Set<string>();
  for (const j of scene.joints) s.add(j.a < j.b ? `${j.a}|${j.b}` : `${j.b}|${j.a}`);
  return s;
}

/** Which moving entities currently intersect non-moving geometry. */
function collisionSet(moving: Map<string, Entity>): Set<string> {
  const joints = jointSet();
  const bad = new Set<string>();
  const movingUids = new Set(moving.keys());
  const all = scene.entities.map((e) => moving.get(e.uid) ?? e);
  for (const [uidStr, mv] of moving) {
    const md = PART_MAP[mv.defId];
    if (!md) continue;
    for (const other of all) {
      if (other.uid === uidStr) continue;
      const key = uidStr < other.uid ? `${uidStr}|${other.uid}` : `${other.uid}|${uidStr}`;
      if (joints.has(key)) continue;
      const od = PART_MAP[other.defId];
      if (!od) continue;
      if (entitiesCollide(mv, md, other, od)) {
        bad.add(uidStr);
        if (!movingUids.has(other.uid)) bad.add(other.uid);
      }
    }
  }
  return bad;
}

// ---------- gizmo geometry ----------
export interface GizmoHandles {
  center: { x: number; y: number };
  axis: { x: number; y: number };
  axisY: { x: number; y: number };
  z: { x: number; y: number };
  rotate: { x: number; y: number; r: number };
}

export function selectionBounds() {
  const uids = selection();
  if (!uids.length) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const u of uids) {
    const f = entityById(u);
    if (!f) continue;
    const obb = entityOBB(f.ent, f.def);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const c = Math.cos(obb.yaw), s = Math.sin(obb.yaw);
      const x = obb.c.x + sx * obb.h.x * c - sy * obb.h.y * s;
      const y = obb.c.y + sx * obb.h.x * s + sy * obb.h.y * c;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    minZ = Math.min(minZ, obb.c.z - obb.h.z);
    maxZ = Math.max(maxZ, obb.c.z + obb.h.z);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, minZ, maxX, maxY, maxZ, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, cz: (minZ + maxZ) / 2 };
}

export function gizmoHandles(): GizmoHandles | null {
  const b = selectionBounds();
  if (!b) return null;
  const cam = camera();
  const center = mmToScreen({ x: b.cx, y: b.cy, z: b.maxZ }, cam);
  const len = 72;
  // Screen-projected unit directions of the world axes under the isometric view:
  //   x → (cos30,  0.5),  y → (-cos30, 0.5),  z → (0, -1)
  const c30 = Math.cos(Math.PI / 6);
  return {
    center,
    axis: { x: center.x + c30 * len, y: center.y + 0.5 * len },      // +X
    axisY: { x: center.x - c30 * len, y: center.y + 0.5 * len },     // +Y
    z: { x: center.x, y: center.y - len },                          // +Z
    rotate: { x: center.x, y: center.y, r: 98 },
  };
}

// ---------- mutations ----------
export function addEntity(defId: string, ground: { x: number; y: number; z?: number }, opts?: { select?: boolean }) {
  const def = PART_MAP[defId];
  if (!def) return null;
  if (layerLocked(def.category)) {
    toast(`图层「${def.category}」已锁定，无法放置`, 'warn');
    return null;
  }
  snapshot();
  let x = roundTo(ground.x, snapGrid() ? 10 : 1);
  let y = roundTo(ground.y, snapGrid() ? 10 : 1);
  const baseZ = ground.z ?? 0;
  const candidate: Entity = { uid: uid(), defId, pos: { x, y, z: baseZ }, rot: 0, color: def.color };
  const sup = supportHeight(scene, candidate.uid, candidate.pos, 0, def);
  // reject if it would collide
  const bad = collisionSet(new Map([[candidate.uid, { ...candidate, pos: { ...candidate.pos, z: sup.z } }]]));
  if (bad.size) {
    toast('此处与现有零件干涉，请换个位置放置', 'warn');
    return null;
  }
  candidate.pos.z = sup.z;
  setScene('entities', (list) => [...list, candidate]);
  if (sup.on) {
    setScene('joints', (list) => [...list, { a: candidate.uid, b: sup.on as string }]);
  }
  if (opts?.select !== false) setSelection([candidate.uid]);
  setDirtySinceSave(true);
  return candidate.uid;
}

export function deleteSelection() {
  const ids = selection().filter(isEditable);
  if (!ids.length) {
    toast('没有可删除的选中件（可能已锁定或隐藏）', 'warn');
    return;
  }
  snapshot();
  const set = new Set(ids);
  setScene(
    produce((s) => {
      s.entities = s.entities.filter((e) => !set.has(e.uid));
      s.joints = s.joints.filter((j) => !set.has(j.a) && !set.has(j.b));
    }),
  );
  clearSelection();
  setDirtySinceSave(true);
}

export function duplicateSelection() {
  const ids = selection().filter(isEditable);
  if (!ids.length) return;
  snapshot();
  const newIds: string[] = [];
  const copies: Entity[] = [];
  for (const id of ids) {
    const f = entityById(id);
    if (!f) continue;
    const copy: Entity = JSON.parse(JSON.stringify(f.ent));
    copy.uid = uid();
    copy.pos.x += 120;
    copy.pos.y += 120;
    copies.push(copy);
    newIds.push(copy.uid);
  }
  setScene('entities', (list) => [...list, ...copies]);
  setSelection(newIds);
  setDirtySinceSave(true);
}

export function rotateSelection(deg: number) {
  const ids = selection().filter(isEditable);
  if (!ids.length) return;
  snapshot();
  const set = new Set(ids);
  setScene(
    produce((s) => {
      for (const e of s.entities) if (set.has(e.uid)) e.rot = normalizeAngle((e.rot || 0) + deg);
    }),
  );
  setDirtySinceSave(true);
}

export function setEntityColor(uidStr: string, color: string) {
  const f = entityById(uidStr);
  if (!f || !isEditable(uidStr)) return;
  setScene('entities', f.index, 'color', color);
  setDirtySinceSave(true);
}

export function setEntitySize(uidStr: string, size: Partial<Size3>) {
  const f = entityById(uidStr);
  if (!f || !isEditable(uidStr)) return;
  const cur = entitySize(f.ent, f.def);
  const next = { ...cur, ...size };
  next.w = clamp(Math.round(next.w), 5, 4000);
  next.d = clamp(Math.round(next.d), 5, 4000);
  next.h = clamp(Math.round(next.h), 5, 4000);
  setScene('entities', f.index, 'size', next);
  setDirtySinceSave(true);
}

export function setEntityMaterialColorByMaterial(uidStr: string, color: string) {
  setEntityColor(uidStr, color);
}

export function toggleLayerVisible(layer: LayerId) {
  setScene('layers', layer, 'visible', (v) => !v);
  const hidden = new Set(scene.entities.filter((e) => PART_MAP[e.defId]?.category === layer).map((e) => e.uid));
  setSelection((sel) => sel.filter((id) => !hidden.has(id)));
  setDirtySinceSave(true);
}
export function toggleLayerLocked(layer: LayerId) {
  setScene('layers', layer, 'locked', (v) => !v);
  setDirtySinceSave(true);
}
export function toggleEntityLock(uidStr: string) {
  const f = entityById(uidStr);
  if (!f) return;
  setScene('entities', f.index, 'locked', (v) => !v);
  setDirtySinceSave(true);
}
export function toggleEntityHidden(uidStr: string) {
  const f = entityById(uidStr);
  if (!f) return;
  setScene('entities', f.index, 'hidden', (v) => !v);
  if (!f.ent.hidden) setSelection((sel) => sel.filter((x) => x !== uidStr));
  setDirtySinceSave(true);
}

export function normalizeAngle(a: number) {
  let r = a % 360;
  if (r > 180) r -= 360;
  if (r < -180) r += 360;
  return r;
}

// ---------- drag lifecycle ----------
export function startDrag(mode: DragMode, sx: number, sy: number, opts?: Partial<DragState>) {
  const ids = selection().filter(isEditable);
  const originals = new Map<string, { pos: Vec3; rot: number }>();
  for (const id of ids) {
    const f = entityById(id);
    if (f) originals.set(id, { pos: { ...f.ent.pos }, rot: f.ent.rot || 0 });
  }
  const baseZ = selectionBounds()?.minZ ?? 0;
  const ground = screenToGround(sx, sy, baseZ);
  setDrag({
    mode,
    startScreen: { x: sx, y: sy },
    startMM: ground,
    planeZ: baseZ,
    originals,
    marquee: null,
    startAngle: 0,
    baseRot: 0,
    moved: false,
    colliding: false,
    ...opts,
  });

}

export function updateDrag(sx: number, sy: number) {
  const d = drag();
  if (d.mode === 'none' || d.mode === 'pending') return;

  if (d.mode === 'marquee') {
    const x = Math.min(d.startScreen.x, sx);
    const y = Math.min(d.startScreen.y, sy);
    setDrag({ ...d, marquee: { x, y, w: Math.abs(sx - d.startScreen.x), h: Math.abs(sy - d.startScreen.y) }, moved: true });
    return;
  }

  if (d.mode === 'rotate') {
    if (!d.moved) snapshot();
    const b = selectionBounds();
    const g = gizmoHandles();
    if (!b || !g) return;
    const ang = Math.atan2(sy - g.center.y, sx - g.center.x);
    let delta = ((ang - d.startAngle) * 180) / Math.PI;
    const baseRot = d.originals.values().next().value?.rot ?? 0;
    let rot = baseRot + delta;
    if (snapAngle()) rot = Math.round(rot / 15) * 15;
    rot = normalizeAngle(rot);
    applyRotate(rot);
    setDrag({ ...d, moved: true });
    return;
  }

  if (d.mode === 'move' || d.mode === 'axis') {
    if (!d.moved) snapshot();
    let dx = 0, dy = 0, dz = 0;
    if (d.mode === 'move') {
      const g = screenToGround(sx, sy, d.planeZ);
      dx = g.x - d.startMM.x;
      dy = g.y - d.startMM.y;
      if (snapGrid()) {
        dx = roundTo(dx, 10);
        dy = roundTo(dy, 10);
      }
    } else if (d.axis === 'z') {
      dz = -(sy - d.startScreen.y) / camera().zoom;
      if (snapGrid()) dz = roundTo(dz, 10);
    } else {
      const dir = d.axis === 'x' ? { x: Math.cos(Math.PI / 6), y: 0.5 } : { x: -Math.cos(Math.PI / 6), y: 0.5 };
      const proj = ((sx - d.startScreen.x) * dir.x + (sy - d.startScreen.y) * dir.y) / camera().zoom;
      if (d.axis === 'x') dx = proj; else dy = proj;
      if (snapGrid()) {
        if (d.axis === 'x') dx = roundTo(dx, 10); else dy = roundTo(dy, 10);
      }
    }
    applyTranslate(dx, dy, dz, d);
    return;
  }
}

function applyTranslate(dx: number, dy: number, dz: number, d: DragState) {
  const moving = new Map<string, Entity>();
  setScene(
    produce((s) => {
      for (const e of s.entities) {
        const orig = d.originals.get(e.uid);
        if (!orig) continue;
        e.pos.x = roundTo(orig.pos.x + dx, 0.01);
        e.pos.y = roundTo(orig.pos.y + dy, 0.01);
        e.pos.z = Math.max(0, orig.pos.z + dz);
        moving.set(e.uid, JSON.parse(JSON.stringify(e)));
      }
    }),
  );

  // port snap
  let hint: PortSnapHit | null = null;
  if (snapPorts() && d.mode === 'move') hint = findPortSnap(scene, new Set(moving.keys()), 90);
  setSnapHint(hint);

  const bad = collisionSet(moving);
  setDrag({ ...d, moved: true, colliding: bad.size > 0 });
  setInterferingUids(bad);
}

function applyRotate(rot: number) {
  const d = drag();
  const moving = new Map<string, Entity>();
  const b = selectionBounds();
  setScene(
    produce((s) => {
      for (const e of s.entities) {
        const orig = d.originals.get(e.uid);
        if (!orig) continue;
        e.rot = rot;
        if (b && d.originals.size > 1) {
          // rotate group around its centre
          const ang = ((rot - orig.rot) * Math.PI) / 180;
          const c = Math.cos(ang), sn = Math.sin(ang);
          const rx = orig.pos.x - b.cx, ry = orig.pos.y - b.cy;
          e.pos.x = b.cx + rx * c - ry * sn;
          e.pos.y = b.cy + rx * sn + ry * c;
        }
        moving.set(e.uid, JSON.parse(JSON.stringify(e)));
      }
    }),
  );
  const bad = collisionSet(moving);
  setDrag({ ...d, moved: true, colliding: bad.size > 0 });
  setInterferingUids(bad);
}

export function endDrag() {
  const d = drag();
  if (d.mode === 'marquee' && d.marquee) {
    const r = d.marquee;
    const cam = camera();
    const rect = {
      x: (r.x - cam.x) / cam.zoom,
      y: (r.y - cam.y) / cam.zoom,
      w: r.w / cam.zoom,
      d: r.h / cam.zoom,
    };
    const hits: string[] = [];
    for (const ent of scene.entities) {
      const def = PART_MAP[ent.defId];
      if (!def || ent.hidden || !layerVisible(def.category)) continue;
      const sil = entitySilhouette(ent, def, 2);
      if (polygonIntersectsRect(sil, rect)) hits.push(ent.uid);
    }
    setSelection(hits);
    setDrag(emptyDrag());
    setSnapHint(null);
    return;
  }

  if (d.mode === 'move' || d.mode === 'axis' || d.mode === 'rotate') {
    const moving = new Map<string, Entity>();
    for (const id of d.originals.keys()) {
      const f = entityById(id);
      if (f) moving.set(id, { ...f.ent, pos: { ...f.ent.pos } });
    }

    // 1) Port snap (highest priority): align a pin into its socket exactly.
    let portSnapped = false;
    const hint = snapHint();
    if (hint && d.mode === 'move') {
      const yawNow = drag().originals.get(hint.movingUid)?.rot ?? 0;
      const targetYaw = hint.yawTarget ?? yawNow;
      setScene(
        produce((s) => {
          const e = s.entities.find((x) => x.uid === hint.movingUid);
          if (!e) return;
          e.pos.x = roundTo(e.pos.x + (hint.socketWorld.x - hint.portWorld.x), 0.01);
          e.pos.y = roundTo(e.pos.y + (hint.socketWorld.y - hint.portWorld.y), 0.01);
          e.pos.z = roundTo(e.pos.z + (hint.socketWorld.z - hint.portWorld.z), 0.01);
          e.rot = targetYaw;
          if (e.pos.z < 0) e.pos.z = 0;
        }),
      );
      // Keep the moving group rigid: shift siblings by the same delta.
      const delta = { x: hint.socketWorld.x - hint.portWorld.x, y: hint.socketWorld.y - hint.portWorld.y, z: hint.socketWorld.z - hint.portWorld.z };
      if (d.originals.size > 1) {
        setScene(produce((s) => {
          for (const e of s.entities) {
            if (e.uid === hint.movingUid || !moving.has(e.uid)) continue;
            e.pos.x = roundTo(e.pos.x + delta.x, 0.01);
            e.pos.y = roundTo(e.pos.y + delta.y, 0.01);
            e.pos.z = Math.max(0, roundTo(e.pos.z + delta.z, 0.01));
          }
        }));
      }
      if (!scene.joints.some((j) => (j.a === hint.movingUid && j.b === hint.targetUid) || (j.b === hint.movingUid && j.a === hint.targetUid))) {
        setScene('joints', (list) => [...list, { a: hint.movingUid, b: hint.targetUid }]);
      }
      portSnapped = true;
      toast(`已对接：${hint.label}`, 'ok');
    }

    // 2) Otherwise, settle the group on the nearest support surface (ground or part top).
    if (d.mode === 'move' && d.moved && !portSnapped) {
      let snappedOn: string | null = null;
      setScene(
        produce((s) => {
          let bestOn: string | null = null;
          let bestZ = 0;
          let bestDist = Infinity;
          for (const e of s.entities) {
            if (!moving.has(e.uid)) continue;
            const def = PART_MAP[e.defId];
            const sup = supportHeight(s, e.uid, e.pos, e.rot, def);
            const dist = Math.abs(e.pos.z - sup.z);
            if (dist < bestDist) {
              bestDist = dist;
              bestZ = sup.z;
              bestOn = sup.on;
            }
          }
          for (const e of s.entities) {
            if (!moving.has(e.uid)) continue;
            e.pos.z = bestZ;
          }
          snappedOn = bestOn;
        }),
      );
      if (snappedOn) {
        const on = snappedOn as string;
        for (const id of moving.keys()) {
          if (id === on) continue;
          if (!scene.joints.some((j) => (j.a === id && j.b === on) || (j.b === id && j.a === on))) {
            setScene('joints', (list) => [...list, { a: id, b: on }]);
          }
        }
      }
    }

    // Final collision check after all snapping — reject if it would intersect.
    const finalMoving = new Map<string, Entity>();
    for (const id of d.originals.keys()) {
      const f = entityById(id);
      if (f) finalMoving.set(id, { ...f.ent, pos: { ...f.ent.pos } });
    }
    const bad = collisionSet(finalMoving);
    if (bad.size > 0) {
      setScene(
        produce((s) => {
          for (const e of s.entities) {
            const orig = d.originals.get(e.uid);
            if (!orig) continue;
            e.pos = { ...orig.pos };
            e.rot = orig.rot;
          }
        }),
      );
      toast('落位会与其它零件干涉，已退回原位', 'warn');
    } else if (d.moved) {
      setDirtySinceSave(true);
    }
  }

  setDrag(emptyDrag());
  setSnapHint(null);
  setDropHint(null);
  setInterferingUids(new Set<string>());
}

export function cancelDrag() {
  const d = drag();
  if (d.mode === 'none') return;
  if (d.originals.size) {
    setScene(
      produce((s) => {
        for (const e of s.entities) {
          const orig = d.originals.get(e.uid);
          if (!orig) continue;
          e.pos = { ...orig.pos };
          e.rot = orig.rot;
        }
      }),
    );
  }
  setDrag(emptyDrag());
  setSnapHint(null);
  setInterferingUids(new Set<string>());
}

// ---------- camera ----------
let camAnim: number | null = null;

/** Smoothly animate the camera to a new {x, y, zoom}. */
export function animateCameraTo(target: { x: number; y: number; zoom: number }, duration = 420) {
  const start = camera();
  const t0 = performance.now();
  if (camAnim) cancelAnimationFrame(camAnim);
  if (typeof requestAnimationFrame === 'undefined') {
    setCamera(target);
    return;
  }
  const step = (now: number) => {
    const t = clamp((now - t0) / duration, 0, 1);
    const e = 1 - Math.pow(1 - t, 3);
    setCamera({
      x: start.x + (target.x - start.x) * e,
      y: start.y + (target.y - start.y) * e,
      zoom: start.zoom + (target.zoom - start.zoom) * e,
    });
    if (t < 1) camAnim = requestAnimationFrame(step);
    else camAnim = null;
  };
  camAnim = requestAnimationFrame(step);
}

/** Camera that centres a projected world-space rectangle. */
function cameraForBox(box: { minX: number; minY: number; maxX: number; maxY: number }, fill = 0.62) {
  const vp = viewportSize();
  const bw = Math.max(1, box.maxX - box.minX);
  const bh = Math.max(1, box.maxY - box.minY);
  const zoom = clamp(Math.min((vp.w * fill) / bw, (vp.h * fill) / bh), 0.08, 2.4);
  return {
    zoom,
    x: vp.w / 2 - ((box.minX + box.maxX) / 2) * zoom,
    y: vp.h / 2 - ((box.minY + box.maxY) / 2) * zoom,
  };
}

export function focusEntity(uidStr: string, zoomTarget?: number) {
  const f = entityById(uidStr);
  if (!f) return;
  if (f.ent.hidden) {
    toast('该零件已隐藏，无法聚焦；请先在层级树中显示', 'warn');
    return;
  }
  const s = entitySize(f.ent, f.def);
  const obb = entityOBB(f.ent, f.def);
  // projected extent of the part's eight corners
  const pts = footprint(obb).map((p) => project({ x: p.x, y: p.y, z: f.ent.pos.z + s.h / 2 }));
  const top = project({ x: f.ent.pos.x, y: f.ent.pos.y, z: f.ent.pos.z + s.h });
  const bot = project({ x: f.ent.pos.x, y: f.ent.pos.y, z: f.ent.pos.z });
  pts.push(top, bot);
  const b = polygonBoundsStatic(pts);
  b.minX -= 120; b.maxX += 120; b.minY -= 120; b.maxY += 120;
  const target = cameraForBox(b, 0.5);
  if (zoomTarget != null) {
    target.zoom = zoomTarget;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const vp = viewportSize();
    target.x = vp.w / 2 - cx * zoomTarget;
    target.y = vp.h / 2 - cy * zoomTarget;
  }
  animateCameraTo(target);
}

export function focusSelection() {
  const b = selectionBounds();
  if (!b) return;
  if (!scene.entities.some((e) => selection().includes(e.uid) && !e.hidden)) {
    toast('选中的零件都已隐藏', 'warn');
    return;
  }
  const vp = viewportSize();
  const pts: { x: number; y: number }[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [0, 1]) {
    pts.push(project({
      x: sx > 0 ? b.maxX : b.minX,
      y: sy > 0 ? b.maxY : b.minY,
      z: sz > 0 ? b.maxZ : b.minZ,
    }));
  }
  const pb = polygonBoundsStatic(pts);
  pb.minX -= 90; pb.maxX += 90; pb.minY -= 90; pb.maxY += 90;
  animateCameraTo(cameraForBox(pb, selection().length > 1 ? 0.78 : 0.55));
}

export function zoomAt(sx: number, sy: number, factor: number) {
  const cam = camera();
  const z = clamp(cam.zoom * factor, 0.05, 3);
  const wx = (sx - cam.x) / cam.zoom;
  const wy = (sy - cam.y) / cam.zoom;
  setCamera({ zoom: z, x: sx - wx * z, y: sy - wy * z });
}

export function panBy(dx: number, dy: number) {
  setCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
}

export function resetScene() {
  snapshot();
  const s = buildStarterScene();
  setScene(s);
  clearSelection();
  setDirtySinceSave(true);
  toast('已复位为示范方案', 'ok');
}

export function replaceScene(s: SceneData) {
  const normalized: SceneData = {
    ...s,
    layers: { ...DEFAULT_LAYERS, ...(s.layers ?? {}) },
    joints: s.joints ?? [],
  };
  setScene(normalized);
  clearSelection();
  setDirtySinceSave(false);
}

export function currentSceneSnapshot(): SceneData {
  return cloneScene(scene as SceneData);
}

export { colorFor, entitySize, entityOBB, portWorld, project };

// Exposed for automated UI tests and debugging only.
if (typeof window !== 'undefined') {
  (window as any).__kd = {
    scene, camera, selection, viewport, focusEntity, fitToScene,
    mmToScreen, view: () => view(), pickAt, screenToGround, project, screenRay, drag, gizmoHandles, snapHint, dropHint, setScene, selectOnly, setSelection, animateCameraTo, focusSelection,
  };
}
