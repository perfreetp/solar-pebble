// 建模页：WebGPU 画布 + 工具栏 + 大纲 + 审核/交付 + 导出统计
import { BaseComponent, toast } from './base';
import { store } from '../core/store';
import { STATUS_LABELS, colorToCss } from '../core/types';
import { VoxelScene } from '../render/voxel-scene';
import { EditController } from '../editor/edit-controller';
import { meshStats, buildMesh } from '../core/mesh';
import { buildGlb, downloadGlb } from '../core/gltf';

const TRIANGLE_LIMIT = 80000;

export class EditorPage extends BaseComponent {
  private scene: VoxelScene | null = null;
  private controller: EditController | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private initError = '';
  private keyHandler?: (e: KeyboardEvent) => void;

  protected render(): string {
    const p = store.current;
    if (!p) return '<style>:host{padding:40px;color:var(--text-dim)}</style>未打开条目';
    const readOnly = p.status === 'locked' || p.status === 'delivered';

    return `
      <style>${this.css()}</style>
      <header class="topbar">
        <div class="crumbs">
          <button class="ghost" id="back-btn">← 条目列表</button>
          <b>${p.code}</b> ${p.name}
          <span class="tag ${p.status}">${STATUS_LABELS[p.status]}</span>
          <span class="tag">退回 ${p.returns}/${p.maxReturns}</span>
          <span class="tag">截止 ${p.deadline.slice(5)}</span>
        </div>
        <div class="flow">
          <button id="preview-btn" title="只看成品并自动绕飞">▶ 成品预览</button>
          ${p.status === 'draft' ? '<button class="primary" id="submit-btn">提交主管审核</button>' : ''}
          ${p.status === 'review' ? `
            <button class="danger" id="return-btn">退回（主管）</button>
            <button class="primary" id="approve-btn">审核通过</button>` : ''}
          ${p.status === 'approved' ? '<button class="primary" id="deliver-btn">打包交付展陈方</button>' : ''}
          <button id="export-btn">导出 glTF</button>
        </div>
      </header>
      <editor-toolbar></editor-toolbar>
      <div class="workspace">
        <aside class="left">
          <layer-outliner></layer-outliner>
        </aside>
        <main class="viewport">
          <canvas id="voxel-canvas"></canvas>
          ${this.initError ? `<div class="gpu-error">${this.initError}</div>` : ''}
          <div class="hud">
            <span id="voxel-counter">体素 0</span>
            <span id="mode-hint"></span>
          </div>
          <div class="select-ops" id="select-ops" hidden>
            <button data-sel="copy">复制 (Ctrl+C)</button>
            <button data-sel="move">移动 (Ctrl+X)</button>
            <button data-sel="delete" class="danger">删除 (Del)</button>
            <button data-sel="clear">取消选区</button>
          </div>
          <div class="paste-tip" id="paste-tip" hidden>粘贴模式：移动鼠标选落点，左键确认，Esc 取消</div>
          ${readOnly ? '<div class="readonly-banner">该条目已锁定/交付，建模只读</div>' : ''}
        </main>
      </div>
    `;
  }

  protected afterRender(): void {
    this.$('#back-btn')?.addEventListener('click', () => {
      store.closeProject();
      this.dispatchNav('projects');
    });
    this.$('#preview-btn')?.addEventListener('click', () => this.dispatchNav('preview'));
    this.$('#submit-btn')?.addEventListener('click', () => { store.submitReview(); toast('已提交主管审核'); });
    this.$('#return-btn')?.addEventListener('click', () => {
      const reason = window.prompt('退回原因（计入退回次数，上限 2 次）', '需要修改');
      if (reason !== null) { store.returnEntry(reason); toast(store.current?.status === 'locked' ? '已达退回上限，条目锁定' : '已退回制作员'); }
    });
    this.$('#approve-btn')?.addEventListener('click', () => { store.approve(); toast('审核通过'); });
    this.$('#deliver-btn')?.addEventListener('click', () => {
      store.deliver();
      toast('已打包交付给展陈方');
    });
    this.$('#export-btn')?.addEventListener('click', () => this.openExportDialog());

    this.shadow.querySelectorAll<HTMLElement>('[data-sel]').forEach((btn) => {
      btn.addEventListener('click', () => this.selectionAction(btn.dataset.sel!));
    });
  }

  /** 路由进入：惰性初始化 WebGPU 场景（DOM 重绘不销毁场景） */
  enter(): void {
    this.initScene();
  }

  /** 路由离开：停止帧循环并释放交互，返回时重建 */
  exit(): void {
    this.teardownScene();
  }

  /** 每次 store 驱动的 innerHTML 重绘后，立刻把场景挂回新 canvas */
  protected onRendered(): void {
    if (this.scene) this.attachCanvas();
  }

