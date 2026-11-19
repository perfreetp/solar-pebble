// Small, dependency-free geometry helpers for the wing kernel.
import earcut from 'earcut';

export const TAU = Math.PI * 2;

/** Centripetal Catmull-Rom through points. open: repeats ends; closed: wraps. */
export function catmullRom(points, { closed = false, samples = 10, alpha = 0.5 } = {}) {
  const n = points.length;
  if (n < 2) return points.map((p) => [p[0], p[1]]);
  const pts = points.map((p) => [p[0], p[1]]);
  const out = [];
  const segs = closed ? n : n - 1;
  const get = (i) => {
    if (closed) return pts[((i % n) + n) % n];
    return pts[Math.max(0, Math.min(n - 1, i))];
  };
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    const d01 = Math.max(1e-6, Math.pow(dist(p0, p1), alpha));
    const d12 = Math.max(1e-6, Math.pow(dist(p1, p2), alpha));
    const d23 = Math.max(1e-6, Math.pow(dist(p2, p3), alpha));
    // tangents as in Barry-Goldman / centripetal parameterisation
    const m1 = [
      (p2[0] - p1[0] + d12 * ((p1[0] - p0[0]) / d01 - (p2[0] - p0[0]) / (d01 + d12))) * 1,
      (p2[1] - p1[1] + d12 * ((p1[1] - p0[1]) / d01 - (p2[1] - p0[1]) / (d01 + d12))) * 1
    ];
    const m2 = [
      (p2[0] - p1[0] + d12 * ((p3[0] - p2[0]) / d23 - (p3[0] - p1[0]) / (d12 + d23))) * 1,
      (p2[1] - p1[1] + d12 * ((p3[1] - p2[1]) / d23 - (p3[1] - p1[1]) / (d12 + d23))) * 1
    ];
    const steps = samples;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      out.push([
        h00 * p1[0] + h10 * m1[0] + h01 * p2[0] + h11 * m2[0],
        h00 * p1[1] + h10 * m1[1] + h01 * p2[1] + h11 * m2[1]
      ]);
    }
  }
  if (!closed) out.push([pts[n - 1][0], pts[n - 1][1]]);
  return out;
}

export function dist(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.hypot(dx, dy);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function lerpPt(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function polylineLength(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  return total;
}

/** Cumulative arc-length table. */
export function arcTable(pts) {
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + dist(pts[i - 1], pts[i]));
  return acc;
}

/** Point at normalized arc length t along an open polyline. */
export function pointAt(pts, t, table) {
  const acc = table || arcTable(pts);
  const total = acc[acc.length - 1] || 1e-9;
  const target = Math.max(0, Math.min(1, t)) * total;
  let lo = 0;
  let hi = acc.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (acc[mid] <= target) lo = mid;
    else hi = mid;
  }
  const seg = acc[hi] - acc[lo] || 1e-9;
  const f = (target - acc[lo]) / seg;
  return lerpPt(pts[lo], pts[hi], f);
}

/** Sub-polyline between arc fractions t0..t1 (t0<t1), inclusive of endpoints. */
export function subPolyline(pts, t0, t1, steps = 8, table) {
  const acc = table || arcTable(pts);
  const total = acc[acc.length - 1] || 1e-9;
  const a = Math.max(0, Math.min(1, t0)) * total;
  const b = Math.max(0, Math.min(1, t1)) * total;
  const out = [pointAt(pts, a / total, acc)];
  for (let i = 1; i < steps; i++) {
    const tt = a + ((b - a) * i) / steps;
    out.push(pointAt(pts, tt / total, acc));
  }
  out.push(pointAt(pts, b / total, acc));
  return out;
}

