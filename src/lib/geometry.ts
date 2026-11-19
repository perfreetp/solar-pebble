import type { Geometry, LineGeom, PolygonGeom, ViewTransform } from '../types';

export type Pt = [number, number];

export function worldToScreen(t: ViewTransform, x: number, y: number): Pt {
  return [x * t.scale + t.offsetX, y * t.scale + t.offsetY];
}

export function screenToWorld(t: ViewTransform, sx: number, sy: number): Pt {
  return [(sx - t.offsetX) / t.scale, (sy - t.offsetY) / t.scale];
}

/** 几何包围盒 [minX, minY, maxX, maxY] */
export function boundsOf(geom: Geometry): [number, number, number, number] {
  if (geom.kind === 'point') {
    return [geom.x, geom.y, geom.x, geom.y];
  }
  const pts = geom.kind === 'line' ? geom.coords : geom.ring;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

/** 点到线段距离 */
function distPointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** 点到折线的最小距离（世界单位） */
export function distanceToLine(x: number, y: number, line: LineGeom): number {
  let best = Infinity;
  const c = line.coords;
  for (let i = 0; i < c.length - 1; i++) {
    const d = distPointSegment(x, y, c[i]![0], c[i]![1], c[i + 1]![0], c[i + 1]![1]);
    if (d < best) best = d;
  }
  return best;
}

/** 射线法判断点是否在多边形内 */
export function pointInPolygon(x: number, y: number, poly: PolygonGeom): boolean {
  const ring = poly.ring;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0];
    const yi = ring[i]![1];
    const xj = ring[j]![0];
    const yj = ring[j]![1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Douglas–Peucker 折线简化，容差以世界米计。
 * LOD 越低容差越大，概览级别显著减少顶点数。
 */
export function simplifyLine(points: Pt[], tolerance: number): Pt[] {
  if (points.length <= 2 || tolerance <= 0) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  const tol2 = tolerance * tolerance;
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxD2 = -1;
    let index = -1;
    const ax = points[first]![0];
    const ay = points[first]![1];
    const bx = points[last]![0];
    const by = points[last]![1];
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i]!;
      const d = distPointSegment(px, py, ax, ay, bx, by);
      const d2 = d * d;
      if (d2 > maxD2) {
        maxD2 = d2;
        index = i;
      }
    }
    if (maxD2 > tol2 && index > 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]!);
  return out;
}

/** 计算几何在屏幕空间的近似包围盒半径，用于命中检测容差 */
export function hitRadius(geom: Geometry, scale: number): number {
  if (geom.kind === 'point') return 10 / scale; // 10px 换算回世界距离
  const [minX, minY, maxX, maxY] = boundsOf(geom);
  return (Math.max(maxX - minX, maxY - minY) / 2 + 8 / scale);
}
