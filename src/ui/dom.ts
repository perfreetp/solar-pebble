/** 极简 DOM 构建工具 */
type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

export function h(tag: string, attrs: Attrs = {}, ...children: (Node | string | null | undefined)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k === 'value') {
      (el as HTMLInputElement).value = String(v);
    } else if (v === true) {
      el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    el.append(c);
  }
  return el;
}

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function daysLeft(deadline: string): number {
  const end = new Date(deadline + 'T23:59:59').getTime();
  return Math.ceil((end - Date.now()) / 86400000);
}

export function deadlineText(deadline: string): { text: string; overdue: boolean } {
  const d = daysLeft(deadline);
  if (d < 0) return { text: `${deadline}(已逾期 ${-d} 天)`, overdue: true };
  if (d === 0) return { text: `${deadline}(今天截止)`, overdue: false };
  return { text: `${deadline}(剩 ${d} 天)`, overdue: false };
}
