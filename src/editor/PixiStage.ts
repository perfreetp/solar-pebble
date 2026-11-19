import { Application, Container, Graphics, Text, TextStyle, type FederatedPointerEvent } from 'pixi.js';
import type { Matrix, Pt, ToolId, VecPath } from './types';
import { useEditor } from './store';
import {
  applyMatrix,
  bboxOf,
  dist,
  flattenPath,
  identity,
  invert,
  lerp,
  mid,
  multiply,
  pointInPolygon,
  pointSegDist,
  worldMatrix,
  worldSamples,
} from './geometry';
import { snapPoint, type SnapHit, type SnapContext } from './snapping';
import { makeItem } from './store';

type Mode =
  | { kind: 'idle' }
  | { kind: 'pan'; start: Pt; panStart: Pt }
  | { kind: 'move'; ids: string[]; startWorld: Pt; baseTransforms: Map<string, Matrix>; baseGroups: Map<string, Matrix> }
  | { kind: 'scale'; ids: string[]; handle: number; bbox: { min: Pt; max: Pt } }
  | { kind: 'rotate'; ids: string[]; center: Pt; startAngle: number }
  | { kind: 'vertex'; itemId: string; index: number }
  | { kind: 'rect'; start: Pt; current: Pt }
  | { kind: 'clicktool'; points: Pt[]; hover: Pt }
  | { kind: 'pen'; segments: { point: Pt; handleIn: Pt | null; handleOut: Pt | null }[]; hover: Pt; downAt: Pt | null; dragVec: Pt | null };

const HANDLE_SIZE = 7;
const RULER = 26;

