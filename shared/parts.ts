import type { PartDef, PortDef } from './types';

const port = (id: string, kind: 'pin' | 'socket', x: number, y: number, z: number, axis: 'x' | 'y' | 'z', dia: number): PortDef => ({
  id,
  kind,
  offset: { x, y, z },
  axis,
  dia,
});

export const MATERIALS: { id: string; name: string; density: number; categories: string[] }[] = [
  { id: 'steel', name: 'Q235 钢管 · 静电喷粉', density: 7.85, categories: ['tube'] },
  { id: 'steel-galv', name: 'Q235 钢管 · 镀锌', density: 7.85, categories: ['tube'] },
  { id: 'pp', name: 'PP 注塑件', density: 1.05, categories: ['connector'] },
  { id: 'abs', name: 'ABS 注塑件', density: 1.05, categories: ['connector'] },
  { id: 'mdf', name: 'MDF 密度板', density: 0.75, categories: ['board'] },
  { id: 'ply', name: '多层实木板', density: 0.65, categories: ['board'] },
  { id: 'corrugated', name: '五层瓦楞纸箱', density: 0.12, categories: ['carton'] },
  { id: 'steel-zinc', name: '镀锌五金件', density: 7.85, categories: ['hardware'] },
];

export const PARTS: PartDef[] = [
  // ---------- 钢管床架件 ----------
  {
    id: 'tube-side',
    partNo: 'KF-T50-1890',
    name: '长边梁管',
    category: 'tube',
    shape: 'cyl',
    axis: 'x',
    size: { w: 1890, d: 50, h: 50 },
    color: '#5d7186',
    material: 'steel',
    density: 7.85,
    wall: 1.5,
    ports: [port('l', 'pin', -945, 0, 25, 'x', 26), port('r', 'pin', 945, 0, 25, 'x', 26)],
    spec: 'Ø50×1.5×1890',
    note: '两端冲孔，配 M8 法兰螺母',
  },
  {
    id: 'tube-end',
    partNo: 'KF-T50-1390',
    name: '端梁管',
    category: 'tube',
    shape: 'cyl',
    axis: 'x',
    size: { w: 1390, d: 50, h: 50 },
    color: '#5d7186',
    material: 'steel',
    density: 7.85,
    wall: 1.5,
    ports: [port('l', 'pin', -695, 0, 25, 'x', 26), port('r', 'pin', 695, 0, 25, 'x', 26)],
    spec: 'Ø50×1.5×1390',
  },
  {
    id: 'tube-mid',
    partNo: 'KF-T38-1800',
    name: '中撑梁管',
    category: 'tube',
    shape: 'cyl',
    axis: 'x',
    size: { w: 1800, d: 38, h: 38 },
    color: '#66798d',
    material: 'steel',
    density: 7.85,
    wall: 1.2,
    ports: [port('l', 'pin', -900, 0, 19, 'x', 20), port('r', 'pin', 900, 0, 19, 'x', 20)],
    spec: 'Ø38×1.2×1800',
  },
  {
    id: 'leg',
    partNo: 'KF-L50-350',
    name: '床腿',
    category: 'tube',
    shape: 'cyl',
    axis: 'z',
    size: { w: 50, d: 50, h: 350 },
    color: '#4d5f72',
    material: 'steel',
    density: 7.85,
    wall: 1.5,
    ports: [port('top', 'pin', 0, 0, 350, 'z', 25), port('foot', 'pin', 0, 0, 0, 'z', 25)],
    spec: 'Ø50×1.5×350',
    note: '顶部 25mm 插销，配 PP 脚垫',
  },
  {
    id: 'post-head',
    partNo: 'KF-P50-850',
    name: '床头立柱',
    category: 'tube',
    shape: 'cyl',
    axis: 'z',
    size: { w: 50, d: 50, h: 850 },
    color: '#4d5f72',
    material: 'steel',
    density: 7.85,
    wall: 1.5,
    ports: [port('bottom', 'pin', 0, 0, 0, 'z', 25), port('top', 'socket', 0, 0, 850, 'z', 25)],
    spec: 'Ø50×1.5×850',
  },
  {
    id: 'bar-head',
    partNo: 'KF-T38-1420',
    name: '床头横管',
    category: 'tube',
    shape: 'cyl',
    axis: 'x',
    size: { w: 1420, d: 38, h: 38 },
    color: '#66798d',
    material: 'steel',
    density: 7.85,
    wall: 1.2,
    ports: [port('l', 'pin', -710, 0, 19, 'x', 20), port('r', 'pin', 710, 0, 19, 'x', 20)],
    spec: 'Ø38×1.2×1420',
  },
  {
    id: 'tube-stretcher',
    partNo: 'KF-T25-380',
    name: '床腿拉撑管',
    category: 'tube',
    shape: 'cyl',
    axis: 'x',
    size: { w: 380, d: 25, h: 25 },
    color: '#66798d',
    material: 'steel-galv',
    density: 7.85,
    wall: 1.0,
    ports: [port('l', 'pin', -190, 0, 12.5, 'x', 14), port('r', 'pin', 190, 0, 12.5, 'x', 14)],
    spec: 'Ø25×1.0×380',
  },

  // ---------- 注塑连接件 ----------
  {
    id: 'conn-corner',
    partNo: 'KF-C60-L',
    name: '直角连接件',
    category: 'connector',
    shape: 'box',
    size: { w: 60, d: 60, h: 60 },
    color: '#d98a3d',
    material: 'pp',
    density: 1.05,
    ports: [port('bottom', 'socket', 0, 0, 0, 'z', 25), port('x', 'socket', 30, 0, 30, 'x', 26), port('y', 'socket', 0, 30, 30, 'y', 26)],
    spec: 'M8 直角 · 左',
    note: '配合床腿顶部插销',
  },
  {
    id: 'conn-tee',
    partNo: 'KF-C60-T',
    name: '三通连接件',
    category: 'connector',
    shape: 'box',
    size: { w: 60, d: 60, h: 60 },
    color: '#e29a4c',
    material: 'pp',
    density: 1.05,
    ports: [
      port('x-', 'socket', -30, 0, 30, 'x', 26),
      port('x+', 'socket', 30, 0, 30, 'x', 26),
      port('y-', 'socket', 0, -30, 30, 'y', 26),
      port('bottom', 'socket', 0, 0, 0, 'z', 25),
    ],
    spec: 'M8 三通',
  },
  {
    id: 'conn-cross',
    partNo: 'KF-C60-X',
    name: '十字连接件',
    category: 'connector',
    shape: 'box',
    size: { w: 60, d: 60, h: 60 },
    color: '#d6903f',
    material: 'pp',
    density: 1.05,
    ports: [
      port('x-', 'socket', -30, 0, 30, 'x', 26),
      port('x+', 'socket', 30, 0, 30, 'x', 26),
      port('y-', 'socket', 0, -30, 30, 'y', 26),
      port('y+', 'socket', 0, 30, 30, 'y', 26),
      port('bottom', 'socket', 0, 0, 0, 'z', 25),
    ],
    spec: 'M8 十字',
  },
  {
    id: 'foot-pad',
    partNo: 'KF-PP-PAD',
    name: 'PP 脚垫',
    category: 'connector',
    shape: 'cyl',
    axis: 'z',
    size: { w: 56, d: 56, h: 22 },
    color: '#394656',
    material: 'pp',
    density: 1.05,
    ports: [port('top', 'socket', 0, 0, 22, 'z', 25)],
    spec: 'Ø56×22',
  },

  // ---------- 床板 ----------
  {
    id: 'board-slat',
    partNo: 'KF-B18-1900',
    name: '床板半幅',
    category: 'board',
    shape: 'box',
    size: { w: 1890, d: 700, h: 18 },
    color: '#c9a173',
    material: 'mdf',
    density: 0.75,
    ports: [],
    spec: '1890×700×18 贴木纹',
  },
  {
    id: 'board-shelf',
    partNo: 'KF-B18-SHELF',
    name: '床头置物板',
    category: 'board',
    shape: 'box',
    size: { w: 1400, d: 180, h: 18 },
    color: '#c9a173',
    material: 'ply',
    density: 0.65,
    ports: [],
    spec: '1400×180×18',
  },

  // ---------- 包装箱 ----------
  {
    id: 'carton-tube',
    partNo: 'PK-A-204',
    name: '管件包装箱',
    category: 'carton',
    shape: 'box',
    size: { w: 2040, d: 190, h: 170 },
    color: '#b98b5e',
    material: 'corrugated',
    density: 0.12,
    ports: [],
    spec: '五层瓦楞 2040×190×170',
  },
  {
    id: 'carton-board',
    partNo: 'PK-B-102',
    name: '床板包装箱',
    category: 'carton',
    shape: 'box',
    size: { w: 1010, d: 1010, h: 120 },
    color: '#b98b5e',
    material: 'corrugated',
    density: 0.12,
    ports: [],
    spec: '五层瓦楞 1010×1010×120',
  },
  {
    id: 'carton-small',
    partNo: 'PK-C-04',
    name: '配件包装箱',
    category: 'carton',
    shape: 'box',
    size: { w: 420, d: 320, h: 210 },
    color: '#c39668',
    material: 'corrugated',
    density: 0.12,
    ports: [],
    spec: '五层瓦楞 420×320×210',
  },

  // ---------- 五金 ----------
  {
    id: 'bolt-m8',
    partNo: 'HW-M8-40',
    name: 'M8×40 法兰螺栓',
    category: 'hardware',
    shape: 'cyl',
    axis: 'z',
    size: { w: 16, d: 16, h: 40 },
    color: '#9aa6b5',
    material: 'steel-zinc',
    density: 7.85,
    ports: [],
    spec: 'M8×40 镀锌 8.8 级',
  },
];

