/**
 * 编辑会话 —— 把体素模型、渲染器与编辑状态串起来。
 *
 * 设计取舍：
 *  - VoxelModel 是普通类实例，不放进 Vue 响应式系统（2M 字节的数组做代理会拖垮性能）。
 *    需要驱动 UI 的计数用 ref 手动同步。
 *  - 所有编辑都通过 applyChanges 落到模型上，并把变更记录进撤销栈。
 *  - 镜像模式在“记录变更”这一层做：一次操作产生的每个格子，
 *    若开启了镜像，就同时写入镜像格，撤销时自然一起回退。
 */

import { reactive, ref, shallowRef, computed, markRaw } from 'vue';
import { VoxelModel, AIR, mirrorIndexX } from '../../shared/voxel.js';
import { analyzeModel, issueMarkers } from '../../shared/validate.js';
import { MAT, MATERIALS } from '../../shared/materials.js';
import { VoxelRenderer } from './VoxelRenderer.js';

const MAX_UNDO = 60;

export class EditorSession {
  constructor(canvas) {
    this.renderer = markRaw(new VoxelRenderer(canvas));
    this.model = shallowRef(null);
    this.order = ref(null);
    this.tool = ref('build');
    this.brushMat = ref(MAT.hull.id);
    this.secondaryMat = ref(MAT.regolith.id);
    this.mode = ref('place'); // place | erase | paint
    this.brushSize = ref(1);

    // 图层
    this.layerCount = ref(96);
    this.layerMin = ref(1);
    this.layerMax = ref(96);
    this.lockedLayers = ref(new Set());
    this.soloLayers = ref(new Set());
    this.activeLayer = ref(1);
    this.focusLayers = ref(false);

    // 镜像
    this.mirror = reactive({ enabled: false, plane: 72, axis: 'x' });

    // 选区
    this.selection = reactive({
      active: false,
      box: null, // {x0,y0,z0,x1,y1,z1}
      count: 0,
      mode: 'box', // box | stack
    });

    // 剪贴板
    this.clipboard = shallowRef(null); // {cells,min,size,count}
    this.clipboardInfo = ref(null);

    // 撤销
    this.undoStack = [];
    this.redoStack = [];
    this.undoDepth = ref(0);
    this.redoDepth = ref(0);

    // 统计
    this.stats = reactive({ total: 0, byGroup: {}, byMaterial: {}, dirty: false });
    this.params = reactive({ floatingMin: 5, minWall: 2 });

    // 体检
    this.analysis = ref(null);
    this.markers = ref([]);
    this.checking = ref(false);
    this.lastSavedAt = ref(null);
    this.dirty = ref(false);

    this.rafPending = false;
    this.hoverInfo = ref(null);
    this.cursor = reactive({ x: 0, y: 0, z: 1, valid: false, mat: 0 });
    this.statusText = ref('就绪');
  }

  setModel(model, order) {
    // 切换订单时清空历史，避免撤销跨模型
    this.undoStack = [];
    this.redoStack = [];
    this.undoDepth.value = 0;
    this.redoDepth.value = 0;
    this.model.value = model;
    this.order.value = order || null;
    this.layerCount.value = model.sizeZ;
    this.layerMin.value = 1;
    this.layerMax.value = model.sizeZ;
    this.lockedLayers.value = new Set();
    this.soloLayers.value = new Set();
    this.activeLayer.value = Math.max(1, Math.min(model.sizeZ, 1));
    this.focusLayers.value = false;
    this.mirror.plane = Math.floor(model.sizeX / 2);
    this.selection.active = false;
    this.selection.box = null;
    this.selection.count = 0;
    this.clipboard.value = null;
    this.clipboardInfo.value = null;
    this.analysis.value = null;
    this.markers.value = [];
    this.dirty.value = false;
    this.renderer.setModel(model);
    this.renderer.frameAll();
    this.renderer.opts.focusLayers = null;
    this.renderer.opts.layerMin = 1;
    this.renderer.opts.layerMax = model.sizeZ;
    this.renderer.opts.mirrorPlane = this.mirror.enabled ? this.mirror.plane : null;
    this.refreshStats();
    this.requestRender();
  }