export class PixiStage {
  private app: Application;
  private gridLayer = new Container();
  private itemLayer = new Container();
  private overlay = new Container();
  private rulerLayer = new Container();
  private mode: Mode = { kind: 'idle' };
  private snapHit: SnapHit | null = null;
  private hoverId: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private resizeObs: ResizeObserver | null = null;
  private keyHandlers: { down: (e: KeyboardEvent) => void };
  private container: HTMLElement;
  private destroyed = false;
  private ready = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.app = new Application();
    this.resizeObs = null;
    this.keyHandlers = { down: (e) => this.onKeyDown(e) };
    this.init();
  }

  private async init() {
    await this.app.init({
      background: '#f7f8fa',
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      width: this.container.clientWidth,
      height: this.container.clientHeight,
    });
    // StrictMode 双挂载时可能 init 尚未完成就已 destroy
    if (this.destroyed) {
      this.safeDestroyApp();
      return;
    }
    this.container.appendChild(this.app.canvas);
    this.app.stage.addChild(this.gridLayer, this.itemLayer, this.overlay, this.rulerLayer);
    this.bindEvents();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.container);
    window.addEventListener('keydown', this.keyHandlers.down);
    window.addEventListener('keyup', this.onKeyUp);
    this.unsubscribe = useEditor.subscribe(() => this.redraw());
    this.ready = true;
    this.redraw();
  }

  private safeDestroyApp() {
    try {
      this.app.destroy(true, { children: true, texture: false });
    } catch {
      /* init 未完成时部分内部对象尚未建立，忽略 */
    }
  }

  destroy() {
    this.destroyed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    window.removeEventListener('keydown', this.keyHandlers.down);
    window.removeEventListener('keyup', this.onKeyUp);
    if (this.ready) this.safeDestroyApp();
  }

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w > 0 && h > 0) this.app.renderer.resize(w, h);
    this.redraw();
  }

  private get state() {
    return useEditor.getState();
  }

  // ---------------- 坐标换算 ----------------
  private screenToWorld(s: Pt): Pt {
    const { zoom, pan } = this.state;
    return { x: (s.x - pan.x) / zoom, y: (s.y - pan.y) / zoom };
  }
  private worldToScreen(w: Pt): Pt {
    const { zoom, pan } = this.state;
    return { x: w.x * zoom + pan.x, y: w.y * zoom + pan.y };
  }

  private groupTx(item: VecPath): Matrix | null {
    if (!item.groupId) return null;
    return this.state.groups.find((g) => g.id === item.groupId)?.transform ?? null;
  }

  // ---------------- 事件绑定 ----------------
  private bindEvents() {
    const stage = this.app.stage;
    stage.eventMode = 'static';
    stage.hitArea = this.app.screen;
    stage.on('pointerdown', (e: FederatedPointerEvent) => this.onDown(e.global, e.nativeEvent));
    stage.on('pointermove', (e: FederatedPointerEvent) => this.onMove(e.global));
    stage.on('pointerup', (e: FederatedPointerEvent) => this.onUp(e.global));
    stage.on('pointerupoutside', (e: FederatedPointerEvent) => this.onUp(e.global));
    stage.on('doubleclick', (e: FederatedPointerEvent) => this.onDoubleClick(e.global));
    this.app.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.app.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const s = this.state;
    const before: Pt = { x: e.offsetX, y: e.offsetY };
    const world = this.screenToWorld(before);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const zoom = Math.min(8, Math.max(0.15, s.zoom * factor));
    const pan = { x: before.x - world.x * zoom, y: before.y - world.y * zoom };
    s.setView(zoom, pan);
  }

  private spaceDown = false;

  private onKeyDown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.code === 'Space') this.spaceDown = true;
    if (e.key === 'Enter') {
      this.finishDrawing();
    } else if (e.key === 'Escape') {
      this.cancelDrawing();
    }
  }

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space') this.spaceDown = false;
  };

  finishDrawing() {
    if (this.mode.kind === 'clicktool') this.commitClickTool(this.mode.points);
    else if (this.mode.kind === 'pen') this.commitPen(this.mode.segments);
  }

  cancelDrawing() {
    this.mode = { kind: 'idle' };
    this.redraw();
  }

  // ---------------- 命中测试 ----------------
  private hitTest(world: Pt): VecPath | null {
    const s = this.state;
    const locked = new Set(s.layers.filter((l) => l.locked || !l.visible).map((l) => l.id));
    const list = s.items.filter((i) => !locked.has(i.layerId));
    const threshold = 6 / s.zoom;
    for (let k = list.length - 1; k >= 0; k--) {
      const item = list[k];
      const pts = worldSamples(item, this.groupTx(item));
      if (item.closed && pts.length >= 3 && pointInPolygon(world, pts)) return item;
      if (!item.closed) {
        for (let i = 0; i < pts.length - 1; i++) {
          if (pointSegDist(world, pts[i], pts[i + 1]).d <= threshold) return item;
        }
      }
    }
    return null;
  }

  private makeSnapCtx(excludeIds: Set<string>): SnapContext {
    const s = this.state;
    const map = new Map<string, Matrix | null>();
    s.items.forEach((i) => map.set(i.id, this.groupTx(i)));
    return {
      items: s.items,
      groupTransforms: map,
      thresholdPx: s.settings.snapThreshold,
      viewScale: s.zoom,
      gridSize: s.settings.gridSize,
      gridEnabled: s.settings.gridVisible,
      excludeIds,
    };
  }

  private doSnap(world: Pt, exclude: Set<string>): Pt {
    const s = this.state;
    if (!s.settings.snapEnabled) {
      this.snapHit = null;
      return world;
    }
    const r = snapPoint(world, this.makeSnapCtx(exclude));
    this.snapHit = r.hit;
    return r.point;
  }

  // ---------------- 指针流程 ----------------
  private onDown(global: Pt, native?: MouseEvent | { button: number; shiftKey: boolean }) {
    const s = this.state;
    const worldRaw = this.screenToWorld(global);
    const tool = s.settings.tool;

    if (native?.button === 1 || tool === 'pan' || this.spaceDown) {
      this.mode = { kind: 'pan', start: global, panStart: { ...s.pan } };
      return;
    }

    const world = this.doSnap(worldRaw, new Set(s.selection));

    if (tool === 'rect') {
      this.mode = { kind: 'rect', start: world, current: world };
      return;
    }
    if (tool === 'polyline' || tool === 'polygon') {
      if (this.mode.kind !== 'clicktool') {
        this.mode = { kind: 'clicktool', points: [world], hover: world };
      } else {
        this.mode = { ...this.mode, points: [...this.mode.points, world] };
      }
      this.redraw();
      return;
    }
    if (tool === 'pen') {
      if (this.mode.kind !== 'pen') {
        this.mode = { kind: 'pen', segments: [{ point: world, handleIn: null, handleOut: null }], hover: world, downAt: world, dragVec: null };
      } else {
        this.mode = { ...this.mode, downAt: world, dragVec: null };
      }
      return;
    }

    // 选择工具
    if (tool === 'select') {
      // 优先命中变换手柄 / 顶点；shift 点选时跳过手柄，保证多选不被顶点拖拽截获
      const handle = native?.shiftKey ? null : this.pickHandle(global);
      if (handle) {
        if (handle.kind === 'vertex') {
          this.mode = { kind: 'vertex', itemId: handle.itemId!, index: handle.index! };
        } else if (handle.kind === 'rotate') {
          const bb = this.selectionBBox();
          if (bb) this.mode = { kind: 'rotate', ids: [...s.selection], center: mid(bb.min, bb.max), startAngle: Math.atan2(worldRaw.y - mid(bb.min, bb.max).y, worldRaw.x - mid(bb.min, bb.max).x) };
        } else if (handle.kind === 'scale') {
          const bb = this.selectionBBox();
          if (bb) this.mode = { kind: 'scale', ids: [...s.selection], handle: handle.index!, bbox: bb };
        }
        return;
      }
      const hit = this.hitTest(worldRaw);
      if (hit) {
        // 连续 shift 点选时入口快照 s.selection 可能过期，取最新状态
        const fresh = this.state;
        let ids = fresh.selection.includes(hit.id) ? fresh.selection : [hit.id];
        if (native?.shiftKey && fresh.selection.includes(hit.id)) {
          ids = fresh.selection.filter((id) => id !== hit.id);
        } else if (native?.shiftKey) {
          ids = [...fresh.selection, hit.id];
        }
        fresh.select(ids);
        const baseTransforms = new Map<string, Matrix>();
        const baseGroups = new Map<string, Matrix>();
        fresh.items.forEach((i) => {
          if (ids.includes(i.id)) baseTransforms.set(i.id, i.transform);
        });
        fresh.groups.forEach((g) => baseGroups.set(g.id, g.transform));
        this.mode = { kind: 'move', ids, startWorld: world, baseTransforms, baseGroups };
      } else {
        s.select([]);
        this.mode = { kind: 'idle' };
      }
    }
  }

  private onMove(global: Pt) {
    const s = this.state;
    const worldRaw = this.screenToWorld(global);
    this.hoverId = this.hitTest(worldRaw)?.id ?? null;

    if (this.mode.kind === 'pan') {
      const dx = global.x - this.mode.start.x;
      const dy = global.y - this.mode.start.y;
      s.setView(s.zoom, { x: this.mode.panStart.x + dx, y: this.mode.panStart.y + dy });
      return;
    }

    const exclude = new Set<string>();
    if (this.mode.kind === 'move') this.mode.ids.forEach((id) => exclude.add(id));
    if (this.mode.kind === 'vertex') exclude.add(this.mode.itemId);
    const world = this.doSnap(worldRaw, exclude);

    switch (this.mode.kind) {
      case 'rect':
        this.mode = { ...this.mode, current: world };
        break;
      case 'clicktool':
        this.mode = { ...this.mode, hover: world };
        break;
      case 'pen': {
        if (this.mode.downAt) {
          this.mode = { ...this.mode, dragVec: { x: world.x - this.mode.downAt.x, y: world.y - this.mode.downAt.y }, hover: world };
        } else {
          this.mode = { ...this.mode, hover: world };
        }
        break;
      }
      case 'move':
        this.applyMove(world);
        break;
      case 'vertex':
        this.applyVertex(world);
        break;
      case 'scale':
        this.applyScale(worldRaw);
        break;
      case 'rotate':
        this.applyRotate(worldRaw);
        break;
      default:
        break;
    }
    this.redraw();
  }

  private onUp(global: Pt) {
    const s = this.state;
    const worldRaw = this.screenToWorld(global);
    if (this.mode.kind === 'rect') {
      const a = this.mode.start;
      const b = this.doSnap(worldRaw, new Set());
      if (Math.abs(b.x - a.x) > 3 && Math.abs(b.y - a.y) > 3) {
        const item = makeItem(this.closedType(), s.settings.activeLayerId, [
          { x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y },
        ], true);
        s.addItem(item);
      }
      this.mode = { kind: 'idle' };
    } else if (this.mode.kind === 'move' || this.mode.kind === 'scale' || this.mode.kind === 'rotate' || this.mode.kind === 'vertex') {
      s.recomputeConflicts();
      this.syncDoc();
      this.mode = { kind: 'idle' };
    } else if (this.mode.kind === 'pen') {
      this.handlePenUp(worldRaw);
    }
    this.snapHit = null;
    this.redraw();
  }

  /** 按当前图层语义推断闭合图元类型：标识层→标识牌，分区层→分区，其余→通用图元 */
  private closedType(): VecPath['type'] {
    const layer = this.state.layers.find((l) => l.id === this.state.settings.activeLayerId);
    if (layer?.name.includes('标识')) return 'sign';
    if (layer?.name.includes('分区')) return 'zone';
    return 'generic';
  }

  private handlePenUp(worldRaw: Pt) {
    if (this.mode.kind !== 'pen') return;
    const s = this.state;
    const world = this.doSnap(worldRaw, new Set());
    const segs = this.mode.segments;
    const drag = this.mode.dragVec;
    const downAt = this.mode.downAt;
    if (downAt && drag && Math.hypot(drag.x, drag.y) > 4) {
      // 拖出贝塞尔控制柄
      const prev = segs[segs.length - 1];
      prev.handleOut = { x: downAt.x + drag.x * 0.45, y: downAt.y + drag.y * 0.45 };
      segs.push({ point: world, handleIn: { x: world.x - drag.x * 0.45, y: world.y - drag.y * 0.45 }, handleOut: null });
    } else if (downAt) {
      segs.push({ point: world, handleIn: null, handleOut: null });
    }
    this.mode = { kind: 'pen', segments: segs, hover: world, downAt: null, dragVec: null };
    void s;
  }

  private onDoubleClick(global: Pt) {
    const world = this.screenToWorld(global);
    if (this.mode.kind === 'clicktool') {
      const pts = this.mode.points;
      if (pts.length >= 2) this.commitClickTool(pts);
    } else if (this.mode.kind === 'pen') {
      if (this.mode.segments.length >= 2) this.commitPen(this.mode.segments);
    } else {
      // 双击图元：进入顶点编辑提示（选中并展开顶点手柄）
      const hit = this.hitTest(world);
      if (hit) this.state.select([hit.id]);
    }
  }

  private commitClickTool(points: Pt[]) {
    const s = this.state;
    const tool = s.settings.tool;
    const closed = tool === 'polygon';
    if (points.length < 2) {
      this.mode = { kind: 'idle' };
      return;
    }
    const type: VecPath['type'] = closed ? this.closedType() : 'pipeline';
    const item = makeItem(type, s.settings.activeLayerId, points, closed);
    s.addItem(item);
    this.mode = { kind: 'idle' };
  }

  private commitPen(segments: { point: Pt; handleIn: Pt | null; handleOut: Pt | null }[]): void {
    const s = this.state;
    if (segments.length < 2) {
      this.mode = { kind: 'idle' };
      return;
    }
    const item = makeItem('pipeline', s.settings.activeLayerId, segments.map((q) => q.point), false, {
      segments: segments.map((q) => ({ point: { ...q.point }, handleIn: q.handleIn ? { ...q.handleIn } : null, handleOut: q.handleOut ? { ...q.handleOut } : null })),
      smooth: true,
    });
    s.addItem(item);
    this.mode = { kind: 'idle' };
  }

  // ---------------- 变换 ----------------
  private applyMove(world: Pt) {
    const s = this.state;
    const m = this.mode;
    if (m.kind !== 'move') return;
    const dx = world.x - m.startWorld.x;
    const dy = world.y - m.startWorld.y;
    const T: Matrix = [1, 0, 0, 1, dx, dy];
    // 基于起始状态重放，保证抖动/切换吸附目标时不漂移
    s.updateItems(m.ids, (it) => ({ ...it, transform: m.baseTransforms.get(it.id) ?? it.transform }));
    const gRestore = new Map(m.baseGroups);
    useEditor.setState({
      groups: s.groups.map((g) => ({ ...g, transform: gRestore.get(g.id) ?? g.transform })),
    });
    s.applyWorldTransform(m.ids, T);
  }

  private applyVertex(world: Pt) {
    const s = this.state;
    const m = this.mode;
    if (m.kind !== 'vertex') return;
    const item = s.items.find((i) => i.id === m.itemId);
    if (!item) return;
    const wm = worldMatrix(item, this.groupTx(item));
    const local = applyMatrix(invert(wm), world);
    s.moveVertex(m.itemId, m.index, local);
  }

  private selectionBBox(): { min: Pt; max: Pt } | null {
    const s = this.state;
    const all: Pt[] = [];
    for (const id of s.selection) {
      const it = s.items.find((i) => i.id === id);
      if (it) all.push(...worldSamples(it, this.groupTx(it)));
    }
    return bboxOf(all);
  }

  private applyScale(world: Pt) {
    const m = this.mode;
    if (m.kind !== 'scale') return;
    const { min, max } = m.bbox;
    const h = m.handle; // 0..7: 左上 上 右上 右 右下 下 左下 左
    const w = max.x - min.x || 1;
    const hh = max.y - min.y || 1;
    // 对角固定锚点：左列固定 maxX，右列固定 minX；上行固定 maxY，下行固定 minY
    const leftSide = h === 0 || h === 6 || h === 7;
    const topSide = h === 0 || h === 1 || h === 2;
    const ax = leftSide ? max.x : min.x;
    const ay = topSide ? max.y : min.y;
    const edgeH = h === 1 || h === 5;
    const edgeV = h === 3 || h === 7;
    const sx = edgeH ? 1 : (leftSide ? (ax - world.x) / w : (world.x - ax) / w);
    const sy = edgeV ? 1 : (topSide ? (ay - world.y) / hh : (world.y - ay) / hh);
    const M: Matrix = [
      sx, 0, 0, sy,
      ax - sx * ax,
      ay - sy * ay,
    ];
    this.state.applyWorldTransform(m.ids, M);
  }

  private applyRotate(world: Pt) {
    const m = this.mode;
    if (m.kind !== 'rotate') return;
    const ang = Math.atan2(world.y - m.center.y, world.x - m.center.x) - m.startAngle;
    const c = Math.cos(ang);
    const sn = Math.sin(ang);
    const M: Matrix = [
      c, sn, -sn, c,
      m.center.x - c * m.center.x + sn * m.center.y,
      m.center.y - sn * m.center.x - c * m.center.y,
    ];
    this.state.applyWorldTransform(m.ids, M);
  }

  private syncDoc() {
    const s = this.state;
    const job = s.jobs.find((j) => j.id === s.currentJobId);
    if (job) {
      useEditor.setState({
        jobs: s.jobs.map((j) =>
          j.id === job.id ? { ...j, doc: { items: structuredClone(s.items), groups: structuredClone(s.groups), layers: structuredClone(s.layers) } } : j,
        ),
      });
    }
  }

  // ---------------- 手柄拾取 ----------------
  private pickHandle(screen: Pt): { kind: 'scale' | 'rotate' | 'vertex'; index?: number; itemId?: string } | null {
    const s = this.state;
    const t = 8 / s.zoom + HANDLE_SIZE / s.zoom;
    // 顶点手柄
    for (const id of s.selection) {
      const item = s.items.find((i) => i.id === id);
      if (!item) continue;
      const pts = worldSamples(item, this.groupTx(item));
      for (let i = 0; i < pts.length; i++) {
        const sp = this.worldToScreen(pts[i]);
        if (dist(sp, screen) <= HANDLE_SIZE + 4) return { kind: 'vertex', index: i, itemId: id };
      }
    }
    const bb = this.selectionBBox();
    if (!bb || !s.selection.length) return null;
    const c = mid(bb.min, bb.max);
    const rotateAnchor = this.worldToScreen({ x: c.x, y: bb.min.y - 28 / s.zoom });
    if (dist(rotateAnchor, screen) <= HANDLE_SIZE + 4) return { kind: 'rotate' };
    const corners = this.bboxHandles(bb);
    for (let i = 0; i < corners.length; i++) {
      const sp = this.worldToScreen(corners[i]);
      if (dist(sp, screen) <= t) return { kind: 'scale', index: i };
    }
    return null;
  }

  private bboxHandles(bb: { min: Pt; max: Pt }): Pt[] {
    const { min, max } = bb;
    const mx = (min.x + max.x) / 2;
    const my = (min.y + max.y) / 2;
    return [
      min, { x: mx, y: min.y }, { x: max.x, y: min.y }, { x: max.x, y: my },
      max, { x: mx, y: max.y }, { x: min.x, y: max.y }, { x: min.x, y: my },
    ];
  }

  // ================= 渲染 =================
  redraw() {
    if (!this.app.renderer) return;
    this.drawGrid();
    this.drawItems();
    this.drawOverlay();
    this.drawRulers();
  }

  private clear(c: Container) {
    c.removeChildren().forEach((ch) => ch.destroy({ children: true }));
  }

  private drawGrid() {
    const s = this.state;
    const g = new Graphics();
    if (s.settings.gridVisible) {
      const size = s.settings.gridSize;
      const view = this.app.screen;
      const tl = this.screenToWorld({ x: 0, y: 0 });
      const br = this.screenToWorld({ x: view.width, y: view.height });
      const startX = Math.floor(tl.x / size) * size;
      const startY = Math.floor(tl.y / size) * size;
      for (let x = startX; x <= br.x; x += size) {
        const p = this.worldToScreen({ x, y: 0 });
        const major = Math.round(x / size) % 5 === 0;
        g.moveTo(p.x, 0).lineTo(p.x, view.height).stroke({ width: 1, color: major ? 0xc9d2dd : 0xe6ebf1, alpha: 1 });
      }
      for (let y = startY; y <= br.y; y += size) {
        const p = this.worldToScreen({ x: 0, y });
        const major = Math.round(y / size) % 5 === 0;
        g.moveTo(0, p.y).lineTo(view.width, p.y).stroke({ width: 1, color: major ? 0xc9d2dd : 0xe6ebf1, alpha: 1 });
      }
    }
    this.clear(this.gridLayer);
    this.gridLayer.addChild(g);
  }

  private drawItems() {
    const s = this.state;
    const hidden = new Set(s.layers.filter((l) => !l.visible).map((l) => l.id));
    const root = new Container();
    for (const item of s.items) {
      if (hidden.has(item.layerId)) continue;
      const g = new Graphics();
      const pts = worldSamples(item, this.groupTx(item));
      if (pts.length < 2) continue;
      const st = item.style;
      const strokeColor = item.conflict ? 0xe53935 : this.toHex(st.stroke);
      const width = item.conflict ? Math.max(3, st.strokeWidth + 1.5) : st.strokeWidth;
      if (item.closed && pts.length >= 3) {
        g.poly(pts.flatMap((p) => [p.x, p.y]));
        g.fill({ color: this.toHex(st.fill), alpha: st.opacity });
        if (st.dash.length) {
          this.strokeDashed(g, pts, true, st.dash, width, strokeColor, 1);
        } else {
          g.stroke({ width, color: strokeColor, alpha: 1, join: 'round' });
        }
      } else {
        g.moveTo(pts[0].x, pts[0].y);
        pts.slice(1).forEach((p) => g.lineTo(p.x, p.y));
        if (st.dash.length) {
          this.strokeDashed(g, pts, false, st.dash, width, strokeColor, 0.95);
        } else {
          g.stroke({ width, color: strokeColor, alpha: 0.95, cap: 'round', join: 'round' });
        }
      }
      if (item.conflict) {
        // 冲突红色外发光
        const halo = new Graphics();
        halo.moveTo(pts[0].x, pts[0].y);
        pts.slice(1).forEach((p) => halo.lineTo(p.x, p.y));
        if (item.closed) halo.closePath();
        halo.stroke({ width: width + 6, color: 0xe53935, alpha: 0.18, cap: 'round', join: 'round' });
        root.addChild(halo);
        const badge = new Text('!', new TextStyle({ fill: 0xffffff, fontSize: 11, fontWeight: '700' }));
        const bb = bboxOf(pts)!;
        badge.position.set(bb.max.x - 4, bb.min.y - 16);
        const badgeBg = new Graphics();
        badgeBg.circle(bb.max.x, bb.min.y - 10, 9).fill(0xe53935);
        root.addChild(badgeBg, badge);
      }
      if (this.hoverId === item.id) {
        const hv = new Graphics();
        hv.moveTo(pts[0].x, pts[0].y);
        pts.slice(1).forEach((p) => hv.lineTo(p.x, p.y));
        if (item.closed) hv.closePath();
        hv.stroke({ width: width + 3, color: 0x1976d2, alpha: 0.25, cap: 'round', join: 'round' });
        root.addChild(hv);
      }
      root.addChild(g);
    }
    this.clear(this.itemLayer);
    this.itemLayer.addChild(root);
  }

  private toHex(hex: string): number {
    return parseInt(hex.replace('#', ''), 16);
  }

  /** Pixi v8 的 stroke 不支持 dash，手工沿折线走笔画/抬笔实现虚线 */
  private strokeDashed(
    g: Graphics,
    pts: Pt[],
    closed: boolean,
    dash: number[],
    width: number,
    color: number,
    alpha = 1,
  ) {
    const ring = closed && pts.length > 2 ? [...pts, pts[0]] : pts;
    if (ring.length < 2) return;
    let drawing = true;
    let remain = dash[0] ?? 6;
    const gap = dash[1] ?? dash[0] ?? 4;
    g.moveTo(ring[0].x, ring[0].y);
    for (let i = 1; i < ring.length; i++) {
      let from = ring[i - 1];
      const target = ring[i];
      let segLen = dist(from, target);
      while (segLen > 1e-6) {
        const step = Math.min(remain, segLen);
        const np = lerp(from, target, step / segLen);
        if (drawing) g.lineTo(np.x, np.y);
        else g.moveTo(np.x, np.y);
        from = np;
        segLen -= step;
        remain -= step;
        if (remain <= 1e-6) {
          drawing = !drawing;
          remain = drawing ? dash[0] ?? 6 : gap;
        }
      }
    }
    g.stroke({ width, color, alpha, cap: 'butt', join: 'round' });
  }

  private drawOverlay() {
    const s = this.state;
    const c = new Container();
    // 选中框 + 手柄
    if (s.selection.length && this.mode.kind !== 'rect') {
      const bb = this.selectionBBox();
      if (bb) {
        const box = new Graphics();
        box.rect(bb.min.x, bb.min.y, bb.max.x - bb.min.x, bb.max.y - bb.min.y);
        box.stroke({ width: 1.2 / s.zoom, color: 0x1976d2, alpha: 0.9 });
        c.addChild(box);
        for (const h of this.bboxHandles(bb)) {
          const hg = new Graphics();
          hg.circle(h.x, h.y, HANDLE_SIZE / s.zoom).fill(0xffffff).stroke({ width: 1.4 / s.zoom, color: 0x1976d2 });
          c.addChild(hg);
        }
        const center = mid(bb.min, bb.max);
        const rot = new Graphics();
        const ry = bb.min.y - 28 / s.zoom;
        rot.moveTo(center.x, bb.min.y).lineTo(center.x, ry).stroke({ width: 1 / s.zoom, color: 0x1976d2 });
        rot.circle(center.x, ry, HANDLE_SIZE / s.zoom).fill(0xfff59d).stroke({ width: 1.4 / s.zoom, color: 0xf9a825 });
        c.addChild(rot);
      }
      // 顶点手柄
      for (const id of s.selection) {
        const item = s.items.find((i) => i.id === id);
        if (!item) continue;
        const pts = worldSamples(item, this.groupTx(item));
        pts.forEach((p) => {
          const vg = new Graphics();
          vg.circle(p.x, p.y, 4.5 / s.zoom).fill(0xffffff).stroke({ width: 1.2 / s.zoom, color: 0xd81b60 });
          c.addChild(vg);
        });
      }
    }

    // 工具预览
    if (this.mode.kind === 'rect') {
      const { start, current } = this.mode;
      const g = new Graphics();
      g.rect(start.x, start.y, current.x - start.x, current.y - start.y)
        .fill({ color: 0x1976d2, alpha: 0.12 });
      this.strokeDashed(
        g,
        [start, { x: current.x, y: start.y }, current, { x: start.x, y: current.y }],
        true,
        [5, 4],
        1.5,
        0x1976d2,
      );
      c.addChild(g);
    }
    if (this.mode.kind === 'clicktool') {
      const { points, hover } = this.mode;
      const g = new Graphics();
      const previewPts = [...points, hover];
      if (s.settings.tool === 'polygon') previewPts.push(points[0]);
      this.strokeDashed(g, previewPts, false, [6, 4], 1.5, 0x1976d2);
      points.forEach((p) => g.circle(p.x, p.y, 4 / s.zoom).fill(0x1976d2));
      c.addChild(g);
    }
    if (this.mode.kind === 'pen') {
      const { segments, hover } = this.mode;
      const g = new Graphics();
      const flat = flattenPath({
        ...({} as VecPath),
        points: [],
        segments: segments.map((q) => ({ point: q.point, handleIn: q.handleIn, handleOut: q.handleOut })),
      });
      if (flat.length) {
        this.strokeDashed(g, [...flat, hover], false, [6, 4], 1.5, 0x6a1b9a);
      }
      segments.forEach((seg) => {
        g.circle(seg.point.x, seg.point.y, 4 / s.zoom).fill(0x6a1b9a);
        if (seg.handleOut) {
          g.moveTo(seg.point.x, seg.point.y).lineTo(seg.handleOut.x, seg.handleOut.y)
            .stroke({ width: 1 / s.zoom, color: 0x8e24aa });
          g.circle(seg.handleOut.x, seg.handleOut.y, 3 / s.zoom).fill(0xffffff).stroke({ width: 1 / s.zoom, color: 0x8e24aa });
        }
      });
      c.addChild(g);
    }

    // 吸附标记
    if (this.snapHit) {
      const sp = this.snapHit.point;
      const colors: Record<string, number> = {
        endpoint: 0x2e7d32,
        midpoint: 0xef6c00,
        grid: 0x00838f,
        edge: 0x7b1fa2,
      };
      const mk = new Graphics();
      mk.circle(sp.x, sp.y, 6 / s.zoom).stroke({ width: 2 / s.zoom, color: colors[this.snapHit.kind] });
      c.addChild(mk);
      const label = { endpoint: '端点', midpoint: '中点', grid: '网格', edge: '边线' }[this.snapHit.kind];
      const t = new Text(label, new TextStyle({ fontSize: 11, fill: colors[this.snapHit.kind], fontWeight: '600' }));
      t.position.set(sp.x + 8 / s.zoom, sp.y - 16 / s.zoom);
      t.scale.set(1 / s.zoom);
      c.addChild(t);
    }

    this.clear(this.overlay);
    this.overlay.addChild(c);
  }

  private drawRulers() {
    const s = this.state;
    const root = new Container();
    if (!s.settings.rulerVisible) {
      this.clear(this.rulerLayer);
      this.rulerLayer.addChild(root);
      return;
    }
    const view = this.app.screen;
    const bg = new Graphics();
    bg.rect(0, 0, view.width, RULER).fill(0xffffff, 0.92).stroke({ width: 1, color: 0xd5dce4 });
    bg.rect(0, 0, RULER, view.height).fill(0xffffff, 0.92).stroke({ width: 1, color: 0xd5dce4 });
    bg.rect(0, 0, RULER, RULER).fill(0xeef1f5);
    root.addChild(bg);

    const size = s.settings.gridSize;
    const tl = this.screenToWorld({ x: RULER, y: RULER });
    const br = this.screenToWorld({ x: view.width, y: view.height });
    const textStyle = new TextStyle({ fontSize: 10, fill: 0x607080 });
    const startX = Math.floor(tl.x / size) * size;
    const startY = Math.floor(tl.y / size) * size;
    for (let x = startX; x <= br.x; x += size) {
      const p = this.worldToScreen({ x, y: 0 });
      const major = Math.round(x / size) % 5 === 0;
      const tick = major ? 8 : 4;
      const ln = new Graphics();
      ln.moveTo(p.x, RULER).lineTo(p.x, RULER - tick).stroke({ width: 1, color: 0x90a0b0 });
      root.addChild(ln);
      if (major) {
        const t = new Text(String(x), textStyle);
        t.position.set(p.x + 2, 2);
        root.addChild(t);
      }
    }
    for (let y = startY; y <= br.y; y += size) {
      const p = this.worldToScreen({ x: 0, y });
      const major = Math.round(y / size) % 5 === 0;
      const tick = major ? 8 : 4;
      const ln = new Graphics();
      ln.moveTo(RULER, p.y).lineTo(RULER - tick, p.y).stroke({ width: 1, color: 0x90a0b0 });
      root.addChild(ln);
      if (major) {
        const t = new Text(String(y), textStyle);
        t.position.set(2, p.y + 2);
        root.addChild(t);
      }
    }
    this.clear(this.rulerLayer);
    this.rulerLayer.addChild(root);
  }
}

export { identity, multiply };
