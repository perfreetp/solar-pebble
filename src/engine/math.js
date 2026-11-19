// 数学 / 插值工具：角度以「度」为单位，0 度指向右方，顺时针为正（Canvas 坐标）

export const DEG = Math.PI / 180
export const RAD = 180 / Math.PI

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v))
export const lerp = (a, b, t) => a + (b - a) * t

export function angleLerp(a, b, t) {
  // 走最短弧
  let d = ((b - a + 540) % 360) - 180
  return a + d * t
}

export function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay)
}

export function normalizeAngle(a) {
  return ((a % 360) + 360) % 360
}

// 角度 a 是否落在 [min, max] 区间内（区间不跨越 360 时直接比较）
export function angleInRange(a, min, max) {
  if (min <= max) return a >= min && a <= max
  return a >= min || a <= max
}

// 区间越界量（度），未越界返回 0
export function rangeExceed(a, min, max) {
  if (angleInRange(a, min, max)) return 0
  if (min <= max) return a < min ? min - a : a - max
  return a > max && a < min ? Math.min(a - max, min + 360 - a) : 0
}

// 三次贝塞尔曲线，输入 x1,y1,x2,y2（CSS cubic-bezier 语义，x∈[0,1]）
// 返回 t -> y 的映射函数
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by

  const sampleX = (t) => ((ax * t + bx) * t + cx) * t
  const sampleY = (t) => ((ay * t + by) * t + cy) * t
  const sampleDX = (t) => (3 * ax * t + 2 * bx) * t + cx

  return function (x) {
    if (x <= 0) return 0
    if (x >= 1) return 1
    // 牛顿迭代求参数 t
    let t = x
    for (let i = 0; i < 8; i++) {
      const dx = sampleDX(t)
      if (Math.abs(dx) < 1e-6) break
      t -= (sampleX(t) - x) / dx
    }
    t = clamp(t, 0, 1)
    // 二分兜底
    let lo = 0, hi = 1
    for (let i = 0; i < 20; i++) {
      const sx = sampleX(t)
      if (Math.abs(sx - x) < 1e-5) break
      if (sx < x) lo = t; else hi = t
      t = (lo + hi) / 2
    }
    return sampleY(t)
  }
}

export const EASING = {
  linear: { label: '线性', make: () => (t) => t },
  easeInOut: { label: '缓入缓出', make: () => cubicBezier(0.42, 0, 0.58, 1) },
  bezier: { label: '贝塞尔', make: (c) => cubicBezier(c[0], c[1], c[2], c[3]) }
}

export const DEFAULT_BEZIER = [0.25, 0.1, 0.25, 1]

// 根据关键帧段配置求进度 0..1 的缓动值
export function segmentEase(seg, t) {
  if (seg.easing === 'bezier') {
    const c = seg.bezier || DEFAULT_BEZIER
    return cubicBezier(c[0], c[1], c[2], c[3])(t)
  }
  if (seg.easing === 'easeInOut') return cubicBezier(0.42, 0, 0.58, 1)(t)
  return t
}

export function easeName(key) {
  return EASING[key]?.label || key
}
