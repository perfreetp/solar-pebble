import { BaseElement, defineElement, htmlEscape } from './base';
import { TOKENS, PANEL } from './styles';
import type { Store } from './store';
import type { Studio } from '../studio';
import { buildSurveyReport, buildCreekCsv, buildCreekGeoJson, regionCode } from '../core/doc';

export class ReportView extends BaseElement {
  private store!: Store;
  private studio: Studio | null = null;
  private unsubscribe: (() => void) | null = null;
  private format: 'text' | 'csv' | 'geojson' = 'text';

  setup(store: Store, studio?: Studio): void {
    this.store = store;
    this.studio = studio ?? null;
    this.unsubscribe?.();
    this.unsubscribe = store.subscribe((_s, patch) => {
      if ('view' in patch || 'network' in patch || 'archiveName' in patch) this.invalidate();
    });
  }

  protected override onUnmount(): void {
    this.unsubscribe?.();
  }

  private codeFor(): string {
    const s = this.store.get();
    const year = s.observedAt.slice(0, 4) || String(new Date().getFullYear());
    // 已归档则沿用档案编号, 否则按同一规则临时编号
    const rec = s.activeArchiveId ? this.studio?.getArchive(s.activeArchiveId) : undefined;
    if (rec) return rec.code;
    return `TC-${year}-${regionCode(s.region)}-001`;
  }

  protected render(): void {
    const s = this.store.get();
    this.useStyles(TOKENS + PANEL + /* css */ `
      :host { display: block; height: 100%; }
      .wrap { display: grid; grid-template-columns: 1fr 300px; gap: 14px; height: 100%; min-height: 0; }
      @media (max-width: 980px) { .wrap { grid-template-columns: 1fr; } }
      .doc {
        background: var(--bg-1); border: 1px solid var(--line-soft); border-radius: var(--radius);
        padding: 22px 26px; overflow: auto; min-height: 0;
      }
      .doc pre {
        margin: 0; font-family: var(--mono); font-size: 12px; line-height: 1.65;
        color: var(--fg-dim); white-space: pre-wrap; word-break: break-word;
      }
      .tabs { display: flex; gap: 5px; margin-bottom: 10px; }
      .tab {
        padding: 5px 12px; border-radius: var(--radius-sm); font-size: 12px;
        background: var(--bg-0); border: 1px solid var(--line-soft); color: var(--fg-dim); cursor: pointer;
      }
      .tab.active { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
      .side { display: flex; flex-direction: column; gap: 10px; min-height: 0; overflow: auto; }
      .empty { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--fg-mute); font-size: 13px; text-align: center; line-height: 1.7; }
      .actions { display: flex; flex-direction: column; gap: 6px; }
      .meta { font-size: 11px; color: var(--fg-mute); line-height: 1.6; }
      .field { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--fg-mute); }
    `);

    if (!s.network) {
      this.setContent(`<div class="empty">生成网络后可在这里出「调查说明」, 并导出 CSV / GeoJSON。</div>`);
      return;
    }

    const meta = {
      code: this.codeFor(),
      name: s.archiveName,
      region: s.region,
      surveyor: s.surveyor,
      observedAt: s.observedAt,
      basemap: s.basemap?.name ?? null,
      notes: '',
    };

    const content =
      this.format === 'text'
        ? buildSurveyReport(s.network, meta)
        : this.format === 'csv'
          ? buildCreekCsv(s.network)
          : buildCreekGeoJson(s.network);

    this.setContent(`
      <div class="wrap">
        <div class="col" style="min-height:0;gap:8px">
          <div class="tabs">
            <button class="tab ${this.format === 'text' ? 'active' : ''}" data-fmt="text">调查说明</button>
            <button class="tab ${this.format === 'csv' ? 'active' : ''}" data-fmt="csv">CSV 属性表</button>
            <button class="tab ${this.format === 'geojson' ? 'active' : ''}" data-fmt="geojson">GeoJSON</button>
          </div>
          <div class="doc"><pre>${htmlEscape(content)}</pre></div>
        </div>
        <div class="side">
          <div class="panel">
            <div class="panel-head">档案信息</div>
            <div class="panel-body col" style="gap:8px">
              <div class="field"><label>成果名称</label>
                <input type="text" data-meta="archiveName" value="${htmlEscape(s.archiveName)}"></div>
              <div class="field"><label>区域 / 岸段</label>
                <input type="text" data-meta="region" value="${htmlEscape(s.region)}"></div>
              <div class="field"><label>调查单位</label>
                <input type="text" data-meta="surveyor" value="${htmlEscape(s.surveyor)}"></div>
              <div class="field"><label>观测日期</label>
                <input type="date" data-meta="observedAt" value="${htmlEscape(s.observedAt)}"></div>
            </div>
          </div>
          <div class="panel">
            <div class="panel-head">导出</div>
            <div class="panel-body actions">
              <button data-act="copy">复制到剪贴板</button>
              <button data-act="download-txt">下载 .txt 调查说明</button>
              <button data-act="download-csv">下载 CSV 属性表</button>
              <button data-act="download-geojson">下载 GeoJSON</button>
              <div class="meta">
                调查说明含参数、三级结构与分级统计, 末尾附野外校核要点。<br>
                同一组参数与同一种子应复现同一指纹 ${htmlEscape(s.network.fingerprint)}。
              </div>
            </div>
          </div>
        </div>
      </div>
    `);

    for (const btn of this.$$<HTMLButtonElement>('[data-fmt]')) {
      btn.addEventListener('click', () => {
        this.format = btn.dataset.fmt as typeof this.format;
        this.invalidate();
      });
    }
    for (const el of this.$$<HTMLInputElement>('[data-meta]')) {
      el.addEventListener('change', () => {
        const key = el.dataset.meta as 'archiveName' | 'region' | 'surveyor' | 'observedAt';
        this.store.set({ [key]: el.value } as never);
      });
    }
    this.$('[data-act="copy"]')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(content);
        this.store.toast('已复制到剪贴板', 'ok');
      } catch {
        this.store.toast('复制失败, 请手动选择文本', 'warn');
      }
    });
    this.$('[data-act="download-txt"]')?.addEventListener('click', () => {
      download(buildSurveyReport(s.network!, meta), `调查说明-${meta.code}.txt`, 'text/plain');
    });
    this.$('[data-act="download-csv"]')?.addEventListener('click', () => {
      download(buildCreekCsv(s.network!), `沟道属性-${meta.code}.csv`, 'text/csv');
    });
    this.$('[data-act="download-geojson"]')?.addEventListener('click', () => {
      download(buildCreekGeoJson(s.network!), `潮沟网络-${meta.code}.geojson`, 'application/geo+json');
    });
  }
}

function download(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

defineElement('report-view', ReportView);
