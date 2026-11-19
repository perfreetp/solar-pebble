import { createSignal, createMemo } from 'solid-js';
import type { LayerId, VoxelCoord, VoxelMap } from '../types';
import {
  LAYER_IDS,
  NEIGHBORS,
  createInitialTerrain,
  keyOf,
  layerAtHeight,
  parseKey,
} from './constants';

export type ToolId = 'add' | 'erase' | 'select' | 'paste';

export interface ClipboardVoxel {
  coord: VoxelCoord; // 相对坐标(以框选最小角为原点)
  layer: LayerId;
}

const STORAGE_KEY = 'crater-voxel-model-v1';

function loadInitial(): VoxelMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as Array<[string, LayerId]>;
      return new Map(arr);
    }
  } catch {
    /* 忽略损坏存档 */
  }
  return createInitialTerrain();
}

const voxels = loadInitial();
const [version, setVersion] = createSignal(0);
const [activeLayer, setActiveLayer] = createSignal<LayerId>('topsoil');
const [mirrorEnabled, setMirrorEnabled] = createSignal(false);
const [tool, setTool] = createSignal<ToolId>('add');
const [visible, setVisible] = createSignal<Record<LayerId, boolean>>({
  topsoil: true,
  ejecta: true,
  bedrock: true,
});
const [locked, setLocked] = createSignal<Record<LayerId, boolean>>({
  topsoil: false,
  ejecta: false,
  bedrock: false,
});
const [selection, setSelection] = createSignal<string[]>([]);
const [highlightKeys, setHighlightKeys] = createSignal<string[]>([]);
const [clipboard, setClipboard] = createSignal<ClipboardVoxel[] | null>(null);
const [meshView, setMeshView] = createSignal(false);
const [simplifyRatio, setSimplifyRatio] = createSignal(0.35);
const [lastReduction, setLastReduction] = createSignal<{
  before: number;
  after: number;
  greedy: number;
  ratio: number;
  collapsed: boolean;
} | null>(null);

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...voxels.entries()]));
    } catch {
      /* 存储满等情况静默处理 */
    }
  }, 400);
}

function bump() {
  setVersion((v) => v + 1);
  persist();
}

function isEditable(layer: LayerId): boolean {
  return visible()[layer] && !locked()[layer];
}

/** 写一个体素;镜像开启时自动在对称侧写同层体素 */
function putVoxel(x: number, y: number, z: number, layer: LayerId) {
  voxels.set(keyOf(x, y, z), layer);
  if (mirrorEnabled()) {
    voxels.set(keyOf(-x, y, z), layer);
  }
}

function removeVoxel(x: number, y: number, z: number) {
  voxels.delete(keyOf(x, y, z));
  if (mirrorEnabled()) {
    voxels.delete(keyOf(-x, y, z));
  }
}

/** 表面堆积:在命中体素上方一格落位,落到锁定/隐藏层的操作被拒绝 */
function stackOn(coord: VoxelCoord): boolean {
  if (!isEditable(activeLayer())) return false;
  const target: VoxelCoord = { x: coord.x, y: coord.y + 1, z: coord.z };
  if (voxels.has(keyOf(target.x, target.y, target.z))) return false;
  putVoxel(target.x, target.y, target.z, activeLayer());
  bump();
  return true;
}

function eraseAt(coord: VoxelCoord): boolean {
  const k = keyOf(coord.x, coord.y, coord.z);
  const layer = voxels.get(k);
  if (!layer || !isEditable(layer)) return false;
  removeVoxel(coord.x, coord.y, coord.z);
  bump();
  return true;
}

/** 框选:轴对齐范围内、属于可见层的体素 */
function selectBox(min: VoxelCoord, max: VoxelCoord) {
  const keys: string[] = [];
  for (let x = min.x; x <= max.x; x++) {
    for (let y = min.y; y <= max.y; y++) {
      for (let z = min.z; z <= max.z; z++) {
        const k = keyOf(x, y, z);
        const layer = voxels.get(k);
        if (layer && visible()[layer]) keys.push(k);
      }
    }
  }
  setSelection(keys);
  return keys.length;
}

function clearSelection() {
  setSelection([]);
}

/** 复制选区到剪贴板(相对坐标,携带层信息) */
function copySelection() {
  const sel = selection();
  if (sel.length === 0) return 0;
  const coords = sel.map(parseKey);
  const minX = Math.min(...coords.map((c) => c.x));
  const minY = Math.min(...coords.map((c) => c.y));
  const minZ = Math.min(...coords.map((c) => c.z));
  const data: ClipboardVoxel[] = coords.map((c) => ({
    coord: { x: c.x - minX, y: c.y - minY, z: c.z - minZ },
    layer: voxels.get(keyOf(c.x, c.y, c.z))!,
  }));
  setClipboard(data);
  return data.length;
}

export interface PasteResult {
  placed: number;
  skipped: number;
}

/**
 * 粘贴:以落点体素为锚,按落点表面法线对剪贴板内容做轴对齐转向,
 * 使内容包围盒贴在命中表面的外侧一格。
 * 镜像开启时粘贴内容同样做对称复制。
 */