  private dispatchNav(route: 'projects' | 'preview'): void {
    this.dispatchEvent(new CustomEvent('navigate', { bubbles: true, composed: true, detail: route }));
  }

  // ---------- 场景装配 ----------

  private async initScene(): Promise<void> {
    if (this.scene) {
      this.attachCanvas();
      this.syncScene();
      return;
    }
    const canvas = this.$<HTMLCanvasElement>('#voxel-canvas');
    if (!canvas) return;
    this.canvas = canvas;
    try {
      this.scene = await VoxelScene.create(canvas);
    } catch (e) {
      this.initError = (e as Error).message;
      this.forceRender();
      return;
    }
    const p = store.current!;
    this.scene.setOrtho(store.settings.ortho);
    this.scene.showMirrorPlane = store.settings.mirrorX;
    this.scene.updateVoxels(p.layers);
    this.scene.start();

    this.controller = new EditController(this.scene, canvas);
    this.controller.onStatus = (msg) => toast(msg);
    this.controller.onSelectionChange = () => this.refreshSelectionUi();

    this.bindKeyboard();
    this.syncScene();
  }

  /** innerHTML 重绘会替换 canvas；把 GPU 上下文重新配置到新元素并重建控制器绑定 */
  private attachCanvas(): void {
    const canvas = this.$<HTMLCanvasElement>('#voxel-canvas');
    if (!canvas || !this.scene || canvas === this.canvas) return;
    // 保留选区/剪贴板等编辑态
    const snapshot = this.controller?.snapshot();
    this.canvas = canvas;
    this.scene.replaceCanvas(canvas);
    this.controller?.dispose();
    this.controller = new EditController(this.scene, canvas);
    this.controller.onStatus = (msg) => toast(msg);
    this.controller.onSelectionChange = () => this.refreshSelectionUi();
    if (snapshot) this.controller.restore(snapshot);
  }

  private teardownScene(): void {
    this.keyHandler && window.removeEventListener('keydown', this.keyHandler);
    this.keyHandler = undefined;
    this.controller?.dispose();
    this.controller = null;
    this.scene?.destroy();
    this.scene = null;
    this.canvas = null;
  }

  /** store 变化后同步场景设置（不重建渲染器） */
  private syncScene(): void {
    if (!this.scene) return;
    this.attachCanvas();
    const p = store.current;
    if (!p) return;
    this.scene.setOrtho(store.settings.ortho);
    this.scene.showMirrorPlane = store.settings.mirrorX;
    this.scene.updateVoxels(p.layers);
    const counter = this.$('#voxel-counter');
    if (counter) counter.textContent = `体素 ${this.scene.voxelCount} / 网格 128³`;
    const hint = this.$('#mode-hint');
    if (hint) {
      const s = store.settings;
      hint.textContent =
        `${s.tool === 'paint' ? '笔刷' : s.tool === 'erase' ? '擦除' : s.tool === 'pick' ? '吸色' : '框选'}` +
        ` · ${s.mirrorX ? '镜像开' : '镜像关'} · ${s.ortho ? '正交' : '透视'} · 颜色 ${colorToCss(s.color)}`;
    }
    this.refreshSelectionUi();
  }

  private refreshSelectionUi(): void {
    const ops = this.$('#select-ops');
    const tip = this.$('#paste-tip');
    if (!ops || !tip || !this.controller) return;
    ops.hidden = !this.controller.selection;
    tip.hidden = !this.controller.isPasting;
  }

  private selectionAction(action: string): void {
    const c = this.controller;
    if (!c) return;
    switch (action) {
      case 'copy': c.copySelection(); c.beginPaste(); break;
      case 'move': c.beginMove(); break;
      case 'delete': c.deleteSelection(); break;
      case 'clear': c.clearSelection(); break;
    }
    this.refreshSelectionUi();
  }

