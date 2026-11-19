// 全局类型定义与常量

export const GRID = 128;
/** 镜像对称面所穿过的体素列编号（该列镜像到自身，只落一次） */
export const MIRROR_PLANE = 63;

export type Vec3 = [number, number, number];

export type LayerGroup = 'core' | 'booster' | 'fairing' | 'fin';

export const LAYER_GROUP_LABELS: Record<LayerGroup, string> = {
  core: '芯级',
  booster: '助推器',
  fairing: '整流罩',
  fin: '尾翼',
};

export type ToolMode = 'paint' | 'erase' | 'pick' | 'select';

export type EntryStatus = 'draft' | 'review' | 'approved' | 'delivered' | 'locked';

export const STATUS_LABELS: Record<EntryStatus, string> = {
  draft: '制作中',
  review: '待主管审核',
  approved: '审核通过',
  delivered: '已打包交付',
  locked: '退回上限锁定',
};

export interface Layer {
  id: string;
  name: string;
  group: LayerGroup;
  visible: boolean;
  locked: boolean;
  /** voxel key -> 打包颜色 0xRRGGBB */
  voxels: Map<string, number>;
}

export interface LayerData {
  id: string;
  name: string;
  group: LayerGroup;
  visible: boolean;
  locked: boolean;
  voxels: Record<string, number>;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  owner: string;
  status: EntryStatus;
  /** ISO 日期字符串，截止时间 */
  deadline: string;
  returns: number;
  readonly maxReturns: number;
  createdAt: string;
  updatedAt: string;
  activeLayerId: string;
  layers: Layer[];
}

export interface ProjectData {
  id: string;
  code: string;
  name: string;
  owner: string;
  status: EntryStatus;
  deadline: string;
  returns: number;
  maxReturns: number;
  createdAt: string;
  updatedAt: string;
  activeLayerId: string;
  layers: LayerData[];
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function packColor(r: number, g: number, b: number): number {
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
}

export function unpackColor(c: number): Rgb {
  return { r: (c >> 16) & 255, g: (c >> 8) & 255, b: c & 255 };
}

export function keyOf(x: number, y: number, z: number): string {
  return x + ',' + y + ',' + z;
}

export function parseKey(key: string): Vec3 {
  const p = key.split(',');
  return [Number(p[0]), Number(p[1]), Number(p[2])];
}

/** 对称镜像坐标：平面过 MIRROR_PLANE 号体素中心 */
export function mirrorX(x: number): number {
  return 2 * MIRROR_PLANE - x;
}

export function inGrid(x: number, y: number, z: number): boolean {
  return x >= 0 && x < GRID && y >= 0 && y < GRID && z >= 0 && z < GRID;
}

/** 内置调色板（航天常用涂装色） */
export const PALETTE: number[] = [
  packColor(240, 240, 240), // 涂装白
  packColor(200, 205, 212), // 浅灰
  packColor(120, 128, 138), // 深灰
  packColor(28, 42, 72), // 深蓝
  packColor(32, 96, 168), // 科技蓝
  packColor(196, 42, 38), // 中国红
  packColor(224, 168, 58), // 警示金
  packColor(36, 132, 96), // 绿色
  packColor(24, 24, 28), // 黑
  packColor(232, 120, 56), // 橙
];

export function colorToCss(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

export function uid(prefix = 'id'): string {
  return prefix + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
