import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type {
  BoolOp,
  DocState,
  ItemStyle,
  ItemType,
  Job,
  JobStatus,
  Layer,
  LegendTemplate,
  Matrix,
  Pt,
  ToolId,
  VecGroup,
  VecPath,
  Worker,
} from './types';
import { identity } from './types';
import {
  applyMatrix,
  bboxOf,
  flattenPath,
  invert,
  multiply,
  worldMatrix,
} from './geometry';
import { booleanOp, resultToItems } from './boolean';
import { detectConflicts } from './conflict';

const HISTORY_LIMIT = 50;

const DEFAULT_STYLE: Record<ItemType, ItemStyle> = {
  pipeline: { stroke: '#1565c0', fill: '#90caf9', strokeWidth: 3, opacity: 0.25, dash: [] },
  sign: { stroke: '#ef6c00', fill: '#ffe0b2', strokeWidth: 2, opacity: 0.85, dash: [] },
  zone: { stroke: '#6a1b9a', fill: '#e1bee7', strokeWidth: 1.5, opacity: 0.18, dash: [8, 5] },
  generic: { stroke: '#37474f', fill: '#cfd8dc', strokeWidth: 1.5, opacity: 0.4, dash: [] },
};

export function makeItem(
  type: ItemType,
  layerId: string,
  pts: Pt[],
  closed: boolean,
  partial?: Partial<VecPath>,
): VecPath {
  const seq = nameSeq[type]++;
  const label = { pipeline: '管线', sign: '标识牌', zone: '分区', generic: '图元' }[type];
  return {
    id: nanoid(8),
    type,
    name: `${label}-${seq}`,
    layerId,
    closed,
    points: pts.map((p) => ({ ...p })),
    segments: [],
    smooth: false,
    style: { ...DEFAULT_STYLE[type], ...(partial?.style ?? {}) },
    transform: identity(),
    groupId: null,
    ...partial,
  };
}

const nameSeq: Record<ItemType, number> = { pipeline: 1, sign: 1, zone: 1, generic: 1 };

// ---------------- 种子数据 ----------------

function seedLayers(): Layer[] {
  return [
    { id: 'L-pipe', name: '采样管线层', visible: true, locked: false, color: '#1565c0' },
    { id: 'L-sign', name: '警示标识层', visible: true, locked: false, color: '#ef6c00' },
    { id: 'L-zone', name: '分区线层', visible: true, locked: false, color: '#6a1b9a' },
  ];
}

function seedTemplates(): LegendTemplate[] {
  return [
    {
      id: 'tpl-sample',
      name: '采样主管（图例蓝）',
      appliesTo: ['pipeline'],
      style: { stroke: '#0d47a1', fill: '#90caf9', strokeWidth: 4, opacity: 0.25, dash: [] },
    },
    {
      id: 'tpl-exhaust',
      name: '排空管（图例红虚线）',
      appliesTo: ['pipeline'],
      style: { stroke: '#c62828', fill: '#ef9a9a', strokeWidth: 2.5, opacity: 0.25, dash: [10, 5] },
    },
    {
      id: 'tpl-warn',
      name: '警示标识牌（橙底）',
      appliesTo: ['sign'],
      style: { stroke: '#e65100', fill: '#ffcc80', strokeWidth: 2.5, opacity: 0.95, dash: [] },
    },
    {
      id: 'tpl-zone',
      name: '受控分区（紫虚线）',
      appliesTo: ['zone'],
      style: { stroke: '#6a1b9a', fill: '#e1bee7', strokeWidth: 1.5, opacity: 0.2, dash: [8, 5] },
    },
  ];
}

function seedWorkers(): Worker[] {
  return [
    { id: 'w1', name: '王师傅', role: 'designer' },
    { id: 'w2', name: '李师傅', role: 'designer' },
    { id: 'w3', name: '赵质检', role: 'qc' },
    { id: 'w4', name: '前台小周', role: 'frontdesk' },
  ];
}

