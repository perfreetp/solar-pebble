/**
 * 确定性随机数基础设施。
 *
 * 设计要点:
 *  - 全部使用 32 位整数运算 (Math.imul), 不依赖平台浮点实现差异;
 *  - 每个"命名流" (stream) 由种子 + 用途字符串派生, 因此调换生成顺序不会改变结果;
 *  - 生成器只通过 Rng 取随机数, 不允许使用 Math.random。
 */

/** FNV-1a 32 位字符串散列 */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // 末尾再混一次, 避免空串 / 近邻字符串碰撞
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

/** 将多个片段组合成一个稳定种子 */
export function deriveSeed(base: string, ...parts: (string | number)[]): number {
  return hashString(base + '\u0000' + parts.join('\u0001'));
}

/** splitmix32 状态机 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
    // 打散一次, 避免相邻 seed 产生相关序列
    this.nextUint();
  }

  nextUint(): number {
    this.state = (this.state + 0x9e3779b9) >>> 0;
    let z = this.state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  }

  /** [0,1) */
  next(): number {
    return this.nextUint() / 4294967296;
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  int(n: number): number {
    return Math.min(n - 1, Math.floor(this.next() * n));
  }

  /** 以 p 的概率返回 true */
  chance(p: number): boolean {
    return this.next() < p;
  }

  sign(): 1 | -1 {
    return this.next() < 0.5 ? -1 : 1;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  /** 近似正态分布 (Irwin–Hall, 4 项) */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.2247;
  }

  fork(...parts: (string | number)[]): Rng {
    return new Rng(deriveSeed('fork', this.state >>> 0, ...parts));
  }
}

/** 命名流: 同一 (seed, 用途) 永远得到同一序列 */
export function stream(seed: string, ...parts: (string | number)[]): Rng {
  return new Rng(hashString(seed) ^ deriveSeed('stream', ...parts));
}

/** 1D 平滑值噪声, 输出 [-1, 1] */
export function noise1(seed: number, x: number): number {
  const i0 = Math.floor(x);
  const f = x - i0;
  const u = f * f * (3 - 2 * f);
  const a = hashToUnit(hashString(`${seed}:${i0}`));
  const b = hashToUnit(hashString(`${seed}:${i0 + 1}`));
  return (a + (b - a) * u) * 2 - 1;
}

/** 2D 平滑值噪声, 输出 [-1, 1] */
export function noise2(seed: number, x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const v00 = hashToUnit(hashString(`${seed}:${ix}:${iy}`));
  const v10 = hashToUnit(hashString(`${seed}:${ix + 1}:${iy}`));
  const v01 = hashToUnit(hashString(`${seed}:${ix}:${iy + 1}`));
  const v11 = hashToUnit(hashString(`${seed}:${ix + 1}:${iy + 1}`));
  const a = v00 + (v10 - v00) * ux;
  const b = v01 + (v11 - v01) * ux;
  return (a + (b - a) * uy) * 2 - 1;
}

/** 分形叠加噪声 (2D) */
export function fbm2(seed: number, x: number, y: number, octaves: number): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(seed + i * 7919, x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

function hashToUnit(h: number): number {
  return (h >>> 8) / 16777216;
}
