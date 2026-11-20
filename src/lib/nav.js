// View + role coordination. Switching role lands the user on that role's
// primary workspace, and views not belonging to a role are marked off-limits.

import { writable, get } from 'svelte/store';
import { store } from './state.js';

export const VIEWS = [
  { key: 'studio', label: '场景制作', icon: 'cube', roles: ['designer', 'supervisor'] },
  { key: 'tasks', label: '镜头任务', icon: 'list', roles: ['designer', 'supervisor'] },
  { key: 'review', label: '审核交付', icon: 'check', roles: ['supervisor'] },
  { key: 'client', label: '项目下单', icon: 'cart', roles: ['designer', 'supervisor', 'client'] }
];

export const HOME_VIEW = { designer: 'studio', supervisor: 'review', client: 'client' };

export const view = writable('studio');

export function go(v) {
  const roles = VIEWS.find((x) => x.key === v)?.roles || [];
  const role = get(store).role;
  if (!roles.includes(role)) {
    return { ok: false, reason: `${roleLabel(role)}无权限进入该界面` };
  }
  view.set(v);
  return { ok: true };
}

export function roleLabel(role) {
  return { designer: '制作员', supervisor: '主管', client: '客户' }[role] || role;
}

export function homeFor(role) {
  return HOME_VIEW[role] || 'studio';
}

// Which actions each role may perform.
export const CAPS = {
  designer: { editScene: true, submit: true, approve: false, deliver: false, placeOrder: false, addShot: true },
  supervisor: { editScene: true, submit: true, approve: true, deliver: true, placeOrder: true, addShot: true },
  client: { editScene: false, submit: false, approve: false, deliver: false, placeOrder: true, addShot: false }
};
