import type { Feature } from '../types';
import { boundsOf } from './geometry';

/**
 * 均匀网格空间索引（Uniform Grid）。
 * 世界坐标按 cellSize 切格，每个要素登记到其包围盒覆盖的所有格子；
 * 命中检测只遍历光标所在格子附近的候选要素，避免全量扫描数万个对象。
 */
export class SpatialIndex {
  readonly cellSize: number;
  private cells = new Map<number, Feature[]>();
  private featureCellCount = new Map<string, number>();

  constructor(cellSize = 120) {
    this.cellSize = cellSize;
  }

  private key(cx: number, cy: number): number {
    // 给 y 一个足够大的偏移避免负坐标碰撞
    return (cx + 0x4000) * 0x10000 + (cy + 0x4000);
  }

  insert(feature: Feature): void {
    const [minX, minY, maxX, maxY] = boundsOf(feature.geom);
    const x0 = Math.floor(minX / this.cellSize);
    const y0 = Math.floor(minY / this.cellSize);
    const x1 = Math.floor(maxX / this.cellSize);
    const y1 = Math.floor(maxY / this.cellSize);
    let count = 0;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = this.key(cx, cy);
        let bucket = this.cells.get(k);
        if (!bucket) {
          bucket = [];
          this.cells.set(k, bucket);
        }
        bucket.push(feature);
        count++;
      }
    }
    this.featureCellCount.set(feature.id, count);
  }

  static build(features: readonly Feature[], cellSize = 120): SpatialIndex {
    const idx = new SpatialIndex(cellSize);
    for (const f of features) idx.insert(f);
    return idx;
  }

  /** 返回点附近的候选要素（去重），radius 为世界单位 */
  queryPoint(x: number, y: number, radius: number): Feature[] {
    const x0 = Math.floor((x - radius) / this.cellSize);
    const y0 = Math.floor((y - radius) / this.cellSize);
    const x1 = Math.floor((x + radius) / this.cellSize);
    const y1 = Math.floor((y + radius) / this.cellSize);
    const seen = new Set<string>();
    const out: Feature[] = [];
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (!bucket) continue;
        for (const f of bucket) {
          if (!seen.has(f.id)) {
            seen.add(f.id);
            out.push(f);
          }
        }
      }
    }
    return out;
  }

  /** 返回矩形区域内的候选要素（包围盒相交判定） */
  queryRect(minX: number, minY: number, maxX: number, maxY: number): Feature[] {
    const x0 = Math.floor(minX / this.cellSize);
    const y0 = Math.floor(minY / this.cellSize);
    const x1 = Math.floor(maxX / this.cellSize);
    const y1 = Math.floor(maxY / this.cellSize);
    const seen = new Set<string>();
    const out: Feature[] = [];
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (!bucket) continue;
        for (const f of bucket) {
          if (seen.has(f.id)) continue;
          const [fMinX, fMinY, fMaxX, fMaxY] = boundsOf(f.geom);
          if (fMaxX >= minX && fMinX <= maxX && fMaxY >= minY && fMinY <= maxY) {
            seen.add(f.id);
            out.push(f);
          }
        }
      }
    }
    return out;
  }

  get stats(): { cells: number; avgFeatureCells: number; totalFeatures: number } {
    let total = 0;
    this.featureCellCount.forEach((n) => (total += n));
    return {
      cells: this.cells.size,
      totalFeatures: this.featureCellCount.size,
      avgFeatureCells: this.featureCellCount.size ? total / this.featureCellCount.size : 0,
    };
  }
}
