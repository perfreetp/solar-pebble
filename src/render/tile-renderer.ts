import type { DiffKind, Feature, LayerId, LayerState, ViewTransform } from '../types';
import { LAYER_METAS } from '../layers';
import type { SpatialIndex } from '../lib/spatial-index';
import { simplifyLine, worldToScreen } from '../lib/geometry';
import { LOD_POLICIES, clusterPoints, thinFeatures, thinLabels, type LabelItem } from './lod';

export const TILE_PX = 512;

const TILE_CACHE_CAP = 160;
const MARGIN_PX = 72; // 瓦片边缘外延，容纳聚合/标签，单位像素

const DIFF_COLORS: Record<DiffKind, string> = {
  added: '#16a34a',
  removed: '#dc2626',
  modified: '#eab308',
};

export interface RenderStyleState {
  versionKey: string;
  layerStates: Record<LayerId, LayerState>;
  /** 对比模式下的要素差异着色（可空） */
  diffById: ReadonlyMap<string, DiffKind> | null;
}

/** 样式签名：任何影响瓦片内容的状态变化都会使旧瓦片失效 */
export function styleSignature(s: RenderStyleState): string {
  const parts = LAYER_METAS.map((m) => {
    const st = s.layerStates[m.id]!;
    return `${m.id}:${st.visible ? 1 : 0}:${Math.round(st.opacity * 100)}:${st.zOrder}`;
  });
  return `${s.versionKey}|${parts.join('|')}|d${s.diffById ? s.diffById.size : 0}`;
}

interface CachedTile {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  /** 最近一次使用时间戳，用于 LRU */
  usedAt: number;
}

/** 瓦片本地变换：世界坐标 → 瓦片内像素坐标 */
function tileLocalTransform(lod: number, tx: number, ty: number): ViewTransform {
  const policy = LOD_POLICIES[lod]!;
  const scale = TILE_PX / policy.tileWorldSize;
  return {
    scale,
    offsetX: -tx * policy.tileWorldSize * scale,
    offsetY: -ty * policy.tileWorldSize * scale,
  };
}

