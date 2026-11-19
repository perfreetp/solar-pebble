// 体素 → 多边形网格：相邻面剔除 + 贪心减面（同色共面合并）
import { GRID, keyOf, parseKey, unpackColor, type Layer } from './types';

export interface MeshGeometry {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  /** 实例化用：每个体素一格（拾取 / 渲染实例） */
  instances: VoxelInstance[];
  voxelCount: number;
  /** 仅做相邻面剔除后的四边面数量（减面前） */
  culledFaceCount: number;
  /** 贪心合并后的矩形面数量（减面后） */
  mergedFaceCount: number;
  vertexCount: number;
  triangleCount: number;
}

export interface VoxelInstance {
  x: number;
  y: number;
  z: number;
  color: number;
}

interface OccupiedCell {
  color: number;
}

const DIMS = [GRID, GRID, GRID];

/** 汇总若干层为并集体素（同格冲突时先出现的层优先） */
function buildOccupancy(layers: Layer[]): Map<string, OccupiedCell> {
  const map = new Map<string, OccupiedCell>();
  for (const layer of layers) {
    for (const [key, color] of layer.voxels) {
      if (!map.has(key)) map.set(key, { color });
    }
  }
  return map;
}

/**
 * 贪心网格合并（greedy meshing）：
 * 逐轴扫描切片，把同色、共面的相邻四边形合并成大矩形，每个矩形 2 个三角形。
 */
export function buildMesh(layers: Layer[]): MeshGeometry {
  const occupied = buildOccupancy(layers);
  const get = (x: number, y: number, z: number): OccupiedCell | undefined =>
    occupied.get(keyOf(x, y, z));

  const instances: VoxelInstance[] = [];
  for (const [key, cell] of occupied) {
    const [x, y, z] = parseKey(key);
    instances.push({ x, y, z, color: cell.color });
  }

  // 减面前的四边面统计（6 邻域剔除）
  let culledFaces = 0;
  const neighbor = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  for (const [key, cell] of occupied) {
    const [x, y, z] = parseKey(key);
    for (const [dx, dy, dz] of neighbor) {
      const n = get(x + dx, y + dy, z + dz);
      if (!n) culledFaces++;
      else void cell;
    }
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let mergedFaces = 0;
  const OFFSET = GRID / 2; // 网格居中

  const face = (
    corners: number[][],
    normal: number[],
    color: number,
  ): void => {
    const base = positions.length / 3;
    const c = unpackColor(color);
    for (const p of corners) {
      positions.push(p[0] - OFFSET, p[1] - OFFSET, p[2] - OFFSET);
      normals.push(normal[0], normal[1], normal[2]);
      colors.push(c.r / 255, c.g / 255, c.b / 255);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    mergedFaces++;
  };

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const du = DIMS[u];
    const dv = DIMS[v];
    const dd = DIMS[d];
    // mask: 0 = 无面；正数 = 朝 +d 方向的面（颜色 key+1）；负数 = 朝 -d 方向
    const mask = new Int32Array(du * dv);
    const x = [0, 0, 0];

    for (let slice = -1; slice < dd; slice++) {
      // 1. 构造本切片掩码
      for (let vi = 0; vi < dv; vi++) {
        for (let ui = 0; ui < du; ui++) {
          x[d] = slice; x[u] = ui; x[v] = vi;
          const a = x[d] >= 0 ? get(x[0], x[1], x[2]) : undefined;
          x[d] = slice + 1;
          const b = x[d] < dd ? get(x[0], x[1], x[2]) : undefined;
          let m = 0;
          if (a && !b) m = a.color + 1;
          else if (!a && b) m = -(b.color + 1);
          mask[vi * du + ui] = m;
        }
      }

      // 2. 贪心合并矩形
      let vi = 0;
      while (vi < dv) {
        let ui = 0;
        while (ui < du) {
          const m = mask[vi * du + ui];
          if (!m) { ui++; continue; }
          // 沿 u 扩展宽度
          let w = 1;
          while (ui + w < du && mask[vi * du + ui + w] === m) w++;
          // 沿 v 扩展高度
          let h = 1;
          outer: while (vi + h < dv) {
            for (let k = 0; k < w; k++) {
              if (mask[(vi + h) * du + ui + k] !== m) break outer;
            }
            h++;
          }
          // 输出矩形（坐标为网格局部 0..128）
          const color = Math.abs(m) - 1;
          const sign = m > 0 ? 1 : -1;
          const p0 = [0, 0, 0], p1 = [0, 0, 0], p2 = [0, 0, 0], p3 = [0, 0, 0];
          const d0 = sign > 0 ? slice + 1 : slice;
          p0[d] = d0; p0[u] = ui; p0[v] = vi;
          p1[d] = d0; p1[u] = ui + w; p1[v] = vi;
          p2[d] = d0; p2[u] = ui + w; p2[v] = vi + h;
          p3[d] = d0; p3[u] = ui; p3[v] = vi + h;
          const n = [0, 0, 0];
          n[d] = sign;
          // 朝 -d 的面翻转绕序，保证正面朝外
          if (sign > 0) face([p0, p1, p2, p3], n, color);
          else face([p0, p3, p2, p1], n, color);

          for (let l = 0; l < h; l++) {
            for (let k = 0; k < w; k++) mask[(vi + l) * du + ui + k] = 0;
          }
          ui += w;
        }
        vi++;
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
    instances,
    voxelCount: occupied.size,
    culledFaceCount: culledFaces,
    mergedFaceCount: mergedFaces,
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
  };
}

/** 仅统计（用于导出前弹窗），不保留几何数据 */
export function meshStats(layers: Layer[]): {
  voxelCount: number;
  culledFaceCount: number;
  mergedFaceCount: number;
  vertexCount: number;
  triangleCount: number;
} {
  const geo = buildMesh(layers);
  return {
    voxelCount: geo.voxelCount,
    culledFaceCount: geo.culledFaceCount,
    mergedFaceCount: geo.mergedFaceCount,
    vertexCount: geo.vertexCount,
    triangleCount: geo.triangleCount,
  };
}
