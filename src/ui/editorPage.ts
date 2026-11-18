import { VoxelRenderer } from '../gpu/renderer';
import { decodeVoxels, encodeVoxels, getProject, getSession, getShot, updateShot } from '../store';
import type { Project, Shot } from '../types';
import { brushFlatten, brushNoise, brushSphere, type ApplyFn } from '../voxel/brushes';
import { decimateMesh } from '../voxel/decimate';
import { download, meshToOBJ } from '../voxel/exporter';
import { VoxelGrid } from '../voxel/grid';
import { buildMesh } from '../voxel/mesher';
import { raycastGrid, rayPlaneZ } from '../voxel/raycast';
import { boxClear, boxCopy, boxPaste, boxTranslate, normalizeBox, type Box, type Clipboard } from '../voxel/selection';
import { h } from './dom';

type Tool = 'add' | 'remove' | 'select' | 'sphere' | 'flatten' | 'noise';
type ViewMode = 'all' | 'layer' | 'below';

const TOOL_NAMES: Record<Tool, string> = {
  add: '堆体素', remove: '删除', select: '框选',
  sphere: '球化笔刷', flatten: '压平笔刷', noise: '随机凹凸',
};

/** 界面 3:体素建模工作台 */
export class EditorPage extends HTMLElement {
  shotId = '';

  private shot!: Shot;
  private project!: Project;
  private grid!: VoxelGrid;
  private renderer: VoxelRenderer | null = null;

  private tool: Tool = 'add';
  private brushRadius = 5;
  private noiseStrength = 0.6;
  private noiseSeed = 7;
  private mirrorX = false;
  private layerOnly = false;
  private currentLayer = 0;
  private viewMode: ViewMode = 'all';

  private selection: Box | null = null;
  private selectAnchor: [number, number, number] | null = null;
  private clipboard: Clipboard | null = null;
  private undoStack: Uint8Array[] = [];
  private painting = false;
  private dragButton = -1;
  private lastX = 0; private lastY = 0;
  private saveTimer = 0;

  // 右侧面板动态元素
  private statEls: Record<string, HTMLElement> = {};
  private bannerEl: HTMLElement | null = null;
  private selInfoEl: HTMLElement | null = null;
  private exportResultEl: HTMLElement | null = null;
  private layerLabel: HTMLElement | null = null;

  connectedCallback(): void {
    const shot = getShot(this.shotId);
    if (!shot) {
      this.append(h('div', { class: 'page' }, h('p', { class: 'danger-text' }, '镜头不存在。')));
      return;
    }
    this.shot = shot;
    this.project = getProject(shot.projectId)!;
    this.grid = new VoxelGrid(this.project.gridSize, decodeVoxels(shot.voxelData, this.project.gridSize));
    this.currentLayer = Math.floor(this.project.gridSize / 2);
    this.buildUI();
    void this.initGPU();
  }

  disconnectedCallback(): void {
    this.saveNow();
    this.renderer?.destroy();
    this.renderer = null;
    window.removeEventListener('keydown', this.onKeyDown);
    clearTimeout(this.saveTimer);
  }