export const PART_MAP: Record<string, PartDef> = Object.fromEntries(PARTS.map((p) => [p.id, p]));

/** Cross-section diameter and length of a round part along its axis. */
export function cylDims(d: PartDef, size?: { w: number; d: number; h: number }) {
  const s = size ?? d.size;
  const axis = d.axis ?? (s.h >= Math.max(s.w, s.d) ? 'z' : s.w >= s.d ? 'x' : 'y');
  const len = axis === 'x' ? s.w : axis === 'y' ? s.d : s.h;
  const dia = axis === 'x' ? Math.max(s.d, s.h) : axis === 'y' ? Math.max(s.w, s.h) : Math.max(s.w, s.d);
  return { axis, len, dia };
}

export function partWeight(d: PartDef, size?: { w: number; d: number; h: number }): number {
  if (d.unitWeight != null) return d.unitWeight;
  const s = size ?? d.size;
  let volumeCm3: number;
  if (d.shape === 'cyl') {
    const { len, dia } = cylDims(d, size);
    if (d.wall) {
      const ri = Math.max(0, dia / 2 - d.wall);
      volumeCm3 = (Math.PI * (dia * dia / 4 - ri * ri) * len) / 1000;
    } else {
      volumeCm3 = (Math.PI * dia * dia / 4 * len) / 1000;
    }
  } else {
    volumeCm3 = (s.w * s.d * s.h) / 1000;
  }
  return (volumeCm3 * d.density) / 1000;
}

export function partVolumeM3(size: { w: number; d: number; h: number }): number {
  return (size.w * size.d * size.h) / 1e9;
}
