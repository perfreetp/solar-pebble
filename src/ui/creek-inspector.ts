import { BaseElement, defineElement, htmlEscape } from './base';
import { TOKENS, PANEL } from './styles';
import type { Store } from './store';
import type { Creek } from '../core/types';
import { LEVEL_COLORS, LEVEL_LABEL } from '../render/palette';

const STOP_LABEL: Record<string, string> = {
  elevation: '高程收尾',
  collision: '净距收尾',
  extent: '范围截断',
  maxLength: '长度上限',
  locked: '锁定段',
};

export class CreekInspector extends BaseElement {
  private store!: Store;
  private unsubscribe: (() => void) | null = null;

  setup(store: Store): void {
    this.store = store;
    this.unsubscribe?.();
    this.unsubscribe = store.subscribe((_s, patch) => {
      if ('selectedCreekId' in patch || 'network' in patch || 'lockedIds' in patch) this.invalidate();
    });
  }

  protected override onUnmount(): void {
    this.unsubscribe?.();
  }

  protected render(): void {
    const s = this.store.get();
    this.useStyles(TOKENS + PANEL + /* css */ `
      :host { display: block; }
      .empty { color: var(--fg-mute); font-size: 12px; padding: 10px 2px; line-height: 1.6; }
      .id { font-family: var(--mono); font-size: 13px; color: var(--fg); word-break: break-all; }
      .lvl { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
      .swatch { width: 9px; height: 9px; border-radius: 2px; }
      .grid { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; font-size: 12px; align-items: baseline; }
      .k { color: var(--fg-mute); white-space: nowrap; }
      .v { color: var(--fg-dim); font-family: var(--mono); font-variant-numeric: tabular-nums; text-align: right; }
      .v.hi { color: var(--accent); }
      .bar-wrap { margin-top: 8px; display: flex; flex-direction: column; gap: 3px; }
      .bar-label { display: flex; justify-content: space-between; font-size: 10.5px; color: var(--fg-mute); }
      .bar { height: 4px; background: var(--bg-0); border-radius: 2px; overflow: hidden; display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 1px; }
      .bar > i { display: block; height: 100%; border-radius: 2px; }
      .actions { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
      .divider { height: 1px; background: var(--line-soft); margin: 9px 0; }
      .tag { font-size: 10.5px; }
    `);

    const c = s.network?.creeks.find((x) => x.id === s.selectedCreekId) ?? null;
    if (!c) {
      this.setContent(`
        <div class="panel">
          <div class="panel-head">沟道档案</div>
          <div class="panel-body">
            <div class="empty">
              在图上点选一条沟道查看逐条属性: 级别、长度、口宽、沟头高程、曲折度、局部密度与分级。
            </div>
          </div>
        </div>`);
      return;
    }

    const parents = s.network ? parentChain(s.network.creeks, c) : [];
    const isLocked = s.lockedIds.has(c.id);
    const classRow = (label: string, idx: number, ramp: string[]) => `
      <div class="bar-wrap">
        <div class="bar-label"><span>${label}</span><span>${idx + 1} / ${ramp.length} 级</span></div>
        <div class="bar">${ramp
          .map((col, i) => `<i style="background:${col};opacity:${i === idx ? 1 : 0.22}"></i>`)
          .join('')}</div>
      </div>`;

    this.setContent(`
      <div class="panel">
        <div class="panel-head">
          <span>沟道档案</span>
          <span class="spacer"></span>
          ${isLocked ? `<span class="chip warn tag">已锁定</span>` : ''}
          ${c.edited && !isLocked ? `<span class="chip tag">已编辑</span>` : ''}
        </div>
        <div class="panel-body">
          <div class="id">${htmlEscape(c.id)}</div>
          <div class="lvl">
            <span class="swatch" style="background:${LEVEL_COLORS[c.level]}"></span>
            <span class="dim">${LEVEL_LABEL[c.level]}</span>
            <span class="spacer"></span>
            <span class="chip tag">${STOP_LABEL[c.stopReason] ?? '—'}</span>
          </div>
          <div class="grid">
            <span class="k">上级</span><span class="v">${parents.length ? htmlEscape(parents.map((p) => p.id).join(' ← ')) : '— (主干)'}</span>
            <span class="k">长度</span><span class="v hi">${(c.length / 1000).toFixed(3)} km</span>
            <span class="k">口宽 / 头宽</span><span class="v">${c.mouthWidth.toFixed(1)} / ${c.headWidth.toFixed(1)} m</span>
            <span class="k">起点高程</span><span class="v">${c.startElevation.toFixed(2)} m</span>
            <span class="k">沟头高程</span><span class="v">${c.headElevation.toFixed(2)} m</span>
            <span class="k">终止目标</span><span class="v">${isFinite(c.headTarget) ? c.headTarget.toFixed(2) + ' m' : '—'}</span>
            <span class="k">曲折度</span><span class="v">${c.sinuosity.toFixed(3)}</span>
            <span class="k">局部密度</span><span class="v">${c.densityValue.toFixed(2)} km/km²</span>
            <span class="k">节点数</span><span class="v">${c.pts.length / 2}</span>
          </div>
          <div class="divider"></div>
          ${classRow('沟长分级', c.classIdx.length, ['#1d3f5c', '#245f78', '#2f8291', '#47a8a4', '#79d0c0'])}
          ${classRow('密度分级', c.classIdx.density, ['#2b1e4a', '#3a3d7a', '#2f7d8f', '#5fb87c', '#e3d36a'])}
          ${classRow('高程分级', c.classIdx.elevation, ['#1f6f8b', '#3e8f8a', '#79a06a', '#b39b58', '#c98a4b'])}
          <div class="actions">
            <button class="small" data-act="lock">${isLocked ? '解除锁定' : '锁定此段'}</button>
            <button class="small" data-act="edit">编辑走向</button>
            <button class="small ghost" data-act="deselect">取消选择</button>
          </div>
        </div>
      </div>
    `);

    this.$('[data-act="lock"]')?.addEventListener('click', () => {
      this.emit('toggle-lock', { creekId: c.id });
    });
    this.$('[data-act="edit"]')?.addEventListener('click', () => {
      this.store.set({ tool: 'edit' });
    });
    this.$('[data-act="deselect"]')?.addEventListener('click', () => {
      this.store.set({ selectedCreekId: null });
    });
  }
}

function parentChain(creeks: Creek[], c: Creek): Creek[] {
  const out: Creek[] = [];
  const byId = new Map(creeks.map((x) => [x.id, x]));
  let cur = c.parentId ? byId.get(c.parentId) : undefined;
  while (cur && out.length < 8) {
    out.push(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

defineElement('creek-inspector', CreekInspector);
