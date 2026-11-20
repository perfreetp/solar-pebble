// Project / order / review domain state. Browser-local persistence via localStorage.

import { writable, derived, get } from 'svelte/store';
import { makeSeed, normalizeSeed } from './nest/seed.js';

const STORAGE_KEY = 'nestworks.v1';

export const ROLE_ORDER = ['designer', 'supervisor', 'client'];

export const ROLES = {
  designer: { key: 'designer', label: '制作员', short: '制' },
  supervisor: { key: 'supervisor', label: '主管', short: '审' },
  client: { key: 'client', label: '客户', short: '客' }
};

function iso(offsetHours = 0) {
  return new Date(Date.now() + offsetHours * 3600 * 1000).toISOString();
}

function day(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400 * 1000).toISOString();
}

export const PROJECTS = [
  {
    id: 'P-2608',
    name: '《土壤之下》第三集 · 切叶蚁巢',
    client: '蓝鲸自然纪录片',
    episodes: 6,
    deadline: day(6),
    brief: '需要展示切叶蚁主巢的完整剖面，重点表现菌圃室与育幼室的层级关系。'
  },
  {
    id: 'P-2611',
    name: '科普展馆 · 地下王国互动屏',
    client: '城西自然博物馆',
    episodes: 3,
    deadline: day(12),
    brief: '触屏交互，俯视总览 + 剖切正视图各一套，材质需要干土和湿土两版对比。'
  },
  {
    id: 'P-2614',
    name: '小学自然课 · 蚂蚁的家',
    client: '启明教育出版社',
    episodes: 4,
    deadline: day(19),
    brief: '面向 8-10 岁，配色明亮，通道不要过细。'
  }
];

const shotBase = [
  { key: 'overview', label: '全景', note: '45° 俯视总览，展示全部入口与层级', camera: 'persp' },
  { key: 'topdown', label: '俯视', note: '正上方垂直俯视，看入口分布', camera: 'top' },
  { key: 'section', label: '剖切正视', note: '前向剖切，看土层与分室层级', camera: 'front' }
];

function defaultOrders() {
  return [
    {
      id: 'O-1042',
      projectId: 'P-2608',
      title: '第 3 集 主巢剖面 · 全套镜头',
      shots: shotBase.map((s, i) => ({
        ...s,
        id: `S-1042-${i + 1}`,
        status: i === 0 ? 'approved' : 'draft',
        reworkCount: i === 0 ? 1 : 0,
        deadline: day(2 + i),
        seed: ['QK7M-2XPA', 'QK7M-2XPA', 'QK7M-2XPA'][i],
        params: null,
        locks: {},
        preview: null,
        scene: null,
        notes: '',
        history: i === 0 ? [{ at: day(-2), action: 'reject', by: '主管', text: '剖切面上 M2 甬道被土挡住看不到，请把 M2 的走向改平缓一些，或换种子重出。', seed: 'QK7M-2XPA', tunnelIds: ['M2'] }, { at: day(-1), action: 'approve', by: '主管', text: '已修改 M2 走向，剖面干净，通过。' }] : []
      }))
    },
    {
      id: 'O-1051',
      projectId: 'P-2611',
      title: '互动屏 · 俯视与剖切两套',
      shots: [
        { ...shotBase[1], id: 'S-1051-1', status: 'submitted', reworkCount: 2, deadline: day(-1), seed: 'TR4W-9QBN', params: null, locks: {}, preview: null, scene: null, notes: '', history: [
          { at: day(-5), action: 'reject', by: '主管', text: '第 2 层储粮室太挤，通道 B2-2-2 走向压在菌圃上，改一下 B2-2-2。', seed: 'TR4W-9QBN', tunnelIds: ['B2-2-2'] },
          { at: day(-3), action: 'reject', by: '主管', text: '入口还是偏左，换种子重新出一版。', seed: 'H8NM-5CVD', tunnelIds: [] }
        ] },
        { ...shotBase[2], id: 'S-1051-2', status: 'draft', reworkCount: 0, deadline: day(4), seed: 'TR4W-9QBN', params: null, locks: {}, preview: null, scene: null, notes: '', history: [] }
      ]
    }
  ];
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.orders)) return parsed;
    }
  } catch (e) {
    /* ignore */
  }
  return { orders: defaultOrders(), role: 'designer', activeOrderId: 'O-1042', activeShotId: 'S-1042-1', currentProjectId: 'P-2608' };
}

