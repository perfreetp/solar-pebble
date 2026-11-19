// 编辑控制器：指针交互、笔刷/擦除/拾取/框选、镜像、撤销历史
import { store, type HistoryEntry } from '../core/store';
import {
  GRID, MIRROR_PLANE, keyOf, mirrorX, inGrid,
  type Layer, type Vec3,
} from '../core/types';
import { voxelToWorld } from '../core/voxel-model';
import { pickVoxel, pickEmptyCell } from '../render/picking';
import type { VoxelScene } from '../render/voxel-scene';
import type { OrbitCamera } from '../render/camera';
import {
  copyToClipboard, deleteCells, restoreCells, normalizeBounds,
  pasteClipboard, type Bounds, type ClipboardData,
} from '../core/ops';

interface ChangeRecord {
  layerId: string;
  key: string;
  color: number;
  kind: 'add' | 'remove';
}

interface ControllerState {
  selection: Bounds | null;
  selectAnchor: Vec3 | null;
  clipboard: ClipboardData | null;
  pasteAnchor: Vec3 | null;
  pasteMode: boolean;
}

export class EditController {
  private scene: VoxelScene;
  private camera: OrbitCamera;
  private canvas: HTMLCanvasElement;

  private pointerDown = false;
  private orbiting = false;
  private panning = false;
  private lastPointer: Vec3 = [0, 0, 0];
  private strokeChanges: ChangeRecord[] = [];
  private strokeActive = false;
  private lastPaintCell = '';

  selection: Bounds | null = null;
  clipboard: ClipboardData | null = null;
  pasteAnchor: Vec3 | null = null;
  private pasteMode = false;

  onSelectionChange?: () => void;
  onStatus?: (msg: string) => void;

  constructor(scene: VoxelScene, canvas: HTMLCanvasElement) {
    this.scene = scene;
    this.camera = scene.camera;
    this.canvas = canvas;
    this.bind();
  }

  private get layers(): Layer[] {
    return store.model.layers;
  }

  // ---------- 事件绑定 ----------

