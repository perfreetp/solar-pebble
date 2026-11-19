/** 全局 toast 工具，挂在 body 下的 #toast-host */
let host: HTMLDivElement | null = null;

export function toast(text: string, kind: 'error' | 'info' = 'info'): void {
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  host.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.25s';
    setTimeout(() => el.remove(), 260);
  }, 2600);
}