const initial = load();

export const store = writable(initial);

let saveTimer = null;
store.subscribe((value) => {
  if (typeof localStorage === 'undefined') return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch (e) {
      /* quota */
    }
  }, 250);
});

export const role = derived(store, (s) => s.role);

export function setRole(r) {
  store.update((s) => ({ ...s, role: r }));
}

export function activeOrder(s) {
  return s.orders.find((o) => o.id === s.activeOrderId) || s.orders[0];
}

export function activeShot(s) {
  const order = activeOrder(s);
  if (!order) return null;
  return order.shots.find((x) => x.id === s.activeShotId) || order.shots[0];
}

export function projectOf(s, order = activeOrder(s)) {
  return PROJECTS.find((p) => p.id === order?.projectId) || PROJECTS[0];
}

export function selectOrder(orderId) {
  store.update((s) => {
    const order = s.orders.find((o) => o.id === orderId);
    return { ...s, activeOrderId: orderId, activeShotId: order?.shots[0]?.id ?? null, currentProjectId: order?.projectId ?? s.currentProjectId };
  });
}

export function selectShot(shotId) {
  store.update((s) => ({ ...s, activeShotId: shotId }));
}

export function updateShot(orderId, shotId, fn) {
  store.update((s) => ({
    ...s,
    orders: s.orders.map((o) =>
      o.id !== orderId
        ? o
        : { ...o, shots: o.shots.map((sh) => (sh.id !== shotId ? sh : fn({ ...sh }))) }
    )
  }));
}

export function resetAll() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    /* ignore */
  }
  store.set({ orders: defaultOrders(), role: 'designer', activeOrderId: 'O-1042', activeShotId: 'S-1042-1', currentProjectId: 'P-2608' });
}

export function defaultShotConfig() {
  return { seed: makeSeed(), params: null, locks: {}, notes: '' };
}

export function nextShotId(order) {
  const used = new Set(order.shots.map((s) => s.id));
  let i = order.shots.length + 1;
  while (used.has(`S-${order.id.slice(2)}-${i}`)) i++;
  return `S-${order.id.slice(2)}-${i}`;
}

export function addShot(orderId, shot) {
  let newId = null;
  store.update((s) => ({
    ...s,
    orders: s.orders.map((o) => {
      if (o.id !== orderId) return o;
      newId = nextShotId(o);
      const full = {
        id: newId,
        key: shot.key || `custom-${o.shots.length + 1}`,
        label: shot.label || '新镜头',
        note: shot.note || '',
        camera: shot.camera || 'persp',
        status: 'draft',
        reworkCount: 0,
        deadline: shot.deadline || day(3),
        seed: normalizeSeed(shot.seed || makeSeed()),
        params: shot.params || null,
        locks: shot.locks || {},
        preview: null,
        scene: null,
        notes: '',
        history: []
      };
      return { ...o, shots: [...o.shots, full] };
    })
  }));
  return newId;
}

export function addOrder(projectId, title) {
  let newId = null;
  store.update((s) => {
    const num = 1042 + s.orders.length * 7 + 3;
    newId = `O-${num}`;
    const shots = shotBase.slice(0, 2).map((shot, i) => ({
      ...shot,
      id: `S-${num}-${i + 1}`,
      status: 'draft',
      reworkCount: 0,
      deadline: day(3 + i),
      seed: makeSeed(),
      params: null,
      locks: {},
      preview: null,
      scene: null,
      notes: '',
      history: []
    }));
    return { ...s, orders: [...s.orders, { id: newId, projectId, title, shots }] };
  });
  return newId;
}

export function setShotStatus(orderId, shotId, status, entry) {
  updateShot(orderId, shotId, (sh) => {
    const history = [...(sh.history || [])];
    if (entry) history.push({ at: new Date().toISOString(), ...entry });
    return { ...sh, status, history };
  });
}