  /* ---------------- UI 构建 ---------------- */
  private buildUI(): void {
    const s = this.project.gridSize;
    this.textContent = '';

    // ---- 左侧工具栏 ----
    const toolButtons = new Map<Tool, HTMLElement>();
    const toolGrid = h('div', { class: 'tool-grid' });
    for (const t of Object.keys(TOOL_NAMES) as Tool[]) {
      const btn = h('button', {
        class: t === this.tool ? 'active' : '',
        onclick: () => {
          this.tool = t;
          this.selectAnchor = null;
          for (const [k, b] of toolButtons) b.classList.toggle('active', k === t);
          this.updateHint();
        },
      }, TOOL_NAMES[t]);
      toolButtons.set(t, btn);
      toolGrid.append(btn);
    }

    const radiusIn = h('input', { type: 'range', min: '1', max: '16', value: String(this.brushRadius) }) as HTMLInputElement;
    const radiusLabel = h('span', {}, String(this.brushRadius));
    radiusIn.oninput = () => { this.brushRadius = +radiusIn.value; radiusLabel.textContent = radiusIn.value; };

    const strengthIn = h('input', { type: 'range', min: '5', max: '100', value: String(this.noiseStrength * 100) }) as HTMLInputElement;
    const strengthLabel = h('span', {}, this.noiseStrength.toFixed(2));
    strengthIn.oninput = () => { this.noiseStrength = +strengthIn.value / 100; strengthLabel.textContent = this.noiseStrength.toFixed(2); };

    const seedIn = h('input', { type: 'number', value: String(this.noiseSeed), style: 'width:70px' }) as HTMLInputElement;
    seedIn.onchange = () => { this.noiseSeed = +seedIn.value || 0; };

    const mirrorChk = h('input', { type: 'checkbox' }) as HTMLInputElement;
    mirrorChk.onchange = () => { this.mirrorX = mirrorChk.checked; this.rebuild(); };
    const layerOnlyChk = h('input', { type: 'checkbox' }) as HTMLInputElement;
    layerOnlyChk.onchange = () => { this.layerOnly = layerOnlyChk.checked; };

    const left = h('div', { class: 'editor-side' },
      h('div', { class: 'tool-group' },
        h('div', { class: 'gt' }, '工具'),
        toolGrid,
      ),
      h('div', { class: 'tool-group' },
        h('div', { class: 'gt' }, '笔刷参数'),
        h('div', { class: 'slider-row' }, h('span', { class: 'muted' }, '半径'), radiusIn, radiusLabel),
        h('div', { class: 'slider-row' }, h('span', { class: 'muted' }, '强度'), strengthIn, strengthLabel),
        h('div', { class: 'row' }, h('span', { class: 'muted' }, '随机种子'), seedIn),
      ),
      h('div', { class: 'tool-group' },
        h('div', { class: 'gt' }, '对称与层约束'),
        h('label', { class: 'row' }, mirrorChk, '左右镜像对称(X轴)'),
        h('label', { class: 'row' }, layerOnlyChk, '仅编辑当前Z层'),
      ),
      h('div', { class: 'tool-group' },
        h('div', { class: 'gt' }, '操作'),
        h('button', { onclick: () => this.undo() }, '撤销 (Ctrl+Z)'),
        h('button', {
          class: 'danger',
          onclick: () => {
            if (confirm('清空全部体素?')) {
              this.pushUndo();
              this.grid.data.fill(0);
              this.afterEdit();
            }
          },
        }, '清空模型'),
      ),
      h('div', { class: 'tool-group' },
        h('div', { class: 'gt' }, '镜头'),
        h('button', { class: 'primary', onclick: () => { this.saveNow(); location.hash = `#/project/${this.project.id}`; } }, '保存并返回'),
        this.shot.status !== '已通过'
          ? h('button', {
              onclick: () => {
                this.saveNow();
                this.shot.status = '待审核';
                updateShot(this.shot);
                alert('已提交审核');
                location.hash = `#/project/${this.project.id}`;
              },
            }, '提交审核')
          : null,
      ),
    );

    // ---- 右侧:Z层 / 框选 / 统计 / 导出 ----
    const layerSlider = h('input', { type: 'range', min: '0', max: String(s - 1), value: String(this.currentLayer) }) as HTMLInputElement;
    this.layerLabel = h('span', {}, String(this.currentLayer));
    layerSlider.oninput = () => {
      this.currentLayer = +layerSlider.value;
      this.layerLabel!.textContent = layerSlider.value;
      this.rebuild();
      this.updateStats();
    };

    const vmRadios = (['all', 'below', 'layer'] as ViewMode[]).map(mode => {
      const name = { all: '全部', below: '当前层及以下', layer: '仅当前层' }[mode];
      const r = h('input', { type: 'radio', name: 'vm', value: mode, ...(mode === this.viewMode ? { checked: true } : {}) }) as HTMLInputElement;
      r.onchange = () => { this.viewMode = mode; this.rebuild(); };
      return h('label', { class: 'row', style: 'font-size:12px' }, r, name);
    });

    const dx = h('input', { type: 'number', value: '0' }) as HTMLInputElement;
    const dy = h('input', { type: 'number', value: '0' }) as HTMLInputElement;
    const dz = h('input', { type: 'number', value: '0' }) as HTMLInputElement;
    const offset = (): [number, number, number] => [+dx.value || 0, +dy.value || 0, +dz.value || 0];
    this.selInfoEl = h('div', { class: 'muted', style: 'font-size:12px' }, '未框选。选择「框选」工具后点击两个角点。');

    const facesIn = h('input', { type: 'number', value: String(this.project.targetFaces), min: '100', step: '100' }) as HTMLInputElement;
    this.exportResultEl = h('div', { class: 'muted', style: 'font-size:12px' }, '');

    const statBox = h('div', {});
    for (const key of ['count', 'bbox', 'layerCount', 'meshFaces']) {
      this.statEls[key] = h('span', {}, '—');
    }
    statBox.append(
      h('div', { class: 'kv' }, h('span', { class: 'k' }, '体素总量'), this.statEls['count']),
      h('div', { class: 'kv' }, h('span', { class: 'k' }, '包围盒(X×Y×Z)'), this.statEls['bbox']),
      h('div', { class: 'kv' }, h('span', { class: 'k' }, '当前层体素'), this.statEls['layerCount']),
      h('div', { class: 'kv' }, h('span', { class: 'k' }, '网格面数'), this.statEls['meshFaces']),
    );

    const right = h('div', { class: 'editor-right' },
      h('div', { class: 'tool-group' },
        h('div', { class: 'gt' }, `Z 层切片(0 ~ ${s - 1})`),
        h('div', { class: 'slider-row' }, layerSlider, this.layerLabel),
        ...vmRadios,
      ),
      h('div', { class: 'tool-group' },
        h('div', { class: 'gt' }, '框选 / 复制 / 平移'),
        this.selInfoEl,
        h('div', { class: 'num-inputs' },
          h('label', {}, 'ΔX', dx), h('label', {}, 'ΔY', dy), h('label', {}, 'ΔZ', dz),
        ),
        h('div', { class: 'tool-grid' },
          h('button', { onclick: () => this.doCopy() }, '复制'),
          h('button', { onclick: () => this.doPaste(offset()) }, '粘贴'),
          h('button', { onclick: () => this.doTranslate(offset()) }, '平移选区'),
          h('button', { onclick: () => this.doClearSelection() }, '删除选区'),
        ),
        h('button', { onclick: () => { this.selection = null; this.selectAnchor = null; this.rebuild(); this.updateSelInfo(); } }, '取消选区'),
      ),
      h('div', { class: 'tool-group' },
        h('div', { class: 'gt' }, '统计'),
        statBox,
      ),
      h('div', { class: 'tool-group' },
        h('div', { class: 'gt' }, '合并减面并导出'),
        h('label', { class: 'field' }, '目标面数', facesIn),
        h('button', {
          class: 'accent',
          onclick: () => this.exportOBJ(Math.max(100, +facesIn.value || this.project.targetFaces)),
        }, '减面并导出 OBJ'),
        this.exportResultEl,
      ),
    );

    // ---- 中央画布 ----
    this.bannerEl = h('div', { class: 'editor-banner', style: 'display:none' }, '');
    const canvas = h('canvas') as HTMLCanvasElement;
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerdown', e => this.onPointerDown(e));
    canvas.addEventListener('pointermove', e => this.onPointerMove(e));
    canvas.addEventListener('pointerup', e => this.onPointerUp(e));
    canvas.addEventListener('wheel', e => { e.preventDefault(); this.renderer?.zoom(e.deltaY); }, { passive: false });

    const center = h('div', { class: 'editor-center' },
      canvas,
      h('div', { class: 'editor-status' },
        h('span', { class: 'badge st-doing' }, `${this.shot.name}`),
        h('span', { class: 'badge' }, `上限 ${this.project.voxelLimit}`),
      ),
      this.bannerEl,
      h('div', { class: 'editor-hint', id: 'editor-hint' }, ''),
    );

    const layout = h('div', { class: 'editor-layout' }, left, center, right);
    layout.style.height = '100%';
    this.append(layout);
    this.canvas = canvas;
    this.updateHint();
    this.updateStats();
    this.updateSelInfo();
    window.addEventListener('keydown', this.onKeyDown);
  }