  get grid() {
    const m = this.model.value;
    if (!m) return { sizeX: 0, sizeY: 0, sizeZ: 0, voxelSize: 0.5 };
    return { sizeX: m.sizeX, sizeY: m.sizeY, sizeZ: m.sizeZ, voxelSize: m.voxelSize };
  }

  requestRender() {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      try {
        this.renderer.render();
      } catch (err) {
        console.error('[render]', err);
      }
    });
  }

  refreshStats() {
    const m = this.model.value;
    if (!m) return;
    const s = m.stats();
    this.stats.total = s.total;
    this.stats.byGroup = s.byGroup;
    this.stats.byMaterial = s.byMaterial;
  }

  // ---------------------------------------------------------------- 层

  isLayerLocked(z) {
    const lv = z + 1; // 1-based
    if (this.lockedLayers.value.has(lv)) return true;
    if (this.soloLayers.value.size && !this.soloLayers.value.has(lv)) return true;
    return lv < this.layerMin.value || lv > this.layerMax.value;
  }

  setLayerRange(min, max) {
    const lo = Math.max(1, Math.min(min, max));
    const hi = Math.min(this.layerCount.value, Math.max(min, max));
    this.layerMin.value = lo;
    this.layerMax.value = hi;
    this.renderer.opts.layerMin = lo;
    this.renderer.opts.layerMax = hi;
    this.renderer.opts.focusLayers = this.focusLayers.value ? new Set(this.layerRangeList()) : null;
    if (this.activeLayer.value < lo || this.activeLayer.value > hi) this.activeLayer.value = lo;
    this.renderer.opts.sectionZ = this.activeLayer.value - 1;
    this.rebuildAllChunks();
  }

  layerRangeList() {
    const out = [];
    for (let z = this.layerMin.value; z <= this.layerMax.value; z++) out.push(z);
    return out;
  }

  toggleFocus() {
    this.focusLayers.value = !this.focusLayers.value;
    this.renderer.opts.focusLayers = this.focusLayers.value ? new Set(this.layerRangeList()) : null;
    this.requestRender();
  }

  setActiveLayer(z) {
    const lv = Math.max(1, Math.min(this.layerCount.value, z));
    this.activeLayer.value = lv;
    this.renderer.opts.sectionZ = lv - 1;
    this.requestRender();
  }

  toggleLock(z) {
    const lv = typeof z === 'number' ? z : this.activeLayer.value;
    const s = new Set(this.lockedLayers.value);
    if (s.has(lv)) s.delete(lv);
    else s.add(lv);
    this.lockedLayers.value = s;
    this.requestRender();
  }

  toggleSolo(z) {
    const lv = typeof z === 'number' ? z : this.activeLayer.value;
    const s = new Set(this.soloLayers.value);
    if (s.has(lv)) s.delete(lv);
    else s.add(lv);
    this.soloLayers.value = s;
    this.applyHiddenLayers();
  }

  clearSolo() {
    this.soloLayers.value = new Set();
    this.applyHiddenLayers();
  }

  /** 只显示指定层（1-based 层号数组）；传空数组等于显示全部。 */
  setVisibleLayers(layers) {
    const valid = new Set();
    for (const lv of layers) {
      if (Number.isFinite(lv) && lv >= 1 && lv <= this.layerCount.value) valid.add(lv);
    }
    this.soloLayers.value = valid;
    this.applyHiddenLayers();
    return valid.size;
  }

  applyHiddenLayers() {
    const hidden = new Set();
    const solo = this.soloLayers.value;
    for (let lv = 1; lv <= this.layerCount.value; lv++) {
      if (solo.size && !solo.has(lv)) hidden.add(lv);
      if (lv < this.layerMin.value || lv > this.layerMax.value) hidden.add(lv);
    }
    this.renderer.opts.hiddenLayers = hidden;
    this.rebuildAllChunks();
  }

  rebuildAllChunks() {
    this.renderer.rebuildAll();
    this.requestRender();
  }

  setMirror(enabled) {
    this.mirror.enabled = enabled;
    this.renderer.opts.mirrorPlane = enabled ? this.mirror.plane : null;
    this.requestRender();
  }

  setMirrorPlane(p) {
    this.mirror.plane = Math.max(1, Math.min(this.grid.sizeX - 1, p));
    if (this.mirror.enabled) this.renderer.opts.mirrorPlane = this.mirror.plane;
    this.requestRender();
  }

  /** 镜像轴线以格数表示时，允许“轴在格心”用 0.5 偏移；这里用整数格边界。 */
  mirroredX(x) {
    return mirrorIndexX(x, this.mirror.plane);
  }

  // ---------------------------------------------------------------- 编辑原语

  /**
   * 把一组目标格子写进模型，处理镜像与图层锁。
   * @param {Array<{x:number,y:number,z:number,mat:number}>} targets
   * @param {{respectLock?:boolean, record?:boolean}} [opts]
   */
  writeCells(targets, opts = {}) {
    const m = this.model.value;
    if (!m) return 0;
    const respectLock = opts.respectLock !== false;
    const record = opts.record !== false;
    const expanded = [];
    const seen = new Set();
    for (const t of targets) {
      if (!m.inside(t.x, t.y, t.z)) continue;
      if (respectLock && this.isLayerLocked(t.z)) continue;
      const key = `${t.x},${t.y},${t.z}`;
      if (seen.has(key)) continue;
      seen.add(key);
      expanded.push(t);
      if (this.mirror.enabled && !t.noMirror) {
        const mx = this.mirroredX(t.x);
        if (mx !== t.x && m.inside(mx, t.y, t.z)) {
          const mkey = `${mx},${t.y},${t.z}`;
          if (!seen.has(mkey) && !(respectLock && this.isLayerLocked(t.z))) {
            seen.add(mkey);
            expanded.push({ x: mx, y: t.y, z: t.z, mat: t.mat });
          }
        }
      }
    }
    const changes = [];
    for (const t of expanded) {
      const i = m.idx(t.x, t.y, t.z);
      const before = m.bytes[i];
      if (before === t.mat) continue;
      changes.push({ x: t.x, y: t.y, z: t.z, b: before, a: t.mat });
      if (before === AIR && t.mat !== AIR) m.occupied++;
      else if (before !== AIR && t.mat === AIR) m.occupied--;
      m.bytes[i] = t.mat;
    }
    if (!changes.length) return 0;
    m.revision++;
    if (record) this.pushUndo(changes);
    for (const c of changes) this.renderer.touchVoxel(c.x, c.y, c.z);
    this.refreshStats();
    this.markDirty();
    this.requestRender();
    return changes.length;
  }

  /** 一次拖拽/一笔操作合并成同一个撤销步。 */
  beginStroke() {
    this._stroke = [];
  }

  endStroke() {
    const stroke = this._stroke;
    this._stroke = null;
    if (!stroke || !stroke.length) return;
    // 同一格子多次改动只保留最初的 before 与最后的 after
    const merged = new Map();
    for (const c of stroke) {
      const k = `${c.x},${c.y},${c.z}`;
      const prev = merged.get(k);
      if (prev) prev.a = c.a;
      else merged.set(k, { ...c });
    }
    const ordered = [...merged.values()].filter((c) => c.b !== c.a);
    if (!ordered.length) return;
    this.undoStack.push(ordered);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack.length = 0;
    this.undoDepth.value = this.undoStack.length;
    this.redoDepth.value = 0;
  }

  pushUndo(changes) {
    if (this._stroke) {
      this._stroke.push(...changes);
      return;
    }
    this.undoStack.push(changes);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack.length = 0;
    this.undoDepth.value = this.undoStack.length;
    this.redoDepth.value = 0;
  }

  undo() {
    const m = this.model.value;
    const changes = this.undoStack.pop();
    if (!changes || !m) return;
    m.applyChanges(changes, -1);
    for (const c of changes) this.renderer.touchVoxel(c.x, c.y, c.z);
    this.redoStack.push(changes);
    this.undoDepth.value = this.undoStack.length;
    this.redoDepth.value = this.redoStack.length;
    this.markDirty();
    this.refreshStats();
    this.requestRender();
  }

  redo() {
    const m = this.model.value;
    const changes = this.redoStack.pop();
    if (!changes || !m) return;
    m.applyChanges(changes, 1);
    for (const c of changes) this.renderer.touchVoxel(c.x, c.y, c.z);
    this.undoStack.push(changes);
    this.undoDepth.value = this.undoStack.length;
    this.redoDepth.value = this.redoStack.length;
    this.markDirty();
    this.refreshStats();
    this.requestRender();
  }

  markDirty() {
    this.dirty.value = true;
    this.stats.dirty = true;
    this.invalidateAnalysis();
  }

  invalidateAnalysis() {
    // 体检结果与模型强相关，改动后标记为陈旧
    if (this.analysis.value) this.analysis.value = { ...this.analysis.value, stale: true };
  }

  // ---------------------------------------------------------------- 笔刷

  /** 在当前编辑层上按笔刷大小落子。 */
  paintAt(voxel, { erase = false } = {}) {
    if (!voxel) return 0;
    const m = this.model.value;
    const r = Math.max(0, Math.floor((this.brushSize.value - 1) / 2));
    const mat = erase ? AIR : this.brushMat.value;
    const targets = [];
    const z = voxel.z;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        targets.push({ x: voxel.x + dx, y: voxel.y + dy, z, mat });
      }
    }
    return this.writeCells(targets);
  }

  /** 在被点中体素的法线方向外侧放置（生成新的一层）。 */
  placeOnFace(voxel) {
    if (!voxel) return 0;
    const n = voxel.face || [0, 0, 1];
    return this.paintAt({ x: voxel.x + n[0], y: voxel.y + n[1], z: voxel.z + n[2] });
  }

  eraseAt(voxel) {
    if (!voxel) return 0;
    return this.paintAt(voxel, { erase: true });
  }

  pickAt(voxel) {
    if (!voxel || !voxel.mat) return;
    this.brushMat.value = voxel.mat;
    this.statusText.value = `吸取材质：${MATERIALS.find((x) => x.id === voxel.mat)?.name || voxel.mat}`;
  }

  // ---------------------------------------------------------------- 选区

  beginSelection(voxel) {
    if (!voxel) return;
    const zLo = this.layerMin.value - 1;
    const zHi = this.layerMax.value - 1;
    this.selection.active = true;
    this.selection.box = {
      x0: voxel.x, y0: voxel.y, z0: Math.max(voxel.z, zLo),
      x1: voxel.x, y1: voxel.y, z1: Math.min(voxel.z, zHi),
    };
    this.updateSelectionCount();
  }

  extendSelection(voxel) {
    if (!voxel || !this.selection.box) return;
    const b = this.selection.box;
    b.x1 = voxel.x;
    b.y1 = voxel.y;
    b.z1 = voxel.z;
    this.updateSelectionCount();
    this.requestRender();
  }

  /** 选区跨整个编辑层范围（“整层框选”）。 */
  selectLayerSpan(voxel) {
    if (!voxel) return;
    this.selection.active = true;
    this.selection.box = {
      x0: voxel.x, y0: voxel.y, z0: this.layerMin.value - 1,
      x1: voxel.x, y1: voxel.y, z1: this.layerMax.value - 1,
    };
    this.updateSelectionCount();
    this.requestRender();
  }

  selectAllInLayers() {
    const m = this.model.value;
    if (!m) return;
    const b = m.occupancyBounds();
    if (!b) return;
    this.selection.active = true;
    this.selection.box = {
      x0: b.x0, y0: b.y0, z0: this.layerMin.value - 1,
      x1: b.x1, y1: b.y1, z1: this.layerMax.value - 1,
    };
    this.updateSelectionCount();
    this.requestRender();
  }

  normalizeSelection() {
    const b = this.selection.box;
    if (!b) return null;
    return {
      x0: Math.min(b.x0, b.x1), y0: Math.min(b.y0, b.y1), z0: Math.min(b.z0, b.z1),
      x1: Math.max(b.x0, b.x1), y1: Math.max(b.y0, b.y1), z1: Math.max(b.z0, b.z1),
    };
  }

  updateSelectionCount() {
    const m = this.model.value;
    const b = this.normalizeSelection();
    if (!m || !b) {
      this.selection.count = 0;
      this.renderer.selection = null;
      return;
    }
    let n = 0;
    for (let z = b.z0; z <= b.z1; z++) {
      for (let y = b.y0; y <= b.y1; y++) {
        for (let x = b.x0; x <= b.x1; x++) {
          if (m.get(x, y, z)) n++;
        }
      }
    }
    this.selection.count = n;
    this.selection.normalized = b;
    this.renderer.selection = { box: b };
    this.requestRender();
  }

  clearSelection() {
    this.selection.active = false;
    this.selection.box = null;
    this.selection.count = 0;
    this.renderer.selection = null;
    this.requestRender();
  }

  /** 当前选区内的非空体素（用于填充/替换材质）。 */
  selectionBoxes() {
    const b = this.selection.active ? this.normalizeSelection() : null;
    if (b) return [b];
    return [{
      x0: 0, y0: 0, z0: this.layerMin.value - 1,
      x1: this.grid.sizeX - 1, y1: this.grid.sizeY - 1, z1: this.layerMax.value - 1,
    }];
  }

  fillSelection(mat) {
    const boxes = this.selectionBoxes();
    const targets = [];
    const m = this.model.value;
    if (!m) return 0;
    const seen = new Set();
    for (const b of boxes) {
      const c = m.clampBox(b);
      if (!c) continue;
      for (let z = c.z0; z <= c.z1; z++) {
        for (let y = c.y0; y <= c.y1; y++) {
          for (let x = c.x0; x <= c.x1; x++) {
            const key = `${x},${y},${z}`;
            if (seen.has(key)) continue;
            seen.add(key);
            targets.push({ x, y, z, mat });
          }
        }
      }
    }
    const n = this.writeCells(targets);
    this.refreshStats();
    return n;
  }

  /** 选区填充：只填空气（“灌浆”），保留已有的形体。 */
  fillSelectionAir(mat) {
    const m = this.model.value;
    if (!m) return 0;
    const b = this.selection.active ? this.normalizeSelection() : null;
    const c = b || {
      x0: 0, y0: 0, z0: this.layerMin.value - 1,
      x1: m.sizeX - 1, y1: m.sizeY - 1, z1: this.layerMax.value - 1,
    };
    const targets = [];
    for (let z = c.z0; z <= c.z1; z++) {
      for (let y = c.y0; y <= c.y1; y++) {
        for (let x = c.x0; x <= c.x1; x++) {
          if (m.get(x, y, z) === AIR) targets.push({ x, y, z, mat });
        }
      }
    }
    const n = this.writeCells(targets);
    this.refreshStats();
    return n;
  }

  /** 按颜色替换：选区（或当前层范围）内指定材质 → 目标材质。 */
  replaceMaterial(fromMat, toMat) {
    const m = this.model.value;
    if (!m) return 0;
    const boxes = this.selectionBoxes();
    const seen = new Set();
    const targets = [];
    for (const raw of boxes) {
      const c = m.clampBox(raw);
      if (!c) continue;
      for (let z = c.z0; z <= c.z1; z++) {
        for (let y = c.y0; y <= c.y1; y++) {
          for (let x = c.x0; x <= c.x1; x++) {
            const key = `${x},${y},${z}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const cur = m.get(x, y, z);
            if (cur === 0) continue;
            if (fromMat === 'any' || cur === fromMat) targets.push({ x, y, z, mat: toMat });
          }
        }
      }
    }
    const n = this.writeCells(targets);
    this.refreshStats();
    return n;
  }

  /** 选区按材质组替换（洞体/内壁/舱体/设备 一组换另一组）。 */
  replaceGroup(fromGroup, toGroup, materials, groups) {
    const toId = (materials.find((mm) => mm.group === toGroup) || {}).id;
    if (!toId) return 0;
    const fromIds = new Set(materials.filter((mm) => mm.group === fromGroup).map((mm) => mm.id));
    const m = this.model.value;
    if (!m) return 0;
    const boxes = this.selectionBoxes();
    const seen = new Set();
    const targets = [];
    for (const raw of boxes) {
      const c = m.clampBox(raw);
      if (!c) continue;
      for (let z = c.z0; z <= c.z1; z++) {
        for (let y = c.y0; y <= c.y1; y++) {
          for (let x = c.x0; x <= c.x1; x++) {
            const key = `${x},${y},${z}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const cur = m.get(x, y, z);
            if (fromIds.has(cur)) targets.push({ x, y, z, mat: toId });
          }
        }
      }
    }
    return this.writeCells(targets);
  }

  deleteSelection() {
    const m = this.model.value;
    if (!m) return 0;
    const b = this.selection.active ? this.normalizeSelection() : null;
    const boxes = b ? [b] : [{
      x0: 0, y0: 0, z0: this.layerMin.value - 1,
      x1: m.sizeX - 1, y1: m.sizeY - 1, z1: this.layerMax.value - 1,
    }];
    const seen = new Set();
    const targets = [];
    for (const raw of boxes) {
      const c = m.clampBox(raw);
      for (let z = c.z0; z <= c.z1; z++) {
        for (let y = c.y0; y <= c.y1; y++) {
          for (let x = c.x0; x <= c.x1; x++) {
            const key = `${x},${y},${z}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (m.get(x, y, z)) targets.push({ x, y, z, mat: AIR });
          }
        }
      }
    }
    const n = this.writeCells(targets);
    this.refreshStats();
    return n;
  }

  // ---------------------------------------------------------------- 剪贴板 / 阵列

  copySelection() {
    const m = this.model.value;
    if (!m) return false;
    const b = this.selection.active ? this.normalizeSelection() : null;
    if (!b) return false;
    const clip = m.copyBoxes([b]);
    if (!clip) return false;
    this.clipboard.value = clip;
    this.clipboardInfo.value = { count: clip.count, size: clip.size, at: Date.now() };
    this.statusText.value = `已复制 ${clip.count.toLocaleString('zh-CN')} 格（${clip.size.join(' × ')}）`;
    return true;
  }

  cutSelection() {
    if (this.copySelection()) {
      const n = this.deleteSelection();
      this.statusText.value = `已剪切 ${n.toLocaleString('zh-CN')} 格`;
      return true;
    }
    return false;
  }

  /**
   * 粘贴到锚点。
   * @param {{x:number,y:number,z:number}} anchor
   * @param {{dx?:number,dy?:number,dz?:number}} [offset]
   */
  paste(anchor, offset = {}) {
    const m = this.model.value;
    const clip = this.clipboard.value;
    if (!m || !clip) return 0;
    const ax = anchor.x + (offset.dx || 0);
    const ay = anchor.y + (offset.dy || 0);
    const az = anchor.z + (offset.dz || 0);
    const targets = [];
    for (const [cx, cy, cz, mat] of clip.cells) {
      targets.push({
        x: ax + (cx - clip.min[0]),
        y: ay + (cy - clip.min[1]),
        z: az + (cz - clip.min[2]),
        mat,
      });
    }
    const n = this.writeCells(targets);
    this.refreshStats();
    return n;
  }

  /** 原地重复粘贴一次（偏移一格，沿当前轴向）。 */
  pasteOffset(axis, delta) {
    const clip = this.clipboard.value;
    if (!clip) return 0;
    const off = { dx: 0, dy: 0, dz: 0 };
    off[`d${axis}`] = delta;
    return this.paste(this.lastPasteAnchor || { x: 0, y: 0, z: 0 }, off);
  }

  /**
   * 阵列复制：把选区（或剪贴板）沿指定轴向复制 count 份。
   * @param {{axis:'x'|'y'|'z', count:number, spacing:number, source:'selection'|'clipboard'}} cfg
   */
  arrayCopy(cfg) {
    const m = this.model.value;
    if (!m) return { added: 0 };
    let clip = this.clipboard.value;
    let anchor = null;
    if (cfg.source === 'selection' || !clip) {
      const b = this.selection.active ? this.normalizeSelection() : null;
      if (!b) return { added: 0, error: '请先框选要阵列的体素' };
      const src = m.copyBoxes([b]);
      if (!src) return { added: 0, error: '选区内没有体素' };
      clip = src;
      anchor = [b.x0, b.y0, b.z0];
    }
    if (!this._arrayAnchor) {
      const nb = m.occupancyBounds();
      this._arrayAnchor = nb ? [nb.x0, nb.y0, nb.z0] : [0, 0, 0];
    }
    const base = anchor || this._arrayAnchor;
    const count = Math.max(1, Math.min(64, Number(cfg.count) || 1));
    const spacing = Math.max(clip.size[cfg.axis === 'x' ? 0 : cfg.axis === 'y' ? 1 : 2], Number(cfg.spacing) || clip.size[0]);
    const targets = [];
    for (let i = 1; i <= count; i++) {
      const d = spacing * i;
      for (const [cx, cy, cz, mat] of clip.cells) {
        const t = {
          x: base[0] + (cx - clip.min[0]) + (cfg.axis === 'x' ? d : 0),
          y: base[1] + (cy - clip.min[1]) + (cfg.axis === 'y' ? d : 0),
          z: base[2] + (cz - clip.min[2]) + (cfg.axis === 'z' ? d : 0),
          mat,
        };
        if (m.inside(t.x, t.y, t.z)) targets.push(t);
      }
    }
    const added = this.writeCells(targets);
    this.refreshStats();
    this.statusText.value = `阵列复制 ${count} 份，新增 ${added.toLocaleString('zh-CN')} 格`;
    return { added, count };
  }

  // ---------------------------------------------------------------- 体检

  /** 指针下的体素信息（材质、层号）供 HUD 显示。 */
  hoverSummary() {
    const h = this.renderer.hover;
    if (!h || !h.mat) return null;
    return { mat: h.mat, z: h.z + 1, x: h.x, y: h.y };
  }

  runCheck() {
    const m = this.model.value;
    if (!m) return null;
    this.checking.value = true;
    try {
      const a = analyzeModel(m, {
        floatingMin: this.params.floatingMin,
        minWall: this.params.minWall,
      });
      this.analysis.value = a;
      this.markers.value = issueMarkers(a);
      this.renderer.markers = this.markers.value;
      this.requestRender();
      return a;
    } finally {
      this.checking.value = false;
    }
  }

  focusIssue(marker) {
    if (!marker) return;
    this.renderer.focusBox(marker.bbox);
    this.requestRender();
  }
}

export function createSession(canvas) {
  return new EditorSession(canvas);
}
