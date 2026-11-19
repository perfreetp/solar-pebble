import { BaseElement, defineElement, htmlEscape } from './base';
import { TOKENS, PANEL } from './styles';
import type { Store } from './store';
import type { Studio } from '../studio';
import type { ArchiveRecord, VersionRecord } from '../core/archive-types';
import { summarizeParams } from '../core/doc';

export class ArchivePanel extends BaseElement {
  private store!: Store;
  private studio!: Studio;
  private unsubscribe: (() => void) | null = null;
  private filter = { year: 'all' as number | 'all', region: 'all', level: 'all' as 1 | 2 | 3 | 'all', keyword: '' };

  setup(store: Store, studio: Studio): void {
    this.store = store;
    this.studio = studio;
    this.unsubscribe?.();
    this.unsubscribe = store.subscribe((_s, patch) => {
      if ('network' in patch || 'view' in patch || 'activeArchiveId' in patch) this.invalidate();
    });
  }

  protected override onUnmount(): void {
    this.unsubscribe?.();
  }

  private canArchive(): boolean {
    return !!this.store.get().network;
  }

  protected render(): void {
    const s = this.store.get();
    this.useStyles(TOKENS + PANEL + /* css */ `
      :host { display: block; height: 100%; }
      .wrap { display: grid; grid-template-columns: 330px 1fr; gap: 14px; height: 100%; align-items: start; }
      @media (max-width: 980px) { .wrap { grid-template-columns: 1fr; } }
      .field { display: flex; flex-direction: column; gap: 4px; }
      .field label { font-size: 11px; color: var(--fg-mute); }
      .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .filters { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .list { display: flex; flex-direction: column; gap: 8px; overflow: auto; max-height: calc(100vh - 210px); padding-right: 4px; }
      .card {
        border: 1px solid var(--line-soft); border-radius: var(--radius);
        background: var(--bg-1); padding: 10px 12px; cursor: pointer;
        transition: border-color 120ms, background 120ms;
      }
      .card:hover { border-color: var(--line); background: var(--bg-2); }
      .card.active { border-color: var(--accent); background: var(--accent-soft); }
      .card-top { display: flex; align-items: baseline; gap: 8px; }
      .code { font-family: var(--mono); font-size: 12px; color: var(--accent); }
      .name { font-size: 13px; font-weight: 600; }
      .meta { font-size: 11px; color: var(--fg-mute); margin-top: 3px; display: flex; gap: 8px; flex-wrap: wrap; }
      .meta .dot-sep { opacity: 0.4; }
      .stat-row { display: flex; gap: 12px; margin-top: 7px; font-size: 11px; color: var(--fg-dim); font-family: var(--mono); }
      .lvl-bars { display: flex; gap: 2px; margin-top: 7px; height: 4px; border-radius: 2px; overflow: hidden; background: var(--bg-0); }
      .lvl-bars > i { display: block; height: 100%; }
      .empty { color: var(--fg-mute); font-size: 12px; line-height: 1.7; padding: 16px; text-align: center; }
      .row-actions { display: flex; gap: 6px; margin-top: 9px; }
      .search { display: flex; gap: 6px; }
      .tagline { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 6px; }
      .mono-sm { font-family: var(--mono); font-size: 10.5px; }
      .count { font-size: 11px; color: var(--fg-mute); margin: 3px 0 8px; }
    `);

    const results = this.studio.searchArchives({
      year: this.filter.year,
      region: this.filter.region,
      level: this.filter.level,
      keyword: this.filter.keyword,
    });
    const years = this.studio.years();
    const regions = this.studio.regions();

    this.setContent(`
      <div class="wrap">
        <div class="col" style="gap:10px">
          <div class="panel">
            <div class="panel-head">建立编号档案</div>
            <div class="panel-body col" style="gap:9px">
              <div class="field">
                <label>成果名称</label>
                <input type="text" data-meta="archiveName" value="${htmlEscape(s.archiveName)}">
              </div>
              <div class="grid2">
                <div class="field">
                  <label>区域 / 岸段</label>
                  <input type="text" data-meta="region" value="${htmlEscape(s.region)}">
                </div>
                <div class="field">
                  <label>调查单位</label>
                  <input type="text" data-meta="surveyor" value="${htmlEscape(s.surveyor)}">
                </div>
              </div>
              <div class="field">
                <label>观测日期</label>
                <input type="date" data-meta="observedAt" value="${htmlEscape(s.observedAt)}">
              </div>
              <button class="primary" data-act="archive" ${this.canArchive() ? '' : 'disabled'}>
                ${this.canArchive() ? '归档当前网络' : '先在工作台生成网络'}
              </button>
              <div class="meta mono-sm" style="color:var(--fg-mute)">
                ${s.network ? `指纹 ${s.network.fingerprint} · ${summarizeParams(s.network.params)}` : '—'}
              </div>
              ${s.basemap ? `<div class="meta mono-sm" style="color:var(--fg-mute)">含航拍底图: ${htmlEscape(s.basemap.name)}</div>` : ''}
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">检索</div>
            <div class="panel-body col" style="gap:8px">
              <div class="search">
                <input type="text" data-filter="keyword" value="${htmlEscape(this.filter.keyword)}" placeholder="编号 / 名称 / 单位">
              </div>
              <div class="filters">
                <div class="field">
                  <label>年份</label>
                  <select data-filter="year">
                    <option value="all" ${this.filter.year === 'all' ? 'selected' : ''}>全部年份</option>
                    ${years.map((y) => `<option value="${y}" ${this.filter.year === y ? 'selected' : ''}>${y}</option>`).join('')}
                  </select>
                </div>
                <div class="field">
                  <label>区域</label>
                  <select data-filter="region">
                    <option value="all" ${this.filter.region === 'all' ? 'selected' : ''}>全部区域</option>
                    ${regions.map((r) => `<option value="${htmlEscape(r)}" ${this.filter.region === r ? 'selected' : ''}>${htmlEscape(r)}</option>`).join('')}
                  </select>
                </div>
                <div class="field" style="grid-column:1/-1">
                  <label>沟级别 (档案含该级沟道)</label>
                  <select data-filter="level">
                    <option value="all" ${this.filter.level === 'all' ? 'selected' : ''}>不限</option>
                    <option value="1" ${this.filter.level === 1 ? 'selected' : ''}>主干沟</option>
                    <option value="2" ${this.filter.level === 2 ? 'selected' : ''}>支沟</option>
                    <option value="3" ${this.filter.level === 3 ? 'selected' : ''}>毛细沟</option>
                  </select>
                </div>
              </div>
              <div class="row">
                <button class="small" data-act="export-db">导出档案库</button>
                <button class="small ghost" data-act="import-db">导入</button>
                <span class="spacer"></span>
                <button class="small ghost danger" data-act="clear-db">清空</button>
              </div>
            </div>
          </div>
        </div>

        <div class="col" style="gap:10px;min-width:0">
          <div class="panel">
            <div class="panel-head">
              <span>档案列表</span>
              <span class="spacer"></span>
              <span class="chip">${results.length} / ${this.studio.listArchives().length}</span>
            </div>
            <div class="panel-body">
              <div class="count">按年份、区域、沟级别检索 —— 点击档案可在工作台载入参数, 或与当前结果并排比对。</div>
              ${
                results.length === 0
                  ? `<div class="empty">没有匹配的档案。<br>生成网络后点击「归档当前网络」建立第一份编号档案。</div>`
                  : `<div class="list">${results.map((a) => this.card(a)).join('')}</div>`
              }
            </div>
          </div>
        </div>
      </div>
    `);

    this.bind();
  }

