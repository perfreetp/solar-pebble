/** 基础几何工具 (纯函数, 无随机, 无平台相关 API) */

export interface Vec2 {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/** 归一化到 (-PI, PI] */
export function wrapAngle(a: number): number {
  let x = a % TAU;
  if (x <= -Math.PI) x += TAU;
  else if (x > Math.PI) x -= TAU;
  return x;
}

/** 角度插值 (走最短路径) */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

/** 由 heading (自正北顺时针, 度) 得到数学方向角 (自 +x 逆时针) */
export function headingToRadians(headingDeg: number): number {
  return (90 - headingDeg) * DEG;
}

/** 数学方向角转 heading 度 */
export function radiansToHeading(rad: number): number {
  let deg = 90 - rad / DEG;
  deg = ((deg % 360) + 360) % 360;
  return deg;
}

export function dirOf(rad: number): Vec2 {
  return { x: Math.cos(rad), y: Math.sin(rad) };
}

/** 点到折线段的最短距离平方, 返回 {d2, t (全局归一化 [0,1]), segIndex} */
export function closestPointOnPolyline(
  px: number,
  py: number,
  pts: Float64Array,
): { d2: number; t: number; segIndex: number; qx: number; qy: number } {
  const n = pts.length / 2;
  let best = { d2: Infinity, t: 0, segIndex: 0, qx: 0, qy: 0 };
  let acc = 0;
  const segLen: number[] = [];
  let total = 0;
  for (let i = 0; i < n - 1; i++) {
    const l = dist(pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3]);
    segLen.push(l);
    total += l;
  }
  if (total === 0) return { d2: dist(px, py, pts[0], pts[1]) ** 2, t: 0, segIndex: 0, qx: pts[0], qy: pts[1] };
  for (let i = 0; i < n - 1; i++) {
    const ax = pts[i * 2], ay = pts[i * 2 + 1];
    const bx = pts[i * 2 + 2], by = pts[i * 2 + 3];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let u = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    u = clamp(u, 0, 1);
    const qx = ax + dx * u, qy = ay + dy * u;
    const d2 = (px - qx) ** 2 + (py - qy) ** 2;
    if (d2 < best.d2) {
      best = { d2, t: (acc + segLen[i] * u) / total, segIndex: i, qx, qy };
    }
    acc += segLen[i];
  }
  return best;
}

/** 折线累计弧长 */
export function cumulativeLengths(pts: Float64Array): { s: Float32Array; total: number } {
  const n = pts.length / 2;
  const s = new Float32Array(n);
  let total = 0;
  for (let i = 1; i < n; i++) {
    total += dist(pts[i * 2 - 2], pts[i * 2 - 1], pts[i * 2], pts[i * 2 + 1]);
    s[i] = total;
  }
  return { s, total };
}

/** 在折线归一化位置 t 处采样 (点 + 切线) */
export function samplePolyline(pts: Float64Array, t: number): { x: number; y: number; angle: number } {
  const n = pts.length / 2;
  if (n === 0) return { x: 0, y: 0, angle: 0 };
  if (n === 1) return { x: pts[0], y: pts[1], angle: 0 };
  const { s, total } = cumulativeLengths(pts);
  const target = clamp(t, 0, 1) * total;
  for (let i = 1; i < n; i++) {
    if (s[i] >= target || i === n - 1) {
      const segLen = s[i] - s[i - 1] || 1;
      const u = clamp((target - s[i - 1]) / segLen, 0, 1);
      const ax = pts[i * 2 - 2], ay = pts[i * 2 - 1];
      const bx = pts[i * 2], by = pts[i * 2 + 1];
      return {
        x: lerp(ax, bx, u),
        y: lerp(ay, by, u),
        angle: Math.atan2(by - ay, bx - ax),
      };
    }
  }
  return { x: pts[0], y: pts[1], angle: 0 };
}

/** 折线长度 */
export function polylineLength(pts: Float64Array): number {
  let d = 0;
  const n = pts.length / 2;
  for (let i = 1; i < n; i++) {
    d += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
  }
  return d;
}

