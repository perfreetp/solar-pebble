import type { Pt, PathData } from '../types';

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export const uid = (prefix = 'id'): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const ptInRect = (p: Pt, r: { x: number; y: number; w: number; h: number }) =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/** 三次贝塞尔点(t) */
export function cubicPoint(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const mt = 1 - t;
  const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/**
 * 把整条路径展平为线段多边形(含镂空处理前的主轮廓)。
 * stepsPerSegment: 每段贝塞尔采样数
 */
export function flattenPath(path: PathData, stepsPerSegment = 16): Pt[] {
  const n = path.nodes.length;
  if (n === 0) return [];
  const segCount = path.closed ? n : n - 1;
  const out: Pt[] = [];
  for (let i = 0; i < segCount; i++) {
    const p0 = path.nodes[i];
    const p3 = path.nodes[(i + 1) % n];
    out.push(p0);
    const hOut = path.handlesOut[i];
    const hIn = path.handlesIn[(i + 1) % n];
    if (hOut || hIn) {
      const p1 = hOut ? { x: p0.x + hOut.x, y: p0.y + hOut.y } : p0;
      const p2 = hIn ? { x: p3.x + hIn.x, y: p3.y + hIn.y } : p3;
      for (let s = 1; s <= stepsPerSegment; s++) {
        if (s === stepsPerSegment && i < segCount - 1) continue;
        out.push(cubicPoint(p0, p1, p2, p3, s / stepsPerSegment));
      }
    } else if (i < segCount - 1) {
      // 直线段:终点在下一轮推入
    }
  }
  if (!path.closed) out.push(path.nodes[n - 1]);
  return out;
}

/** 点到线段距离 */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** 点到路径(展平折线)距离,返回距离与最近点 */
export function distToPath(p: Pt, flat: Pt[], closed: boolean): { d: number; nearest: Pt } {
  let best = Infinity;
  let nearest = flat[0];
  const segs = closed ? flat.length : flat.length - 1;
  for (let i = 0; i < segs; i++) {
    const a = flat[i], b = flat[(i + 1) % flat.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
    t = clamp(t, 0, 1);
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = dist(p, q);
    if (d < best) { best = d; nearest = q; }
  }
  return { d: best, nearest };
}

/** 射线法判断点在多边形内(边界算内) */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = (yi > p.y) !== (yj > p.y) &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** 线段与线段交点 */
export function segIntersect(a1: Pt, a2: Pt, b1: Pt, b2: Pt): Pt | null {
  const d1x = a2.x - a1.x, d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x, d2y = b2.y - b1.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom;
  const u = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / denom;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return { x: a1.x + t * d1x, y: a1.y + t * d1y };
  }
  return null;
}

/** 深拷贝路径(去掉不可结构化克隆的内容这里没有) */
export function clonePath(p: PathData): PathData {
  return {
    ...p,
    nodes: p.nodes.map(n => ({ ...n })),
    handlesIn: p.handlesIn.map(h => (h ? { ...h } : null)),
    handlesOut: p.handlesOut.map(h => (h ? { ...h } : null)),
    holes: p.holes.map(ring => ring.map(q => ({ ...q }))),
  };
}

export function movePath(p: PathData, dx: number, dy: number): PathData {
  p.nodes.forEach(n => { n.x += dx; n.y += dy; });
  p.holes.forEach(ring => ring.forEach(q => { q.x += dx; q.y += dy; }));
  return p;
}

/** 多边形环重心 */
export function centroid(pts: Pt[]): Pt {
  let x = 0, y = 0;
  pts.forEach(p => { x += p.x; y += p.y; });
  return { x: x / pts.length, y: y / pts.length };
}

export const bboxOf = (pts: Pt[]) => {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return {
    x: Math.min(...xs), y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
};

/** 多边形环面积(有符号) */
export function ringArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  }
  return a / 2;
}

/** 确保环为逆时针(外环约定) */
export function ensureCCW(ring: Pt[]): Pt[] {
  return ringArea(ring) < 0 ? [...ring].reverse() : ring;
}
export function ensureCW(ring: Pt[]): Pt[] {
  return ringArea(ring) > 0 ? [...ring].reverse() : ring;
}