  private bindKeyboard(): void {
    this.keyHandler = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const s = store.settings;
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'z') { e.preventDefault(); store.undo(); }
        else if (e.key.toLowerCase() === 'y') { e.preventDefault(); store.redo(); }
        else if (e.key.toLowerCase() === 'c') { e.preventDefault(); this.controller?.copySelection(); }
        else if (e.key.toLowerCase() === 'x') { e.preventDefault(); this.controller?.beginMove(); }
        else if (e.key.toLowerCase() === 'v') { e.preventDefault(); this.controller?.beginPaste(); }
        return;
      }
      if (e.key === 'Escape') { this.controller?.cancelPaste(); this.controller?.clearSelection(); this.refreshSelectionUi(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { this.controller?.deleteSelection(); return; }
      const map: Record<string, typeof s.tool> = { b: 'paint', e: 'erase', i: 'pick', s: 'select' };
      if (map[e.key.toLowerCase()]) { s.tool = map[e.key.toLowerCase()]; store.emit(); }
      if (e.key.toLowerCase() === 'm') { s.mirrorX = !s.mirrorX; store.emit(); }
      if (e.key.toLowerCase() === 'o') { s.ortho = !s.ortho; store.emit(); }
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  // ---------- 导出 ----------

  private openExportDialog(): void {
    const p = store.current;
    if (!p) return;
    const visibleLayers = p.layers.filter((l) => l.visible);
    const stats = meshStats(visibleLayers);
    const overLimit = stats.triangleCount > TRIANGLE_LIMIT;
    const dlg = document.createElement('dialog');
    dlg.innerHTML = `
      <div class="dialog-head">导出 glTF — ${p.name}</div>
      <div class="dialog-body">
        <div class="stat-grid">
          <div class="stat-row"><span>体素数</span><b>${stats.voxelCount.toLocaleString()}</b></div>
          <div class="stat-row"><span>顶点数</span><b>${stats.vertexCount.toLocaleString()}</b></div>
          <div class="stat-row"><span>三角面数</span><b>${stats.triangleCount.toLocaleString()}</b></div>
          <div class="stat-row"><span>剔除相邻面后</span><b>${stats.culledFaceCount.toLocaleString()} 面</b></div>
          <div class="stat-row"><span>贪心减面后</span><b>${stats.mergedFaceCount.toLocaleString()} 矩形</b></div>
          <div class="stat-row"><span>导出层</span><b>${visibleLayers.length}/${p.layers.length}（可见层）</b></div>
        </div>
        ${overLimit ? `
          <div class="warn-banner">
            ⚠ 三角面数 ${stats.triangleCount.toLocaleString()} 已超过 ${TRIANGLE_LIMIT.toLocaleString()} 面的展陈设备建议上限，
            建议合并层、减少体素或隐藏次要层后再导出。
          </div>` : ''}
      </div>
      <div class="dialog-foot">
        <button id="dlg-cancel">取消</button>
        <button class="primary" id="dlg-ok">导出 .glb</button>
      </div>`;
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector<HTMLButtonElement>('#dlg-cancel')!.onclick = () => dlg.close();
    dlg.querySelector<HTMLButtonElement>('#dlg-ok')!.onclick = () => {
      const geo = buildMesh(visibleLayers);
      const glb = buildGlb(geo, p.code);
      downloadGlb(glb, `${p.code}_voxel.glb`);
      toast(`已导出 ${p.code}_voxel.glb（${stats.triangleCount.toLocaleString()} 三角面）`);
      dlg.close();
    };
    dlg.addEventListener('close', () => dlg.remove());
  }

  private css(): string {
    return `
      :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
      .topbar { display: flex; justify-content: space-between; align-items: center;
        padding: 8px 16px; background: var(--bg-panel); border-bottom: 1px solid var(--border); gap: 12px; }
      .crumbs { display: flex; align-items: center; gap: 10px; font-size: 13px; flex-wrap: wrap; }
      .flow { display: flex; gap: 8px; }
      .workspace { flex: 1; display: flex; min-height: 0; }
      .left { width: 280px; min-width: 240px; background: var(--bg-panel);
        border-right: 1px solid var(--border); padding: 14px; overflow: auto; }
      .viewport { flex: 1; position: relative; min-width: 0; }
      canvas { width: 100%; height: 100%; display: block; touch-action: none; cursor: crosshair; }
      .gpu-error { position: absolute; inset: 20%; background: var(--bg-panel);
        border: 1px solid var(--danger); border-radius: 10px; padding: 24px; color: #f0b0b0; }
      .hud { position: absolute; left: 14px; bottom: 12px; display: flex; gap: 14px;
        background: rgba(20,26,36,0.82); border: 1px solid var(--border); border-radius: 6px;
        padding: 7px 12px; font-size: 12px; color: var(--text-dim); }
      .select-ops { position: absolute; top: 14px; left: 50%; transform: translateX(-50%);
        display: flex; gap: 8px; background: rgba(20,26,36,0.9); border: 1px solid var(--warn);
        border-radius: 8px; padding: 8px; }
      .select-ops[hidden], .paste-tip[hidden] { display: none; }
      .paste-tip { position: absolute; top: 14px; left: 50%; transform: translateX(-50%);
        background: rgba(20,26,36,0.9); border: 1px solid var(--ok); border-radius: 8px; padding: 8px 14px; }
      .readonly-banner { position: absolute; right: 14px; top: 14px;
        background: rgba(201,79,79,0.18); border: 1px solid var(--danger); border-radius: 6px;
        padding: 6px 12px; color: #f0b0b0; font-size: 12px; }
    `;
  }
}