function demoDoc(): DocState {
  const layers = seedLayers();
  const pipe = makeItem('pipeline', 'L-pipe', [
    { x: 120, y: 180 }, { x: 360, y: 180 }, { x: 360, y: 340 }, { x: 620, y: 340 },
  ], false);
  const sign = makeItem('sign', 'L-sign', [
    { x: 300, y: 140 }, { x: 420, y: 140 }, { x: 420, y: 220 }, { x: 300, y: 220 },
  ], true);
  const zone = makeItem('zone', 'L-zone', [
    { x: 80, y: 100 }, { x: 680, y: 100 }, { x: 680, y: 420 }, { x: 80, y: 420 },
  ], true);
  return { items: [zone, pipe, sign], groups: [], layers };
}

function seedJobs(): Job[] {
  const now = Date.now();
  return [
    {
      id: nanoid(8),
      code: 'J-2026-001',
      customer: '江北环境监测中心',
      station: '空气站 A-07',
      requirements: '采样主管走向 + 高压警示标识，分区线按图例紫虚线，注意标识牌不得被管线压盖。',
      assignee: 'w1',
      status: 'in_progress',
      createdAt: now - 86400000,
      submittedAt: null,
      approvedAt: null,
      qcNote: '',
      reworkCount: 0,
      qcHistory: [],
      doc: demoDoc(),
    },
    {
      id: nanoid(8),
      code: 'J-2026-002',
      customer: '临港水质自动站',
      station: '水站 W-12',
      requirements: '新增排空管虚线与两块警示标识牌。',
      assignee: null,
      status: 'intake',
      createdAt: now - 3600000,
      submittedAt: null,
      approvedAt: null,
      qcNote: '',
      reworkCount: 0,
      qcHistory: [],
      doc: null,
    },
  ];
}

// ---------------- Store 类型 ----------------

interface Settings {
  tool: ToolId;
  snapEnabled: boolean;
  snapThreshold: number; // 像素
  gridSize: number;
  gridVisible: boolean;
  rulerVisible: boolean;
  activeLayerId: string;
}

interface EditorState {
  // 文档
  items: VecPath[];
  groups: VecGroup[];
  layers: Layer[];
  selection: string[];
  // 历史
  past: DocState[];
  future: DocState[];
  // 设置
  settings: Settings;
  // 图例模板
  templates: LegendTemplate[];
  // 工单
  jobs: Job[];
  workers: Worker[];
  currentJobId: string | null;
  // 视图
  zoom: number;
  pan: Pt;
  // 动作
  setTool: (t: ToolId) => void;
  patchSettings: (p: Partial<Settings>) => void;
  setView: (zoom: number, pan: Pt) => void;
  snapshot: () => void;
  undo: () => void;
  redo: () => void;
  addItem: (item: VecPath) => void;
  updateItem: (id: string, patch: Partial<VecPath>) => void;
  updateItems: (ids: string[], fn: (it: VecPath) => VecPath) => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  select: (ids: string[]) => void;
  groupSelection: () => void;
  ungroupSelection: () => void;
  applyWorldTransform: (ids: string[], w: Matrix) => void;
  moveVertex: (itemId: string, index: number, p: Pt) => void;
  boolean: (op: BoolOp) => void;
  applyTemplate: (templateId: string, ids: string[]) => void;
  addLayer: (name: string) => void;
  toggleLayer: (id: string, key: 'visible' | 'locked') => void;
  removeLayer: (id: string) => void;
  setActiveLayer: (id: string) => void;
  recomputeConflicts: () => void;
  // 工单流
  createJob: (data: Pick<Job, 'customer' | 'station' | 'requirements'>) => void;
  assignJob: (jobId: string, workerId: string) => void;
  openJob: (jobId: string) => void;
  submitJob: (jobId: string) => void;
  qcDecision: (jobId: string, pass: boolean, note: string) => void;
  newBlankDoc: (jobId: string) => void;
}

const LS_KEY = 'station-editor-state-v1';

