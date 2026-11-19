import { createRoot, createEffect } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { TYPES } from './model';
import { aabbOf, aabbOverlap, inSite, computeCoverage } from './geometry';

const STORAGE_KEY = 'park-iso-editor-v1';
let uid = 1;
export const nextId = (p = 'o') => `${p}${Date.now().toString(36)}${uid++}`;

const saved = (() => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
})();

export const [state, setState] = createStore({
  role: saved.role || 'teacher',            // teacher | student
  studentName: saved.studentName || '',
  camera: { angle: 0, top: false },
  snapGround: saved.snapGround !== false,
  site: { w: 60, d: 40, elevation: 0, ...(saved.site || {}) },
  objects: saved.objects || [],
  selected: [],
  task: saved.task || { title: '监测微站点位布置任务', points: [] },
  taskPlacing: null,                         // 正在放置的点位类型
  submissions: saved.submissions || [],
  review: null,                              // 老师查看作业: {student, objects, covered, missed}
});

// 持久化
createRoot(() => {
  createEffect(() => {
    const { role, studentName, snapGround, site, objects, task, submissions } = state;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ role, studentName, snapGround, site, objects, task, submissions }));
    } catch { /* 存储满时忽略 */ }
  });
});

const clone = (v) => JSON.parse(JSON.stringify(v));

function findFreeSpot(type) {
  const t = TYPES[type];
  const cand = { type, rot: 0, x: 0, y: 0 };
  outer:
  for (let r = 0; r < 20; r++) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      cand.x = Math.round(Math.cos(a) * r * 2);
      cand.y = Math.round(Math.sin(a) * r * 2);
      const bb = aabbOf(cand);
      if (!inSite(bb, state.site)) continue;
      for (const o of state.objects) if (aabbOverlap(bb, aabbOf(o))) continue outer;
      return { x: cand.x, y: cand.y };
    }
  }
  return { x: 0, y: 0 };
}

export const actions = {
  setRole(role) { setState({ role, review: null, selected: [], taskPlacing: null }); },

  setCamera(angle, top) {
    setState('camera', top ? { angle: state.camera.angle, top: true } : { angle, top: false });
  },

  addObject(type) {
    const t = TYPES[type];
    const pos = findFreeSpot(type);
    const o = { id: nextId(), type, x: pos.x, y: pos.y, z: state.site.elevation, rot: 0, params: { ...t.params } };
    setState('objects', (objs) => [...objs, o]);
    setState('selected', [o.id]);
  },

  updateObject(id, patch) {
    setState('objects', (o) => o.id === id, patch);
  },

  setSelection(ids) { setState('selected', ids); },
  toggleSelect(id) {
    setState('selected', (sel) => sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]);
  },

  deleteSelected() {
    const sel = new Set(state.selected);
    setState('objects', (objs) => objs.filter((o) => !sel.has(o.id)));
    setState('selected', []);
  },

  rotateSelected() {
    // 逐个尝试 90° 步进旋转,旋转后越界/碰撞则回退
    const sel = [...state.selected];
    const objs = state.objects;
    for (const id of sel) {
      const o = objs.find((x) => x.id === id);
      if (!o) continue;
      const cand = { ...o, rot: (o.rot + 90) % 360 };
      const bb = aabbOf(cand);
      let ok = inSite(bb, state.site);
      if (ok) {
        for (const other of objs) {
          if (other.id === id) continue;
          if (aabbOverlap(bb, aabbOf(other))) { ok = false; break; }
        }
      }
      if (ok) setState('objects', (x) => x.id === id, 'rot', cand.rot);
    }
  },

  duplicateSelected() {
    const sel = new Set(state.selected);
    const copies = [];
    for (const o of state.objects) {
      if (!sel.has(o.id)) continue;
      let placed = null;
      for (let i = 1; i <= 6 && !placed; i++) {
        const cand = { ...o, x: o.x + 2 * i, y: o.y + 2 * i };
        const bb = aabbOf(cand);
        if (!inSite(bb, state.site)) continue;
        if (state.objects.some((p) => aabbOverlap(bb, aabbOf(p)))) continue;
        if (copies.some((p) => aabbOverlap(bb, aabbOf(p)))) continue;
        placed = cand;
      }
      const src = placed || { ...o, x: o.x + 2, y: o.y + 2 };
      copies.push({ ...clone(src), id: nextId(), z: state.snapGround ? state.site.elevation : src.z });
    }
    if (copies.length) {
      setState('objects', (objs) => [...objs, ...copies]);
      setState('selected', copies.map((c) => c.id));
    }
  },

  setSite(patch) {
    setState('site', patch);
    if (state.snapGround && patch.elevation !== undefined) {
      setState('objects', () => true, 'z', state.site.elevation);
    }
  },

  // ---- 任务点位(老师) ----
  addTaskPoint(type, x, y) {
    const n = state.task.points.length + 1;
    const p = { id: nextId('p'), type, x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2, radius: 3, label: `点位${n}` };
    setState('task', 'points', (pts) => [...pts, p]);
  },
  updateTaskPoint(id, patch) { setState('task', 'points', (p) => p.id === id, patch); },
  removeTaskPoint(id) { setState('task', 'points', (pts) => pts.filter((p) => p.id !== id)); },
  clearTaskPoints() { setState('task', 'points', []); },

  // ---- 学员提交 ----
  submitAssignment() {
    const cov = computeCoverage(state.objects, state.task.points);
    const sub = {
      id: nextId('s'),
      student: state.studentName.trim() || '未命名学员',
      time: new Date().toLocaleString('zh-CN'),
      autoScore: cov.score,
      coveredCount: cov.covered.length,
      total: cov.total,
      coveredIds: cov.covered,
      missedIds: cov.missed,
      missedLabels: state.task.points.filter((p) => cov.missed.includes(p.id)).map((p) => `${p.label}(${TYPES[p.type].name})`),
      objects: clone(state.objects),
      finalScore: null,
      comment: '',
      reviewed: false,
    };
    setState('submissions', (subs) => [...subs, sub]);
    return sub;
  },

  reviewSubmission(id, patch) {
    setState('submissions', (s) => s.id === id, patch);
  },
  removeSubmission(id) {
    setState('submissions', (subs) => subs.filter((s) => s.id !== id));
    if (state.review?.subId === id) setState('review', null);
  },

  enterReview(sub) {
    setState({
      review: { subId: sub.id, student: sub.student, objects: clone(sub.objects), covered: sub.coveredIds, missed: sub.missedIds },
      selected: [],
    });
  },
  exitReview() { setState('review', null); },

  resetAll() {
    setState({ objects: [], selected: [], review: null, taskPlacing: null });
  },
};