function makeCanvas(size: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

export class TileRenderer {
  private cache = new Map<string, CachedTile>();
  /** 几何位置 → 最近一次瓦片 key（样式切换时的回退索引） */
  private latestByPos = new Map<string, string>();
  private queue: string[] = [];
  private queued = new Set<string>();
  private scheduled = false;
  /** 待渲染瓦片对应的参数 */
  private jobs = new Map<
    string,
    { lod: number; tx: number; ty: number; style: RenderStyleState; sig: string }
  >();
  private invalidate: () => void;
  private useOffscreen: boolean;

  constructor(
    features: readonly Feature[],
    private index: SpatialIndex,
    onInvalidate: () => void,
  ) {
    this.invalidate = onInvalidate;
    this.useOffscreen = typeof OffscreenCanvas !== 'undefined';
    this.featureMap = new Map(features.map((f) => [f.id, f]));
  }

  get offscreenSupported(): boolean {
    return this.useOffscreen;
  }

  get tileCount(): number {
    return this.cache.size;
  }

  private tileKey(sig: string, lod: number, tx: number, ty: number): string {
    return `${sig}|${lod}|${tx}|${ty}`;
  }

  private posKey(lod: number, tx: number, ty: number): string {
    return `${lod}|${tx}|${ty}`;
  }

  /**
   * 确保视口覆盖的瓦片已在生成队列中。
   * 返回当前视口需要的几何位置列表。
   */
  ensureTiles(
    view: ViewTransform,
    lod: number,
    cssWidth: number,
    cssHeight: number,
    style: RenderStyleState,
  ): { lod: number; tx: number; ty: number }[] {
    const policy = LOD_POLICIES[lod]!;
    const tileWorld = policy.tileWorldSize;
    const minX = -view.offsetX / view.scale;
    const minY = -view.offsetY / view.scale;
    const maxX = (cssWidth - view.offsetX) / view.scale;
    const maxY = (cssHeight - view.offsetY) / view.scale;
    const tx0 = Math.floor(minX / tileWorld);
    const ty0 = Math.floor(minY / tileWorld);
    const tx1 = Math.floor(maxX / tileWorld);
    const ty1 = Math.floor(maxY / tileWorld);
    const sig = styleSignature(style);
    const need: { lod: number; tx: number; ty: number }[] = [];

    const centerTx = (tx0 + tx1) / 2;
    const centerTy = (ty0 + ty1) / 2;
    const positions: { lod: number; tx: number; ty: number; d: number }[] = [];
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        need.push({ lod, tx, ty });
        const key = this.tileKey(sig, lod, tx, ty);
        if (this.cache.has(key)) {
          // 重新插入到 Map 末尾，保持 Map 顺序即 LRU 顺序
          const tile = this.cache.get(key)!;
          tile.usedAt = performance.now();
          this.cache.delete(key);
          this.cache.set(key, tile);
          continue;
        }
        if (!this.queued.has(key)) {
          this.queued.add(key);
          this.jobs.set(key, { lod, tx, ty, style, sig });
          positions.push({ lod, tx, ty, d: (tx - centerTx) ** 2 + (ty - centerTy) ** 2 });
        }
      }
    }
    if (positions.length) {
      positions.sort((a, b) => a.d - b.d);
      this.queue.push(...positions.map((p) => this.tileKey(sig, p.lod, p.tx, p.ty)));
      this.schedule();
    }
    return need;
  }

  /** 取已就绪的瓦片；新样式未就绪时回退到同位置旧样式瓦片 */
  getTile(lod: number, tx: number, ty: number, sig: string): CachedTile | null {
    const exact = this.cache.get(this.tileKey(sig, lod, tx, ty));
    if (exact) return exact;
    const fallbackKey = this.latestByPos.get(this.posKey(lod, tx, ty));
    if (fallbackKey) {
      const fb = this.cache.get(fallbackKey);
      if (fb) return fb;
    }
    return null;
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    const run = () => {
      this.scheduled = false;
      // 每轮最多生成 2 张瓦片，避免长任务阻塞交互
      let budget = 2;
      while (budget-- > 0 && this.queue.length) {
        const key = this.queue.shift()!;
        this.queued.delete(key);
        const job = this.jobs.get(key);
        if (!job) continue;
        this.jobs.delete(key);
        if (this.cache.has(key)) continue;
        this.renderTile(key, job.lod, job.tx, job.ty, job.style);
      }
      this.invalidate();
      if (this.queue.length) this.schedule();
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 120 });
    } else {
      setTimeout(run, 16);
    }
  }

  private renderTile(
    key: string,
    lod: number,
    tx: number,
    ty: number,
    style: RenderStyleState,
  ): void {
    const policy = LOD_POLICIES[lod]!;
    const tileWorld = policy.tileWorldSize;
    const originX = tx * tileWorld;
    const originY = ty * tileWorld;
    const local = tileLocalTransform(lod, tx, ty);
    const marginWorld = MARGIN_PX / local.scale;

    const canvas = makeCanvas(TILE_PX);
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
    ctx.clearRect(0, 0, TILE_PX, TILE_PX);

    const candidates = this.index.queryRect(
      originX - marginWorld,
      originY - marginWorld,
      originX + tileWorld + marginWorld,
      originY + tileWorld + marginWorld,
    );

    // 按图层叠放顺序排序（值小的在下方）
    const orderedLayers = [...LAYER_METAS].sort(
      (a, b) => style.layerStates[a.id]!.zOrder - style.layerStates[b.id]!.zOrder,
    );

    const labels: LabelItem[] = [];

    for (const meta of orderedLayers) {
      const layerState = style.layerStates[meta.id]!;
      if (!layerState.visible) continue;
      if (lod < meta.minLod) continue;
      const layerFeatures = meta.kind === 'point'
        ? candidates.filter((f) => f.layerId === meta.id)
        : thinFeatures(candidates.filter((f) => f.layerId === meta.id), local, lod);
      if (!layerFeatures.length) continue;

      ctx.save();
      ctx.globalAlpha = layerState.opacity;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      if (meta.kind === 'point') {
        const clusters = clusterPoints(layerFeatures, local, lod);
        for (const cluster of clusters) {
          // 只绘制锚点落在本瓦片内的簇，避免 margin 导致重复
          if (
            cluster.x < originX - 0.5 ||
            cluster.x >= originX + tileWorld + 0.5 ||
            cluster.y < originY - 0.5 ||
            cluster.y >= originY + tileWorld + 0.5
          ) {
            continue;
          }
          const diffKind = cluster.count === 1 ? style.diffById?.get(cluster.members[0]!) : undefined;
          const [sx, sy] = worldToScreen(local, cluster.x, cluster.y);
          const r =
            policy.pointRadius + (cluster.count > 1 ? Math.min(9, Math.log2(cluster.count) * 1.8) : 0);
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.fillStyle = diffKind ? DIFF_COLORS[diffKind] : meta.color;
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.stroke();
          if (cluster.count > 1) {
            ctx.fillStyle = '#fff';
            ctx.font = '600 10px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(cluster.count), sx, sy + 0.5);
          }
          if (policy.showFeatureLabels && cluster.count === 1) {
            const f = this.featureById(cluster.members[0]!);
            if (f) labels.push({ id: f.id, x: cluster.x, y: cluster.y, text: f.props.name, layerId: meta.id, priority: 2 });
          }
        }
      } else if (meta.kind === 'line') {
        ctx.lineWidth = policy.lineWidth;
        for (const f of layerFeatures) {
          if (f.geom.kind !== 'line') continue;
          const pts = simplifyLine(f.geom.coords, policy.simplifyTolerance);
          const diffKind = style.diffById?.get(f.id);
          ctx.beginPath();
          pts.forEach(([x, y], i) => {
            const [sx, sy] = worldToScreen(local, x, y);
            if (i === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          });
          ctx.strokeStyle = diffKind ? DIFF_COLORS[diffKind] : meta.color;
          if (diffKind) ctx.lineWidth = policy.lineWidth + 1.5;
          ctx.stroke();
          if (policy.showFeatureLabels) {
            const mid = pts[Math.floor(pts.length / 2)]!;
            labels.push({ id: f.id, x: mid[0], y: mid[1], text: f.props.name, layerId: meta.id, priority: 1 });
          }
        }
      } else {
        // polygon
        for (const f of layerFeatures) {
          if (f.geom.kind !== 'polygon') continue;
          const ring = simplifyLine(f.geom.ring, policy.simplifyTolerance);
          const diffKind = style.diffById?.get(f.id);
          const [cx, cy] = this.centroid(ring);
          if (policy.polygonAsMarker) {
            if (cx < originX || cx >= originX + tileWorld || cy < originY || cy >= originY + tileWorld) continue;
            const [sx, sy] = worldToScreen(local, cx, cy);
            ctx.fillStyle = diffKind ? DIFF_COLORS[diffKind] : meta.color;
            ctx.fillRect(sx - 3, sy - 3, 6, 6);
            continue;
          }
          ctx.beginPath();
          ring.forEach(([x, y], i) => {
            const [sx, sy] = worldToScreen(local, x, y);
            if (i === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          });
          ctx.closePath();
          ctx.fillStyle = diffKind ? `${DIFF_COLORS[diffKind]}33` : meta.fill ?? `${meta.color}33`;
          ctx.fill();
          ctx.lineWidth = policy.lineWidth;
          ctx.strokeStyle = diffKind ? DIFF_COLORS[diffKind] : meta.color;
          ctx.stroke();
          if (policy.showFeatureLabels) {
            labels.push({ id: f.id, x: cx, y: cy, text: f.props.name, layerId: meta.id, priority: 3 });
          }
        }
      }
      ctx.restore();
    }

    // 标签密度抽稀后绘制（只画锚点在瓦片内的）
    const kept = thinLabels(labels, local, lod);
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const item of kept) {
      if (
        item.x < originX ||
        item.x >= originX + tileWorld ||
        item.y < originY ||
        item.y >= originY + tileWorld
      ) {
        continue;
      }
      const [sx, sy] = worldToScreen(local, item.x, item.y);
      const tx2 = sx + 7;
      const ty2 = sy - 7;
      ctx.fillStyle = 'rgba(15,23,42,0.78)';
      const w = ctx.measureText(item.text).width + 6;
      ctx.fillRect(tx2 - 3, ty2 - 8, w, 15);
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(item.text, tx2, ty2);
    }

    this.store(key, this.posKey(lod, tx, ty), { canvas, usedAt: performance.now() });
  }

  private store(key: string, pos: string, tile: CachedTile): void {
    if (this.cache.size >= TILE_CACHE_CAP) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
        if (this.latestByPos.get(this.extractPos(oldestKey)) === oldestKey) {
          this.latestByPos.delete(this.extractPos(oldestKey));
        }
      }
    }
    this.cache.set(key, tile);
    this.latestByPos.set(pos, key);
  }

  private extractPos(key: string): string {
    const parts = key.split('|');
    return `${parts[parts.length - 3]}|${parts[parts.length - 2]}|${parts[parts.length - 1]}`;
  }

  private featureById(id: string): Feature | undefined {
    return this.featureMap.get(id);
  }

  private featureMap = new Map<string, Feature>();

  setFeatures(features: readonly Feature[], index: SpatialIndex): void {
    this.index = index;
    this.featureMap = new Map(features.map((f) => [f.id, f]));
    this.cache.clear();
    this.latestByPos.clear();
    this.queue = [];
    this.queued.clear();
    this.jobs.clear();
  }

  /** 样式变化不必清空缓存（旧瓦片作回退），但要丢弃同位置的回退指向以外的内容由 LRU 自然淘汰 */
  clear(): void {
    this.cache.clear();
    this.latestByPos.clear();
  }

  private centroid(ring: [number, number][]): [number, number] {
    let x = 0;
    let y = 0;
    for (const [px, py] of ring) {
      x += px;
      y += py;
    }
    return [x / ring.length, y / ring.length];
  }
}
