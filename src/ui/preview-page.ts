// 预览页：只看成品，自动绕飞，无编辑控件
import { BaseComponent } from './base';
import { store } from '../core/store';
import { STATUS_LABELS } from '../core/types';
import { VoxelScene } from '../render/voxel-scene';

export class PreviewPage extends BaseComponent {
  private scene: VoxelScene | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private initError = '';
  private flying = true;

  protected render(): string {
    const p = store.current;
    if (!p) return '<style>:host{padding:40px;color:var(--text-dim)}</style>未打开条目';
    return `
      <style>${this.css()}</style>
      <header class="topbar">
        <button class="ghost" id="back-btn">← 返回</button>
        <div class="title">${p.name} <span class="tag ${p.status}">${STATUS_LABELS[p.status]}</span></div>
        <div class="spacer"></div>
        <button id="pause-btn">${this.flying ? '⏸ 暂停绕飞' : '▶ 继续绕飞'}</button>
      </header>
      <main class="stage">
        <canvas id="preview-canvas"></canvas>
        ${this.initError ? `<div class="gpu-error">${this.initError}</div>` : ''}
        <div class="badge">成品预览 · 自动绕飞 · 只读</div>
      </main>
    `;
  }

  protected afterRender(): void {
    this.$('#back-btn')?.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('navigate', {
        bubbles: true, composed: true, detail: 'editor',
      }));
    });
    this.$('#pause-btn')?.addEventListener('click', () => {
      this.flying = !this.flying;
      this.scene?.setAutoOrbit(this.flying);
      this.forceRender();
    });
  }

  /** 路由进入：惰性创建场景；重绘后重新挂接 canvas */
  async enter(): Promise<void> {
    if (this.scene) {
      this.attachCanvas();
      return;
    }
    const canvas = this.$<HTMLCanvasElement>('#preview-canvas');
    if (!canvas) return;
    this.canvas = canvas;
    const p = store.current;
    if (!p) return;
    try {
      this.scene = await VoxelScene.create(canvas);
    } catch (e) {
      this.initError = (e as Error).message;
      this.forceRender();
      return;
    }
    this.scene.setOrtho(false);
    this.scene.updateVoxels(p.layers);
    this.scene.setAutoOrbit(this.flying);
    this.scene.start();
  }

  exit(): void {
    this.scene?.destroy();
    this.scene = null;
    this.canvas = null;
  }

  /** store 驱动的 innerHTML 重绘后，立刻把场景挂回新 canvas */
  protected onRendered(): void {
    if (this.scene) this.attachCanvas();
  }

  private attachCanvas(): void {
    const canvas = this.$<HTMLCanvasElement>('#preview-canvas');
    if (!canvas || !this.scene || canvas === this.canvas) return;
    this.canvas = canvas;
    this.scene.replaceCanvas(canvas);
    const p = store.current;
    if (p) this.scene.updateVoxels(p.layers);
    this.scene.setAutoOrbit(this.flying);
    this.scene.start();
  }

  private css(): string {
    return `
      :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
      .topbar { display: flex; align-items: center; gap: 14px; padding: 10px 18px;
        background: var(--bg-panel); border-bottom: 1px solid var(--border); }
      .title { font-weight: 600; }
      .spacer { flex: 1; }
      .stage { flex: 1; position: relative; min-height: 0; }
      canvas { width: 100%; height: 100%; display: block; }
      .gpu-error { position: absolute; inset: 20%; background: var(--bg-panel);
        border: 1px solid var(--danger); border-radius: 10px; padding: 24px; color: #f0b0b0; }
      .badge { position: absolute; right: 18px; bottom: 16px;
        background: rgba(20,26,36,0.82); border: 1px solid var(--border);
        border-radius: 6px; padding: 7px 12px; color: var(--text-dim); font-size: 12px; }
    `;
  }
}
