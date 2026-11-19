import { createSignal } from 'solid-js';
import type {
  GuideLine, PathData, Pt, Submission, ToolMode, ViewTransform, BooleanOp,
} from '../types';
import { DOC_H, DOC_W } from '../types';
import { clonePath, uid, movePath } from '../lib/geometry';
import { HistoryStack, snapshot as makeSnapshot, type DocSnapshot } from '../lib/history';
import { applyAlign, type AlignAction } from '../lib/align';
import { booleanPaths, cutPatternWithVeins } from '../lib/boolean';
import { makePath } from '../lib/pathFactory';
import { createSubmission } from './store';

// ---------- 文档数据 ----------
const [paths, setPaths] = createSignal<PathData[]>([]);
const [guides, setGuides] = createSignal<GuideLine[]>([]);
const [docId, setDocId] = createSignal(uid('doc'));
const [specimen, setSpecimen] = createSignal<{ code: string; family: string; species: string }>(
  { code: 'SP-0001', family: '凤蝶科 Papilionidae', species: '金凤蝶 Papilio machaon' },
);
const [bgImage, setBgImage] = createSignal<ImageBitmap | null>(null);
const [bgOpacity, setBgOpacity] = createSignal(0.7);
const [showGrid, setShowGrid] = createSignal(true);

// ---------- 工具与视图 ----------
const [tool, setTool] = createSignal<ToolMode>({ type: 'select' });
const [penKind, setPenKind] = createSignal<'vein' | 'pattern'>('vein');
const [viewTransform, setViewTransform] = createSignal<ViewTransform>({
  scale: 1, offsetX: 40, offsetY: 30,
});
const [selection, setSelection] = createSignal<Set<string>>(new Set());
const [activePathId, setActivePathId] = createSignal<string | null>(null);
const [hoverInfo, setHoverInfo] = createSignal<{
  pathId?: string; nodeIndex?: number; handle?: 'in' | 'out'; snap?: string;
}>({});

// ---------- 历史 ----------
const history = new HistoryStack();
const [historyInfo, setHistoryInfo] = createSignal({ undo: 0, redo: 0 });

function refreshHistoryInfo() {
  setHistoryInfo({ ...history.sizes });
}

/** 任何修改前调用:推入当前状态快照 */
export function commitHistory() {
  history.push(makeSnapshot(paths(), guides()));
  refreshHistoryInfo();
}

export function beginInteraction() { history.beginInteraction(); }
export function endInteraction() { history.endInteraction(); }

export function undo() {
  const snap = history.undo(makeSnapshot(paths(), guides()));
  if (snap) restoreSnapshot(snap);
}
export function redo() {
  const snap = history.redo(makeSnapshot(paths(), guides()));
  if (snap) restoreSnapshot(snap);
}
function restoreSnapshot(snap: DocSnapshot) {
  setPaths(snap.paths.map(clonePath));
  setGuides(snap.guides.map(g => ({ ...g })));
  setSelection(prev => {
    const next = new Set<string>();
    prev.forEach(id => { if (snap.paths.some(p => p.id === id)) next.add(id); });
    return next;
  });
  if (activePathId() && !snap.paths.some(p => p.id === activePathId())) setActivePathId(null);
  refreshHistoryInfo();
}

// ---------- 路径增删改 ----------
export function addPathFromPen(kind: 'vein' | 'pattern'): PathData {
  const p = makePath(kind);
  commitHistory();
  setPaths(prev => [...prev, p]);
  setActivePathId(p.id);
  setSelection(new Set([p.id]));
  return p;
}

export function updatePath(id: string, updater: (p: PathData) => void) {
  setPaths(prev => prev.map(p => {
    if (p.id !== id) return p;
    const copy = clonePath(p);
    updater(copy);
    return copy;
  }));
}