  private card(a: ArchiveRecord): string {
    const s = this.store.get();
    const lc = a.levelCounts;
    const total = (lc['1'] ?? 0) + (lc['2'] ?? 0) + (lc['3'] ?? 0);
    const pct = (n: number) => (total ? (n / total) * 100 : 0);
    const active = s.activeArchiveId === a.id;
    return `
      <div class="card ${active ? 'active' : ''}" data-archive="${a.id}">
        <div class="card-top">
          <span class="code">${htmlEscape(a.code)}</span>
          <span class="name">${htmlEscape(a.name)}</span>
        </div>
        <div class="meta">
          <span>${a.year}</span><span class="dot-sep">·</span>
          <span>${htmlEscape(a.region)}</span><span class="dot-sep">·</span>
          <span>${htmlEscape(a.observedAt)}</span><span class="dot-sep">·</span>
          <span>${htmlEscape(a.surveyor)}</span>
        </div>
        <div class="meta mono-sm">指纹 ${a.fingerprint}</div>
        <div class="lvl-bars">
          <i style="background:#5fe0d8;width:${pct(lc['1'] ?? 0)}%"></i>
          <i style="background:#3fa9c4;width:${pct(lc['2'] ?? 0)}%"></i>
          <i style="background:#3d7f9b;width:${pct(lc['3'] ?? 0)}%"></i>
        </div>
        <div class="stat-row">
          <span>主干 ${lc['1'] ?? 0}</span>
          <span>支沟 ${lc['2'] ?? 0}</span>
          <span>毛细 ${lc['3'] ?? 0}</span>
          <span>${(a.stats.totalLength / 1000).toFixed(2)} km</span>
          <span>${a.stats.densityKmPerKm2.toFixed(1)} km/km²</span>
        </div>
        <div class="tagline">
          ${a.lockCount > 0 ? `<span class="chip warn">锁定 ${a.lockCount}</span>` : ''}
          ${a.basemap ? `<span class="chip">航拍底图</span>` : ''}
          <span class="chip">版本 ${this.studio.listVersions(a.id).length}</span>
        </div>
        <div class="row-actions">
          <button class="small" data-load="${a.id}">载入</button>
          <button class="small" data-compare="${a.id}">并排比对</button>
          <button class="small ghost" data-report="${a.id}">调查说明</button>
          <span class="spacer"></span>
          <button class="small ghost danger" data-del="${a.id}">删除</button>
        </div>
      </div>`;
  }

