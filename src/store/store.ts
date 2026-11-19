import { createSignal } from 'solid-js';
import type {
  Annotation, ExportPreset, GuideLine, PathData, Pt, Submission, Template,
} from '../types';
import { HISTORY_LIMIT } from '../types';
import { clonePath, uid } from '../lib/geometry';

const LS_KEY = 'wing-studio-v1';

export interface PersistShape {
  templates: Template[];
  presets: ExportPreset[];
  submissions: Submission[];
  stats: { illustrator: string; date: string; count: number }[];
  users: { name: string; role: 'illustrator' | 'reviewer' | 'admin' }[];
}

const DEFAULT_USERS = [
  { name: '林描', role: 'illustrator' as const },
  { name: '周绘', role: 'illustrator' as const },
  { name: '沈审校', role: 'reviewer' as const },
  { name: '管理员', role: 'admin' as const },
];

const DEFAULT_PRESETS: ExportPreset[] = [
  {
    id: 'preset-print', name: '印刷分版(默认)', veinColor: '#14352a', patternFill: '#8a5a25',
    patternOpacity: 0.85, strokeWidth: 2.2, splitLayers: true, includeBg: false,
  },
  {
    id: 'preset-web', name: '网页预览', veinColor: '#1f7a43', patternFill: '#c07a2b',
    patternOpacity: 0.6, strokeWidth: 1.6, splitLayers: false, includeBg: true,
  },
];

function loadPersisted(): PersistShape {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const data = JSON.parse(raw) as PersistShape;
      return {
        templates: data.templates ?? [],
        presets: data.presets?.length ? data.presets : DEFAULT_PRESETS,
        submissions: data.submissions ?? [],
        stats: data.stats ?? [],
        users: data.users?.length ? data.users : DEFAULT_USERS,
      };
    }
  } catch { /* 损坏的存档直接退回默认 */ }
  return {
    templates: [], presets: DEFAULT_PRESETS, submissions: [], stats: [], users: DEFAULT_USERS,
  };
}

const persisted = loadPersisted();

// ---------- 全局信号 ----------
export const [currentUser, setCurrentUser] = createSignal(persisted.users[0]);
export const [view, setView] = createSignal<'studio' | 'review' | 'admin' | 'stats'>('studio');
export const [users] = createSignal(persisted.users);

export const [templates, setTemplates] = createSignal<Template[]>(persisted.templates);
export const [presets, setPresets] = createSignal<ExportPreset[]>(persisted.presets);
export const [submissions, setSubmissions] = createSignal<Submission[]>(persisted.submissions);
export const [stats, setStats] = createSignal(persisted.stats);

// ---------- 持久化(bitmap 不可序列化,自动被 JSON 丢弃) ----------
function persist() {
  const data: PersistShape = {
    templates: templates().map(t => ({ ...t, paths: t.paths.map(clonePath) })),
    presets: presets(),
    submissions: submissions().map(s => ({ ...s })),
    stats: stats(),
    users: users(),
  };
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

// ---------- 模板库 ----------
export function saveTemplate(name: string, family: string, paths: PathData[]): Template {
  const tpl: Template = {
    id: uid('tpl'), name, family, createdAt: Date.now(),
    paths: paths.filter(p => p.kind === 'vein').map(clonePath),
  };
  setTemplates(prev => [tpl, ...prev]);
  persist();
  return tpl;
}

export function deleteTemplate(id: string) {
  setTemplates(prev => prev.filter(t => t.id !== id));
  persist();
}

export function applyTemplate(tpl: Template): PathData[] {
  // 重新分配 id,避免与现有路径冲突;整体小幅偏移以便区分
  return tpl.paths.map((p, i) => ({
    ...clonePath(p),
    id: uid('path'),
    name: `${tpl.name}·${p.name}`,
    locked: false,
    visible: true,
    nodes: p.nodes.map(n => ({ x: n.x + 24, y: n.y + 24 + i * 4 })),
    handlesIn: p.handlesIn.map(h => (h ? { ...h } : null)),
    handlesOut: p.handlesOut.map(h => (h ? { ...h } : null)),
    holes: p.holes.map(r => r.map(q => ({ ...q }))),
  }));
}

// ---------- 导出预设 ----------
export function savePreset(preset: ExportPreset) {
  setPresets(prev => {
    const idx = prev.findIndex(p => p.id === preset.id);
    if (idx >= 0) {
      const next = [...prev];
      next[idx] = preset;
      return next;
    }
    return [...prev, preset];
  });
  persist();
}
export function deletePreset(id: string) {
  setPresets(prev => prev.filter(p => p.id !== id));
  persist();
}
export const newPresetId = () => uid('preset');

// ---------- 提交与审校 ----------
export function createSubmission(input: {
  docId: string; specimenCode: string; family: string; species: string;
  illustrator: string; snapshot: Submission['snapshot'];
}): Submission {
  const sub: Submission = {
    id: uid('sub'),
    ...input,
    submittedAt: Date.now(),
    status: 'pending',
    annotations: [],
  };
  setSubmissions(prev => [sub, ...prev]);
  bumpStats(input.illustrator);
  persist();
  return sub;
}

export function addAnnotation(subId: string, ann: Omit<Annotation, 'id' | 'createdAt' | 'author'>) {
  setSubmissions(prev => prev.map(s => {
    if (s.id !== subId) return s;
    const full: Annotation = {
      ...ann, id: uid('ann'), createdAt: Date.now(), author: currentUser().name,
    };
    return { ...s, annotations: [...s.annotations, full] };
  }));
  persist();
}

export function removeAnnotation(subId: string, annId: string) {
  setSubmissions(prev => prev.map(s =>
    s.id === subId ? { ...s, annotations: s.annotations.filter(a => a.id !== annId) } : s));
  persist();
}

export function reviewSubmission(subId: string, status: 'approved' | 'rejected', reviewer: string) {
  setSubmissions(prev => prev.map(s =>
    s.id === subId
      ? { ...s, status, reviewedBy: reviewer, reviewedAt: Date.now() }
      : s));
  persist();
}

// ---------- 统计 ----------
function bumpStats(illustrator: string) {
  const date = new Date().toISOString().slice(0, 10);
  setStats(prev => {
    const idx = prev.findIndex(r => r.illustrator === illustrator && r.date === date);
    if (idx >= 0) {
      const next = [...prev];
      next[idx] = { ...next[idx], count: next[idx].count + 1 };
      return next;
    }
    return [...prev, { illustrator, date, count: 1 }];
  });
  persist();
}

export function addDemoStats() {
  // 供后台演示:补最近 6 天的模拟数据
  const illustrators = users().filter(u => u.role === 'illustrator').map(u => u.name);
  const rows = [...stats()];
  for (let d = 6; d >= 1; d--) {
    const date = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    illustrators.forEach((name, i) => {
      if (!rows.some(r => r.illustrator === name && r.date === date)) {
        rows.push({ illustrator: name, date, count: 2 + ((d * 7 + i * 3) % 6) });
      }
    });
  }
  setStats(rows);
  persist();
}

export { HISTORY_LIMIT };
export type { GuideLine, PathData, Pt };