  private bind(): void {
    this.canvas.addEventListener('pointerdown', this.handleDown);
    this.canvas.addEventListener('pointermove', this.handleMove);
    window.addEventListener('pointerup', this.handleUp);
    this.canvas.addEventListener('pointerleave', this.handleLeave);
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.handleDown);
    this.canvas.removeEventListener('pointermove', this.handleMove);
    window.removeEventListener('pointerup', this.handleUp);
    this.canvas.removeEventListener('pointerleave', this.handleLeave);
    this.canvas.removeEventListener('wheel', this.handleWheel);
  }

  private ndc(e: PointerEvent | WheelEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -(((e.clientY - r.top) / r.height) * 2 - 1),
    ];
  }

  private rayAt(e: PointerEvent | WheelEvent): { origin: Vec3; dir: Vec3 } {
    const [nx, ny] = this.ndc(e);
    return this.camera.screenToRay(nx, ny);
  }

  private handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.camera.zoom(e.deltaY);
  };

  private handleDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointerDown = true;
    this.lastPointer = [e.clientX, e.clientY, 0];

    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey)) {
      this.orbiting = e.button === 1 || (e.button === 0 && e.shiftKey);
      this.panning = e.button === 2;
      return;
    }
    if (e.button !== 0) return;

    const ray = this.rayAt(e);
    const tool = store.settings.tool;

    // 只读条目：相机操作之外的编辑动作一律拦截
    const status = store.current?.status;
    if (status === 'locked' || status === 'delivered') {
      this.onStatus?.('该条目已' + (status === 'locked' ? '锁定' : '交付') + '，不可编辑');
      return;
    }

    if (this.pasteMode && this.pasteAnchor) {
      this.commitPaste();
      return;
    }

    if (tool === 'select') {
      this.handleSelectClick(ray);
      return;
    }

    // 笔刷类工具：开始一笔
    this.strokeActive = true;
    this.strokeChanges = [];
    this.applyBrush(ray, true);
  };

  private handleMove = (e: PointerEvent): void => {
    if (this.pointerDown && (this.orbiting || this.panning)) {
      const dx = e.clientX - this.lastPointer[0];
      const dy = e.clientY - this.lastPointer[1];
      this.lastPointer = [e.clientX, e.clientY, 0];
      if (this.orbiting) this.camera.rotate(dx, dy);
      else this.panCamera(dx, dy);
      return;
    }
    const ray = this.rayAt(e);
    if (this.strokeActive) {
      this.applyBrush(ray, false);
      return;
    }
    if (this.pasteMode && this.clipboard) {
      this.updatePasteAnchor(ray);
      return;
    }
    this.updateHover(ray);
  };

  private handleUp = (): void => {
    if (this.strokeActive) this.finishStroke();
    this.pointerDown = false;
    this.orbiting = false;
    this.panning = false;
  };

  private handleLeave = (): void => {
    this.scene.hover = null;
  };

  private panCamera(dx: number, dy: number): void {
    const scale = this.camera.radius * 0.0016;
    const right = this.camera.right;
    const f = this.camera.forward;
    const up: Vec3 = [
      f[1] * right[2] - f[2] * right[1],
      f[2] * right[0] - f[0] * right[2],
      f[0] * right[1] - f[1] * right[0],
    ];
    this.camera.target = [
      this.camera.target[0] - right[0] * dx * scale + up[0] * dy * scale,
      this.camera.target[1] - right[1] * dx * scale + up[1] * dy * scale,
      this.camera.target[2] - right[2] * dx * scale + up[2] * dy * scale,
    ];
  }

  // ---------- 悬停 / 拾取 ----------

  private pickableLayers(): Layer[] {
    // 只编辑当前层时，拾取只看当前层；否则看所有可见层
    if (store.settings.editActiveOnly) {
      const active = store.activeLayer;
      return active ? [active] : [];
    }
    return this.layers.filter((l) => l.visible);
  }

  private updateHover(ray: { origin: Vec3; dir: Vec3 }): void {
    const hit = pickVoxel(ray.origin, ray.dir, this.pickableLayers());
    if (hit) {
      this.scene.hover = { voxel: hit.voxel, normal: hit.normal, kind: 'face' };
      return;
    }
    // 空落点：让笔刷在空白处也能沿网格外盒落子
    if (store.settings.tool === 'paint') {
      const occ = (x: number, y: number, z: number): boolean =>
        this.pickableLayers().some((l) => l.voxels.has(keyOf(x, y, z)));
      const empty = pickEmptyCell(ray.origin, ray.dir, occ);
      if (empty) {
        this.scene.hover = { voxel: empty.voxel, normal: empty.normal, kind: 'ghost' };
        return;
      }
    }
    this.scene.hover = null;
  }

  // ---------- 笔刷 ----------

  private applyBrush(ray: { origin: Vec3; dir: Vec3 }, isFirst: boolean): void {
    const tool = store.settings.tool;
    const hit = pickVoxel(ray.origin, ray.dir, this.pickableLayers());
    const s = store.settings;

    if (tool === 'pick') {
      if (hit) {
        const owner = store.model.findOwner(hit.voxel[0], hit.voxel[1], hit.voxel[2]);
        const color = owner?.voxels.get(keyOf(hit.voxel[0], hit.voxel[1], hit.voxel[2]));
        if (color !== undefined) {
          s.color = color;
          this.onStatus?.('已吸取颜色');
          store.emit();
        }
      }
      this.strokeActive = false;
      return;
    }

    if (tool === 'erase') {
      if (!hit) return;
      this.eraseAt(hit.voxel);
      return;
    }

    // paint：沿命中面法线落子；空白处用 ghost 落点
    let target: Vec3 | null = null;
    let normal: Vec3 = [0, 1, 0];
    if (hit) {
      target = [
        hit.voxel[0] + hit.normal[0],
        hit.voxel[1] + hit.normal[1],
        hit.voxel[2] + hit.normal[2],
      ];
      normal = hit.normal;
    } else {
      const occ = (x: number, y: number, z: number): boolean =>
        this.pickableLayers().some((l) => l.voxels.has(keyOf(x, y, z)));
      const empty = pickEmptyCell(ray.origin, ray.dir, occ);
      if (empty) {
        target = empty.voxel;
        normal = empty.normal;
      }
    }
    if (!target) return;
    const cellKey = keyOf(target[0], target[1], target[2]);
    if (!isFirst && cellKey === this.lastPaintCell) return;
    this.lastPaintCell = cellKey;
    this.paintAt(target, normal);
  }

  /** 以 center 为中心、brushSize 为直径在垂直于 normal 的平面上铺开笔刷 */
  private brushOffsets(normal: Vec3): Vec3[] {
    const r = store.settings.brushSize;
    if (r <= 1) return [[0, 0, 0]];
    const half = Math.floor(r / 2);
    const offsets: Vec3[] = [];
    if (normal[0] !== 0) {
      for (let dy = -half; dy <= half; dy++)
        for (let dz = -half; dz <= half; dz++) offsets.push([0, dy, dz]);
    } else if (normal[1] !== 0) {
      for (let dx = -half; dx <= half; dx++)
        for (let dz = -half; dz <= half; dz++) offsets.push([dx, 0, dz]);
    } else {
      for (let dx = -half; dx <= half; dx++)
        for (let dy = -half; dy <= half; dy++) offsets.push([dx, dy, 0]);
    }
    return offsets;
  }

  private paintAt(center: Vec3, normal: Vec3): void {
    const active = store.activeLayer;
    if (!active || active.locked) {
      this.onStatus?.('当前层已锁定，无法放置');
      return;
    }
    const s = store.settings;
    const offsets = this.brushOffsets(normal);
    for (const o of offsets) {
      const x = center[0] + o[0], y = center[1] + o[1], z = center[2] + o[2];
      if (!inGrid(x, y, z)) continue;
      const targets: Vec3[] = [[x, y, z]];
      if (s.mirrorX) {
        const mx = mirrorX(x);
        if (mx !== x) targets.push([mx, y, z]); // 对称面格只落一次
      }
      for (const [tx, ty, tz] of targets) {
        const k = keyOf(tx, ty, tz);
        if (store.model.occupiedAt(tx, ty, tz)) {
          // 已占用：同层则换色，异层跳过（不重叠）
          if (active.voxels.has(k)) {
            const old = active.voxels.get(k)!;
            if (old === s.color) continue;
            active.voxels.set(k, s.color);
            this.strokeChanges.push({ layerId: active.id, key: k, color: old, kind: 'add' });
          }
          continue;
        }
        active.voxels.set(k, s.color);
        this.strokeChanges.push({ layerId: active.id, key: k, color: s.color, kind: 'add' });
      }
    }
    this.afterEdit();
  }

  private eraseAt(voxel: Vec3): void {
    const s = store.settings;
    const targets: Vec3[] = [[voxel[0], voxel[1], voxel[2]]];
    if (s.mirrorX) {
      const mx = mirrorX(voxel[0]);
      if (mx !== voxel[0]) targets.push([mx, voxel[1], voxel[2]]);
    }
    for (const [tx, ty, tz] of targets) {
      const owner = this.layers.find(
        (l) => l.visible && l.voxels.has(keyOf(tx, ty, tz)),
      );
      if (!owner || owner.locked) continue;
      if (s.editActiveOnly && owner.id !== store.activeLayer?.id) continue;
      const k = keyOf(tx, ty, tz);
      const color = owner.voxels.get(k)!;
      owner.voxels.delete(k);
      this.strokeChanges.push({ layerId: owner.id, key: k, color, kind: 'remove' });
    }
    this.afterEdit();
  }

  private afterEdit(): void {
    this.scene.updateVoxels(this.layers);
  }

  private finishStroke(): void {
    this.strokeActive = false;
    this.lastPaintCell = '';
    const changes = this.strokeChanges;
    this.strokeChanges = [];
    if (!changes.length) return;
    const layerById = new Map(this.layers.map((l) => [l.id, l]));
    const entry: HistoryEntry = {
      label: changes[0].kind === 'add' ? '笔刷放置/换色' : '擦除',
      undo: () => {
        for (const c of changes) {
          const layer = layerById.get(c.layerId);
          if (!layer) continue;
          if (c.kind === 'add') layer.voxels.delete(c.key);
          else layer.voxels.set(c.key, c.color);
        }
        this.scene.updateVoxels(this.layers);
      },
      redo: () => {
        for (const c of changes) {
          const layer = layerById.get(c.layerId);
          if (!layer) continue;
          if (c.kind === 'add') layer.voxels.set(c.key, c.color);
          else layer.voxels.delete(c.key);
        }
        this.scene.updateVoxels(this.layers);
      },
    };
    store.pushHistory(entry);
    store.emit();
  }

  // ---------- 框选 ----------

  private selectAnchor: Vec3 | null = null;

  private handleSelectClick(ray: { origin: Vec3; dir: Vec3 }): void {
    const hit = pickVoxel(ray.origin, ray.dir, this.pickableLayers());
    if (!hit) {
      this.clearSelection();
      return;
    }
    if (!this.selectAnchor) {
      this.selectAnchor = hit.voxel;
      this.selection = normalizeBounds(hit.voxel, hit.voxel);
      this.scene.selectionBounds = this.selection;
      this.onStatus?.('已选第一个角点，再点一个体素确定选区');
    } else {
      this.selection = normalizeBounds(this.selectAnchor, hit.voxel);
      this.scene.selectionBounds = this.selection;
      this.selectAnchor = null;
      this.onStatus?.(`选区已建立：${this.countSelected()} 个体素`);
    }
    this.onSelectionChange?.();
  }

  private countSelected(): number {
    if (!this.selection) return 0;
    let n = 0;
    const b = this.selection;
    for (const l of this.layers) {
      for (const k of l.voxels.keys()) {
        const [x, y, z] = k.split(',').map(Number);
        if (x >= b.min[0] && x <= b.max[0] && y >= b.min[1] && y <= b.max[1] && z >= b.min[2] && z <= b.max[2]) n++;
      }
    }
    return n;
  }

  clearSelection(): void {
    this.selection = null;
    this.selectAnchor = null;
    this.scene.selectionBounds = null;
    this.cancelPaste();
    this.onSelectionChange?.();
  }

  copySelection(): void {
    if (!this.selection) return;
    this.clipboard = copyToClipboard(this.layers, this.selection);
    this.onStatus?.(`已复制 ${this.countSelected()} 个体素`);
  }

  deleteSelection(): void {
    if (!this.selection) return;
    const picked = new Map(this.layers.map((l) => [l.id, new Map<string, number>()]));
    const b = this.selection;
    for (const l of this.layers) {
      if (l.locked) continue;
      for (const [k, color] of l.voxels) {
        const [x, y, z] = k.split(',').map(Number);
        if (x >= b.min[0] && x <= b.max[0] && y >= b.min[1] && y <= b.max[1] && z >= b.min[2] && z <= b.max[2]) {
          picked.get(l.id)!.set(k, color);
        }
      }
    }
    const records = deleteCells(this.layers, picked);
    if (!records.length) return;
    const entry: HistoryEntry = {
      label: '框选删除',
      undo: () => { restoreCells(this.layers, records); this.scene.updateVoxels(this.layers); },
      redo: () => { deleteCells(this.layers, picked); this.scene.updateVoxels(this.layers); },
    };
    store.pushHistory(entry);
    this.scene.updateVoxels(this.layers);
    this.clearSelection();
    store.emit();
  }

  /** 复制后进入粘贴模式，点击场景确定落点 */
  beginPaste(): void {
    if (!this.clipboard) return;
    this.pasteMode = true;
    this.pasteAnchor = this.clipboard.anchor;
    this.refreshPasteGhost();
    this.onStatus?.('移动鼠标选择粘贴位置，左键确认 / Esc 取消');
  }

  private updatePasteAnchor(ray: { origin: Vec3; dir: Vec3 }): void {
    const hit = pickVoxel(ray.origin, ray.dir, this.pickableLayers());
    if (!hit || !this.clipboard) return;
    // 贴在命中面外侧，以命中体素面法线偏移
    const anchor: Vec3 = [
      hit.voxel[0] + hit.normal[0],
      hit.voxel[1] + hit.normal[1],
      hit.voxel[2] + hit.normal[2],
    ];
    this.pasteAnchor = anchor;
    this.refreshPasteGhost();
  }

  private refreshPasteGhost(): void {
    if (!this.clipboard || !this.pasteAnchor) return;
    const a = this.pasteAnchor;
    const s = this.clipboard.size;
    this.scene.pasteGhost = {
      min: a,
      max: [a[0] + s[0] - 1, a[1] + s[1] - 1, a[2] + s[2] - 1],
    };
  }

  private commitPaste(): void {
    if (!this.clipboard || !this.pasteAnchor) return;
    const occupied = new Set<string>();
    for (const l of this.layers) for (const k of l.voxels.keys()) occupied.add(k);
    const { result, records } = pasteClipboard(this.layers, this.clipboard, this.pasteAnchor, occupied);
    const entry: HistoryEntry = {
      label: '粘贴体素',
      undo: () => { restoreCells(this.layers, records); this.scene.updateVoxels(this.layers); },
      redo: () => {
        const occ = new Set<string>();
        for (const l of this.layers) for (const k of l.voxels.keys()) occ.add(k);
        if (this.clipboard) pasteClipboard(this.layers, this.clipboard, this.pasteAnchor!, occ);
        this.scene.updateVoxels(this.layers);
      },
    };
    store.pushHistory(entry);
    this.cancelPaste();
    this.scene.updateVoxels(this.layers);
    this.onStatus?.(`粘贴完成：${result.placed} 个落位，${result.blocked} 个被遮挡/越界`);
    store.emit();
  }

  cancelPaste(): void {
    this.pasteMode = false;
    this.pasteAnchor = null;
    this.scene.pasteGhost = null;
  }

  get isPasting(): boolean {
    return this.pasteMode;
  }

  /** 控制器因 DOM 重绘重建时，导出/恢复编辑态 */
  snapshot(): ControllerState {
    return {
      selection: this.selection,
      selectAnchor: this.selectAnchor,
      clipboard: this.clipboard,
      pasteAnchor: this.pasteAnchor,
      pasteMode: this.pasteMode,
    };
  }

  restore(state: ControllerState): void {
    this.selection = state.selection;
    this.selectAnchor = state.selectAnchor;
    this.clipboard = state.clipboard;
    this.pasteAnchor = state.pasteAnchor;
    this.pasteMode = state.pasteMode;
    this.scene.selectionBounds = this.selection;
    this.refreshPasteGhost();
    this.onSelectionChange?.();
  }

  // 移动 = 剪切 + 粘贴
  beginMove(): void {
    if (!this.selection) return;
    this.copySelection();
    this.deleteSelection();
    this.beginPaste();
  }
}

export { voxelToWorld, MIRROR_PLANE, GRID };