  private bind(): void {
    for (const el of this.$$<HTMLInputElement>('[data-meta]')) {
      el.addEventListener('change', () => {
        const key = el.dataset.meta as 'archiveName' | 'region' | 'surveyor' | 'observedAt';
        this.store.set({ [key]: el.value } as never);
      });
    }
    for (const el of this.$$<HTMLInputElement | HTMLSelectElement>('[data-filter]')) {
      el.addEventListener('change', () => {
        const key = el.dataset.filter as 'year' | 'region' | 'level' | 'keyword';
        let v: unknown = el.value;
        if (key === 'year') v = el.value === 'all' ? 'all' : Number(el.value);
        if (key === 'level') v = el.value === 'all' ? 'all' : Number(el.value);
        (this.filter as Record<string, unknown>)[key] = v;
        this.invalidate();
      });
    }
    this.$('[data-act="archive"]')?.addEventListener('click', () => this.doArchive());
    for (const el of this.$$<HTMLElement>('[data-load]')) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.emit('archive-load', { id: el.dataset.load });
      });
    }
    for (const el of this.$$<HTMLElement>('[data-compare]')) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.emit('archive-compare', { id: el.dataset.compare });
      });
    }
    for (const el of this.$$<HTMLElement>('[data-report]')) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.emit('archive-report', { id: el.dataset.report });
      });
    }
    for (const el of this.$$<HTMLElement>('[data-del]')) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = el.dataset.del!;
        if (!window.confirm('删除该档案及其全部历史版本与锁定段?')) return;
        this.studio.deleteArchive(id);
        if (this.store.get().activeArchiveId === id) this.store.set({ activeArchiveId: null });
        this.store.toast('档案已删除', 'info');
        this.invalidate();
      });
    }
    this.$('[data-act="export-db"]')?.addEventListener('click', () => this.emit('db-export', {}));
    this.$('[data-act="import-db"]')?.addEventListener('click', () => this.emit('db-import', {}));
    this.$('[data-act="clear-db"]')?.addEventListener('click', () => {
      if (!window.confirm('清空全部档案、版本与锁定段? 此操作不可撤销。')) return;
      this.studio.clearAll();
      this.store.set({ activeArchiveId: null });
      this.invalidate();
    });
  }

  private doArchive(): void {
    const s = this.store.get();
    if (!s.network) return;
    const rec = this.studio.createArchive({
      name: s.archiveName.trim() || '潮沟网络调查成果',
      region: s.region.trim() || '未指定区域',
      year: Number(s.observedAt.slice(0, 4)) || new Date().getFullYear(),
      surveyor: s.surveyor.trim(),
      observedAt: s.observedAt,
      network: s.network,
      basemap: s.basemap,
      lockCount: s.locks.length,
    });
    this.studio.saveVersion(rec.id, '归档时快照', s.network);
    if (s.locks.length) this.studio.replaceLocks(rec.id, s.locks);
    this.store.set({ activeArchiveId: rec.id });
    this.store.toast(`已归档: ${rec.code}`, 'ok');
    this.invalidate();
  }

  versionsOf(id: string): VersionRecord[] {
    return this.studio.listVersions(id);
  }
}

defineElement('archive-panel', ArchivePanel);
