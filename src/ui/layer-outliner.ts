// 分层大纲：按 芯级/助推器/整流罩/尾翼 分组，显隐、锁定、只编辑当前层、合并、径向阵列
import { BaseComponent, toast } from './base';
import { store } from '../core/store';
import {
  LAYER_GROUP_LABELS, type Layer, type LayerGroup, type Vec3,
} from '../core/types';
import { mergeLayers, radialArrayY } from '../core/ops';

const GROUP_ORDER: LayerGroup[] = ['core', 'booster', 'fairing', 'fin'];

export class LayerOutliner extends BaseComponent {
  protected render(): string {
    const p = store.current;
    if (!p) return '<style>:host{color:var(--text-dim)}</style>未打开条目';
    const groups = GROUP_ORDER.map((g) => ({
      group: g,
      layers: p.layers.filter((l) => l.group === g),
    })).filter((x) => x.layers.length > 0);

    return `
      <style>${this.css()}</style>
      <div class="head">
        <span>分层大纲</span>
        <select id="new-layer-group" title="新层所属分组">
          ${GROUP_ORDER.map((g) => `<option value="${g}">${LAYER_GROUP_LABELS[g]}</option>`).join('')}
        </select>
        <button id="add-layer" title="新增层">＋</button>
      </div>
      <label class="edit-only">
        <input type="checkbox" id="edit-active-only" ${store.settings.editActiveOnly ? 'checked' : ''} />
        只编辑当前层
      </label>
      <div class="groups">
        ${groups.map(({ group, layers }) => `
          <div class="group">
            <div class="group-title">${LAYER_GROUP_LABELS[group]}</div>
            ${layers.map((l) => this.layerRow(l, p.activeLayerId === l.id)).join('')}
          </div>
        `).join('')}
      </div>
      <div class="merge-box">
        <div class="merge-title">多层合并（剔除相邻面后减面导出）</div>
        <div class="merge-actions">
          <select id="merge-target">
            ${p.layers.map((l) => `<option value="${l.id}">并入：${l.name}</option>`).join('')}
          </select>
          <button id="merge-btn">合并所选</button>
        </div>
      </div>
    `;
  }

  private layerRow(l: Layer, active: boolean): string {
    return `
      <div class="layer ${active ? 'active' : ''}" data-layer="${l.id}">
        <span class="name" title="点击设为当前层">${l.name} <em>${l.voxels.size}</em></span>
        <span class="icons">
          <button class="ico" data-act="visible" title="${l.visible ? '隐藏' : '显示'}">${l.visible ? '显' : '隐'}</button>
          <button class="ico ${l.locked ? 'is-locked' : ''}" data-act="lock" title="${l.locked ? '解锁' : '锁定'}">${l.locked ? '已锁' : '未锁'}</button>
          ${l.group === 'booster' ? '<button class="ico" data-act="array" title="绕 Y 轴阵列成四枚">⟳4</button>' : ''}
        </span>
      </div>`;
  }

  protected afterRender(): void {
    this.$('#add-layer')?.addEventListener('click', () => {
      const g = this.$<HTMLSelectElement>('#new-layer-group')!.value as LayerGroup;
      const n = store.current!.layers.filter((l) => l.group === g).length + 1;
      store.addLayer(`${LAYER_GROUP_LABELS[g]} ${n}`, g);
    });
    this.$<HTMLInputElement>('#edit-active-only')?.addEventListener('change', (e) => {
      store.settings.editActiveOnly = (e.target as HTMLInputElement).checked;
      store.emit();
    });
    this.$('#merge-btn')?.addEventListener('click', () => this.doMerge());

    this.shadow.querySelectorAll<HTMLElement>('.layer').forEach((row) => {
      const id = row.dataset.layer!;
      row.querySelector('.name')!.addEventListener('click', () => store.setActiveLayer(id));
      row.querySelector('[data-act="visible"]')!.addEventListener('click', () => {
        const l = store.model.getLayer(id)!;
        l.visible = !l.visible;
        store.emit();
      });
      row.querySelector('[data-act="lock"]')!.addEventListener('click', () => {
        const l = store.model.getLayer(id)!;
        l.locked = !l.locked;
        store.emit();
      });
      row.querySelector('[data-act="array"]')?.addEventListener('click', () => this.doArray(id));
    });
  }

  private doArray(layerId: string): void {
    const layer = store.model.getLayer(layerId);
    const p = store.current;
    if (!layer || !p || layer.locked) {
      toast('该层已锁定，无法阵列');
      return;
    }
    const center: Vec3 = [63, 0, 63];
    const before = new Map(layer.voxels);
    const { added, blocked } = radialArrayY(layer, 4, center);
    const entry = {
      label: '助推器四枚阵列',
      undo: (): void => { layer.voxels = new Map(before); },
      redo: (): void => { radialArrayY(layer, 4, center); },
    };
    store.pushHistory(entry);
    toast(`阵列完成：新增 ${added} 个体素${blocked ? `，${blocked} 个重叠/越界被跳过` : ''}`);
    store.emit();
  }

  private doMerge(): void {
    const p = store.current;
    if (!p) return;
    const targetId = this.$<HTMLSelectElement>('#merge-target')!.value;
    const ids = p.layers.map((l) => l.id);
    if (ids.length < 2) { toast('至少需要两个层才能合并'); return; }
    const entry = mergeLayers(p, ids, targetId);
    store.pushHistory(entry);
    toast(`已合并为「${store.model.getLayer(targetId)?.name}」，导出时自动剔除相邻面并减面`);
    store.emit();
  }

  private css(): string {
    return `
      :host { display: flex; flex-direction: column; gap: 10px; }
      .head { display: flex; align-items: center; gap: 8px; font-weight: 600; }
      .head select { flex: 1; }
      .head button { padding: 4px 10px; }
      .edit-only { display: flex; align-items: center; gap: 8px; color: var(--text-dim); font-size: 12px; }
      .groups { display: flex; flex-direction: column; gap: 10px; }
      .group-title { font-size: 11px; color: var(--accent); text-transform: uppercase;
        letter-spacing: 0.08em; margin-bottom: 4px; }
      .layer { display: flex; align-items: center; justify-content: space-between;
        padding: 7px 9px; border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--bg-panel-2); margin-bottom: 5px; cursor: pointer; }
      .layer.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
      .layer .name { font-size: 12px; }
      .layer .name em { color: var(--text-dim); font-style: normal; font-family: var(--mono); margin-left: 6px; }
      .icons { display: flex; gap: 4px; }
      .ico { padding: 2px 6px; font-size: 11px; background: transparent; border: 1px solid transparent; border-radius: 4px; color: var(--text-dim); }
      .ico:hover { background: var(--bg-hover); }
      .ico.is-locked { color: var(--warn); border-color: var(--warn); }
      .merge-box { border-top: 1px solid var(--border); padding-top: 10px; }
      .merge-title { font-size: 12px; color: var(--text-dim); margin-bottom: 8px; }
      .merge-actions { display: flex; gap: 6px; }
      .merge-actions select { flex: 1; min-width: 0; }
    `;
  }
}