function loadPersisted(): { jobs: Job[]; workers: Worker[]; templates: LegendTemplate[] } | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const persisted = loadPersisted();
const initialJobs = persisted?.jobs ?? seedJobs();
const initialWorkers = persisted?.workers ?? seedWorkers();
const initialTemplates = persisted?.templates ?? seedTemplates();
const firstOpen = initialJobs.find((j) => j.doc) ?? initialJobs[0];

function docOf(job: Job | undefined): DocState {
  if (job?.doc) return structuredClone(job.doc);
  return { items: [], groups: [], layers: seedLayers() };
}

const initialDoc = docOf(firstOpen);

// 初始文档先算一次版面冲突（管线压标识牌）
{
  const initialConflicts = detectConflicts(initialDoc.items, () => null);
  if (initialConflicts.size) {
    initialDoc.items = initialDoc.items.map((i) =>
      initialConflicts.has(i.id) ? { ...i, conflict: true } : i,
    );
  }
}

function groupTxOf(groups: VecGroup[]): (item: VecPath) => Matrix | null {
  return (item) => {
    if (!item.groupId) return null;
    return groups.find((g) => g.id === item.groupId)?.transform ?? null;
  };
}

export const useEditor = create<EditorState>((set, get) => {
  const persist = () => {
    const s = get();
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ jobs: s.jobs, workers: s.workers, templates: s.templates }),
      );
    } catch {
      /* 忽略配额错误 */
    }
  };

  /** 把当前文档同步回当前工单，并刷新冲突标记 */
  const syncJobDoc = (items: VecPath[], groups: VecGroup[], layers: Layer[]) => {
    const s = get();
    if (!s.currentJobId) return;
    const jobs = s.jobs.map((j) =>
      j.id === s.currentJobId ? { ...j, doc: { items, groups, layers } } : j,
    );
    set({ jobs });
    persist();
  };

  return {
    items: initialDoc.items,
    groups: initialDoc.groups,
    layers: initialDoc.layers,
    selection: [],
    past: [],
    future: [],
    settings: {
      tool: 'select',
      snapEnabled: true,
      snapThreshold: 8,
      gridSize: 20,
      gridVisible: true,
      rulerVisible: true,
      activeLayerId: initialDoc.layers[0]?.id ?? 'L-pipe',
    },
    templates: initialTemplates,
    jobs: initialJobs,
    workers: initialWorkers,
    currentJobId: firstOpen?.id ?? null,
    zoom: 1,
    pan: { x: 0, y: 0 },

    setTool: (tool) => set((s) => ({ settings: { ...s.settings, tool } })),
    patchSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
    setView: (zoom, pan) => set({ zoom, pan }),

    snapshot: () =>
      set((s) => ({
        past: [...s.past, { items: structuredClone(s.items), groups: structuredClone(s.groups), layers: structuredClone(s.layers) }].slice(-HISTORY_LIMIT),
        future: [],
      })),

    undo: () => {
      const s = get();
      if (!s.past.length) return;
      const prev = s.past[s.past.length - 1];
      set({
        items: prev.items,
        groups: prev.groups,
        layers: prev.layers,
        past: s.past.slice(0, -1),
        future: [{ items: structuredClone(s.items), groups: structuredClone(s.groups), layers: structuredClone(s.layers) }, ...s.future].slice(0, HISTORY_LIMIT),
        selection: s.selection.filter((id) => prev.items.some((i) => i.id === id)),
      });
      get().recomputeConflicts();
      syncJobDoc(get().items, get().groups, get().layers);
    },

    redo: () => {
      const s = get();
      if (!s.future.length) return;
      const next = s.future[0];
      set({
        items: next.items,
        groups: next.groups,
        layers: next.layers,
        future: s.future.slice(1),
        past: [...s.past, { items: structuredClone(s.items), groups: structuredClone(s.groups), layers: structuredClone(s.layers) }].slice(-HISTORY_LIMIT),
        selection: s.selection.filter((id) => next.items.some((i) => i.id === id)),
      });
      get().recomputeConflicts();
      syncJobDoc(get().items, get().groups, get().layers);
    },

    addItem: (item) => {
      get().snapshot();
      set((s) => ({ items: [...s.items, item], selection: [item.id] }));
      get().recomputeConflicts();
      syncJobDoc(get().items, get().groups, get().layers);
    },

    updateItem: (id, patch) => {
      set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
    },

    updateItems: (ids, fn) => {
      const idset = new Set(ids);
      set((s) => ({ items: s.items.map((i) => (idset.has(i.id) ? fn(i) : i)) }));
    },

    deleteSelection: () => {
      const s = get();
      if (!s.selection.length) return;
      s.snapshot();
      const ids = new Set(s.selection);
      set({
        items: s.items.filter((i) => !ids.has(i.id)),
        groups: s.groups.filter((g) => s.items.some((i) => i.groupId === g.id && !ids.has(i.id))),
        selection: [],
      });
      get().recomputeConflicts();
      syncJobDoc(get().items, get().groups, get().layers);
    },

    duplicateSelection: () => {
      const s = get();
      if (!s.selection.length) return;
      s.snapshot();
      const clones = s.items
        .filter((i) => s.selection.includes(i.id))
        .map((i) => ({
          ...structuredClone(i),
          id: nanoid(8),
          name: `${i.name}-副本`,
          groupId: null,
          transform: multiply(i.transform, [1, 0, 0, 1, 24, 24]) as Matrix,
        }));
      set({ items: [...s.items, ...clones], selection: clones.map((c) => c.id) });
      syncJobDoc(get().items, get().groups, get().layers);
    },

    select: (ids) => set({ selection: ids }),

    groupSelection: () => {
      const s = get();
      const members = s.items.filter((i) => s.selection.includes(i.id) && !i.groupId);
      if (members.length < 2) return;
      s.snapshot();
      const group: VecGroup = { id: nanoid(8), name: `组-${s.groups.length + 1}`, transform: identity() };
      set({
        groups: [...s.groups, group],
        items: s.items.map((i) => (s.selection.includes(i.id) ? { ...i, groupId: group.id } : i)),
      });
      syncJobDoc(get().items, get().groups, get().layers);
    },

    ungroupSelection: () => {
      const s = get();
      const groupIds = new Set(
        s.items.filter((i) => s.selection.includes(i.id) && i.groupId).map((i) => i.groupId!),
      );
      if (!groupIds.size) return;
      s.snapshot();
      const gMap = new Map(s.groups.map((g) => [g.id, g]));
      set({
        groups: s.groups.filter((g) => !groupIds.has(g.id)),
        items: s.items.map((i) => {
          if (!i.groupId || !groupIds.has(i.groupId)) return i;
          const g = gMap.get(i.groupId)!;
          return { ...i, groupId: null, transform: multiply(g.transform, i.transform) as Matrix };
        }),
      });
      syncJobDoc(get().items, get().groups, get().layers);
    },

    /** 对选中图元施加世界仿射（缩放/旋转手柄、拖拽平移都走这里） */
    applyWorldTransform: (ids, w) => {
      const s = get();
      const selected = s.items.filter((i) => ids.includes(i.id));
      const groupIds = new Set(selected.map((i) => i.groupId).filter(Boolean) as string[]);
      // 若选中了某组的全部成员，则对组变换操作
      const wholeGroups = [...groupIds].filter((gid) => {
        const members = s.items.filter((i) => i.groupId === gid);
        return members.length && members.every((m) => ids.includes(m.id));
      });
      const wholeSet = new Set(wholeGroups);
      set({
        groups: s.groups.map((g) => (wholeSet.has(g.id) ? { ...g, transform: multiply(w, g.transform) as Matrix } : g)),
        items: s.items.map((i) => {
          if (!ids.includes(i.id)) return i;
          if (i.groupId && wholeSet.has(i.groupId)) return i; // 随组走
          const gtx = i.groupId ? s.groups.find((g) => g.id === i.groupId)?.transform ?? null : null;
          // L' = G⁻¹·W·G·L
          const gl = gtx ? multiply(gtx, i.transform) : i.transform;
          const wgl = multiply(w, gl);
          const next = gtx ? multiply(invert(gtx), wgl) : wgl;
          return { ...i, transform: next as Matrix };
        }),
      });
    },

    moveVertex: (itemId, index, p) => {
      set((s) => ({
        items: s.items.map((i) => {
          if (i.id !== itemId) return i;
          if (i.segments.length) {
            const segments = i.segments.map((seg, k) => (k === index ? { ...seg, point: { ...p } } : seg));
            return { ...i, segments };
          }
          const points = i.points.map((q, k) => (k === index ? { ...p } : q));
          return { ...i, points };
        }),
      }));
    },

    boolean: (op) => {
      const s = get();
      const operands = s.items.filter((i) => s.selection.includes(i.id));
      if (operands.length < 2) return;
      const gtx = groupTxOf(s.groups);
      s.snapshot();
      let current = operands[0];
      let allRings: ReturnType<typeof booleanOp>['rings'] = [];
      for (let k = 1; k < operands.length; k++) {
        const r = booleanOp(op, current, operands[k], gtx(current), gtx(operands[k]));
        if (r.empty) {
          allRings = [];
          break;
        }
        allRings = r.rings;
        // 链式运算：把第一个环包成临时图元继续算
        if (k < operands.length - 1) {
          current = { ...current, closed: true, points: allRings[0], segments: [], transform: identity(), groupId: null };
        }
      }
      if (!allRings.length) {
        alert('布尔运算没有产生有效结果（图形可能没有重叠区域）。');
        return;
      }
      const base = operands[0];
      const created = resultToItems(
        allRings,
        { type: base.type, layerId: base.layerId, style: base.style },
        () => nanoid(8),
        `${opLabel(op)}-${base.name}`,
      );
      const removeIds = new Set(operands.map((o) => o.id));
      set({
        items: [...s.items.filter((i) => !removeIds.has(i.id)), ...created],
        selection: created.map((c) => c.id),
      });
      get().recomputeConflicts();
      syncJobDoc(get().items, get().groups, get().layers);
    },

    applyTemplate: (templateId, ids) => {
      const s = get();
      const tpl = s.templates.find((t) => t.id === templateId);
      if (!tpl) return;
      s.snapshot();
      const idset = new Set(ids);
      set({
        items: s.items.map((i) =>
          idset.has(i.id) && tpl.appliesTo.includes(i.type)
            ? { ...i, style: { ...i.style, ...structuredClone(tpl.style) } }
            : i,
        ),
      });
      syncJobDoc(get().items, get().groups, get().layers);
    },

    addLayer: (name) => {
      get().snapshot();
      const colors = ['#00897b', '#5e35b1', '#3949ab', '#c0282c'];
      const layer: Layer = {
        id: nanoid(6),
        name: name || `图层-${get().layers.length + 1}`,
        visible: true,
        locked: false,
        color: colors[get().layers.length % colors.length],
      };
      set((s) => ({ layers: [...s.layers, layer], settings: { ...s.settings, activeLayerId: layer.id } }));
      syncJobDoc(get().items, get().groups, get().layers);
    },

    toggleLayer: (id, key) => {
      set((s) => ({
        layers: s.layers.map((l) => (l.id === id ? { ...l, [key]: !l[key] } : l)),
      }));
      syncJobDoc(get().items, get().groups, get().layers);
    },

    removeLayer: (id) => {
      const s = get();
      if (s.layers.length <= 1) return;
      s.snapshot();
      set({
        layers: s.layers.filter((l) => l.id !== id),
        items: s.items.filter((i) => i.layerId !== id),
        settings: {
          ...s.settings,
          activeLayerId: s.settings.activeLayerId === id ? s.layers.find((l) => l.id !== id)!.id : s.settings.activeLayerId,
        },
        selection: s.selection.filter((sid) => s.items.some((i) => i.id === sid && i.layerId !== id)),
      });
      syncJobDoc(get().items, get().groups, get().layers);
    },

    setActiveLayer: (id) => set((s) => ({ settings: { ...s.settings, activeLayerId: id } })),

    recomputeConflicts: () => {
      const s = get();
      const map = detectConflicts(s.items, groupTxOf(s.groups));
      set({
        items: s.items.map((i) => {
          const c = map.has(i.id);
          return c === !!i.conflict ? i : { ...i, conflict: c };
        }),
      });
    },

    // ---------------- 工单流 ----------------
    createJob: (data) => {
      const job: Job = {
        id: nanoid(8),
        code: `J-2026-${String(get().jobs.length + 1).padStart(3, '0')}`,
        customer: data.customer,
        station: data.station,
        requirements: data.requirements,
        assignee: null,
        status: 'intake',
        createdAt: Date.now(),
        submittedAt: null,
        approvedAt: null,
        qcNote: '',
        reworkCount: 0,
        qcHistory: [],
        doc: null,
      };
      set({ jobs: [job, ...get().jobs] });
      persist();
    },

    assignJob: (jobId, workerId) => {
      set({
        jobs: get().jobs.map((j) =>
          j.id === jobId ? { ...j, assignee: workerId, status: 'assigned' as JobStatus } : j,
        ),
      });
      persist();
    },

    openJob: (jobId) => {
      const job = get().jobs.find((j) => j.id === jobId);
      if (!job) return;
      const doc = docOf(job);
      set({
        currentJobId: jobId,
        items: doc.items,
        groups: doc.groups,
        layers: doc.layers,
        selection: [],
        past: [],
        future: [],
        settings: { ...get().settings, activeLayerId: doc.layers[0]?.id ?? get().settings.activeLayerId },
      });
      get().recomputeConflicts();
    },

    newBlankDoc: (jobId) => {
      const doc: DocState = { items: [], groups: [], layers: seedLayers() };
      set({
        jobs: get().jobs.map((j) => (j.id === jobId ? { ...j, doc } : j)),
      });
      get().openJob(jobId);
      persist();
    },

    submitJob: (jobId) => {
      get().recomputeConflicts();
      const s = get();
      const doc: DocState = { items: s.items, groups: s.groups, layers: s.layers };
      set({
        jobs: s.jobs.map((j) =>
          j.id === jobId
            ? { ...j, status: 'submitted' as JobStatus, submittedAt: Date.now(), doc }
            : j,
        ),
      });
      persist();
    },

    qcDecision: (jobId, pass, note) => {
      const s = get();
      const reviewer = s.workers.find((w) => w.role === 'qc')?.name ?? '质检员';
      set({
        jobs: s.jobs.map((j) => {
          if (j.id !== jobId) return j;
          const history = [...j.qcHistory, { at: Date.now(), passed: pass, note, reviewer }];
          return pass
            ? { ...j, status: 'approved' as JobStatus, approvedAt: Date.now(), qcNote: note, qcHistory: history }
            : {
                ...j,
                status: 'returned' as JobStatus,
                qcNote: note,
                reworkCount: j.reworkCount + 1,
                qcHistory: history,
              };
        }),
      });
      persist();
    },
  };
});

function opLabel(op: BoolOp): string {
  return { unite: '并集', subtract: '差集', intersect: '交集', xor: '异或' }[op];
}

/** 供画布使用的世界采样辅助 */
export function selectableInActiveLayers(state: EditorState): VecPath[] {
  const locked = new Set(state.layers.filter((l) => l.locked || !l.visible).map((l) => l.id));
  return state.items.filter((i) => !locked.has(i.layerId));
}

export { DEFAULT_STYLE };

// 自动化测试 / 控制台调试接口
declare global {
  interface Window {
    __editor: typeof useEditor;
  }
}
if (typeof window !== 'undefined') {
  window.__editor = useEditor;
}
export function worldBBox(items: VecPath[], groups: VecGroup[]): { min: Pt; max: Pt } | null {
  const gtx = groupTxOf(groups);
  const all: Pt[] = [];
  for (const it of items) {
    for (const p of flattenPath(it)) all.push(applyMatrix(worldMatrix(it, gtx(it)), p));
  }
  return bboxOf(all);
}
