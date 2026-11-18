import type { VoxelGrid } from './grid';

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  faceCount: number;
}

// 6 个面:法线 + 4 个顶点(逆时针,从外侧看)
const FACES: { n: [number, number, number]; v: [number, number, number][] }[] = [
  { n: [1, 0, 0],  v: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]] },
  { n: [-1, 0, 0], v: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]] },
  { n: [0, 1, 0],  v: [[0,1,0],[0,1,1],[1,1,1],[1,1,0]] },
  { n: [0, -1, 0], v: [[0,0,1],[0,0,0],[1,0,0],[1,0,1]] },
  { n: [0, 0, 1],  v: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]] },
  { n: [0, 0, -1], v: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]] },
];

function hash01(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * 面剔除网格化:只为暴露面生成几何体。
 * zMin/zMax 用于 Z 层切片显示(含端点)。
 */
export function buildMesh(grid: VoxelGrid, zMin = 0, zMax = grid.size - 1): MeshData {
  const s = grid.size;
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], idx: number[] = [];
  // 小天体配色:按高度在深灰褐到浅岩色间渐变,加少量体素级抖动
  const c0 = [0.32, 0.27, 0.23], c1 = [0.72, 0.66, 0.58];
  for (let z = zMin; z <= zMax; z++) {
    const t = z / (s - 1);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      if (!grid.get(x, y, z)) continue;
      const jitter = (hash01(x, y, z) - 0.5) * 0.1;
      const r = Math.min(1, Math.max(0, c0[0] + (c1[0] - c0[0]) * t + jitter));
      const g = Math.min(1, Math.max(0, c0[1] + (c1[1] - c0[1]) * t + jitter));
      const b = Math.min(1, Math.max(0, c0[2] + (c1[2] - c0[2]) * t + jitter));
      for (const f of FACES) {
        const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2];
        // 切片边界处也生成面,方便观察截面
        if (grid.get(nx, ny, nz) && nz >= zMin && nz <= zMax) continue;
        const base = pos.length / 3;
        for (const v of f.v) {
          pos.push(x + v[0], y + v[1], z + v[2]);
          nrm.push(f.n[0], f.n[1], f.n[2]);
          col.push(r, g, b);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
  }
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nrm),
    colors: new Float32Array(col),
    indices: new Uint32Array(idx),
    faceCount: idx.length / 3,
  };
}