/** 以固定间距重采样折线 (含首尾) */
export function resample(pts: Float64Array, spacing: number): Float64Array {
  const n = pts.length / 2;
  if (n < 2) return pts.slice();
  const { s, total } = cumulativeLengths(pts);
  if (total === 0) return pts.slice();
  const count = Math.max(2, Math.round(total / spacing) + 1);
  const out = new Float64Array(count * 2);
  let seg = 1;
  for (let i = 0; i < count; i++) {
    const target = (i / (count - 1)) * total;
    while (seg < n - 1 && s[seg] < target) seg++;
    const segLen = s[seg] - s[seg - 1] || 1;
    const u = clamp((target - s[seg - 1]) / segLen, 0, 1);
    out[i * 2] = lerp(pts[seg * 2 - 2], pts[seg * 2], u);
    out[i * 2 + 1] = lerp(pts[seg * 2 - 1], pts[seg * 2 + 1], u);
  }
  return out;
}

/** 相对某处横向偏移调整 (用于锁定段编辑): 在 17 个控制点上按法向平移 */
export function applyNormalOffsets(pts: Float64Array, offsets: number[]): Float64Array {
  const n = pts.length / 2;
  const out = new Float64Array(pts.length);
  const ctrl = offsets.length;
  if (n < 2) return out;
  // 先计算每个原始点的法向
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);
    const tx = pts[i1 * 2] - pts[i0 * 2];
    const ty = pts[i1 * 2 + 1] - pts[i0 * 2 + 1];
    const tl = Math.hypot(tx, ty) || 1;
    const nx = -ty / tl;
    const ny = tx / tl;
    const u = (i / (n - 1)) * (ctrl - 1);
    const k = Math.min(ctrl - 2, Math.floor(u));
    const f = u - k;
    const off = lerp(offsets[k], offsets[Math.min(ctrl - 1, k + 1)], f);
    out[i * 2] = pts[i * 2] + nx * off;
    out[i * 2 + 1] = pts[i * 2 + 1] + ny * off;
  }
  return out;
}

/**
 * 折线形状签名: 平移 + 旋转不变量。
 *
 * 用"每段长度 + 每个顶点的转角"序列描述形态, 这些量在刚体变换下不变
 * (绝对朝向不参与), 因此锁定段绕父沟重挂之后签名应完全一致。
 * 转角按微弧度、长度按毫米量化, 吸收浮点末位差异。
 */
export function shapeSignature(pts: Float64Array, length: number): string {
  const n = pts.length / 2;
  if (n < 2) return `${length.toFixed(3)}:0`;
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v & 0xffffffff;
    h = Math.imul(h, 0x01000193);
  };
  let prevAngle = Math.atan2(pts[3] - pts[1], pts[2] - pts[0]);
  for (let i = 1; i < n; i++) {
    const ax = pts[i * 2 - 2], ay = pts[i * 2 - 1];
    const bx = pts[i * 2], by = pts[i * 2 + 1];
    const segLen = Math.hypot(bx - ax, by - ay);
    const angle = Math.atan2(by - ay, bx - ax);
    const turn = wrapAngle(angle - prevAngle);
    prevAngle = angle;
    // 长度: 毫米级
    mix(Math.round(segLen * 1000));
    // 转角: 微弧度级
    mix(Math.round(turn * 1e6));
  }
  return `${length.toFixed(3)}:${(h >>> 0).toString(16).padStart(8, '0')}:${n}`;
}

/** 两点间带种子扰动的针状判断辅助 (避免沟道之间过近) */
export function segSegDistance(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): number {
  const d1 = pointSegDistance(ax, ay, cx, cy, dx, dy);
  const d2 = pointSegDistance(bx, by, cx, cy, dx, dy);
  const d3 = pointSegDistance(cx, cy, ax, ay, bx, by);
  const d4 = pointSegDistance(dx, dy, ax, ay, bx, by);
  return Math.min(d1, d2, d3, d4);
}

export function pointSegDistance(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let u = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  u = clamp(u, 0, 1);
  return Math.hypot(px - (ax + dx * u), py - (ay + dy * u));
}
