// CPU 体素射线拾取：Amanatides–Woo DDA，返回命中体素格与入射面法线
import { GRID, type Vec3 } from '../core/types';

export interface PickHit {
  /** 命中的已占用体素格坐标 */
  voxel: Vec3;
  /** 入射面法线（轴对齐单位向量） */
  normal: Vec3;
  /** 射线参数 t */
  t: number;
}

const HALF = GRID / 2;

function isOccupiedSet(occupied: Set<string>): (x: number, y: number, z: number) => boolean {
  return (x, y, z) => occupied.has(x + ',' + y + ',' + z);
}

/**
 * 射线 DDA 遍历 128³ 网格，返回第一个命中的占用格。
 * occupied 只包含可拾取（可见）体素。
 */
export function pickVoxel(
  origin: Vec3,
  dir: Vec3,
  layers: { voxels: Map<string, number>; visible: boolean }[],
): PickHit | null {
  const occupied = new Set<string>();
  for (const l of layers) {
    if (!l.visible) continue;
    for (const k of l.voxels.keys()) occupied.add(k);
  }
  return dda(origin, dir, isOccupiedSet(occupied));
}

export function dda(
  origin: Vec3,
  dir: Vec3,
  isOccupied: (x: number, y: number, z: number) => boolean,
): PickHit | null {
  // 1. 判断射线是否穿过网格外盒 [-HALF, HALF]^3，并求遍历起点
  const lo: Vec3 = [-HALF, -HALF, -HALF];
  const hi: Vec3 = [HALF, HALF, HALF];
  const insideBox =
    origin[0] >= lo[0] && origin[0] <= hi[0] &&
    origin[1] >= lo[1] && origin[1] <= hi[1] &&
    origin[2] >= lo[2] && origin[2] <= hi[2];

  let t = 0;
  if (!insideBox) {
    // 标准 slab 求交：逐轴求近/远交点（与方向符号无关地排序）
    let tMin = -Infinity;
    let tMax = Infinity;
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(dir[axis]) < 1e-9) {
        if (origin[axis] < lo[axis] || origin[axis] > hi[axis]) return null;
        continue;
      }
      const tNear = (lo[axis] - origin[axis]) / dir[axis];
      const tFar = (hi[axis] - origin[axis]) / dir[axis];
      const t1 = Math.min(tNear, tFar);
      const t2 = Math.max(tNear, tFar);
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
    }
    if (tMax < Math.max(tMin, 0)) return null;
    t = Math.max(tMin, 0);
  }

  // 起点所在格（盒内时即原点所在格）
  const start: Vec3 = [
    origin[0] + dir[0] * (t + 1e-6),
    origin[1] + dir[1] * (t + 1e-6),
    origin[2] + dir[2] * (t + 1e-6),
  ];
  let x = Math.floor(start[0] + HALF);
  let y = Math.floor(start[1] + HALF);
  let z = Math.floor(start[2] + HALF);

  const stepX = dir[0] > 0 ? 1 : -1;
  const stepY = dir[1] > 0 ? 1 : -1;
  const stepZ = dir[2] > 0 ? 1 : -1;

  // 到前方第一个垂直面的 t 距离（盒内起点时跳过身后的界面）
  const nextBoundary = (cell: number, step: number): number =>
    step > 0 ? cell + 1 - HALF : cell - HALF;
  const tDeltaX = Math.abs(1 / dir[0]);
  const tDeltaY = Math.abs(1 / dir[1]);
  const tDeltaZ = Math.abs(1 / dir[2]);
  const calcTMax = (cell: number, step: number, axis: number): number => {
    if (Math.abs(dir[axis]) < 1e-9) return Infinity;
    let v = (nextBoundary(cell, step) - origin[axis]) / dir[axis];
    // 盒内起点：身后的界面 v 为负，逐格推进到前方第一个
    if (insideBox && v < 0) {
      const n = Math.ceil(-v / Math.abs(1 / dir[axis]));
      v += n * Math.abs(1 / dir[axis]);
    }
    return v;
  };
  let tMaxX = calcTMax(x, stepX, 0);
  let tMaxY = calcTMax(y, stepY, 1);
  let tMaxZ = calcTMax(z, stepZ, 2);

  let normal: Vec3 = [0, 0, 0];
  for (let guard = 0; guard < GRID * GRID * 3; guard++) {
    if (x < 0 || x >= GRID || y < 0 || y >= GRID || z < 0 || z >= GRID) return null;
    if (isOccupied(x, y, z)) {
      return { voxel: [x, y, z], normal: [...normal] as Vec3, t };
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      normal = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      normal = [0, -stepY, 0];
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      normal = [0, 0, -stepZ];
    }
  }
  return null;
}

/**
 * 空网格落点：沿射线走到第一个未占用格（用于在空场景下笔刷仍可落子）。
 * 取射线与网格外盒入射点所在格；若被占则沿射线继续 DDA 直到空格。
 */
export function pickEmptyCell(
  origin: Vec3,
  dir: Vec3,
  isOccupied: (x: number, y: number, z: number) => boolean,
): { voxel: Vec3; normal: Vec3 } | null {
  const hit = dda(origin, dir, isOccupied);
  if (hit) {
    // 命中体素沿法线外推一格 = 放置位
    const v: Vec3 = [
      hit.voxel[0] + hit.normal[0],
      hit.voxel[1] + hit.normal[1],
      hit.voxel[2] + hit.normal[2],
    ];
    if (v[0] < 0 || v[0] >= GRID || v[1] < 0 || v[1] >= GRID || v[2] < 0 || v[2] >= GRID) return null;
    return { voxel: v, normal: hit.normal };
  }
  // 完全没命中：落在网格盒入射面的格子上
  const lo: Vec3 = [-HALF, -HALF, -HALF];
  const hi: Vec3 = [HALF, HALF, HALF];
  let tMin = Infinity;
  let n: Vec3 = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(dir[axis]) < 1e-9) continue;
    for (const [bound, sgn] of [[lo[axis], -1], [hi[axis], 1]] as Array<[number, number]>) {
      const tt = (bound - origin[axis]) / dir[axis];
      if (tt >= 0 && tt < tMin) {
        tMin = tt;
        n = [0, 0, 0];
        n[axis] = sgn;
      }
    }
  }
  if (!isFinite(tMin)) return null;
  const p: Vec3 = [
    origin[0] + dir[0] * tMin,
    origin[1] + dir[1] * tMin,
    origin[2] + dir[2] * tMin,
  ];
  const cell: Vec3 = [
    Math.floor(p[0] + HALF),
    Math.floor(p[1] + HALF),
    Math.floor(p[2] + HALF),
  ];  if (cell.some((c: number) => c < 0 || c >= GRID)) return null;
  return { voxel: cell, normal: n };
}
