import type { Matrix, Pt, VecPath } from './types';
import { identity } from './types';

export const pt = (x: number, y: number): Pt => ({ x, y });
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s });
export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const lerp = (a: Pt, b: Pt, t: number): Pt => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export const clonePts = (pts: Pt[]): Pt[] => pts.map((p) => ({ ...p }));

export function applyMatrix(m: Matrix, p: Pt): Pt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  const id = det;
  return [
    m[3] / id,
    -m[1] / id,
    -m[2] / id,
    m[0] / id,
    (m[2] * m[5] - m[3] * m[4]) / id,
    (m[1] * m[4] - m[0] * m[5]) / id,
  ];
}

export function rotationOf(m: Matrix): number {
  return Math.atan2(m[1], m[0]);
}

/** 组合变换：先 local 再 group（若有） */
export function worldMatrix(item: VecPath, groupTransform: Matrix | null): Matrix {
  return groupTransform ? multiply(groupTransform, item.transform) : item.transform;
}

export function bboxOf(pts: Pt[]): { min: Pt; max: Pt } | null {
  if (!pts.length) return null;
  const min = { x: Infinity, y: Infinity };
  const max = { x: -Infinity, y: -Infinity };
  for (const p of pts) {
    min.x = Math.min(min.x, p.x);
    min.y = Math.min(min.y, p.y);
    max.x = Math.max(max.x, p.x);
    max.y = Math.max(max.y, p.y);
  }
  return { min, max };
}

/** 钢笔曲线/折线统一展开为折线采样点（局部坐标），用于绘制、命中与布尔运算 */
export function flattenPath(item: VecPath, tolerance = 2): Pt[] {
  if (!item.segments.length) return item.points.map((p) => ({ ...p }));
  const segs = item.segments;
  const out: Pt[] = [segs[0].point];
  for (let i = 0; i < segs.length - 1; i++) {
    const s0 = segs[i];
    const s1 = segs[i + 1];
    const p0 = s0.point;
    const p3 = s1.point;
    const p1 = s0.handleOut ?? p0;
    const p2 = s1.handleIn ?? p3;
    const straight =
      (!s0.handleOut || dist(s0.handleOut, p0) < 0.001) &&
      (!s1.handleIn || dist(s1.handleIn, p3) < 0.001);
    if (straight) {
      out.push(p3);
      continue;
    }
    const steps = Math.max(6, Math.ceil(curveLength(p0, p1, p2, p3) / tolerance));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      out.push({
        x: u ** 3 * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t ** 3 * p3.x,
        y: u ** 3 * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t ** 3 * p3.y,
      });
    }
  }
  return out;
}

function curveLength(p0: Pt, p1: Pt, p2: Pt, p3: Pt): number {
  let prev = p0;
  let len = 0;
  for (let i = 1; i <= 12; i++) {
    const t = i / 12;
    const u = 1 - t;
    const cur = {
      x: u ** 3 * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t ** 3 * p3.x,
      y: u ** 3 * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t ** 3 * p3.y,
    };
    len += dist(prev, cur);
    prev = cur;
  }
  return len;
}

/** 路径在世界坐标下的采样点（含自身与组变换） */
export function worldSamples(item: VecPath, groupTx: Matrix | null): Pt[] {
  const local = flattenPath(item);
  const m = worldMatrix(item, groupTx);
  const world = local.map((p) => applyMatrix(m, p));
  // 平滑折线做一次点抽稀，控制后续计算量
  return simplify(world, 0.5);
}

/** Ramer–Douglas–Peucker 抽稀 */
export function simplify(points: Pt[], eps: number): Pt[] {
  if (points.length <= 3) return points;
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    const a = points[lo];
    const b = points[hi];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = lo + 1; i < hi; i++) {
      const d = Math.abs(dy * points[i].x - dx * points[i].y + b.x * a.y - b.y * a.x) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = true;
      stack.push([lo, idx], [idx, hi]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

export function pointSegDist(p: Pt, a: Pt, b: Pt): { d: number; near: Pt } {
  const v = sub(b, a);
  const l2 = v.x * v.x + v.y * v.y;
  let t = l2 ? ((p.x - a.x) * v.x + (p.y - a.y) * v.y) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const near = lerp(a, b, t);
  return { d: dist(p, near), near };
}

/** 点是否在闭合多边形内（射线法） */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** 两条线段是否相交 */
export function segIntersect(a1: Pt, a2: Pt, b1: Pt, b2: Pt): boolean {
  const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
  if (Math.abs(d) < 1e-10) return false;
  const t = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / d;
  const u = ((b1.x - a1.x) * (a2.y - a1.y) - (b1.y - a1.y) * (a2.x - a1.x)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

export function centerOf(pts: Pt[]): Pt {
  const bb = bboxOf(pts);
  if (!bb) return { x: 0, y: 0 };
  return mid(bb.min, bb.max);
}

export { identity };