export function appendNode(id: string, pt: Pt, smooth: boolean) {
  updatePath(id, p => {
    p.nodes.push({ ...pt });
    const idx = p.nodes.length - 1;
    if (smooth && idx > 0) {
      const prev = p.nodes[idx - 1];
      const next = p.nodes[Math.min(idx + 1, p.nodes.length - 1)];
      const dx = pt.x - prev.x, dy = pt.y - prev.y;
      const len = Math.min(34, Math.hypot(dx, dy) * 0.35);
      const ang = Math.atan2(dy, dx);
      p.handlesOut[idx - 1] = { x: Math.cos(ang) * len, y: Math.sin(ang) * len };
      p.handlesIn[idx] = { x: -Math.cos(ang) * len, y: -Math.sin(ang) * len };
      void next;
    } else {
      p.handlesIn.push(null);
      p.handlesOut.push(null);
    }
    if (p.handlesIn.length < p.nodes.length) {
      p.handlesIn.push(null);
      p.handlesOut.push(null);
    }
  });
}

export function closePath(id: string) {
  commitHistory();
  updatePath(id, p => { p.closed = true; });
}

export function deleteSelected() {
  const sel = selection();
  if (!sel.size) return;
  commitHistory();
  setPaths(prev => prev.filter(p => !sel.has(p.id)));
  setSelection(new Set<string>());
  setActivePathId(null);
}

export function duplicateSelected() {
  const sel = [...selection()];
  if (!sel.length) return;
  commitHistory();
  const copies: PathData[] = [];
  setPaths(prev => {
    const next = [...prev];
    sel.forEach(id => {
      const src = prev.find(p => p.id === id);
      if (!src) return;
      const c = clonePath(src);
      c.id = uid('path');
      c.name = `${src.name} 副本`;
      movePath(c, 18, 18);
      next.push(c);
      copies.push(c);
    });
    return next;
  });
  setSelection(new Set(copies.map(c => c.id)));
}

export function togglePathVisible(id: string) {
  commitHistory();
  updatePath(id, p => { p.visible = !p.visible; });
}
export function togglePathLocked(id: string) {
  commitHistory();
  updatePath(id, p => { p.locked = !p.locked; });
}
export function renamePath(id: string, name: string) {
  updatePath(id, p => { p.name = name; });
}
export function reorderPath(id: string, dir: 'up' | 'down') {
  commitHistory();
  setPaths(prev => {
    const idx = prev.findIndex(p => p.id === id);
    if (idx < 0) return prev;
    const swap = dir === 'up' ? idx + 1 : idx - 1;
    if (swap < 0 || swap >= prev.length) return prev;
    const next = [...prev];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    return next;
  });
}

