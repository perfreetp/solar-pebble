// 体素层与体素增删操作（含镜像语义）
import {
  GRID,
  keyOf,
  mirrorX,
  inGrid,
  uid,
  type Layer,
  type LayerGroup,
  type Vec3,
} from './types';

export interface VoxelEdit {
  pos: Vec3;
  color: number;
}

export class VoxelModel {
  layers: Layer[] = [];

  static createLayer(name: string, group: LayerGroup): Layer {
    return { id: uid('lay'), name, group, visible: true, locked: false, voxels: new Map() };
  }

  getLayer(id: string): Layer | undefined {
    return this.layers.find((l) => l.id === id);
  }

  /** 任意可见层中该格是否已有体素（用于放置时防重叠） */
  occupiedAt(x: number, y: number, z: number): boolean {
    const k = keyOf(x, y, z);
    for (const l of this.layers) {
      if (l.visible && l.voxels.has(k)) return true;
    }
    return false;
  }

  findOwner(x: number, y: number, z: number): Layer | undefined {
    const k = keyOf(x, y, z);
    return this.layers.find((l) => l.voxels.has(k));
  }

  totalVoxels(): number {
    let n = 0;
    for (const l of this.layers) n += l.voxels.size;
    return n;
  }

  /**
   * 放置体素。mirror=true 时镜像到对侧；压在对称面（x===MIRROR_PLANE）上只落一次。
   * 不与已有体素重叠（返回实际落子列表，空数组表示全部被挡住）。
   */
  place(
    layer: Layer,
    x: number,
    y: number,
    z: number,
    color: number,
    mirror: boolean,
  ): VoxelEdit[] {
    const targets: Vec3[] = [[x, y, z]];
    if (mirror) {
      const mx = mirrorX(x);
      if (mx !== x) targets.push([mx, y, z]); // 对称面上 x===mx，去重，只落一次
    }
    const placed: VoxelEdit[] = [];
    for (const [tx, ty, tz] of targets) {
      if (!inGrid(tx, ty, tz)) continue;
      if (this.occupiedAt(tx, ty, tz)) continue; // 不与已有体素重叠
      const k = keyOf(tx, ty, tz);
      layer.voxels.set(k, color);
      placed.push({ pos: [tx, ty, tz], color });
    }
    return placed;
  }

  /** 擦除。镜像开启时对侧同步删除（不限层，删到谁是谁；主要落在当前层） */
  erase(x: number, y: number, z: number, mirror: boolean): VoxelEdit[] {
    const targets: Vec3[] = [[x, y, z]];
    if (mirror) {
      const mx = mirrorX(x);
      if (mx !== x) targets.push([mx, y, z]);
    }
    const removed: VoxelEdit[] = [];
    for (const [tx, ty, tz] of targets) {
      if (!inGrid(tx, ty, tz)) continue;
      const owner = this.findOwner(tx, ty, tz);
      if (!owner) continue;
      const k = keyOf(tx, ty, tz);
      const color = owner.voxels.get(k)!;
      owner.voxels.delete(k);
      removed.push({ pos: [tx, ty, tz], color });
    }
    return removed;
  }

  /** 换色：修改当前层（或指定层）该格颜色，镜像同步 */
  recolor(layer: Layer, x: number, y: number, z: number, color: number, mirror: boolean): VoxelEdit[] {
    const xs = mirror && mirrorX(x) !== x ? [x, mirrorX(x)] : [x];
    const out: VoxelEdit[] = [];
    for (const tx of xs) {
      const k = keyOf(tx, y, z);
      if (layer.voxels.has(k)) {
        layer.voxels.set(k, color);
        out.push({ pos: [tx, y, z], color });
      }
    }
    return out;
  }
}

/** 网格坐标（0..127）→ 世界坐标，体素边长 1，网格居中于原点 */
export function voxelToWorld(x: number, y: number, z: number): Vec3 {
  const half = GRID / 2;
  return [x - half + 0.5, y - half + 0.5, z - half + 0.5];
}

/** 世界坐标 → 所在体素格坐标 */
export function worldToVoxel(p: Vec3): Vec3 {
  const half = GRID / 2;
  return [
    Math.floor(p[0] + half),
    Math.floor(p[1] + half),
    Math.floor(p[2] + half),
  ];
}
