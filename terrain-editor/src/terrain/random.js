/**
 * 确定性随机与基础数学工具。
 * 所有生成过程只允许使用这里的随机源，保证同 seed + 同参数结果逐位一致。
 */

/** 32bit 字符串/数字混合哈希 → uint32 */
export function hash32(str) {
  let h = 0x811c9dc5
  const s = String(str)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32 PRNG，返回 [0,1) 浮点 */
export function mulberry32(seedU32) {
  let a = seedU32 >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 取一条独立随机流（不同 key 互不干扰，且与生成顺序无关） */
export function rngStream(seed, key) {
  return mulberry32(hash32(`${seed}::${key}`))
}

/** 整数 [min, max] */
export function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1))
}

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v
}

export function lerp(a, b, t) {
  return a + (b - a) * t
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** 二维向量旋转 */
export function rot2(x, z, ang) {
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  return { x: x * c - z * s, z: x * s + z * c }
}

/** 点到线段距离 */
export function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax
  const dz = bz - az
  const l2 = dx * dx + dz * dz
  if (l2 < 1e-9) return Math.hypot(px - ax, pz - az)
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1)
  const qx = ax + t * dx
  const qz = az + t * dz
  return Math.hypot(px - qx, pz - qz)
}

/** 点是否在旋转矩形内（cx,cz 中心，ang 朝向，sx/sz 半边长） */
export function insideRotRect(x, z, cx, cz, ang, sx, sz) {
  const dx = x - cx
  const dz = z - cz
  const c = Math.cos(-ang)
  const s = Math.sin(-ang)
  const lx = dx * c - dz * s
  const lz = dx * s + dz * c
  return Math.abs(lx) <= sx && Math.abs(lz) <= sz
}

/**
 * 晶格值噪声（确定性，无外部随机调用顺序依赖）。
 * 整数格点值由 hash 决定，双线性插值 + smoothstep。
 */
export function makeValueNoise2D(seed) {
  const base = hash32(`${seed}::noise`)
  function lattice(ix, iz) {
    let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + base
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }
  return function noise(x, z) {
    const ix = Math.floor(x)
    const iz = Math.floor(z)
    const fx = x - ix
    const fz = z - iz
    const ux = fx * fx * (3 - 2 * fx)
    const uz = fz * fz * (3 - 2 * fz)
    const a = lattice(ix, iz)
    const b = lattice(ix + 1, iz)
    const c = lattice(ix, iz + 1)
    const d = lattice(ix + 1, iz + 1)
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uz) * 2 - 1
  }
}
