import { CATALOG, KIND_LABEL } from '../catalog';
import { store } from '../store';
import { EditorEngine } from '../three/editor';
import { toast } from '../toast';
import { dragBus } from '../drag-bus';
import type { ComponentKind, SceneComponent } from '../types';
import { sharedCss } from './shared-css';
import { findCollisions, insideTank, worldBox } from '../geometry';

/** 界面一：三维布置编辑器 */
export class ViewEditor extends HTMLElement {
  private engine: EditorEngine | null = null;
  private unsub: (() => void) | null = null;
  private viewport: HTMLDivElement | null = null;

  connectedCallback(): void {
    this.render();
    this.viewport = this.shadowRoot!.querySelector('.viewport')!;
    // 等布局完成再初始化 three，保证容器有尺寸
    requestAnimationFrame(() => {
      if (this.engine || !this.viewport) return;
      this.engine = new EditorEngine(this.viewport);
      this.engine.onMessage = (text, kind) => toast(text, kind);
      this.engine.onSelectionChange = () => this.refreshPanels();
    });
    this.unsub = store.subscribe(() => this.refreshPanels());
  }

  disconnectedCallback(): void {
    this.unsub?.();
    this.engine?.dispose();
    this.engine = null;
  }

  private render(): void {
    const s = store.settings;
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${sharedCss}
        .catalog-head-tip { font-size:11px; color:var(--muted); margin-bottom:10px; line-height:1.5; }
        .bom-total { margin-top: 12px; padding-top: 10px; border-top: 2px solid var(--border);
          display:flex; justify-content:space-between; font-weight:700; }
        .mini-btn { padding: 4px 8px; font-size: 12px; }
      </style>
      <div class="layout">
        <!-- 左：构件库 -->
        <section class="panel side">
          <div class="panel-head">构件库</div>
          <div class="panel-body">
            <div class="catalog-head-tip">按住构件拖入右侧视口；落入展箱内自动贴面，碰撞时变红拦截。</div>
            ${CATALOG.map((c) => `
              <div class="catalog-item" draggable="true" data-kind="${c.kind}">
                <div class="swatch" style="background:#${c.color.toString(16).padStart(6, '0')}"></div>
                <div>
                  <div class="name">${c.label}</div>
                  <div class="desc">${c.desc}</div>
                </div>
              </div>`).join('')}
          </div>
        </section>

        <!-- 中：工具栏 + 视口 -->
        <section class="viewport-wrap">
          <div class="panel" style="margin-bottom:12px;">
            <div class="toolbar">
              <div class="group">
                <button data-mode="translate" class="${s.transformMode === 'translate' ? 'active' : ''}" title="平移 (W)">✥ 平移</button>
                <button data-mode="rotate" class="${s.transformMode === 'rotate' ? 'active' : ''}" title="旋转 (E)">↻ 旋转</button>
                <button data-mode="scale" class="${s.transformMode === 'scale' ? 'active' : ''}" title="缩放 (R)">⤢ 缩放</button>
              </div>
              <div class="sep"></div>
              <label>网格 <input type="number" min="0.02" step="0.01" value="${s.gridSize}" id="grid-size">m</label>
              <label>吸附 <input type="number" min="0" step="0.01" value="${s.snapStep}" id="snap-step">m</label>
              <label>角度 <input type="number" min="0" step="5" value="${s.angleSnap}" id="angle-snap">°</label>
              <div class="sep"></div>
              <button id="top-view" class="${s.topView ? 'active' : ''}">▤ 俯视图</button>
              <label class="checkbox"><input type="checkbox" id="footprint" ${s.showFootprint ? 'checked' : ''}>占位轮廓</label>
              <button id="reset-cam">复位镜头</button>
              <div class="sep"></div>
              <button id="align-left" class="mini-btn">左对齐</button>
              <button id="distribute" class="mini-btn">等距排布</button>
              <button id="delete-sel" class="mini-btn danger">删除</button>
            </div>
          </div>
          <div class="panel viewport">
            <div class="hint">
              单击拾取 · Shift 加选 · 空白拖拽框选 · W/E/R 切换手柄 · Delete 删除<br>
              拖动被相邻构件挡住立即变红并拦截，松手自动吸附贴面
            </div>
          </div>
        </section>

        <!-- 右：属性 + 物料清单 -->
        <aside class="panel side right">
          <div class="panel-head">构件属性</div>
          <div class="panel-body" id="prop-panel"></div>
          <div class="panel-head" style="border-top:1px solid var(--border);">物料清单（按类型汇总）</div>
          <div class="panel-body" id="bom-panel"></div>
        </aside>
      </div>`;

    this.bindCatalog();
    this.bindToolbar();
    this.refreshPanels();
  }

  private bindCatalog(): void {
    this.shadowRoot!.querySelectorAll<HTMLElement>('.catalog-item').forEach((el) => {
      el.addEventListener('dragstart', (e) => {
        const kind = el.dataset.kind as ComponentKind;
        dragBus.start(kind);
        e.dataTransfer?.setData('application/x-component-kind', kind);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
      });
      el.addEventListener('dragend', () => dragBus.end());
    });
  }

  private bindToolbar(): void {
    const root = this.shadowRoot!;
    root.querySelectorAll<HTMLElement>('button[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.engine?.setTransformMode(btn.dataset.mode as 'translate' | 'rotate' | 'scale');
      });
    });
    root.querySelector<HTMLInputElement>('#grid-size')!.addEventListener('change', (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      if (v > 0) {
        store.updateSettings({ gridSize: v });
        this.engine?.refreshGrid();
      }
    });
    root.querySelector<HTMLInputElement>('#snap-step')!.addEventListener('change', (e) => {
      const v = Math.max(0, Number((e.target as HTMLInputElement).value));
      store.updateSettings({ snapStep: v });
    });
    root.querySelector<HTMLInputElement>('#angle-snap')!.addEventListener('change', (e) => {
      const v = Math.max(0, Number((e.target as HTMLInputElement).value));
      store.updateSettings({ angleSnap: v });
    });
    root.querySelector<HTMLButtonElement>('#top-view')!.addEventListener('click', () => {
      const next = !store.settings.topView;
      store.updateSettings({ topView: next });
      this.engine?.toggleTopView(next);
    });
    root.querySelector<HTMLInputElement>('#footprint')!.addEventListener('change', (e) => {
      this.engine?.toggleFootprint((e.target as HTMLInputElement).checked);
    });
    root.querySelector('#reset-cam')!.addEventListener('click', () => this.engine?.resetCamera());
    root.querySelector('#align-left')!.addEventListener('click', () => this.engine?.alignSelectedLeft());
    root.querySelector('#distribute')!.addEventListener('click', () => this.engine?.distributeSelected());
    root.querySelector('#delete-sel')!.addEventListener('click', () => store.removeSelected());
  }

  private refreshPanels(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const propPanel = root.querySelector('#prop-panel');
    const bomPanel = root.querySelector('#bom-panel');
    if (!propPanel || !bomPanel) return;
    const selected = store.getSelected();

    if (selected.length === 0) {
      propPanel.innerHTML = `<div class="empty">未选中构件<br>单击视口中的构件进行拾取，或空白处拖拽框选</div>`;
    } else if (selected.length === 1) {
      propPanel.innerHTML = this.singlePropHtml(selected[0]);
      this.bindPropInputs(selected[0].id);
    } else {
      propPanel.innerHTML = `
        <div class="sel-list">已框选 <b>${selected.length}</b> 个构件：<br>
        ${selected.map((c) => c.name).join('、')}</div>
        <div class="sel-list">多选状态下支持整体平移 / 旋转，或使用工具栏的「左对齐」「等距排布」。</div>`;
    }

    // 物料清单：按类型汇总
    const counts = new Map<ComponentKind, number>();
    for (const c of store.components) {
      counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
    }
    const total = store.components.length;
    bomPanel.innerHTML = total === 0
      ? `<div class="empty">场景为空，从左侧拖入构件</div>`
      : CATALOG.filter((c) => counts.has(c.kind)).map((c) => {
        const qty = counts.get(c.kind)!;
        return `<div class="bom-row">
          <span>${c.label} <small style="color:var(--muted)">(${c.unit})</small></span>
          <span class="qty">× ${qty}</span>
        </div>`;
      }).join('') + `<div class="bom-total"><span>构件总数</span><span class="qty">${total}</span></div>`;
  }

  private singlePropHtml(c: SceneComponent): string {
    const b = worldBox(c);
    const dims = `${(b.max.x - b.min.x).toFixed(2)} × ${(b.max.y - b.min.y).toFixed(2)} × ${(b.max.z - b.min.z).toFixed(2)} m`;
    const row = (label: string, key: 'position' | 'rotation' | 'scale', axis: 'x' | 'y' | 'z', val: number, step: number) => `
      <div class="prop-row">
        <label>${label}${axis.toUpperCase()}</label>
        <div class="vec3" style="flex:none;width:100%;">
          <input type="number" step="${step}" value="${val}" data-key="${key}" data-axis="${axis}">
        </div>
      </div>`;
    const rotDeg = {
      x: (c.rotation.x * 180) / Math.PI,
      y: (c.rotation.y * 180) / Math.PI,
      z: (c.rotation.z * 180) / Math.PI
    };
    return `
      <div class="sel-list">
        <b style="color:var(--text);font-size:13px;">${c.name}</b><br>
        类型：${KIND_LABEL[c.kind]}${c.tankId ? '<br>所属：' + (store.components.find((t) => t.id === c.tankId)?.name ?? '展箱') : ''}
        <br>外形尺寸：${dims}
      </div>
      ${row('位置', 'position', 'x', +c.position.x.toFixed(3), 0.01)}
      ${row('位置', 'position', 'y', +c.position.y.toFixed(3), 0.01)}
      ${row('位置', 'position', 'z', +c.position.z.toFixed(3), 0.01)}
      ${row('角度°', 'rotation', 'x', +rotDeg.x.toFixed(1), 1)}
      ${row('角度°', 'rotation', 'y', +rotDeg.y.toFixed(1), 1)}
      ${row('角度°', 'rotation', 'z', +rotDeg.z.toFixed(1), 1)}
      ${row('缩放', 'scale', 'x', +c.scale.x.toFixed(2), 0.05)}
      ${row('缩放', 'scale', 'y', +c.scale.y.toFixed(2), 0.05)}
      ${row('缩放', 'scale', 'z', +c.scale.z.toFixed(2), 0.05)}
      <div class="sel-list" style="margin-top:8px;">直接输入数值会做碰撞与边界校验，无效输入自动还原。</div>`;
  }

  private bindPropInputs(id: string): void {
    this.shadowRoot!.querySelectorAll<HTMLInputElement>('#prop-panel input').forEach((input) => {
      input.addEventListener('change', () => {
        const comp = store.components.find((c) => c.id === id);
        if (!comp) return;
        const key = input.dataset.key as 'position' | 'rotation' | 'scale';
        const axis = input.dataset.axis as 'x' | 'y' | 'z';
        const v = Number(input.value);
        if (Number.isNaN(v)) { this.refreshPanels(); return; }
        const trial: SceneComponent = JSON.parse(JSON.stringify(comp));
        if (key === 'rotation') trial.rotation[axis] = (v * Math.PI) / 180;
        else trial[key][axis] = v;
        const all = store.components.map((c) => (c.id === id ? trial : c));
        if (findCollisions(trial, all).length || !insideTank(trial, all)) {
          toast('数值导致碰撞或超出展箱，已忽略', 'error');
          this.refreshPanels();
          return;
        }
        store.updateComponent(id, { [key]: { ...comp[key], [axis]: key === 'rotation' ? (v * Math.PI) / 180 : v } });
      });
    });
  }
}
