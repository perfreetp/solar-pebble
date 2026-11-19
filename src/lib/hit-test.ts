import type { Feature, LayerState, ViewTransform } from '../types';
import type { SpatialIndex } from './spatial-index';
import { LAYER_MAP } from '../layers';
import { distanceToLine, pointInPolygon } from './geometry';

export interface HitTestDeps {
  index: SpatialIndex;
  layerStates: Record<string, LayerState>;
  view: ViewTransform;
  /** 当前 LOD，低于图层 minLod 的要素不参与拾取 */
  lod?: number;
}

/**
 * 拾取光标处最上层的要素。
 * 网格索引先做粗筛，再按几何类型精判；线/面给屏幕像素级容差。
 */
export function pickFeature(
  deps: HitTestDeps,
  worldX: number,
  worldY: number,
  cssX: number,
  cssY: number,
): Feature | null {
  const pxTol = 9; // 屏幕像素容差
  const worldTol = pxTol / deps.view.scale;
  const candidates = deps.index.queryPoint(worldX, worldY, worldTol);

  let best: Feature | null = null;
  let bestZ = -Infinity;
  let bestDist = Infinity;

  for (const f of candidates) {
    const st = deps.layerStates[f.layerId];
    if (!st || !st.visible) continue;
    if (deps.lod !== undefined && deps.lod < LAYER_MAP[f.layerId].minLod) continue;
    const g = f.geom;
    let hit = false;
    let dist = 0;

    if (g.kind === 'point') {
      const d = Math.hypot(g.x - worldX, g.y - worldY);
      // 点要素命中半径 10px（世界距离）
      hit = d <= Math.max(worldTol, 10 / deps.view.scale);
      dist = d;
    } else if (g.kind === 'line') {
      dist = distanceToLine(worldX, worldY, g);
      hit = dist <= worldTol;
    } else {
      if (pointInPolygon(worldX, worldY, g)) {
        hit = true;
        dist = 0;
      } else {
        // 点在面外时，也允许点中边界（容差内）
        let edge = Infinity;
        for (let i = 0; i < g.ring.length; i++) {
          const a = g.ring[i]!;
          const b = g.ring[(i + 1) % g.ring.length]!;
          const dx = b[0] - a[0];
          const dy = b[1] - a[1];
          const len2 = dx * dx + dy * dy;
          let t = len2 === 0 ? 0 : ((worldX - a[0]) * dx + (worldY - a[1]) * dy) / len2;
          t = Math.max(0, Math.min(1, t));
          const d = Math.hypot(worldX - (a[0] + t * dx), worldY - (a[1] + t * dy));
          if (d < edge) edge = d;
        }
        dist = edge;
        hit = edge <= worldTol;
      }
    }

    if (!hit) continue;
    const z = st.zOrder;
    // 同层级时取距离更近的
    if (z > bestZ || (z === bestZ && dist < bestDist)) {
      best = f;
      bestZ = z;
      bestDist = dist;
    }
  }

  void cssX;
  void cssY;
  return best;
}

/** 框选：返回与屏幕矩形相交的全部可见要素（多选） */
export function pickBox(
  deps: HitTestDeps,
  worldMinX: number,
  worldMinY: number,
  worldMaxX: number,
  worldMaxY: number,
): Feature[] {
  const candidates = deps.index.queryRect(worldMinX, worldMinY, worldMaxX, worldMaxY);
  const out: Feature[] = [];
  for (const f of candidates) {
    const st = deps.layerStates[f.layerId];
    if (!st || !st.visible) continue;
    if (deps.lod !== undefined && deps.lod < LAYER_MAP[f.layerId].minLod) continue;
    const g = f.geom;
    if (g.kind === 'point') {
      if (g.x >= worldMinX && g.x <= worldMaxX && g.y >= worldMinY && g.y <= worldMaxY) out.push(f);
    } else if (g.kind === 'line') {
      if (g.coords.some((p) => p[0] >= worldMinX && p[0] <= worldMaxX && p[1] >= worldMinY && p[1] <= worldMaxY)) {
        out.push(f);
      }
    } else {
      // 面：任一环点在框内，或框的角点在面内即视为相交
      if (g.ring.some((p) => p[0] >= worldMinX && p[0] <= worldMaxX && p[1] >= worldMinY && p[1] <= worldMaxY)
        || pointInPolygon((worldMinX + worldMaxX) / 2, (worldMinY + worldMaxY) / 2, g)) {
        out.push(f);
      }
    }
  }
  return out;
}
