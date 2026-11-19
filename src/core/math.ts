// 最小化向量 / 矩阵数学库（列主序 mat4，兼容 WebGPU）
import type { Vec3 } from './types';

export type Mat4 = Float32Array;

export function vec3(x: number, y: number, z: number): Vec3 {
  return [x, y, z];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a: Vec3): Vec3 {
  const l = length(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function perspective(fovyRad: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovyRad / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = far / (near - far);
  m[11] = -1;
  m[14] = (far * near) / (near - far);
  return m;
}

export function ortho(left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4 {
  const m = new Float32Array(16);
  m[0] = 2 / (right - left);
  m[5] = 2 / (top - bottom);
  m[10] = -1 / (far - near);
  m[14] = -(near + far) / (far - near);
  m[15] = 1;
  return m;
}

export function lookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  const z = normalize(sub(eye, center));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  const m = new Float32Array(16);
  m[0] = x[0]; m[1] = y[0]; m[2] = z[0]; m[3] = 0;
  m[4] = x[1]; m[5] = y[1]; m[6] = z[1]; m[7] = 0;
  m[8] = x[2]; m[9] = y[2]; m[10] = z[2]; m[11] = 0;
  m[12] = -dot(x, eye);
  m[13] = -dot(y, eye);
  m[14] = -dot(z, eye);
  m[15] = 1;
  return m;
}

export function invert(a: Mat4): Mat4 {
  // Gauss–Jordan 消元：增广矩阵 [a | I] → [I | a⁻¹]，列主序展平
  const m = new Float32Array(32);
  for (let i = 0; i < 16; i++) m[i] = a[i];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) m[16 + i * 4 + j] = i === j ? 1 : 0;

  const at = (r: number, c: number): number => m[c * 4 + r];
  const set = (r: number, c: number, v: number): void => { m[c * 4 + r] = v; };
  const atA = (r: number, c: number): number => m[16 + c * 4 + r];
  const setA = (r: number, c: number, v: number): void => { m[16 + c * 4 + r] = v; };

  for (let col = 0; col < 4; col++) {
    // 选主元
    let pivot = col;
    for (let r = col + 1; r < 4; r++) {
      if (Math.abs(at(r, col)) > Math.abs(at(pivot, col))) pivot = r;
    }
    if (Math.abs(at(pivot, col)) < 1e-10) return identity();
    if (pivot !== col) {
      for (let c = 0; c < 4; c++) {
        let tmp = at(col, c); set(col, c, at(pivot, c)); set(pivot, c, tmp);
        tmp = atA(col, c); setA(col, c, atA(pivot, c)); setA(pivot, c, tmp);
      }
    }
    // 归一化主元行
    const div = at(col, col);
    for (let c = 0; c < 4; c++) {
      set(col, c, at(col, c) / div);
      setA(col, c, atA(col, c) / div);
    }
    // 消去其它行
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const factor = at(r, col);
      if (factor === 0) continue;
      for (let c = 0; c < 4; c++) {
        set(r, c, at(r, c) - factor * at(col, c));
        setA(r, c, atA(r, c) - factor * atA(col, c));
      }
    }
  }
  return new Float32Array(m.buffer, 16 * 4, 16).slice();
}

export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  const x = p[0], y = p[1], z = p[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

/** 射线与平面（point + normal）求交，返回 t，无交点返回 null */
export function rayPlane(origin: Vec3, dir: Vec3, point: Vec3, normal: Vec3): number | null {
  const denom = dot(normal, dir);
  if (Math.abs(denom) < 1e-8) return null;
  const t = dot(sub(point, origin), normal) / denom;
  return t >= 0 ? t : null;
}
