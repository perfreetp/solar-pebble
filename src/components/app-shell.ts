import { store } from '../store';
import { shellCss } from './shared-css';

const TABS = [
  { id: 'editor', label: '三维布置编辑', icon: '▦' },
  { id: 'orders', label: '前台接单 / 派工', icon: '✎' },
  { id: 'workshop', label: '师傅工作台 / 质检', icon: '⚒' },
  { id: 'board', label: '完成看板', icon: '📊' }
] as const;

export type TabId = (typeof TABS)[number]['id'];

/** 应用外壳：顶部导航 + 四个界面切换（Shadow DOM） */
export class AppShell extends HTMLElement {
  private tab: TabId = 'editor';
  private root!: ShadowRoot;

  connectedCallback(): void {
    this.root = this.attachShadow({ mode: 'open' });
    this.syncFromHash();
    this.render();
    window.addEventListener('hashchange', () => {
      this.syncFromHash();
      this.render();
    });
  }

  private syncFromHash(): void {
    const id = location.hash.replace('#/', '') as TabId;
    if (TABS.some((t) => t.id === id)) this.tab = id;
  }

  private render(): void {
    const pendingCount = store.jobs.filter((j) => j.status === 'pending').length;
    const qcCount = store.jobs.filter((j) => j.status === 'submitted').length;
    const viewTag = {
      editor: 'view-editor', orders: 'view-orders',
      workshop: 'view-workshop', board: 'view-board'
    }[this.tab];
    this.root.innerHTML = `
      <style>${shellCss}</style>
      <header class="topbar">
        <div class="brand">
          <span class="logo">🪲</span>
          <div>
            <div class="title">生态展箱三维布置编辑器</div>
            <div class="subtitle">自然博物馆 · 昆虫展陈组</div>
          </div>
        </div>
        <nav>
          ${TABS.map((t) => {
            let dot = '';
            if (t.id === 'orders' && pendingCount) dot = `<span class="dot">${pendingCount}</span>`;
            if (t.id === 'workshop' && qcCount) dot = `<span class="dot warn">${qcCount}</span>`;
            return `
              <button data-tab="${t.id}" class="${this.tab === t.id ? 'active' : ''}">
                ${t.icon} ${t.label}${dot}
              </button>`;
          }).join('')}
        </nav>
      </header>
      <main class="view-host"><${viewTag}></${viewTag}></main>`;
    this.root.querySelectorAll('button[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        location.hash = `/${(btn as HTMLElement).dataset.tab}`;
      });
    });
  }
}
