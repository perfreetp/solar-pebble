// 编辑操作：框选收集、剪贴板、绕轴阵列、多层合并
import { GRID, inGrid, keyOf, parseKey, type Layer, type Project, type Vec3 } from './types';
import type { HistoryEntry } from './store';

export interface Bounds {
  min: Vec3;
  max: Vec3; // 含端点
}

export interface ClipboardData {
  /** layerId -> (本地相对坐标 key -> 颜色) */
  layers: Map<string, Map<string, number>>;
  size: Vec3; // 选区尺寸
  anchor: Vec3; // 原选区最小角（世界体素坐标）
}

export function normalizeBounds(a: Vec3, b: Vec3): Bounds {
  return {
    min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
  };
}

export function forEachInBounds(bounds: Bounds, fn: (x: number, y: number, z: number) => void): void {
  for (let x = bounds.min[0]; x <= bounds.max[0]; x++) {
    for (let y = bounds.min[1]; y <= bounds.max[1]; y++) {
      for (let z = bounds.min[2]; z <= bounds.max[2]; z++) {
        fn(x, y, z);
      }
    }
  }
}

/** 收集选区内各层体素（返回深拷贝，可直接进剪贴板/历史） */
export function collectSelection(layers: Layer[], bounds: Bounds): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const layer of layers) {
    const picked = new Map<string, number>();
    forEachInBounds(bounds, (x, y, z) => {
      const k = keyOf(x, y, z);
      const c = layer.voxels.get(k);
      if (c !== undefined) picked.set(k, c);
    });
    if (picked.size) out.set(layer.id, picked);
  }
  return out;
}

export function copyToClipboard(layers: Layer[], bounds: Bounds): ClipboardData {
  const picked = collectSelection(layers, bounds);
  // 转成相对坐标，便于平移粘贴
  const local = new Map<string, Map<string, number>>();
  for (const [layerId, cells] of picked) {
    const m = new Map<string, number>();
    for (const [k, color] of cells) {
      const [x, y, z] = parseKey(k);
      m.set(
        keyOf(x - bounds.min[0], y - bounds.min[1], z - bounds.min[2]),
        color,
      );
    }
    local.set(layerId, m);
  }
  return {
    layers: local,
    size: [
      bounds.max[0] - bounds.min[0] + 1,
      bounds.max[1] - bounds.min[1] + 1,
      bounds.max[2] - bounds.min[2] + 1,
    ],
    anchor: [...bounds.min] as Vec3,
  };
}

export interface PasteResult {
  placed: number;
  blocked: number;
}

/**
 * 把剪贴板贴到 anchor（新的最小角）。occupied 为当前全局占用集合，用于防重叠。
 * 返回可回滚的 placed 记录：{layerId, key, color}
 */
export function pasteClipboard(
  layers: Layer[],
  clip: ClipboardData,
  anchor: Vec3,
  occupied: Set<string>,
): { result: PasteResult; records: Array<{ layerId: string; key: string; color: number }> } {
  const layerById = new Map(layers.map((l) => [l.id, l]));
  const records: Array<{ layerId: string; key: string; color: number }> = [];
  let blocked = 0;
  for (const [layerId, cells] of clip.layers) {
    const layer = layerById.get(layerId);
    if (!layer) continue;
    for (const [localKey, color] of cells) {
      const [lx, ly, lz] = parseKey(localKey);
      const x = anchor[0] + lx, y = anchor[1] + ly, z = anchor[2] + lz;
      if (!inGrid(x, y, z)) { blocked++; continue; }
      const k = keyOf(x, y, z);
      if (occupied.has(k) || layer.voxels.has(k)) { blocked++; continue; }
      layer.voxels.set(k, color);
      occupied.add(k);
      records.push({ layerId, key: k, color });
    }
  }
  return { result: { placed: records.length, blocked }, records };
}

