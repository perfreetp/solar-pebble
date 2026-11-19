import { BaseElement, defineElement, htmlEscape } from './base';
import { TOKENS, PANEL } from './styles';
import type { Store } from './store';
import type { Studio } from '../studio';
import { fromPayload } from '../core/serialize';
import { summarizeParams } from '../core/doc';
import { toPayload } from '../core/serialize';
import type { Network } from '../core/types';

export class CompareView extends BaseElement {
  private store!: Store;
  private studio!: Studio;
  private unsubscribe: (() => void) | null = null;
  private selectedId: string | null = null;
  private canvasA: HTMLCanvasElement | null = null;
  private canvasB: HTMLCanvasElement | null = null;

  setup(store: Store, studio: Studio): void {
    this.store = store;
    this.studio = studio;
    this.unsubscribe?.();
    this.unsubscribe = store.subscribe((_s, patch) => {
      if ('view' in patch || 'compareVersionId' in patch || 'compareNetwork' in patch || 'network' in patch) {
        if (this.store.get().view === 'compare') this.invalidate();
      }
    });
  }

  protected override onUnmount(): void {
    this.unsubscribe?.();
  }

  private currentArchiveVersions() {
    const s = this.store.get();
    const versions = s.activeArchiveId ? this.studio.listVersions(s.activeArchiveId) : this.studio.listAllVersions();
    return versions;
  }

