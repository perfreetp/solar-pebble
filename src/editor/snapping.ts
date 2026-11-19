/**
 * 吸附引擎：端点、中点、网格、图元边线
 * 阈值由 store.settings.snapThreshold 控制（屏幕像素，按缩放换算到世界坐标）
 */
import type { Matrix, Pt, VecPath } from './types';
import { applyMatrix, dist, mid, pointSegDist, worldSamples } from './geometry';

export type SnapKind = 'endpoint' | 'midpoint' | 'grid' | 'edge';

export interface SnapHit {
  kind: SnapKind;
  point: Pt;
  itemId?: string;
  /** 吸附源点到命中点的世界距离 */
  distance: number;
}

export interface SnapContext {
  items: VecPath[];
  groupTransforms: Map<string, Matrix | null>;
  thresholdPx: number;
  viewScale: number;
  gridSize: number;
  gridEnabled: boolean;
  /** 拖拽中的图元自身 id（及其同组），避免自吸附 */
  excludeIds: Set<string>;
}

function worldPointsOf(item: VecPath, groupTx: Matrix | null): Pt[] {
  return worldSamples(item, groupTx);
}

/** 找最近的吸附目标；返回吸附后的坐标与命中信息 */
export function snapPoint(world: Pt, ctx: SnapContext): { point: Pt; hit: SnapHit | null } {
  const threshold = ctx.thresholdPx / Math.max(0.05, ctx.viewScale);
  let best: SnapHit | null = null;
  const consider = (hit: SnapHit) => {
    if (hit.distance <= threshold && (!best || hit.distance < (best as SnapHit).distance)) best = hit;
  };

  // 1. 网格吸附
  if (ctx.gridEnabled && ctx.gridSize > 0) {
    const g = ctx.gridSize;
    const gp: Pt = { x: Math.round(world.x / g) * g, y: Math.round(world.y / g) * g };
    consider({ kind: 'grid', point: gp, distance: dist(world, gp) });
  }

  // 2. 其它图元的端点 / 中点 / 边线
  for (const item of ctx.items) {
    if (ctx.excludeIds.has(item.id)) continue;
    const gtx = ctx.groupTransforms.get(item.id) ?? null;
    const wpts = worldPointsOf(item, gtx);
    if (wpts.length < 2) continue;

    for (const p of wpts) {
      consider({ kind: 'endpoint', point: p, itemId: item.id, distance: dist(world, p) });
    }
    for (let i = 0; i < wpts.length - 1; i++) {
      const m = mid(wpts[i], wpts[i + 1]);
      consider({ kind: 'midpoint', point: m, itemId: item.id, distance: dist(world, m) });
      const { d, near } = pointSegDist(world, wpts[i], wpts[i + 1]);
      consider({ kind: 'edge', point: near, itemId: item.id, distance: d });
    }
    if (item.closed && wpts.length > 2) {
      const m = mid(wpts[wpts.length - 1], wpts[0]);
      consider({ kind: 'midpoint', point: m, itemId: item.id, distance: dist(world, m) });
      const { d, near } = pointSegDist(world, wpts[wpts.length - 1], wpts[0]);
      consider({ kind: 'edge', point: near, itemId: item.id, distance: d });
    }
  }

  const finalHit = best as SnapHit | null;
  return finalHit ? { point: finalHit.point, hit: finalHit } : { point: world, hit: null };
}

/** 对一组待移动点整体做吸附：以首个活动点为准找命中，再整体平移，保持形状不变 */
export function snapDrag(
  anchor: Pt,
  moved: Pt,
  ctx: SnapContext,
): { dx: number; dy: number; hit: SnapHit | null } {
  const { point, hit } = snapPoint(moved, ctx);
  void anchor;
  if (!hit) return { dx: 0, dy: 0, hit: null };
  return { dx: point.x - moved.x, dy: point.y - moved.y, hit };
}

/** 编辑单个顶点时的吸附（可吸附到被编辑图元以外的所有目标，网格始终参与） */
export function snapVertex(p: Pt, ctx: SnapContext): { point: Pt; hit: SnapHit | null } {
  return snapPoint(p, ctx);
}

export function transformPointForPreview(m: Matrix, p: Pt): Pt {
  return applyMatrix(m, p);
}
