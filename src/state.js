/**
 * 应用级状态：当前登录成员、成员列表、订单缓存、提示条。
 * 身份通过 localStorage 记住（车间共用终端时的“当前操作人”切换）。
 */

import { reactive, ref, computed } from 'vue';

const LS_MEMBER = 'lunar.member';
const LS_DATA = 'lunar.data';

export const appState = reactive({
  ready: false,
  error: null,
  me: null,
  members: [],
  groups: [],
  materials: [],
  statuses: {},
  priorities: {},
  orders: [],
  online: false,
});

export const toasts = ref([]);
let toastSeq = 0;

export function toast(message, kind = 'info', ms = 3200) {
  const id = ++toastSeq;
  toasts.value.push({ id, message, kind });
  // 最多同时显示 3 条，超出时挤掉最早的，避免连环核验刷屏
  if (toasts.value.length > 3) toasts.value.splice(0, toasts.value.length - 3);
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, ms);
  return id;
}

export function getMemberId() {
  try {
    return localStorage.getItem(LS_MEMBER);
  } catch {
    return null;
  }
}

export function setMemberId(id) {
  try {
    localStorage.setItem(LS_MEMBER, id);
  } catch {
    /* 隐私模式下忽略 */
  }
}

const BASE = '';

async function api(path, opts = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };
  const memberId = getMemberId();
  if (memberId) headers['X-Member'] = memberId;

  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      ...opts,
      headers,
      body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
    });
  } catch (err) {
    throw new Error(`无法连接本地服务：${err.message}`);
  }
  if (!res.ok) {
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      /* 非 JSON 响应 */
    }
    const error = new Error(payload?.error || `请求失败 (${res.status})`);
    error.status = res.status;
    error.payload = payload;
    throw error;
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res;
}

export const apiClient = {
  bootstrap: () => api('/bootstrap'),
  orders: (q) => api(`/orders${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  order: (id) => api(`/orders/${id}`),
  createOrder: (body) => api('/orders', { method: 'POST', body }),
  patchOrder: (id, body) => api(`/orders/${id}`, { method: 'PATCH', body }),
  assign: (id, body) => api(`/orders/${id}/assign`, { method: 'POST', body }),
  setStatus: (id, body) => api(`/orders/${id}/status`, { method: 'POST', body }),
  model: (id) => api(`/orders/${id}/model`),
  saveModel: (id, body) => api(`/orders/${id}/model`, { method: 'PUT', body }),
  analyze: (id, body) => api(`/orders/${id}/analyze`, { method: 'POST', body }),
  inspect: (id, body = {}) => api(`/orders/${id}/inspect`, { method: 'POST', body }),
  exportPreview: (id) => api(`/orders/${id}/export/preview`),
  exportOrder: (id, body) => api(`/orders/${id}/export`, { method: 'POST', body }),
  dashboard: () => api('/dashboard'),
};

export async function loadBootstrap(force = false) {
  if (appState.ready && !force) return appState;
  try {
    const data = await apiClient.bootstrap();
    appState.members = data.members;
    appState.groups = data.groups;
    appState.materials = data.materials;
    appState.statuses = data.statuses;
    appState.priorities = data.priorities;
    appState.orders = data.orders;
    const saved = getMemberId();
    const found = data.members.find((m) => m.id === saved);
    appState.me = found || data.me;
    if (!saved || !found) setMemberId(appState.me.id);
    appState.ready = true;
    appState.online = true;
    appState.error = null;
  } catch (err) {
    appState.error = err.message;
    appState.ready = false;
    appState.online = false;
    throw err;
  }
  return appState;
}

export async function refreshOrders(q = '') {
  const list = await apiClient.orders(q);
  appState.orders = list;
  return list;
}

/** 让服务端按当前成员的 X-Member 头返回“我”，用于单机演示时切换身份。 */
export function switchMember(id) {
  setMemberId(id);
  const m = appState.members.find((x) => x.id === id);
  if (m) appState.me = m;
  return m;
}

export function memberById(id) {
  return appState.members.find((m) => m.id === id) || null;
}

export function memberName(id) {
  return memberById(id)?.name || '未分派';
}

export function statusMeta(key) {
  return appState.statuses[key] || { label: key, tone: 'neutral' };
}

export function materialById(id) {
  return appState.materials.find((m) => m.id === id) || null;
}

export function groupOf(id) {
  const m = materialById(id);
  return m ? appState.groups.find((g) => g.key === m.group) : null;
}

export function avatarStyle(member) {
  if (!member) return {};
  const h = member.hue ?? 40;
  return {
    background: `linear-gradient(145deg, hsl(${h} 42% 62%), hsl(${h + 18} 38% 48%))`,
    color: `hsl(${h} 60% 12%)`,
  };
}

export function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  const diffMs = now - d;
  const min = Math.round(diffMs / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} 天前`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function uuid(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}
