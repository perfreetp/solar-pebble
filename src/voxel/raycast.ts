import type { VoxelGrid } from './grid';

export interface RayHit {
  voxel: [number, number, number];   // 命中的实心体素
  normal: [number, number, number];  // 命中面的法线(即放置相邻体素的方向)
  dist: number;
}

/**
 * Amanatides & Woo DDA 体素遍历。
 * zMin/zMax 限定可命中的 Z 层范围(与切片显示一致)。
 */
export function raycastGrid(
  grid: VoxelGrid,
  ro: [number, number, number],
  rd: [number, number, number],
  zMin = 0,
  zMax = grid.size - 1,
): RayHit | null {
  let x = Math.floor(ro[0]), y = Math.floor(ro[1]), z = Math.floor(ro[2]);
  const stepX = rd[0] > 0 ? 1 : -1, stepY = rd[1] > 0 ? 1 : -1, stepZ = rd[2] > 0 ? 1 : -1;
  const tDeltaX = rd[0] !== 0 ? Math.abs(1 / rd[0]) : Infinity;
  const tDeltaY = rd[1] !== 0 ? Math.abs(1 / rd[1]) : Infinity;
  const tDeltaZ = rd[2] !== 0 ? Math.abs(1 / rd[2]) : Infinity;
  const boundary = (p: number, cell: number, step: number) => (step > 0 ? cell + 1 - p : cell - p);
  let tMaxX = rd[0] !== 0 ? boundary(ro[0], x, stepX) * tDeltaX : Infinity;
  let tMaxY = rd[1] !== 0 ? boundary(ro[1], y, stepY) * tDeltaY : Infinity;
  let tMaxZ = rd[2] !== 0 ? boundary(ro[2], z, stepZ) * tDeltaZ : Infinity;

  let nx = 0, ny = 0, nz = 0;
  let t = 0;
  const maxT = grid.size * 4;
  for (let i = 0; i < 1024 && t < maxT; i++) {
    if (z >= zMin && z <= zMax && grid.get(x, y, z)) {
      return { voxel: [x, y, z], normal: [nx, ny, nz], dist: t };
    }
    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY <= tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
    }
    // 远远离开网格包围盒即可终止
    const s = grid.size;
    if ((x < -1 || x > s) && (y < -1 || y > s) && (z < -1 || z > s)) break;
  }
  return null;
}

/** 射线与水平面 z = planeZ 求交,返回命中点 */
export function rayPlaneZ(
  ro: [number, number, number],
  rd: [number, number, number],
  planeZ: number,
): [number, number, number] | null {
  if (Math.abs(rd[2]) < 1e-8) return null;
  const t = (planeZ - ro[2]) / rd[2];
  if (t < 0) return null;
  return [ro[0] + rd[0] * t, ro[1] + rd[1] * t, planeZ];
}
