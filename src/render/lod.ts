import type { Feature, LayerId, ViewTransform } from '../types';
import { LAYER_MAP } from '../layers';

/** 每级 LOD 的绘制策略 */
export interface LodPolicy {
  /** 瓦片覆盖的世界尺寸（米） */
  tileWorldSize: number;
  /** 点要素聚合的屏幕像素间距 */
  clusterPx: number;
  /** 线/面简化容差（世界米） */
  simplifyTolerance: number;
  /** 标签之间最小屏幕间距 */
  labelSpacingPx: number;
  /** 点符号屏幕半径 */
  pointRadius: number;
  /** 线宽（px） */
  lineWidth: number;
  /** 是否绘制单个要素的文字标签 */
  showFeatureLabels: boolean;
  /** 多边形在概览级是否退化为中心点标记 */
  polygonAsMarker: boolean;
  /** 线/面要素密度抽稀的屏幕网格间距（0=不抽稀，全量绘制） */
  featureThinPx: number;
}

export const LOD_POLICIES: LodPolicy[] = [
  { tileWorldSize: 1600, clusterPx: 72, simplifyTolerance: 48, labelSpacingPx: 160, pointRadius: 3, lineWidth: 0.7, showFeatureLabels: false, polygonAsMarker: true, featureThinPx: 46 },
  { tileWorldSize: 640, clusterPx: 52, simplifyTolerance: 22, labelSpacingPx: 120, pointRadius: 3.5, lineWidth: 1.1, showFeatureLabels: false, polygonAsMarker: false, featureThinPx: 26 },
  { tileWorldSize: 320, clusterPx: 36, simplifyTolerance: 8, labelSpacingPx: 92, pointRadius: 4.5, lineWidth: 1.6, showFeatureLabels: true, polygonAsMarker: false, featureThinPx: 0 },
  { tileWorldSize: 128, clusterPx: 18, simplifyTolerance: 1.2, labelSpacingPx: 72, pointRadius: 5.5, lineWidth: 2.5, showFeatureLabels: true, polygonAsMarker: false, featureThinPx: 0 },
];

export interface Cluster {
  x: number;
  y: number;
  layerId: LayerId;
  count: number;
  /** 簇内要素 id（单个要素时长度为 1） */
  members: string[];
}

/**
 * 屏幕空间贪心聚合：同一图层、屏幕间距小于 clusterPx 的点合并为一个簇。
 * 用 clusterPx/2 的哈希网格做邻接查询，每个点只与已建立的、距离足够近的簇合并，
 * 这样跨网格边界的邻近点也能聚到一起，而不是被网格线机械切分。
 * 输入要素已由瓦片按区域（带 margin）预筛。
 */