export function polyArea(points) {
  let s = 0;
  for (let i = 0, n = points.length; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

export function polyCentroid(points) {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0, n = points.length; i < n; i++) {
    const p = points[i];
    const q = points[(i + 1) % n];
    const f = p[0] * q[1] - q[0] * p[1];
    a += f;
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  }
  if (Math.abs(a) < 1e-12) {
    const avg = points.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]);
    return [avg[0] / points.length, avg[1] / points.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function polyBounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][0];
    const yi = points[i][1];
    const xj = points[j][0];
    const yj = points[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Approx. distance from point to a closed polygon boundary. */
export function distToPolygonBoundary(x, y, pts) {
  let best = Infinity;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const d = distToSegment(x, y, a[0], a[1], b[0], b[1]);
    if (d < best) best = d;
  }
  return best;
}

/** Unit outward normal of a closed CCW polygon at vertex i (approx). */
export function vertexNormal(pts, i) {
  const n = pts.length;
  const a = pts[(i - 1 + n) % n];
  const b = pts[(i + 1) % n];
  const tx = b[0] - a[0];
  const ty = b[1] - a[1];
  const l = Math.hypot(tx, ty) || 1;
  return [ty / l, -tx / l];
}

export function rotatePoint(p, ang, origin = [0, 0]) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const x = p[0] - origin[0];
  const y = p[1] - origin[1];
  return [origin[0] + x * c - y * s, origin[1] + x * s + y * c];
}

export function transformPoint(p, m) {
  // m: {a,b,c,d,e,f} like canvas transforms (x' = a x + c y + e)
  return [m.a * p[0] + m.c * p[1] + m.e, m.b * p[0] + m.d * p[1] + m.f];
}

export function invertPoint(p, m) {
  const det = m.a * m.d - m.b * m.c || 1e-9;
  const x = p[0] - m.e;
  const y = p[1] - m.f;
  return [(m.d * x - m.c * y) / det, (-m.b * x + m.a * y) / det];
}

export function makeTransform({ rotate = 0, scale = 1, scaleY = null, mirror = false, tx = 0, ty = 0 } = {}) {
  const c = Math.cos(rotate);
  const s = Math.sin(rotate);
  const sx = (mirror ? -1 : 1) * scale;
  const sy = (scaleY == null ? scale : scaleY) * (mirror ? 1 : 1);
  let a = c * sx;
  let b = s * sx;
  let cc = -s * sy;
  let d = c * sy;
  if (mirror) {
    // mirror in wing-local space before rotation: x -> -x, keep y
  }
  return { a, b, c: cc, d, e: tx, f: ty };
}

/** Quad bezier sampled into a polyline. */
export function quadBezier(p0, p1, p2, steps = 24) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push([
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]
    ]);
  }
  return out;
}

/** Triangulate a simple polygon; returns flat [x0,y0,...] triangles. */
export function triangulate(poly) {
  const flat = [];
  for (const p of poly) flat.push(p[0], p[1]);
  let idx;
  try {
    idx = earcut(flat);
  } catch {
    idx = [];
  }
  if (!idx || idx.length === 0) {
    // degenerate fallback: fan from centroid-ish vertex 0
    idx = [];
    for (let i = 1; i + 1 < poly.length; i++) idx.push(0, i, i + 1);
  }
  const out = [];
  for (const i of idx) out.push(poly[i][0], poly[i][1]);
  return out;
}

/** Ellipse polygon. */
export function ellipsePoints(cx, cy, rx, ry, rot = 0, segments = 32) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * TAU;
    const x = Math.cos(t) * rx;
    const y = Math.sin(t) * ry;
    pts.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return pts;
}

export function pointInEllipse(px, py, cx, cy, rx, ry, rot) {
  const c = Math.cos(-rot);
  const s = Math.sin(-rot);
  const dx = px - cx;
  const dy = py - cy;
  const x = dx * c - dy * s;
  const y = dx * s + dy * c;
  return (x * x) / (rx * rx + 1e-9) + (y * y) / (ry * ry + 1e-9) <= 1;
}

/** Simplify a polyline with Douglas-Peucker (keeps endpoints). */
export function simplify(points, tol = 0.05) {
  if (points.length < 3) return points;
  const sq = tol * tol;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0;
    let idx = -1;
    const ax = points[a][0];
    const ay = points[a][1];
    const bx = points[b][0];
    const by = points[b][1];
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(points[i][0], points[i][1], ax, ay, bx, by);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

export function convexHull(points) {
  const pts = points.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
