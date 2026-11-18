import type { VoxelGrid } from './grid';

/** 编辑器注入的应用函数:负责越界检查、Z层限制与镜像同步 */
export type ApplyFn = (x: number, y: number, z: number, v: 0 | 1) => void;

/** 确定性整数哈希 → [0,1) */
function hash01(x: number, y: number, z: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2246822519 + seed * 3266489917) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** 球化笔刷:以点击点为球心填充/挖除球体。挖除模式可造陨石坑。 */
export function brushSphere(
  grid: VoxelGrid, cx: number, cy: number, cz: number,
  radius: number, mode: 'add' | 'remove', apply: ApplyFn,
): void {
  const r = Math.max(1, radius);
  const r2 = r * r;
  const v = (mode === 'add' ? 1 : 0) as 0 | 1;
  for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++)
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy, dz = z + 0.5 - cz;
        if (dx * dx + dy * dy + dz * dz <= r2) apply(x, y, z, v);
      }
}

/**
 * 压平笔刷:半径圆柱范围内,把表面压到 targetZ 高度。
 * 高于 targetZ 的体素删除,低于的补齐,用于整平着陆区/台地。
 */
export function brushFlatten(
  grid: VoxelGrid, cx: number, cy: number, _cz: number,
  radius: number, targetZ: number, apply: ApplyFn,
): void {
  const r = Math.max(1, radius);
  const tz = Math.max(0, Math.min(grid.size - 1, Math.round(targetZ)));
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > r * r) continue;
      // 找该柱最高实心体素
      let top = -1;
      for (let z = grid.size - 1; z >= 0; z--) {
        if (grid.get(x, y, z)) { top = z; break; }
      }
      if (top < 0) continue;
      if (top > tz) {
        for (let z = tz + 1; z <= top; z++) apply(x, y, z, 0);
      } else if (top < tz) {
        for (let z = top + 1; z <= tz; z++) apply(x, y, z, 1);
      }
    }
}

/**
 * 随机凹凸笔刷:在球域内按确定性噪声增删表面体素,
 * 凹陷处成陨石坑缘,凸起处成碎石堆。strength ∈ (0,1]。
 */
export function brushNoise(
  grid: VoxelGrid, cx: number, cy: number, cz: number,
  radius: number, strength: number, seed: number, apply: ApplyFn,
): void {
  const r = Math.max(1, radius);
  const r2 = r * r;
  const s = Math.max(0.05, Math.min(1, strength));
  for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++)
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy, dz = z + 0.5 - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) continue;
        const falloff = 1 - Math.sqrt(d2) / r; // 中心强边缘弱
        const h = hash01(x, y, z, seed);
        const cur = grid.get(x, y, z);
        if (cur === 1) {
          // 仅侵蚀暴露表面,形成凹坑
          const exposed = !grid.get(x+1,y,z) || !grid.get(x-1,y,z) || !grid.get(x,y+1,z) ||
                          !grid.get(x,y-1,z) || !grid.get(x,y,z+1) || !grid.get(x,y,z-1);
          if (exposed && h < s * 0.55 * falloff) apply(x, y, z, 0);
        } else {
          // 仅在已有表面旁堆积,形成碎石
          const nearSolid = !!(grid.get(x+1,y,z) || grid.get(x-1,y,z) || grid.get(x,y+1,z) ||
                               grid.get(x,y-1,z) || grid.get(x,y,z+1) || grid.get(x,y,z-1));
          if (nearSolid && h < s * 0.4 * falloff) apply(x, y, z, 1);
        }
      }
}
