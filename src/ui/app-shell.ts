import { BaseElement, defineElement } from './base';
import { TOKENS } from './styles';
import type { Store, MainView } from './store';

export class AppShell extends BaseElement {
  private store!: Store;
  private unsubscribe: (() => void) | null = null;

  setup(store: Store): void {
    this.store = store;
    this.unsubscribe?.();
    this.unsubscribe = store.subscribe((_s, patch) => {
      if ('view' in patch || 'network' in patch || 'generating' in patch) this.invalidate();
    });
  }

  protected override onUnmount(): void {
    this.unsubscribe?.();
  }

  protected render(): void {
    const s = this.store.get();
    this.useStyles(TOKENS + /* css */ `
      :host { display: block; height: 100vh; background: var(--bg-0); }
      .shell { display: grid; grid-template-rows: 48px minmax(0, 1fr); height: 100vh; }
      .topbar {
        display: flex; align-items: center; gap: 10px; padding: 0 12px;
        border-bottom: 1px solid var(--line-soft);
        background: linear-gradient(180deg, #101c22, #0d181d);
        z-index: 10;
        min-width: 0;
        overflow: hidden;
      }
      @media (max-width: 720px) {
        .topbar { overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
        .topbar::-webkit-scrollbar { display: none; }
        .brand { font-size: 12.5px; }
        .tab { padding: 5px 8px; font-size: 12px; }
        .fp-chip { display: none; }
      }
      .brand { display: flex; align-items: center; gap: 8px; font-weight: 650; font-size: 13.5px; letter-spacing: 0.01em; white-space: nowrap; flex: none; }
      .brand-icon { width: 18px; height: 18px; }
      .sep { width: 1px; height: 20px; background: var(--line-soft); }
      .tabs { display: flex; gap: 2px; flex: 0 0 auto; }
      .tab {
        padding: 6px 12px; border-radius: var(--radius-sm); font-size: 12.5px;
        background: transparent; border: 1px solid transparent; color: var(--fg-dim); cursor: pointer;
      }
      .tab:hover { background: var(--bg-2); color: var(--fg); }
      .tab.active { background: var(--accent-soft); border-color: rgba(79,209,197,0.35); color: var(--accent); font-weight: 600; }
      .main { min-height: 0; overflow: hidden; display: block; }
      slot { display: block; height: 100%; }
      .toast {
        position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
        padding: 9px 16px; border-radius: 7px; font-size: 12.5px; z-index: 100;
        background: #1a2b33; border: 1px solid var(--line); box-shadow: var(--shadow);
        animation: rise 160ms ease-out;
      }
      .toast.ok { border-color: rgba(110,211,160,0.5); color: #c9f5de; }
      .toast.warn { border-color: rgba(242,176,74,0.5); color: #f7e3bd; }
      .toast.error { border-color: rgba(232,116,106,0.5); color: #ffd9d4; }
      @keyframes rise { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }
      .spinner {
        width: 12px; height: 12px; border-radius: 50%;
        border: 2px solid rgba(79,209,197,0.25); border-top-color: var(--accent);
        animation: spin 700ms linear infinite; display: inline-block;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
    `);

    const tabs: { id: MainView; label: string }[] = [
      { id: 'workspace', label: '生成工作台' },
      { id: 'compare', label: '版本比对' },
      { id: 'archive', label: '编号档案' },
      { id: 'report', label: '调查说明' },
    ];

    this.setContent(`
      <div class="shell">
        <header class="topbar">
          <div class="brand">
            <svg class="brand-icon" viewBox="0 0 24 24" fill="none" stroke="#4fd1c5" stroke-width="1.7" stroke-linecap="round">
              <path d="M3 5c3 0 3 3 6 3s3-3 6-3 3 3 6 3"/>
              <path d="M3 12c3 0 3 3 6 3s3-3 6-3 3 3 6 3" opacity="0.75"/>
              <path d="M3 19c3 0 3 3 6 3s3-3 6-3 3 3 6 3" opacity="0.5"/>
              <path d="M12 8v8" stroke="#3fa9c4"/>
            </svg>
            潮沟网络工作台
          </div>
          <span class="sep"></span>
          <nav class="tabs">
            ${tabs
              .map(
                (t) =>
                  `<button class="tab ${s.view === t.id ? 'active' : ''}" data-view="${t.id}">${t.label}</button>`,
              )
              .join('')}
          </nav>
          <span class="spacer"></span>
          ${s.generating ? `<span class="spinner"></span><span class="dim" style="font-size:12px">生成中…</span>` : ''}
          ${s.network ? `<span class="chip mono fp-chip" title="参数指纹">${s.network.fingerprint}</span>` : ''}
        </header>
        <div class="main">
          <slot name="body"></slot>
        </div>
      </div>
      ${
        s.toast
          ? `<div class="toast ${s.toast.kind}">${s.toast.text}</div>`
          : ''
      }
    `);

    for (const btn of this.$$<HTMLButtonElement>('[data-view]')) {
      btn.addEventListener('click', () => {
        this.emit('view-change', { view: btn.dataset.view as MainView });
      });
    }
    this.style.display = 'block';
  }
}

defineElement('app-shell', AppShell);
