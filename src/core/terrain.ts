import { fbm2, noise2, hashString } from './rng';
import { clamp, headingToRadians, DEG } from './geom';
import type { NetworkParams, TerrainModel } from './types';

/**
 * 滩面高程模型。
 *
 * 潮沟总是在滩面最低处入海 (口门), 向陆方向比降抬升。这里用
 * "口门基准高程 + 比降 × 向陆距离 + 微地形噪声" 的解析式,
 * 保证任意参数组合下都得到确定的高程场, 也是沟头自然收尾的依据。
 */
export class Terrain {
  readonly model: TerrainModel;
  private readonly inlandX: number;
  private readonly inlandY: number;
  private readonly seed: number;

  constructor(params: NetworkParams) {
    const rad = headingToRadians(params.heading);
    this.inlandX = Math.cos(rad);
    this.inlandY = Math.sin(rad);
    this.model = {
      datum: params.datum,
      slope: params.slope,
      seaLevel: params.datum,
    };
    this.seed = hashString(params.seed) ^ 0x51ed;
  }

  /** 向陆距离 (m): 沿主沟走向投影 */
  inlandDistance(x: number, y: number): number {
    return x * this.inlandX + y * this.inlandY;
  }

  /** 某点高程 (m, 相对理论最低潮面) */
  elevationAt(x: number, y: number): number {
    const d = this.inlandDistance(x, y);
    const base = this.model.datum + this.model.slope * Math.max(-260, d);
    // 滩面微地形: 大尺度起伏 + 小尺度斑块, 幅度随向陆距离略增
    const micro = fbm2(this.seed, x / 420, y / 420, 3) * 0.055
      + noise2(this.seed + 17, x / 90, y / 90) * 0.012;
    return base + micro;
  }

  /** 局部坡度 (用于校核分支走向是否逆坡) */
  gradientAt(x: number, y: number): { gx: number; gy: number } {
    const h = 6;
    const ex = (this.elevationAt(x + h, y) - this.elevationAt(x - h, y)) / (2 * h);
    const ey = (this.elevationAt(x, y + h) - this.elevationAt(x, y - h)) / (2 * h);
    return { gx: ex, gy: ey };
  }

  /** 观测边界 (滩面调查范围), 以口门为原点向海侧展开 */
  surveyBounds(extent: number): { minX: number; minY: number; maxX: number; maxY: number } {
    return { minX: -extent * 0.55, minY: -extent * 0.42, maxX: extent, maxY: extent };
  }
}

/** 潮位 / 观测窗元数据, 写入调查说明 */
export interface TideWindow {
  tide: string;
  observedAt: string;
}

export function describeTideWindow(params: NetworkParams, t: TideWindow): string {
  const rad = headingToRadians(params.heading);
  const deg = ((90 - rad / DEG) % 360 + 360) % 360;
  return `主沟走向 ${deg.toFixed(1)}° · ${t.tide}`;
}

export function clampElevation(v: number, lo: number, hi: number): number {
  return clamp(v, lo, hi);
}