  protected render(): void {
    const s = this.store.get();
    this.useStyles(TOKENS + PANEL + /* css */ `
      :host { display: block; height: 100%; min-height: 0; overflow: hidden; }
      .wrap { display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 12px; height: 100%; min-height: 0; }
      .bar {
        display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
        background: var(--bg-1); border: 1px solid var(--line-soft);
        border-radius: var(--radius); padding: 9px 12px;
      }
      .bar select { width: auto; min-width: 240px; }
      .panes { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; min-height: 0; overflow: hidden; }
      @media (max-width: 900px) { .panes { grid-template-columns: 1fr; } }
      .pane { display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow-y: auto; padding-right: 2px; }
      .pane-head { display: flex; align-items: center; gap: 8px; font-size: 12px; }
      .pane-title { font-weight: 600; }
      .canvas-wrap {
        position: relative; flex: 1 1 auto; min-height: 220px; max-height: 46vh;
        background: #060d11; border: 1px solid var(--line-soft); border-radius: var(--radius); overflow: hidden;
      }
      canvas { width: 100%; height: 100%; display: block; }
      @media (max-width: 980px) { .pane { overflow: visible; } .panes { grid-template-columns: minmax(0,1fr); } }
      .stats-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .stats-table th, .stats-table td { padding: 5px 8px; text-align: left; border-bottom: 1px solid var(--line-soft); }
      .stats-table th { color: var(--fg-mute); font-weight: 500; font-size: 11px; }
      .stats-table td:first-child { color: var(--fg-dim); }
      .stats-table td { font-family: var(--mono); font-variant-numeric: tabular-nums; color: var(--fg); }
      .diff-up { color: var(--ok); }
      .diff-down { color: var(--warn); }
      .diff-same { color: var(--fg-mute); }
      .empty { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--fg-mute); font-size: 13px; text-align: center; line-height: 1.7; padding: 30px; }
      .legend { font-size: 11px; color: var(--fg-mute); }
      .version-row { display: flex; gap: 6px; flex-wrap: wrap; }
      .v-chip {
        padding: 3px 8px; border-radius: 999px; font-size: 11px;
        border: 1px solid var(--line-soft); background: var(--bg-0); cursor: pointer; color: var(--fg-dim);
      }
      .v-chip.active { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
    `);

    const versions = this.currentArchiveVersions();
    if (!s.network) {
      this.setContent(`<div class="empty">请先在工作台生成网络, 再选择历史版本并排比对。</div>`);
      return;
    }
    if (versions.length === 0) {
      this.setContent(`
        <div class="wrap">
          <div class="bar"><span class="dim">还没有历史版本。在工作台点击「存为版本」即可建立。</span></div>
          <div class="empty">历史版本会记录每次生成 / 编辑后的完整几何快照, 可随时与当前结果并排比对。</div>
        </div>`);
      return;
    }

    const sel = versions.find((v) => v.id === (s.compareVersionId ?? this.selectedId)) ?? versions[0];
    let compareNet = s.compareNetwork;
    if (!compareNet || s.compareVersionId !== sel.id) {
      compareNet = fromPayload(sel.payload);
      queueMicrotask(() => this.store.set({ compareVersionId: sel.id, compareNetwork: compareNet }));
    }

    const diff = diffStats(compareNet!, s.network);

    this.setContent(`
      <div class="wrap">
        <div class="bar">
          <span class="dim">历史版本</span>
          <select data-version>
            ${versions.map((v) => `<option value="${v.id}" ${v.id === sel.id ? 'selected' : ''}>${htmlEscape(v.label)} · ${new Date(v.createdAt).toLocaleString('zh-CN')} · ${v.fingerprint}</option>`).join('')}
          </select>
          <span class="spacer"></span>
          <span class="chip mono">差异指纹 ${diff.same ? '一致' : '不同'}</span>
          <button class="small" data-act="store-version">把当前结果存为新版本</button>
        </div>
        <div class="panes">
          <div class="pane">
            <div class="pane-head">
              <span class="pane-title">版本 · ${htmlEscape(sel.label)}</span>
              <span class="spacer"></span>
              <span class="chip mono">${sel.fingerprint}</span>
            </div>
            <div class="canvas-wrap"><canvas data-side="a"></canvas></div>
            <div class="legend">${htmlEscape(summarizeParams(compareNet!.params))}</div>
            ${this.statsTable(compareNet!, null)}
          </div>
          <div class="pane">
            <div class="pane-head">
              <span class="pane-title">当前结果</span>
              <span class="spacer"></span>
              <span class="chip mono">${s.network.fingerprint}</span>
            </div>
            <div class="canvas-wrap"><canvas data-side="b"></canvas></div>
            <div class="legend">${htmlEscape(summarizeParams(s.network.params))}</div>
            ${this.statsTable(s.network, compareNet!)}
          </div>
        </div>
      </div>
    `);

    this.canvasA = this.$<HTMLCanvasElement>('[data-side="a"]');
    this.canvasB = this.$<HTMLCanvasElement>('[data-side="b"]');
    queueMicrotask(() => {
      if (this.canvasA) drawPreview(this.canvasA, compareNet!, s.levelVisible);
      if (this.canvasB) drawPreview(this.canvasB, s.network!, s.levelVisible);
    });

    this.$<HTMLSelectElement>('[data-version]')?.addEventListener('change', (e) => {
      const id = (e.target as HTMLSelectElement).value;
      const v = versions.find((x) => x.id === id);
      if (!v) return;
      this.store.set({ compareVersionId: v.id, compareNetwork: fromPayload(v.payload) });
    });
    this.$('[data-act="store-version"]')?.addEventListener('click', () => {
      this.emit('store-version', {});
    });
  }

