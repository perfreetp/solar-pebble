// 建模工具栏：工具切换、调色板、笔刷尺寸、镜像、正交、撤销重做、导出
import { BaseComponent } from './base';
import { store } from '../core/store';
import { PALETTE, colorToCss, type ToolMode } from '../core/types';

const TOOLS: Array<{ id: ToolMode; label: string; hint: string }> = [
  { id: 'paint', label: '笔刷', hint: 'B' },
  { id: 'erase', label: '擦除', hint: 'E' },
  { id: 'pick', label: '吸色', hint: 'I' },
  { id: 'select', label: '框选', hint: 'S' },
];

export class EditorToolbar extends BaseComponent {
  protected render(): string {
    const s = store.settings;
    return `
      <style>${this.css()}</style>
      <div class="toolbar">
        <div class="group tools">
          ${TOOLS.map((t) => `
            <button class="tool ${s.tool === t.id ? 'on' : ''}" data-tool="${t.id}">
              ${t.label}<kbd>${t.hint}</kbd>
            </button>`).join('')}
        </div>
        <div class="toolbar-sep"></div>
        <div class="group palette" title="体素颜色">
          ${PALETTE.map((c) => `
            <button class="swatch ${s.color === c ? 'on' : ''}" data-color="${c}"
              style="background:${colorToCss(c)}"></button>`).join('')}
          <label class="custom-color" title="自定义颜色">
            <input type="color" id="custom-color" value="${colorToCss(s.color)}" />
          </label>
        </div>
        <div class="toolbar-sep"></div>
        <div class="group">
          <label class="brush">笔刷
            <input type="range" id="brush-size" min="1" max="9" step="2" value="${s.brushSize}" />
            <b id="brush-val">${s.brushSize}</b>
          </label>
        </div>
        <div class="toolbar-sep"></div>
        <div class="group toggles">
          <button class="toggle ${s.mirrorX ? 'on' : ''}" id="mirror-btn" title="X 轴镜像：一侧增删同步对侧，对称面只落一次">
            ⇋ X 镜像
          </button>
          <button class="toggle ${s.ortho ? 'on' : ''}" id="ortho-btn" title="透视 / 正交视图切换">
            ▦ 正交
          </button>
          <button class="toggle" id="undo-btn" title="撤销 Ctrl+Z">↶ 撤销</button>
          <button class="toggle" id="redo-btn" title="重做 Ctrl+Y">↷ 重做</button>
        </div>
      </div>
    `;
  }

  protected afterRender(): void {
    this.shadow.querySelectorAll<HTMLElement>('[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        store.settings.tool = btn.dataset.tool as ToolMode;
        store.emit();
      });
    });
    this.shadow.querySelectorAll<HTMLElement>('[data-color]').forEach((btn) => {
      btn.addEventListener('click', () => {
        store.settings.color = Number(btn.dataset.color);
        store.emit();
      });
    });
    this.$<HTMLInputElement>('#custom-color')!.addEventListener('input', (e) => {
      const hex = (e.target as HTMLInputElement).value;
      store.settings.color = parseInt(hex.slice(1), 16);
      store.emit();
    });
    this.$<HTMLInputElement>('#brush-size')!.addEventListener('input', (e) => {
      store.settings.brushSize = Number((e.target as HTMLInputElement).value);
      this.$('#brush-val')!.textContent = String(store.settings.brushSize);
    });
    this.$('#mirror-btn')!.addEventListener('click', () => {
      store.settings.mirrorX = !store.settings.mirrorX;
      store.emit();
    });
    this.$('#ortho-btn')!.addEventListener('click', () => {
      store.settings.ortho = !store.settings.ortho;
      store.emit();
    });
    this.$('#undo-btn')!.addEventListener('click', () => store.undo());
    this.$('#redo-btn')!.addEventListener('click', () => store.redo());
  }

  private css(): string {
    return `
      .toolbar { display: flex; align-items: center; gap: 4px; padding: 8px 14px;
        background: var(--bg-panel); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
      .group { display: flex; align-items: center; gap: 6px; }
      .tool, .toggle { position: relative; padding: 7px 12px; }
      .tool.on, .toggle.on { background: var(--accent-2); border-color: var(--accent); }
      kbd { display: block; font-size: 9px; color: var(--text-dim); margin-top: 1px; }
      .swatch { width: 22px; height: 22px; padding: 0; border-radius: 4px;
        border: 2px solid transparent; }
      .swatch.on { border-color: var(--accent); }
      .custom-color input { width: 24px; height: 22px; padding: 0; border: none; background: none; cursor: pointer; }
      .brush { display: flex; align-items: center; gap: 8px; color: var(--text-dim); font-size: 12px; }
      .brush b { color: var(--text); font-family: var(--mono); }
      input[type="range"] { width: 90px; }
    `;
  }
}
