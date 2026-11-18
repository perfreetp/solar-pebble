import type { VoxelGrid } from './grid';
import type { ApplyFn } from './brushes';

/** 框选区域(含端点) */
export interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

export function normalizeBox(a: [number, number, number], b: [number, number, number]): Box {
  return {
    min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
  };
}

export interface Clipboard {
  dims: [number, number, number];
  data: Uint8Array; // 按 (z,y,x) 排布的 0/1
}

export function boxCopy(grid: VoxelGrid, box: Box): Clipboard {
  const dx = box.max[0] - box.min[0] + 1;
  const dy = box.max[1] - box.min[1] + 1;
  const dz = box.max[2] - box.min[2] + 1;
  const data = new Uint8Array(dx * dy * dz);
  for (let z = 0; z < dz; z++)
    for (let y = 0; y < dy; y++)
      for (let x = 0; x < dx; x++)
        data[(z * dy + y) * dx + x] = grid.get(box.min[0] + x, box.min[1] + y, box.min[2] + z);
  return { dims: [dx, dy, dz], data };
}

/** 在 at(粘贴左下后角)处放置剪贴板内容 */
export function boxPaste(clip: Clipboard, at: [number, number, number], apply: ApplyFn): void {
  const [dx, dy, dz] = clip.dims;
  for (let z = 0; z < dz; z++)
    for (let y = 0; y < dy; y++)
      for (let x = 0; x < dx; x++) {
        if (clip.data[(z * dy + y) * dx + x]) apply(at[0] + x, at[1] + y, at[2] + z, 1);
      }
}

export function boxClear(grid: VoxelGrid, box: Box, apply: ApplyFn): void {
  for (let z = box.min[2]; z <= box.max[2]; z++)
    for (let y = box.min[1]; y <= box.max[1]; y++)
      for (let x = box.min[0]; x <= box.max[0]; x++)
        if (grid.get(x, y, z)) apply(x, y, z, 0);
}

/** 平移选区:复制 → 清空原区域 → 按 delta 粘贴(越界部分自动裁剪) */
export function boxTranslate(grid: VoxelGrid, box: Box, delta: [number, number, number], apply: ApplyFn): void {
  const clip = boxCopy(grid, box);
  boxClear(grid, box, apply);
  boxPaste(clip, [box.min[0] + delta[0], box.min[1] + delta[1], box.min[2] + delta[2]], apply);
}
