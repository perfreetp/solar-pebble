import { BaseElement, defineElement, htmlEscape } from './base';
import { TOKENS, PANEL } from './styles';
import type { Store } from './store';
import type { ColorMode, Level } from '../core/types';
import { LEVEL_COLORS, LEVEL_LABEL, rampFor, toCss } from '../render/palette';

const COLOR_MODES: { id: ColorMode; label: string }[] = [
  { id: 'level', label: '按级别' },
  { id: 'length', label: '按沟长' },
  { id: 'density', label: '按密度' },
  { id: 'elevation', label: '按高程' },
];

export class LayerPanel extends BaseElement {
  private store!: Store;
  private unsubscribe: (() => void) | null = null;

  setup(store: Store): void {
    this.store = store;
    this.unsubscribe?.();
    this.unsubscribe = store.subscribe((_s, patch) => {
      const keys = ['colorMode', 'levelAlpha', 'levelVisible', 'showContours', 'showGrid', 'showBasemap', 'basemap', 'network'];
      if (keys.some((k) => k in patch)) this.invalidate();
    });
  }

  protected override onUnmount(): void {
    this.unsubscribe?.();
  }

  private legend(mode: ColorMode): string {
    const s = this.store.get();
    const net = s.network;
    if (mode === 'level') {
      return ([1, 2, 3] as Level[])
        .map(
          (l) => `<div class="leg-row">
            <span class="leg-swatch" style="background:${LEVEL_COLORS[l]}"></span>
            <span>${LEVEL_LABEL[l]}</span>
            <span class="spacer"></span>
            <span class="mono dim">${net ? net.stats.counts[l] : '—'} 条</span>
          </div>`,
        )
        .join('');
    }
    const ramp = rampFor(mode);
    const cls = net?.classes;
    const table = cls ? (mode === 'length' ? cls.length : mode === 'density' ? cls.density : cls.elevation) : null;
    const unit = mode === 'length' ? 'm' : mode === 'density' ? 'km/km²' : 'm';
    const fmt = (v: number) => (mode === 'density' ? v.toFixed(2) : mode === 'length' ? (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)) : v.toFixed(2));
    const bars = ramp
      .map(
        (c, i) => `<div class="grad-seg" style="background:${toCss(c)}" title="${i + 1} 级"></div>`,
      )
      .join('');
    let ticks = '';
    if (table) {
      const edges = [table.min, ...table.breaks, table.max];
      const pick = edges.length > 3 ? [edges[0], edges[1], edges[edges.length - 1]] : edges;
      ticks = `<div class="grad-ticks">${pick.map((v, i) => `<span${i === pick.length - 1 ? ' style="text-align:right"' : i > 0 ? ' style="text-align:center"' : ''}>${fmt(v)}</span>`).join('')}</div>`;
    }
    return `<div class="grad">${bars}</div>${ticks}<div class="hint">单位: ${unit} · 5 级分位</div>`;
  }

  private alphaRow(level: Level): string {
    const s = this.store.get();
    const a = s.levelAlpha[level];
    const visible = s.levelVisible[level];
    return `
      <div class="alpha-row ${visible ? '' : 'off'}">
        <label class="toggle">
          <input type="checkbox" data-visible="${level}" ${visible ? 'checked' : ''}>
          <span class="leg-swatch" style="background:${LEVEL_COLORS[level]}"></span>
          <span class="alpha-name">${LEVEL_LABEL[level]}</span>
        </label>
        <input type="range" data-alpha="${level}" min="0" max="1" step="0.01" value="${a}" ${visible ? '' : 'disabled'}
          aria-label="${LEVEL_LABEL[level]} 透明度">
        <span class="alpha-val mono">${Math.round(a * 100)}%</span>
      </div>`;
  }

  protected render(): void {
    const s = this.store.get();
    this.useStyles(TOKENS + PANEL + /* css */ `
      :host { display: block; }
      .leg-row { display: flex; align-items: center; gap: 7px; padding: 2px 0; font-size: 12px; color: var(--fg-dim); }
      .leg-swatch { width: 10px; height: 10px; border-radius: 2px; flex: none; }
      .grad { display: flex; height: 10px; border-radius: 3px; overflow: hidden; margin: 4px 0 3px; }
      .grad-seg { flex: 1; }
      .grad-ticks { display: flex; justify-content: space-between; font-size: 9.5px; color: var(--fg-mute); font-family: var(--mono); gap: 2px; }
      .grad-ticks span { white-space: nowrap; flex: 1; }
      .hint { font-size: 10.5px; color: var(--fg-mute); margin-top: 3px; }
      .hint { font-size: 11px; color: var(--fg-mute); margin-top: 2px; }
      .modes { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
      .mode-btn {
        padding: 5px 6px; font-size: 12px; text-align: center;
        background: var(--bg-0); border: 1px solid var(--line-soft); border-radius: var(--radius-sm);
        color: var(--fg-dim); cursor: pointer;
      }
      .mode-btn:hover { border-color: var(--accent-2); color: var(--fg); }
      .mode-btn.active { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); font-weight: 600; }
      .alpha-row { display: grid; grid-template-columns: 96px 1fr 36px; align-items: center; gap: 6px; }
      .alpha-row.off { opacity: 0.45; }
      .alpha-row.off .alpha-val::after { content: ' (隐藏)'; font-size: 9px; }
      .toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; color: var(--fg-dim); }
      .alpha-name { white-space: nowrap; }
      .alpha-val { font-size: 10.5px; color: var(--fg-mute); text-align: right; }
      .check-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
      .check-row label { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--fg-dim); cursor: pointer; }
      .base-info { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--fg-mute); }
      .base-thumb { width: 42px; height: 30px; object-fit: cover; border-radius: 3px; border: 1px solid var(--line); }
      .divider { height: 1px; background: var(--line-soft); margin: 10px 0; }
    `);

    this.setContent(`
      <div class="col" style="gap:10px">
        <div class="panel">
          <div class="panel-head">图例与配色</div>
          <div class="panel-body col" style="gap:9px">
            <div class="modes">
              ${COLOR_MODES.map(
                (m) => `<button class="mode-btn ${s.colorMode === m.id ? 'active' : ''}" data-mode="${m.id}">${m.label}</button>`,
              ).join('')}
            </div>
            <div>${this.legend(s.colorMode)}</div>
            <div class="divider"></div>
            <div class="section-title" style="margin:0">级别透明度</div>
            ${this.alphaRow(1)}
            ${this.alphaRow(2)}
            ${this.alphaRow(3)}
          </div>
        </div>

        <div class="panel">
          <div class="panel-head">底图与参照</div>
          <div class="panel-body col" style="gap:8px">
            <div class="check-row">
              <label><input type="checkbox" data-flag="showContours" ${s.showContours ? 'checked' : ''}>等深线</label>
              <label><input type="checkbox" data-flag="showGrid" ${s.showGrid ? 'checked' : ''}>测量网格</label>
            </div>
            <div class="check-row">
              <label><input type="checkbox" data-flag="showBasemap" ${s.showBasemap ? 'checked' : ''} ${s.basemap ? '' : 'disabled'}>航拍底图</label>
              <span class="spacer"></span>
              <button class="small" data-act="import-basemap">导入航拍底图</button>
            </div>
            ${
              s.basemap
                ? `<div class="base-info">
                    ${s.basemap.src.startsWith('data:') ? `<img class="base-thumb" src="${s.basemap.src}" alt="">` : ''}
                    <span>${htmlEscape(s.basemap.name)}</span>
                    <span class="spacer"></span>
                    <button class="small ghost" data-act="clear-basemap">移除</button>
                  </div>`
                : `<div class="base-info">未导入底图 —— 导入航拍片可与滩面对位建立编号档案</div>`
            }
          </div>
        </div>
      </div>
    `);

    this.bind();
  }

  private bind(): void {
    for (const btn of this.$$<HTMLButtonElement>('[data-mode]')) {
      btn.addEventListener('click', () => {
        this.store.set({ colorMode: btn.dataset.mode as ColorMode });
      });
    }
    for (const el of this.$$<HTMLInputElement>('[data-alpha]')) {
      el.addEventListener('input', () => {
        const level = Number(el.dataset.alpha) as Level;
        const alpha = { ...this.store.get().levelAlpha, [level]: Number(el.value) };
        this.store.set({ levelAlpha: alpha });
        const valEl = el.parentElement?.querySelector('.alpha-val');
        if (valEl) valEl.textContent = `${Math.round(Number(el.value) * 100)}%`;
      });
    }
    for (const el of this.$$<HTMLInputElement>('[data-visible]')) {
      el.addEventListener('change', () => {
        const level = Number(el.dataset.visible) as Level;
        const visible = { ...this.store.get().levelVisible, [level]: el.checked };
        const alpha = { ...this.store.get().levelAlpha };
        // 重新显示时若透明度为 0, 恢复到 1
        if (el.checked && alpha[level] <= 0.001) alpha[level] = 1;
        this.store.set({ levelVisible: visible, levelAlpha: alpha });
        this.invalidate();
      });
    }
    for (const el of this.$$<HTMLInputElement>('[data-flag]')) {
      el.addEventListener('change', () => {
        const key = el.dataset.flag as 'showContours' | 'showGrid' | 'showBasemap';
        this.store.set({ [key]: el.checked } as never);
      });
    }
    this.$('[data-act="import-basemap"]')?.addEventListener('click', () => {
      this.emit('basemap-import', {});
    });
    this.$('[data-act="clear-basemap"]')?.addEventListener('click', () => {
      this.store.set({ basemap: null, basemapImage: null, showBasemap: false });
    });
  }
}

defineElement('layer-panel', LayerPanel);
