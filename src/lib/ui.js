import { writable } from 'svelte/store';

export const toasts = writable([]);
let seq = 0;

export function toast(message, kind = 'info', ms = 2600) {
  const id = ++seq;
  toasts.update((t) => [...t, { id, message, kind }]);
  setTimeout(() => {
    toasts.update((t) => t.filter((x) => x.id !== id));
  }, ms);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e2) {
      return false;
    }
  }
}

export function fmtDate(iso, withTime = false) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  if (!withTime) return `${m}/${day}`;
  return `${y}-${m}-${day} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtRelative(iso) {
  if (!iso) return '—';
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '—';
  const diff = d - Date.now();
  const abs = Math.abs(diff);
  const day = 86400000;
  const hour = 3600000;
  const rtf = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
  if (abs >= day) return rtf.format(Math.round(diff / day), 'day');
  if (abs >= hour) return rtf.format(Math.round(diff / hour), 'hour');
  return rtf.format(Math.round(diff / 60000), 'minute');
}

export function deadlineMeta(iso) {
  if (!iso) return { text: '—', urgent: false, overdue: false };
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return { text: '—', urgent: false, overdue: false };
  const diff = d - Date.now();
  const overdue = diff < 0;
  const urgent = !overdue && diff < 86400000 * 1.5;
  return { text: fmtDate(iso), urgent, overdue, hours: Math.round(diff / 3600000) };
}

export function uid(prefix = 'x') {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}
