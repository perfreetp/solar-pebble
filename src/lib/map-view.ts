import type {
  Annotation,
  CameraState,
  DiffKind,
  Feature,
  LayerId,
  LayerState,
  ViewTransform,
} from '../types';
import { WORLD, lodForScale } from '../layers';
import { screenToWorld, worldToScreen } from './geometry';
import { SpatialIndex } from './spatial-index';
import { TileRenderer, styleSignature, type RenderStyleState } from '../render/tile-renderer';
import { LOD_POLICIES } from '../render/lod';
import { pickBox, pickFeature } from './hit-test';

const MIN_SCALE = 0.12;
const MAX_SCALE = 6;

export interface MapViewOptions {
  /** 是否处于批注打点模式 */
  isAnnotationMode: () => boolean;
  getSelectedIds: () => Set<string>;
  getHoveredId: () => string | null;
  onHover: (id: string | null) => void;
  onFeatureClick: (feature: Feature, additive: boolean) => void;
  onBoxSelect: (features: Feature[]) => void;
  onMapClick: (worldX: number, worldY: number) => void;
  onCameraChange: (cam: CameraState) => void;
  getAnnotations: () => Annotation[];
  getActiveAnnotationId: () => string | null;
  onAnnotationClick: (id: string) => void;
}

export class MapView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);
  private cssW = 0;
  private cssH = 0;

  private view: ViewTransform = { scale: 0.3, offsetX: 0, offsetY: 0 };
  private lod = 0;
  private renderer: TileRenderer;
  private index: SpatialIndex;
  private features: readonly Feature[];
  private style: RenderStyleState;
  private opts: MapViewOptions;

  private rafId = 0;
  private needsFrame = true;
  private interactionActive = false;
  private zoomPreviewUntil = 0;
  private zoomPreview: { canvas: HTMLCanvasElement; scaleRatio: number; focusX: number; focusY: number } | null =
    null;

  private drag: { startX: number; startY: number; ox: number; oy: number; moved: boolean } | null = null;
  private box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private pointer: { x: number; y: number } | null = null;
  private destroyed = false;

  constructor(
    canvas: HTMLCanvasElement,
    features: readonly Feature[],
    layerStates: Record<LayerId, LayerState>,
    versionKey: string,
    diffById: ReadonlyMap<string, DiffKind> | null,
    opts: MapViewOptions,
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.features = features;
    this.index = SpatialIndex.build(features);
    this.opts = opts;
    this.style = { versionKey, layerStates, diffById };
    this.renderer = new TileRenderer(features, this.index, () => this.invalidate());
    this.resize();
    this.fitWorld();
    this.bindEvents();
    this.loop();
  }

  // ---------------- 数据 / 样式更新 ----------------

  setData(features: readonly Feature[], layerStates: Record<LayerId, LayerState>, versionKey: string,
    diffById: ReadonlyMap<string, DiffKind> | null): void {
    this.features = features;
    this.index = SpatialIndex.build(features);
    this.style = { versionKey, layerStates, diffById };
    this.renderer.setFeatures(features, this.index);
    this.invalidate();
  }

  /** 仅样式（显隐/透明度/顺序/差异）变化：保留旧瓦片做回退，避免闪烁 */
  setStyle(layerStates: Record<LayerId, LayerState>, versionKey: string,
    diffById: ReadonlyMap<string, DiffKind> | null): void {
    this.style = { versionKey, layerStates, diffById };
    this.invalidate();
  }

  get spatialStats() {
    return this.index.stats;
  }

  get tileCacheCount(): number {
    return this.renderer.tileCount;
  }

  get offscreen(): boolean {
    return this.renderer.offscreenSupported;
  }

  get camera(): CameraState {
    return { ...this.view, lod: this.lod };
  }

  fitWorld(): void {
    const pad = 40;
    const sx = (this.cssW - pad * 2) / WORLD.width;
    const sy = (this.cssH - pad * 2) / WORLD.height;
    const scale = Math.min(sx, sy);
    this.view = {
      scale,
      offsetX: (this.cssW - WORLD.width * scale) / 2,
      offsetY: (this.cssH - WORLD.height * scale) / 2,
    };
    this.lod = lodForScale(scale);
    this.opts.onCameraChange(this.camera);
    this.invalidate();
  }

  /** 并排对比时应用另一面板的相机，保持两视图同步 */
  applyExternalCamera(cam: CameraState): void {
    this.view = { scale: cam.scale, offsetX: cam.offsetX, offsetY: cam.offsetY };
    if (cam.lod !== this.lod) this.lod = cam.lod;
    this.invalidate();
  }

  /** 世界坐标 → 画布 CSS 像素坐标（调试/自动化用） */
  worldToScreenPx(x: number, y: number): [number, number] {
    return worldToScreen(this.view, x, y);
  }

  /** 屏幕像素拾取（调试/自动化用，走与真实交互相同的命中链路） */
  pickAtScreen(x: number, y: number): Feature | null {
    const [wx, wy] = screenToWorld(this.view, x, y);
    return pickFeature(
      { index: this.index, layerStates: this.style.layerStates, view: this.view, lod: this.lod },
      wx, wy, x, y,
    );
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.invalidate();
  }

  // ---------------- 事件 ----------------

  private bindEvents(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.rafId);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
  }

  private onPointerDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.drag = { startX: p.x, startY: p.y, ox: this.view.offsetX, oy: this.view.offsetY, moved: false };
    this.interactionActive = true;
    if (e.shiftKey) {
      this.box = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    const p = this.local(e);
    this.pointer = p;
    if (this.drag) {
      const dx = p.x - this.drag.startX;
      const dy = p.y - this.drag.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true;
      if (this.box) {
        this.box.x1 = p.x;
        this.box.y1 = p.y;
      } else {
        this.view.offsetX = this.drag.ox + dx;
        this.view.offsetY = this.drag.oy + dy;
      }
      this.invalidate();
      return;
    }
    // 悬停命中检测
    const [wx, wy] = screenToWorld(this.view, p.x, p.y);
    const hit = pickFeature(
      { index: this.index, layerStates: this.style.layerStates, view: this.view, lod: this.lod },
      wx, wy, p.x, p.y,
    );
    this.opts.onHover(hit ? hit.id : null);
    this.canvas.style.cursor = hit ? 'pointer' : 'default';
    this.invalidate();
  };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.drag) return;
    const p = this.local(e);
    const wasDrag = this.drag.moved;

    if (this.box) {
      const x0 = Math.min(this.box.x0, this.box.x1);
      const x1 = Math.max(this.box.x0, this.box.x1);
      const y0 = Math.min(this.box.y0, this.box.y1);
      const y1 = Math.max(this.box.y0, this.box.y1);
      if (x1 - x0 > 4 && y1 - y0 > 4) {
        const [wMinX, wMinY] = screenToWorld(this.view, x0, y0);
        const [wMaxX, wMaxY] = screenToWorld(this.view, x1, y1);
        const feats = pickBox(
          { index: this.index, layerStates: this.style.layerStates, view: this.view, lod: this.lod },
          wMinX, wMinY, wMaxX, wMaxY,
        );
        this.opts.onBoxSelect(feats);
      }
      this.box = null;
    } else if (!wasDrag) {
      this.handleClick(p, e);
    }

    this.drag = null;
    this.interactionActive = false;
    this.opts.onCameraChange(this.camera);
    this.invalidate();
  };

  private handleClick(p: { x: number; y: number }, e: PointerEvent): void {
    // 批注锚点优先命中
    for (const ann of this.opts.getAnnotations()) {
      const [sx, sy] = worldToScreen(this.view, ann.x, ann.y);
      if (Math.hypot(sx - p.x, sy - p.y) <= 11) {
        this.opts.onAnnotationClick(ann.id);
        return;
      }
    }
    const [wx, wy] = screenToWorld(this.view, p.x, p.y);
    const hit = pickFeature(
      { index: this.index, layerStates: this.style.layerStates, view: this.view, lod: this.lod },
      wx, wy, p.x, p.y,
    );
    if (this.opts.isAnnotationMode()) {
      this.opts.onMapClick(wx, wy);
      return;
    }
    if (hit) {
      this.opts.onFeatureClick(hit, e.ctrlKey || e.metaKey || e.shiftKey);
    } else {
      this.opts.onMapClick(wx, wy);
    }
  }

  private onPointerLeave = () => {
    this.pointer = null;
    this.opts.onHover(null);
    this.invalidate();
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.local(e);
    const factor = Math.exp(-e.deltaY * 0.0015);
    this.zoomAt(p.x, p.y, factor);
  };

  /** 以屏幕点为锚点缩放，并启动低分辨率过渡预览保证稳定 */
  zoomAt(focusX: number, focusY: number, factor: number): void {
    const oldScale = this.view.scale;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, oldScale * factor));
    if (newScale === oldScale) return;

    // 抓取当前帧做平滑过渡（缩放过程中不等待瓦片重建）
    this.captureZoomPreview();
    const [wx, wy] = screenToWorld(this.view, focusX, focusY);
    this.view.scale = newScale;
    this.view.offsetX = focusX - wx * newScale;
    this.view.offsetY = focusY - wy * newScale;
    const newLod = lodForScale(newScale);
    if (newLod !== this.lod) this.lod = newLod;
    this.zoomPreviewUntil = performance.now() + 260;
    this.opts.onCameraChange(this.camera);
    this.invalidate();
  }

  private captureZoomPreview(): void {
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    c.getContext('2d')!.drawImage(this.canvas, 0, 0);
    this.zoomPreview = {
      canvas: c,
      scaleRatio: 1, // drawImage 时按当前变换实时计算
      focusX: 0,
      focusY: 0,
    };
  }

  private local(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // ---------------- 渲染主循环 ----------------

  invalidate(): void {
    this.needsFrame = true;
  }

  private loop = () => {
    if (this.destroyed) return;
    this.rafId = requestAnimationFrame(this.loop);
    if (!this.needsFrame) return;
    this.needsFrame = false;
    this.draw();
  };

  private draw(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // 背景
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    this.drawWorldGrid(ctx);

    const tiles = this.renderer.ensureTiles(this.view, this.lod, this.cssW, this.cssH, this.style);
    const sig = styleSignature(this.style);

    // 缩放过渡：旧帧拉伸显示，瓦片就绪前不出现空白
    const inPreview = performance.now() < this.zoomPreviewUntil && this.zoomPreview;
    if (inPreview) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.zoomPreview!.canvas, 0, 0, this.cssW, this.cssH);
      ctx.restore();
    }

    // 绘制视口覆盖瓦片
    for (const t of tiles) {
      const tile = this.renderer.getTile(t.lod, t.tx, t.ty, sig);
      if (!tile) {
        this.drawPlaceholder(ctx, t.lod, t.tx, t.ty);
        continue;
      }
      const size = LOD_POLICIES[t.lod]!.tileWorldSize;
      const dx = t.tx * size * this.view.scale + this.view.offsetX;
      const dy = t.ty * size * this.view.scale + this.view.offsetY;
      const dw = size * this.view.scale;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(tile.canvas, dx, dy, dw, dw);
    }

    this.drawHighlights(ctx);
    this.drawAnnotations(ctx);
    if (this.box) this.drawBox(ctx);
    this.drawHud(ctx);
  }

  private drawPlaceholder(ctx: CanvasRenderingContext2D, lod: number, tx: number, ty: number): void {
    const size = LOD_POLICIES[lod]!.tileWorldSize;
    const dx = tx * size * this.view.scale + this.view.offsetX;
    const dy = ty * size * this.view.scale + this.view.offsetY;
    const dw = size * this.view.scale;
    ctx.fillStyle = 'rgba(148,163,184,0.05)';
    ctx.fillRect(dx, dy, dw, dw);
  }

  private drawWorldGrid(ctx: CanvasRenderingContext2D): void {
    const grid = 200; // 世界米
    const [x0, y0] = screenToWorld(this.view, 0, 0);
    const [x1, y1] = screenToWorld(this.view, this.cssW, this.cssH);
    ctx.strokeStyle = 'rgba(148,163,184,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(x0 / grid) * grid; x <= x1; x += grid) {
      const [sx] = worldToScreen(this.view, x, 0);
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, this.cssH);
    }
    for (let y = Math.floor(y0 / grid) * grid; y <= y1; y += grid) {
      const [, sy] = worldToScreen(this.view, 0, y);
      ctx.moveTo(0, sy);
      ctx.lineTo(this.cssW, sy);
    }
    ctx.stroke();

    // 场区边界
    const [bx0, by0] = worldToScreen(this.view, 0, 0);
    const [bx1, by1] = worldToScreen(this.view, WORLD.width, WORLD.height);
    ctx.strokeStyle = 'rgba(226,232,240,0.35)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(bx0, by0, bx1 - bx0, by1 - by0);
    ctx.setLineDash([]);
  }

  private drawHighlights(ctx: CanvasRenderingContext2D): void {
    const selected = this.opts.getSelectedIds();
    const hovered = this.opts.getHoveredId();
    const map = new Map(this.features.map((f) => [f.id, f]));

    const drawOne = (id: string, color: string, width: number) => {
      const f = map.get(id);
      if (!f || !this.style.layerStates[f.layerId]?.visible) return;
      const g = f.geom;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      if (g.kind === 'point') {
        const [sx, sy] = worldToScreen(this.view, g.x, g.y);
        ctx.arc(sx, sy, 11, 0, Math.PI * 2);
      } else if (g.kind === 'line') {
        g.coords.forEach(([x, y], i) => {
          const [sx, sy] = worldToScreen(this.view, x, y);
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
      } else {
        g.ring.forEach(([x, y], i) => {
          const [sx, sy] = worldToScreen(this.view, x, y);
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.closePath();
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    };

    selected.forEach((id) => drawOne(id, '#38bdf8', 2.5));
    if (hovered && !selected.has(hovered)) drawOne(hovered, '#fde047', 2);
  }

  private drawAnnotations(ctx: CanvasRenderingContext2D): void {
    const activeId = this.opts.getActiveAnnotationId();
    for (const ann of this.opts.getAnnotations()) {
      const [sx, sy] = worldToScreen(this.view, ann.x, ann.y);
      if (sx < -30 || sx > this.cssW + 30 || sy < -30 || sy > this.cssH + 30) continue;
      const color =
        ann.status === 'resolved' ? '#16a34a' : ann.status === 'rejected' ? '#dc2626' : '#f97316';
      const active = ann.id === activeId;
      ctx.beginPath();
      ctx.moveTo(sx, sy + 4);
      ctx.lineTo(sx - 7, sy - 6);
      ctx.lineTo(sx + 7, sy - 6);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = active ? '#fff' : 'rgba(255,255,255,0.7)';
      ctx.lineWidth = active ? 2 : 1;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '600 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(ann.replies.length), sx, sy - 2.5);
    }
  }

  private drawBox(ctx: CanvasRenderingContext2D): void {
    const b = this.box!;
    const x = Math.min(b.x0, b.x1);
    const y = Math.min(b.y0, b.y1);
    const w = Math.abs(b.x1 - b.x0);
    const h = Math.abs(b.y1 - b.y0);
    ctx.fillStyle = 'rgba(56,189,248,0.15)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }

  private drawHud(ctx: CanvasRenderingContext2D): void {
    if (!this.pointer || this.interactionActive) return;
    const [wx, wy] = screenToWorld(this.view, this.pointer.x, this.pointer.y);
    const text = `X ${wx.toFixed(1)}m  Y ${wy.toFixed(1)}m`;
    ctx.font = '11px ui-monospace, monospace';
    const w = ctx.measureText(text).width + 14;
    ctx.fillStyle = 'rgba(15,23,42,0.8)';
    ctx.fillRect(this.cssW - w - 10, this.cssH - 28, w, 20);
    ctx.fillStyle = '#cbd5e1';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, this.cssW - w - 3, this.cssH - 18);
  }
}