  private statsTable(net: { stats: { counts: Record<number, number>; totalLength: number; junctionCount: number; densityKmPerKm2: number; meanSinuosity: number; headMin: number; headMax: number } }, ref: typeof net | null): string {
    const rows: [string, string, number][] = [
      ['主干沟', '条', net.stats.counts[1]],
      ['支沟', '条', net.stats.counts[2]],
      ['毛细沟', '条', net.stats.counts[3]],
      ['总沟长', 'km', net.stats.totalLength / 1000],
      ['汇流节点', '处', net.stats.junctionCount],
      ['沟道密度', 'km/km²', net.stats.densityKmPerKm2],
      ['平均曲折度', '', net.stats.meanSinuosity],
      ['沟头高程', 'm', (net.stats.headMin + net.stats.headMax) / 2],
    ];
    const cls = (v: number, r: number | null): string => {
      if (r === null) return '';
      const d = v - r;
      if (Math.abs(d) < 1e-6) return 'diff-same';
      return d > 0 ? 'diff-up' : 'diff-down';
    };
    return `<table class="stats-table">
      <thead><tr><th>指标</th><th>数值</th><th>相对</th></tr></thead>
      <tbody>
        ${rows
          .map(([label, unit, v], i) => {
            const rv = ref ? ([ref.stats.counts[1], ref.stats.counts[2], ref.stats.counts[3], ref.stats.totalLength / 1000, ref.stats.junctionCount, ref.stats.densityKmPerKm2, ref.stats.meanSinuosity, (ref.stats.headMin + ref.stats.headMax) / 2][i] as number) : null;
            const delta = rv === null ? '' : (v - rv >= 0 ? '+' : '') + (Math.abs(v - rv) < 1e-3 ? '0' : (v - rv).toFixed(Math.abs(v) < 10 ? 2 : 0));
            return `<tr><td>${label}</td><td>${v.toFixed(Math.abs(v) < 10 ? 2 : 0)}${unit ? ' ' + unit : ''}</td><td class="${cls(v, rv)}">${delta}</td></tr>`;
          })
          .join('')}
      </tbody>
    </table>`;
  }
}

function diffStats(a: { fingerprint: string; stats: { totalLength: number; counts: Record<number, number> } }, b: typeof a): { same: boolean } {
  return { same: a.fingerprint === b.fingerprint };
}

/** 用 2D canvas 画缩略预览 (比对视图无需 WebGPU, 也能在低端设备上工作) */
function drawPreview(canvas: HTMLCanvasElement, net: Network, visible: Record<number, boolean>): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 400;
  const h = canvas.clientHeight || 300;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#060d11';
  ctx.fillRect(0, 0, w, h);
  const b = net.bounds;
  const pad = 12;
  const s = Math.min((w - pad * 2) / Math.max(1, b.maxX - b.minX), (h - pad * 2) / Math.max(1, b.maxY - b.minY));
  const ox = w / 2 - ((b.minX + b.maxX) / 2) * s;
  const oy = h / 2 + ((b.minY + b.maxY) / 2) * s;
  const colors: Record<number, string> = { 1: '#5fe0d8', 2: '#3fa9c4', 3: '#3d7f9b' };
  for (const c of net.creeks) {
    if (!visible[c.level]) continue;
    ctx.strokeStyle = colors[c.level] ?? '#888';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const minW = c.level === 1 ? 1.6 : c.level === 2 ? 1.05 : 0.7;
    ctx.lineWidth = Math.max(minW * dpr * 0.7, Math.min(3, 0.5 + c.mouthWidth * s * 0.6));
    ctx.beginPath();
    const n = c.pts.length / 2;
    for (let i = 0; i < n; i++) {
      const x = c.pts[i * 2] * s + ox;
      const y = -c.pts[i * 2 + 1] * s + oy;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // 比例尺
  const targetM = niceScale((b.maxX - b.minX) / 4);
  const px = targetM * s;
  ctx.strokeStyle = 'rgba(220,236,238,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(12, h - 16);
  ctx.lineTo(12 + px, h - 16);
  ctx.stroke();
  ctx.fillStyle = 'rgba(220,236,238,0.7)';
  ctx.font = '10px monospace';
  ctx.fillText(`${targetM} m`, 12, h - 22);
}

function niceScale(v: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1, v))));
  const n = v / pow;
  const factor = n >= 5 ? 5 : n >= 2 ? 2 : 1;
  return factor * pow;
}

defineElement('compare-view', CompareView);

/** 供主壳调用 */
export function makeVersionPayload(net: Parameters<typeof toPayload>[0]) {
  return toPayload(net);
}