  private canvas!: HTMLCanvasElement;

  private async initGPU(): Promise<void> {
    this.renderer = new VoxelRenderer(this.canvas);
    const ok = await this.renderer.init();
    if (!ok) {
      this.querySelector('.editor-center')?.append(
        h('div', { class: 'gpu-error' }, this.renderer.error),
      );
      return;
    }
    const s = this.project.gridSize;
    this.renderer.target = [s / 2, s / 2, s / 2];
    this.renderer.dist = s * 2.2;
    this.rebuild();
  }

  /* ---------------- 编辑核心 ---------------- */
  /** 应用函数:越界检查 + 仅当前层约束 + 镜像同步 */
  private apply: ApplyFn = (x, y, z, v) => {
    if (this.layerOnly && z !== this.currentLayer) return;
    this.grid.set(x, y, z, v);
    if (this.mirrorX) this.grid.set(this.grid.size - 1 - x, y, z, v);
  };

  private visibleRange(): [number, number] {
    const s = this.grid.size;
    if (this.viewMode === 'layer') return [this.currentLayer, this.currentLayer];
    if (this.viewMode === 'below') return [0, this.currentLayer];
    return [0, s - 1];
  }

  private pick(e: PointerEvent): { voxel: [number, number, number]; normal: [number, number, number] } | null {
    if (!this.renderer?.ready) return null;
    const { ro, rd } = this.renderer.screenRay(e.clientX, e.clientY);
    const [zMin, zMax] = this.visibleRange();
    const hit = raycastGrid(this.grid, ro, rd, zMin, zMax);
    if (hit) return { voxel: hit.voxel, normal: hit.normal };
    // 未命中实体时,落在当前层平面上
    const p = rayPlaneZ(ro, rd, this.currentLayer + 0.5);
    if (p) {
      const x = Math.floor(p[0]), y = Math.floor(p[1]);
      if (x >= 0 && y >= 0 && x < this.grid.size && y < this.grid.size) {
        return { voxel: [x, y, this.currentLayer], normal: [0, 0, 0] };
      }
    }
    return null;
  }