// ---------- 选择 ----------
export function selectOnly(id: string | null) {
  setSelection(id ? new Set([id]) : new Set<string>());
  setActivePathId(id);
}
export function toggleSelection(id: string) {
  setSelection(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  setActivePathId(id);
}
export function selectAll() {
  setSelection(new Set(paths().map(p => p.id)));
}

const selectedPaths = () => paths().filter(p => selection().has(p.id));

// ---------- 对齐分布 ----------
export function alignSelected(action: AlignAction) {
  const list = selectedPaths();
  if (list.length < 2 && (action.startsWith('dist') ? list.length < 3 : true)) return;
  commitHistory();
  // applyAlign 原地修改,先克隆再写回
  const clones = list.map(clonePath);
  applyAlign(action, clones);
  setPaths(prev => prev.map(p => {
    const i = list.findIndex(x => x.id === p.id);
    return i >= 0 ? clones[i] : p;
  }));
}

// ---------- 布尔运算 ----------
export function applyBoolean(op: BooleanOp) {
  const list = selectedPaths().filter(p => p.closed && p.nodes.length >= 3);
  if (list.length < 2) {
    return { ok: false as const, msg: '需要两条闭合路径(各至少 3 个节点)' };
  }
  const [a, b] = list;
  const result = booleanPaths(a, b, op);
  if (!result.length) return { ok: false as const, msg: '运算结果为空(差集可能完全切除)' };
  commitHistory();
  const removeIds = new Set([a.id, b.id]);
  setPaths(prev => [...prev.filter(p => !removeIds.has(p.id)), ...result]);
  setSelection(new Set(result.map(r => r.id)));
  setActivePathId(result[0].id);
  return { ok: true as const };
}

/** 斑纹 × 翅脉 → 镂空 */
export function cutHoles() {
  const patterns = selectedPaths().filter(p => p.kind === 'pattern' && p.closed);
  if (!patterns.length) return { ok: false as const, msg: '请先选中闭合的斑纹块' };
  const veins = paths().filter(p => p.kind === 'vein' && p.visible);
  if (!veins.length) return { ok: false as const, msg: '图中没有可见翅脉' };
  commitHistory();
  const replacements = new Map<string, PathData[]>();
  patterns.forEach(pat => {
    replacements.set(pat.id, cutPatternWithVeins(pat, veins));
  });
  setPaths(prev => {
    const out: PathData[] = [];
    prev.forEach(p => {
      const r = replacements.get(p.id);
      if (r) out.push(...r); else out.push(p);
    });
    return out;
  });
  const newIds = [...replacements.values()].flat().map(p => p.id);
  setSelection(new Set(newIds));
  return { ok: true as const };
}

// ---------- 参考线 ----------
export function addGuide(orientation: 'h' | 'v', pos: number) {
  commitHistory();
  setGuides(prev => [...prev, { id: uid('guide'), orientation, pos }]);
}
export function moveGuide(id: string, pos: number) {
  setGuides(prev => prev.map(g => g.id === id ? { ...g, pos } : g));
}
export function deleteGuide(id: string) {
  commitHistory();
  setGuides(prev => prev.filter(g => g.id !== id));
}

// ---------- 视图 ----------
export function zoomAt(factor: number, center: Pt) {
  setViewTransform(t => {
    const scale = Math.min(6, Math.max(0.2, t.scale * factor));
    const real = scale / t.scale;
    return {
      scale,
      offsetX: center.x - (center.x - t.offsetX) * real,
      offsetY: center.y - (center.y - t.offsetY) * real,
    };
  });
}
export function panBy(dx: number, dy: number) {
  setViewTransform(t => ({ ...t, offsetX: t.offsetX + dx, offsetY: t.offsetY + dy }));
}
export function resetView() {
  setViewTransform({ scale: 1, offsetX: 40, offsetY: 30 });
}

// ---------- 图层整体操作 ----------
export function loadPaths(newPaths: PathData[], newGuides: GuideLine[] = []) {
  commitHistory();
  setPaths(newPaths.map(clonePath));
  setGuides(newGuides.map(g => ({ ...g })));
  setSelection(new Set<string>());
  setActivePathId(null);
}

export function clearDoc() {
  commitHistory();
  setPaths([]);
  setGuides([]);
  setSelection(new Set<string>());
}

// ---------- 提交 ----------
export function submitDoc(illustrator: string): Submission {
  const sp = specimen();
  return createSubmission({
    docId: docId(),
    specimenCode: sp.code,
    family: sp.family,
    species: sp.species,
    illustrator,
    snapshot: {
      paths: paths().map(clonePath),
      guides: guides().map(g => ({ ...g })),
      bgOpacity: bgOpacity(),
    },
  });
}

// ---------- 底图与标本 ----------
export function loadSpecimen(
  info: { code: string; family: string; species: string },
  bitmap: ImageBitmap | null,
) {
  setSpecimen(info);
  setBgImage(bitmap);
}

export { DOC_W, DOC_H };
export const docState = {
  paths, guides, docId, specimen, bgImage, bgOpacity, setBgOpacity, showGrid, setShowGrid,
  tool, setTool, penKind, setPenKind, viewTransform, selection, activePathId, hoverInfo, setHoverInfo,
  historyInfo,
};