function pasteAt(anchor: VoxelCoord, normal: { x: number; y: number; z: number }): PasteResult {
  const data = clipboard();
  if (!data || data.length === 0) return { placed: 0, skipped: 0 };

  // 法线主导轴
  const ax = Math.abs(normal.x);
  const ay = Math.abs(normal.y);
  const az = Math.abs(normal.z);
  const axis: 'x' | 'y' | 'z' =
    ay >= ax && ay >= az ? 'y' : ax >= az ? 'x' : 'z';
  const sign = Math.sign(normal[axis]) || 1;

  // 轴对齐转向:把剪贴板局部 (lx,ly,lz) 映射到世界体素坐标,
  // 内容沿法线方向立在表面外侧
  function orient(c: VoxelCoord): VoxelCoord {
    if (axis === 'y') {
      // 顶面/底面:保持平面方向,整体上抬(下压)一个体素厚度
      return {
        x: anchor.x + c.x,
        y: anchor.y + sign * (c.y + (sign > 0 ? 1 : 0)),
        z: anchor.z + c.z,
      };
    }
    if (axis === 'x') {
      // 侧面(法线沿 x):剪贴板 y 轴 → 世界 x 方向,x 轴 → 世界 y 方向
      return {
        x: anchor.x + sign * (c.y + (sign > 0 ? 1 : 0)),
        y: anchor.y + c.x,
        z: anchor.z + c.z,
      };
    }
    // 侧面(法线沿 z):剪贴板 y 轴 → 世界 z 方向,z 轴 → 世界 y 方向
    return {
      x: anchor.x + c.x,
      y: anchor.y + c.z,
      z: anchor.z + sign * (c.y + (sign > 0 ? 1 : 0)),
    };
  }

  let placed = 0;
  let skipped = 0;
  const newEntries: Array<[string, LayerId]> = [];
  for (const item of data) {
    const p = orient(item.coord);
    const k = keyOf(p.x, p.y, p.z);
    if (voxels.has(k)) {
      skipped++;
      continue;
    }
    newEntries.push([k, item.layer]);
    if (mirrorEnabled()) {
      const mk = keyOf(-p.x, p.y, p.z);
      if (!voxels.has(mk)) newEntries.push([mk, item.layer]);
    }
  }
  for (const [k, layer] of newEntries) {
    // 锁定层不允许被粘贴覆盖写入
    if (locked()[layer]) {
      skipped++;
      continue;
    }
    voxels.set(k, layer);
    placed++;
  }
  if (placed > 0) bump();
  return { placed, skipped };
}

export interface ScanFinding {
  isolated: string[];
  floatingFaces: string[];
}

/** 导出前扫描:孤立体素(无任何六邻接)+ 悬空面(顶部暴露且下方无支撑) */
function scanModel(): ScanFinding {
  const isolated: string[] = [];
  const floatingFaces: string[] = [];
  for (const [k] of voxels) {
    const c = parseKey(k);
    let neighborCount = 0;
    for (const [dx, dy, dz] of NEIGHBORS) {
      if (voxels.has(keyOf(c.x + dx, c.y + dy, c.z + dz))) neighborCount++;
    }
    if (neighborCount === 0) isolated.push(k);
    // 悬空面:顶面暴露(上方无体素)且下方也无体素,且不是孤立体素
    const topOpen = !voxels.has(keyOf(c.x, c.y + 1, c.z));
    const bottomOpen = !voxels.has(keyOf(c.x, c.y - 1, c.z));
    if (topOpen && bottomOpen && neighborCount > 0) floatingFaces.push(k);
  }
  setHighlightKeys([...isolated, ...floatingFaces]);
  return { isolated, floatingFaces };
}

function clearHighlight() {
  setHighlightKeys([]);
}

function resetTerrain() {
  voxels.clear();
  for (const [k, v] of createInitialTerrain()) voxels.set(k, v);
  setSelection([]);
  setHighlightKeys([]);
  setMeshView(false);
  setLastReduction(null);
  bump();
}

function stats() {
  let total = 0;
  const perLayer: Record<LayerId, number> = { topsoil: 0, ejecta: 0, bedrock: 0 };
  for (const [, layer] of voxels) {
    total++;
    perLayer[layer]++;
  }
  return { total, perLayer };
}

/** 供网格构建/导出使用的只读快照 */
function snapshot(): Array<{ coord: VoxelCoord; layer: LayerId }> {
  return [...voxels.entries()].map(([k, layer]) => ({ coord: parseKey(k), layer }));
}

const layerCounts = createMemo(() => {
  version();
  return stats().perLayer;
});

const totalCount = createMemo(() => {
  version();
  return stats().total;
});

export const voxelStore = {
  // 状态
  version,
  activeLayer,
  setActiveLayer,
  mirrorEnabled,
  setMirrorEnabled,
  tool,
  setTool,
  visible,
  toggleVisible: (l: LayerId) =>
    setVisible((v) => ({ ...v, [l]: !v[l] })),
  locked,
  toggleLock: (l: LayerId) => setLocked((v) => ({ ...v, [l]: !v[l] })),
  selection,
  highlightKeys,
  clipboard,
  meshView,
  setMeshView,
  simplifyRatio,
  setSimplifyRatio,
  lastReduction,
  setLastReduction,
  layerCounts,
  totalCount,
  LAYER_IDS,
  // 操作
  getVoxel: (x: number, y: number, z: number) => voxels.get(keyOf(x, y, z)),
  has: (k: string) => voxels.has(k),
  stackOn,
  eraseAt,
  selectBox,
  clearSelection,
  copySelection,
  pasteAt,
  scanModel,
  clearHighlight,
  resetTerrain,
  stats,
  snapshot,
  layerAtHeight,
};