  private applyToolAt(e: PointerEvent): void {
    const hit = this.pick(e);
    if (!hit) return;
    const [vx, vy, vz] = hit.voxel;
    const [nx, ny, nz] = hit.normal;
    const c: [number, number, number] = [vx + 0.5, vy + 0.5, vz + 0.5];
    switch (this.tool) {
      case 'add': {
        let tx = vx + nx, ty = vy + ny, tz = vz + nz;
        if (this.layerOnly) tz = this.currentLayer;
        this.apply(tx, ty, tz, 1);
        break;
      }
      case 'remove':
        this.apply(vx, vy, vz, 0);
        break;
      case 'sphere': {
        // 球化:朝外生长球体;按住 Alt 挖球形坑(陨石坑)
        const dig = e.altKey;
        const cc: [number, number, number] = dig ? c : [c[0] + nx, c[1] + ny, c[2] + nz];
        brushSphere(this.grid, cc[0], cc[1], cc[2], this.brushRadius, dig ? 'remove' : 'add', this.apply);
        break;
      }
      case 'flatten':
        brushFlatten(this.grid, c[0], c[1], c[2], this.brushRadius, vz, this.apply);
        break;
      case 'noise':
        brushNoise(this.grid, c[0], c[1], c[2], this.brushRadius, this.noiseStrength, this.noiseSeed, this.apply);
        break;
      case 'select': {
        if (!this.selectAnchor) {
          this.selectAnchor = [vx, vy, vz];
          this.selection = null;
        } else {
          this.selection = normalizeBox(this.selectAnchor, [vx, vy, vz]);
          this.selectAnchor = null;
        }
        this.updateSelInfo();
        break;
      }
    }
  }

  private onPointerDown(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    this.lastX = e.clientX; this.lastY = e.clientY;
    this.dragButton = e.button;
    if (e.button === 0) {
      this.pushUndo();
      this.painting = true;
      this.applyToolAt(e);
      this.afterEdit();
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
    this.lastX = e.clientX; this.lastY = e.clientY;
    if (this.dragButton === 2) { this.renderer?.orbit(dx, dy); return; }
    if (this.dragButton === 1) { this.renderer?.pan(dx, dy); return; }
    if (this.painting && this.dragButton === 0 && (this.tool === 'add' || this.tool === 'remove')) {
      this.applyToolAt(e);
      this.afterEdit();
    }
  }

  private onPointerUp(_e?: PointerEvent): void {
    this.painting = false;
    this.dragButton = -1;
    this.saveSoon();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      this.undo();
    }
    if (e.key === 'Escape') {
      this.selection = null;
      this.selectAnchor = null;
      this.rebuild();
      this.updateSelInfo();
    }
  };