export function deleteCells(
  layers: Layer[],
  picked: Map<string, Map<string, number>>,
): Array<{ layerId: string; key: string; color: number }> {
  const removed: Array<{ layerId: string; key: string; color: number }> = [];
  const layerById = new Map(layers.map((l) => [l.id, l]));
  for (const [layerId, cells] of picked) {
    const layer = layerById.get(layerId);
    if (!layer) continue;
    for (const [k, color] of cells) {
      if (layer.voxels.delete(k)) removed.push({ layerId, key: k, color });
    }
  }
  return removed;
}

export function restoreCells(
  layers: Layer[],
  records: Array<{ layerId: string; key: string; color: number }>,
): void {
  const layerById = new Map(layers.map((l) => [l.id, l]));
  for (const r of records) {
    layerById.get(r.layerId)?.voxels.set(r.key, r.color);
  }
}

/**
 * 把一层体素绕 Y 轴阵列成 count 枚（默认四枚，90° 等分）。
 * 旋转中心为 (cx, cz) 号体素中心连成的 Y 轴，整数格旋转不产生亚体素偏移。
 */
export function radialArrayY(
  layer: Layer,
  count = 4,
  center: Vec3 = [GRID / 2 - 1, 0, GRID / 2 - 1],
): { added: number; blocked: number; records: Array<{ key: string; color: number }> } {
  const [cx, , cz] = center;
  const records: Array<{ key: string; color: number }> = [];
  const snapshot = [...layer.voxels.entries()];
  let blocked = 0;
  for (const [key, color] of snapshot) {
    const [x, y, z] = parseKey(key);
    const dx = x - cx;
    const dz = z - cz;
    for (let k = 1; k < count; k++) {
      // 90° 整数旋转：(dx,dz) -> 按 k 次旋转
      let rx = dx, rz = dz;
      for (let s = 0; s < k; s++) {
        const nx = -rz;
        const nz = rx;
        rx = nx; rz = nz;
      }
      const nx = cx + rx;
      const nz = cz + rz;
      if (!inGrid(nx, y, nz)) { blocked++; continue; }
      const nk = keyOf(nx, y, nz);
      if (layer.voxels.has(nk)) { blocked++; continue; }
      layer.voxels.set(nk, color);
      records.push({ key: nk, color });
    }
  }
  return { added: records.length, blocked, records };
}

/** 多层合并：合并进 target 层，冲突时 target 优先；返回可撤销的历史条目 */
export function mergeLayers(project: Project, layerIds: string[], targetId: string): HistoryEntry {
  const target = project.layers.find((l) => l.id === targetId)!;
  const victims = project.layers.filter((l) => layerIds.includes(l.id) && l.id !== targetId);
  // 备份被删层与 target 中被覆盖的格
  const backup = victims.map((l) => ({
    id: l.id, name: l.name, group: l.group, visible: l.visible, locked: l.locked,
    voxels: new Map(l.voxels),
  }));
  for (const v of victims) {
    for (const [k, color] of v.voxels) {
      if (!target.voxels.has(k)) target.voxels.set(k, color);
    }
  }
  const victimIds = new Set(victims.map((v) => v.id));
  project.layers = project.layers.filter((l) => !victimIds.has(l.id));
  if (project.activeLayerId !== target.id) project.activeLayerId = target.id;

  return {
    label: `合并 ${victims.length + 1} 个层`,
    undo: () => {
      for (const b of backup) {
        const restored: Layer = {
          id: b.id, name: b.name, group: b.group,
          visible: b.visible, locked: b.locked, voxels: new Map(b.voxels),
        };
        project.layers.push(restored);
        for (const k of b.voxels.keys()) target.voxels.delete(k);
      }
      project.activeLayerId = target.id;
    },
    redo: () => {
      const ids = new Set(backup.map((b) => b.id));
      project.layers = project.layers.filter((l) => !ids.has(l.id));
      for (const b of backup) {
        for (const [k, color] of b.voxels) {
          if (!target.voxels.has(k)) target.voxels.set(k, color);
        }
      }
      project.activeLayerId = target.id;
    },
  };
}
