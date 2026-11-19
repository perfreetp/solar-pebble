import type { LayerId, LayerMeta, VoxelCoord, VoxelMap } from '../types';

/** 体素边长(米) */
export const VOXEL_SIZE = 0.5;
/** 水平网格半径(体素单位),R=24 → 49×49 格 */
export const GRID_R = 24;
/** 坑底半径(米) */
export const CRATER_FLOOR_R = 4.2;
/** 坑缘半径(米),即剖面最深位置 */
export const CRATER_RIM_R = 7.0;
/** 外缘影响半径(米) */
export const CRATER_OUTER_R = 11.5;
/** 坑底相对原地表的深度(米) */
export const CRATER_DEPTH = 3.2;
/** 坑缘堆积高度(米) */
export const RIM_HEIGHT = 1.1;

export const LAYERS: LayerMeta[] = [
  {
    id: 'topsoil',
    name: '表土层',
    color: 0x8a5a33,
    desc: '最上层松散表土与风化碎屑',
  },
  {
    id: 'ejecta',
    name: '溅射层',
    color: 0xc77b3a,
    desc: '撞击抛射回落的溅射物覆盖层',
  },
  {
    id: 'bedrock',
    name: '基岩层',
    color: 0x5d6470,
    desc: '下部原位基岩与破碎基岩体',
  },
];

export const LAYER_IDS: LayerId[] = LAYERS.map((l) => l.id);

export function keyOf(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export function parseKey(k: string): VoxelCoord {
  const [x, y, z] = k.split(',').map(Number);
  return { x, y, z };
}

/** 距坑中心的水平距离(米) */
export function radiusMeters(x: number, z: number): number {
  const wx = x * VOXEL_SIZE;
  const wz = z * VOXEL_SIZE;
  return Math.hypot(wx, wz);
}

/**
 * 撞击坑地形剖面:返回该水平位置的地表相对原地表(y=0)的高度(米)。
 * 坑底下凹、坑缘隆起、外缘溅射毯缓坡回落。
 */
export function terrainHeightMeters(r: number): number {
  if (r <= CRATER_FLOOR_R) {
    // 坑底,略带中央轻微起伏
    const t = r / CRATER_FLOOR_R;
    return -CRATER_DEPTH + 0.12 * t * t;
  }
  if (r <= CRATER_RIM_R) {
    // 坑壁:从坑底平滑抬升到坑缘顶点
    const t = (r - CRATER_FLOOR_R) / (CRATER_RIM_R - CRATER_FLOOR_R);
    const s = t * t * (3 - 2 * t); // smoothstep
    return -CRATER_DEPTH + s * (CRATER_DEPTH + RIM_HEIGHT);
  }
  if (r <= CRATER_OUTER_R) {
    // 外缘溅射毯:坑缘高度指数衰减回原地表
    const t = (r - CRATER_RIM_R) / (CRATER_OUTER_R - CRATER_RIM_R);
    return RIM_HEIGHT * Math.exp(-2.6 * t);
  }
  return 0;
}

/** 按深度确定某高度体素所属编辑层 */
export function layerAtHeight(heightMeters: number): LayerId {
  // 地表以下 0~0.75m 表土,0.75~1.75m 溅射层,再深为基岩
  if (heightMeters >= -0.75) return 'topsoil';
  if (heightMeters >= -1.75) return 'ejecta';
  return 'bedrock';
}

/** 生成初始撞击坑地形体素(每列自地表向下填充有限厚度,避免悬空柱) */
export function createInitialTerrain(): VoxelMap {
  const map: VoxelMap = new Map();
  // 基岩底板厚度(米):覆盖三层浅部地质剖面
  const BASE_THICKNESS = 3.5;
  for (let x = -GRID_R; x <= GRID_R; x++) {
    for (let z = -GRID_R; z <= GRID_R; z++) {
      const r = radiusMeters(x, z);
      if (r > CRATER_OUTER_R) continue;
      const h = terrainHeightMeters(r);
      const topY = Math.round(h / VOXEL_SIZE);
      // 每列底板随该列地表高度下移,形成厚度一致的实心地质块而非悬空柱
      const bottomY = Math.round((h - BASE_THICKNESS) / VOXEL_SIZE);
      for (let y = bottomY; y <= topY; y++) {
        const worldY = y * VOXEL_SIZE;
        const depth = h - worldY;
        let layer: LayerId;
        if (depth <= 0.75) layer = 'topsoil';
        else if (depth <= 1.75) layer = 'ejecta';
        else layer = 'bedrock';
        map.set(keyOf(x, y, z), layer);
      }
    }
  }
  return map;
}

/** 六邻接方向 */
export const NEIGHBORS: ReadonlyArray<[number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export function voxelWorldCenter(c: VoxelCoord): { x: number; y: number; z: number } {
  return {
    x: c.x * VOXEL_SIZE,
    y: c.y * VOXEL_SIZE,
    z: c.z * VOXEL_SIZE,
  };
}