export function clusterPoints(
  features: Feature[],
  transform: ViewTransform,
  lod: number,
): Cluster[] {
  const policy = LOD_POLICIES[lod]!;
  if (policy.clusterPx <= 0) {
    return features
      .filter((f) => f.geom.kind === 'point')
      .map((f) => {
        const g = f.geom as Extract<Feature['geom'], { kind: 'point' }>;
        return { x: g.x, y: g.y, layerId: f.layerId, count: 1, members: [f.id] };
      });
  }

  interface Cell {
    sx: number;
    sy: number;
    wx: number;
    wy: number;
    n: number;
    cluster: Cluster;
  }
  // 每图层独立的网格（不同图层不互相吞并）
  const perLayer = new Map<LayerId, Map<number, Cell>>();
  const out: Cluster[] = [];
  const cellSize = policy.clusterPx / 2;
  const radius2 = policy.clusterPx * policy.clusterPx;
  const OFFSET = 0x2000;

  for (const f of features) {
    if (f.geom.kind !== 'point' || !LAYER_MAP[f.layerId]?.clusterable) continue;
    const sx = f.geom.x * transform.scale + transform.offsetX;
    const sy = f.geom.y * transform.scale + transform.offsetY;
    const gx = Math.floor(sx / cellSize);
    const gy = Math.floor(sy / cellSize);

    let grid = perLayer.get(f.layerId);
    if (!grid) {
      grid = new Map();
      perLayer.set(f.layerId, grid);
    }

    // 在 3×3 邻格中找距离最近且满足半径的现有簇
    let target: Cell | null = null;
    let bestD2 = radius2;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const k = (gx + dx + OFFSET) * 0x10000 + (gy + dy + OFFSET);
        const c = grid.get(k);
        if (!c) continue;
        const cx = c.sx / c.n;
        const cy = c.sy / c.n;
        const d2 = (cx - sx) ** 2 + (cy - sy) ** 2;
        if (d2 <= bestD2) {
          bestD2 = d2;
          target = c;
        }
      }
    }

    if (!target) {
      const cluster: Cluster = { x: 0, y: 0, layerId: f.layerId, count: 0, members: [] };
      const cell: Cell = { sx: 0, sy: 0, wx: 0, wy: 0, n: 0, cluster };
      grid.set((gx + OFFSET) * 0x10000 + (gy + OFFSET), cell);
      out.push(cluster);
      target = cell;
    }

    target.n++;
    target.sx += sx;
    target.sy += sy;
    target.wx += f.geom.x;
    target.wy += f.geom.y;
    target.cluster.count++;
    target.cluster.members.push(f.id);
  }

  for (const grid of perLayer.values()) {
    for (const c of grid.values()) {
      c.cluster.x = c.wx / c.n;
      c.cluster.y = c.wy / c.n;
    }
  }
  return out;
}

export interface LabelItem {
  id: string;
  x: number;
  y: number;
  text: string;
  layerId: LayerId;
  priority: number;
}

/**
 * 密度抽稀标签：屏幕空间占据网格，先到先得（按 priority 排序），
 * 保证任意相邻标签间距不小于 policy.labelSpacingPx。
 */
export function thinLabels(items: LabelItem[], transform: ViewTransform, lod: number): LabelItem[] {
  const policy = LOD_POLICIES[lod]!;
  const spacing = policy.labelSpacingPx;
  const sorted = [...items].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
  const occupied = new Set<number>();
  const kept: LabelItem[] = [];
  for (const item of sorted) {
    const sx = item.x * transform.scale + transform.offsetX;
    const sy = item.y * transform.scale + transform.offsetY;
    const gx = Math.floor(sx / spacing);
    const gy = Math.floor(sy / spacing);
    const key = (gx + 0x4000) * 0x10000 + (gy + 0x4000);
    if (occupied.has(key)) continue;
    occupied.add(key);
    kept.push(item);
  }
  return kept;
}

/** 取线/面几何的代表点（质心），用于抽稀定位 */
function representativePoint(f: Feature): [number, number] {
  if (f.geom.kind === 'point') return [f.geom.x, f.geom.y];
  const pts = f.geom.kind === 'line' ? f.geom.coords : f.geom.ring;
  let x = 0;
  let y = 0;
  for (const [px, py] of pts) {
    x += px;
    y += py;
  }
  return [x / pts.length, y / pts.length];
}

/**
 * 线/面要素密度抽稀：按质心落到屏幕网格，每格只保留一个要素。
 * 要素按 id 稳定排序后再占据网格，同一要素在不同瓦片/帧中取舍一致，避免拖动闪烁。
 * spacingPx 为 0 时原样返回。
 */
export function thinFeatures(features: Feature[], transform: ViewTransform, lod: number): Feature[] {
  const spacing = LOD_POLICIES[lod]!.featureThinPx;
  if (spacing <= 0) return features;
  const sorted = [...features].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const occupied = new Set<number>();
  const kept: Feature[] = [];
  for (const f of sorted) {
    const [wx, wy] = representativePoint(f);
    const sx = wx * transform.scale + transform.offsetX;
    const sy = wy * transform.scale + transform.offsetY;
    const key =
      (Math.floor(sx / spacing) + 0x4000) * 0x10000 + (Math.floor(sy / spacing) + 0x4000);
    if (occupied.has(key)) continue;
    occupied.add(key);
    kept.push(f);
  }
  return kept;
}