  private pushUndo(): void {
    this.undoStack.push(this.grid.data.slice());
    if (this.undoStack.length > 30) this.undoStack.shift();
  }
  private undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.grid.data.set(prev);
    this.afterEdit();
    this.saveSoon();
  }

  private afterEdit(): void {
    if (this.shot.status === '未开始') {
      this.shot.status = '制作中';
      updateShot(this.shot);
    }
    this.rebuild();
    this.updateStats();
  }

  /* ---------------- 框选操作 ---------------- */
  private doCopy(): void {
    if (!this.selection) return;
    this.clipboard = boxCopy(this.grid, this.selection);
    this.updateSelInfo();
  }
  private doPaste(offset: [number, number, number]): void {
    if (!this.clipboard) return;
    this.pushUndo();
    const base = this.selection ? this.selection.min : [0, 0, 0] as [number, number, number];
    boxPaste(this.clipboard, [base[0] + offset[0], base[1] + offset[1], base[2] + offset[2]], this.apply);
    this.afterEdit();
    this.saveSoon();
  }
  private doTranslate(offset: [number, number, number]): void {
    if (!this.selection) return;
    this.pushUndo();
    boxTranslate(this.grid, this.selection, offset, this.apply);
    this.selection = normalizeBox(
      [this.selection.min[0] + offset[0], this.selection.min[1] + offset[1], this.selection.min[2] + offset[2]],
      [this.selection.max[0] + offset[0], this.selection.max[1] + offset[1], this.selection.max[2] + offset[2]],
    );
    // 裁剪到网格内
    const s = this.grid.size;
    const clamp = (v: number) => Math.max(0, Math.min(s - 1, v));
    this.selection = normalizeBox(
      [clamp(this.selection.min[0]), clamp(this.selection.min[1]), clamp(this.selection.min[2])],
      [clamp(this.selection.max[0]), clamp(this.selection.max[1]), clamp(this.selection.max[2])],
    );
    this.afterEdit();
    this.updateSelInfo();
    this.saveSoon();
  }
  private doClearSelection(): void {
    if (!this.selection) return;
    this.pushUndo();
    boxClear(this.grid, this.selection, this.apply);
    this.afterEdit();
    this.saveSoon();
  }

  /* ---------------- 渲染与统计 ---------------- */
  private rebuild(): void {
    if (!this.renderer?.ready) return;
    const [zMin, zMax] = this.visibleRange();
    const mesh = buildMesh(this.grid, zMin, zMax);
    this.renderer.setMesh(mesh);
    this.statEls['meshFaces']!.textContent = String(mesh.faceCount);

    const s = this.grid.size;
    // 地面网格线 + 外框
    const lines: { a: [number, number, number]; b: [number, number, number]; color: [number, number, number, number] }[] = [];
    const gridColor: [number, number, number, number] = [0.22, 0.27, 0.36, 1];
    const step = Math.max(1, Math.floor(s / 16));
    for (let i = 0; i <= s; i += step) {
      lines.push({ a: [i, 0, 0], b: [i, s, 0], color: gridColor });
      lines.push({ a: [0, i, 0], b: [s, i, 0], color: gridColor });
    }
    const edge: [number, number, number, number] = [0.4, 0.5, 0.68, 1];
    const corners: [number, number, number][] = [[0,0,0],[s,0,0],[s,s,0],[0,s,0],[0,0,s],[s,0,s],[s,s,s],[0,s,s]];
    const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    for (const [a, b] of edges) lines.push({ a: corners[a], b: corners[b], color: edge });
    if (this.selection) {
      const c: [number, number, number, number] = [0.95, 0.62, 0.25, 1];
      const [x0, y0, z0] = this.selection.min;
      const [x1, y1, z1] = [this.selection.max[0] + 1, this.selection.max[1] + 1, this.selection.max[2] + 1];
      const sc: [number, number, number][] = [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
      for (const [a, b] of edges) lines.push({ a: sc[a], b: sc[b], color: c });
    }
    this.renderer.setLines(lines);

    // 覆盖层:当前Z层高亮 + 镜像面 + 选区盒
    const overlays = [];
    overlays.push({
      min: [0, 0, this.currentLayer] as [number, number, number],
      max: [s, s, this.currentLayer + 1] as [number, number, number],
      color: [0.31, 0.61, 0.94, 0.10] as [number, number, number, number],
    });
    if (this.mirrorX) {
      overlays.push({
        min: [s / 2 - 0.03, 0, 0] as [number, number, number],
        max: [s / 2 + 0.03, s, s] as [number, number, number],
        color: [0.88, 0.56, 0.27, 0.18] as [number, number, number, number],
      });
    }
    if (this.selection) {
      overlays.push({
        min: this.selection.min.map(v => v) as [number, number, number],
        max: this.selection.max.map(v => v + 1) as [number, number, number],
        color: [0.95, 0.62, 0.25, 0.14] as [number, number, number, number],
      });
    }
    this.renderer.setOverlays(overlays);
  }

  private updateStats(): void {
    const count = this.grid.count();
    const limit = this.project.voxelLimit;
    const over = count > limit;
    this.statEls['count']!.textContent = `${count} / ${limit}`;
    this.statEls['count']!.className = over ? 'danger-text' : '';
    const b = this.grid.bounds();
    this.statEls['bbox']!.textContent = b
      ? `${b.max[0] - b.min[0] + 1} × ${b.max[1] - b.min[1] + 1} × ${b.max[2] - b.min[2] + 1}`
      : '(空)';
    this.statEls['layerCount']!.textContent = String(this.grid.countLayer(this.currentLayer));
    if (this.bannerEl) {
      this.bannerEl.style.display = over ? '' : 'none';
      this.bannerEl.textContent = `⚠ 体素总量 ${count} 已超出上限 ${limit},请精简模型`;
    }
  }

  private updateSelInfo(): void {
    if (!this.selInfoEl) return;
    if (this.selectAnchor) {
      this.selInfoEl.textContent = `角点1:(${this.selectAnchor.join(', ')}),请点击对角点。`;
    } else if (this.selection) {
      const d = [
        this.selection.max[0] - this.selection.min[0] + 1,
        this.selection.max[1] - this.selection.min[1] + 1,
        this.selection.max[2] - this.selection.min[2] + 1,
      ];
      this.selInfoEl.textContent = `选区 ${d[0]}×${d[1]}×${d[2]} @ (${this.selection.min.join(', ')})` +
        (this.clipboard ? ` | 剪贴板 ${this.clipboard.dims.join('×')}` : '');
    } else {
      this.selInfoEl.textContent = '未框选。选择「框选」工具后点击两个角点。' +
        (this.clipboard ? `剪贴板:${this.clipboard.dims.join('×')}` : '');
    }
  }

  private updateHint(): void {
    const el = this.querySelector('#editor-hint');
    if (!el) return;
    const toolHint: Record<Tool, string> = {
      add: '左键:在表面/当前层堆体素(拖动连续放置)',
      remove: '左键:删除体素(拖动连续删除)',
      select: '左键:点击两个角点定义选区,Esc 取消',
      sphere: '左键:球化(填充球体);Alt+左键:挖球形陨石坑',
      flatten: '左键:把半径内表面压平到点击高度',
      noise: '左键:随机凹凸,塑造陨石坑缘与碎石堆',
    };
    el.textContent = `${toolHint[this.tool]} | 右键拖动:旋转 中键:平移 滚轮:缩放`;
  }

  /* ---------------- 保存与导出 ---------------- */
  private saveSoon(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 1200);
  }
  private saveNow(): void {
    if (!this.shot) return;
    this.shot.voxelData = encodeVoxels(this.grid.data);
    this.shot.voxelCount = this.grid.count();
    updateShot(this.shot);
  }

  private exportOBJ(targetFaces: number): void {
    this.saveNow();
    const mesh = buildMesh(this.grid);
    const dec = decimateMesh(mesh.positions, mesh.indices, targetFaces);
    const obj = meshToOBJ(this.shot.name.replace(/\s+/g, '_'), dec.positions, dec.indices);
    download(`${this.project.name}_${this.shot.name}.obj`.replace(/[\\/:*?"<>|]/g, '_'), obj);
    if (this.exportResultEl) {
      this.exportResultEl.textContent = `合并面数 ${mesh.faceCount} → 减面后 ${dec.faceCount}(目标 ${targetFaces}),已导出 OBJ。`;
    }
  }
}
customElements.define('editor-page', EditorPage);
