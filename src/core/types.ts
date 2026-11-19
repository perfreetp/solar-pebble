export type Level = 1 | 2 | 3;
export type ColorMode = 'level' | 'length' | 'density' | 'elevation';

export interface LevelTuning {
  /** 每 100 m 的宽度衰减比例 0..0.95 */
  widthDecay: number;
  /** 弯曲噪声倍数 */
  meanderScale: number;
  /** 宽度整体倍数 */
  widthScale: number;
}

export interface NetworkParams {
  /** 主沟走向, 0..360 度, 自正北顺时针 */
  heading: number;
  /** 分叉角, 一对支沟之间的夹角 (度) */
  branchAngle: number;
  /** 支沟密度 0..1 */
  density: number;
  /** 曲流幅度 0..1 */
  meander: number;
  /** 随机种子 (任意字符串) */
  seed: string;
  /** 沟头终止高程 (m) */
  headLevel: number;
  /** 滩面比降 (m/m) */
  slope: number;
  /** 口门基准高程 (m) */
  datum: number;
  /** 各级独立调参 (可选, 默认见 generator) */
  levelTuning?: Record<Level, LevelTuning>;
}

export const DEFAULT_PARAMS: NetworkParams = {
  heading: 22,
  branchAngle: 38,
  density: 0.56,
  meander: 0.58,
  seed: 'TIDAL-2026',
  headLevel: 1.62,
  slope: 0.00095,
  datum: 0.16,
};

export interface TerrainModel {
  datum: number;
  slope: number;
  seaLevel: number;
}

export interface Creek {
  id: string;
  level: Level;
  parentId: string | null;
  /** 在父沟上的归一化位置 */
  parentU: number;
  side: -1 | 0 | 1;
  /** 中心线坐标, x,y 交替 */
  pts: Float64Array;
  widths: Float32Array;
  /** 累计弧长 */
  s: Float32Array;
  length: number;
  mouthWidth: number;
  headWidth: number;
  startElevation: number;
  headElevation: number;
  /** 该级沟道的潮位上限 (沟头应自然收尾于此高程) */
  headTarget: number;
  /** 收尾原因: 到达沟头高程 / 与邻近沟道净距不足 / 超出调查范围 / 达到长度上限 */
  stopReason: 'elevation' | 'collision' | 'extent' | 'maxLength' | 'locked';
  sinuosity: number;
  densityValue: number;
  classIdx: { length: number; density: number; elevation: number };
  /** 手工编辑标志 */
  edited?: boolean;
}

export interface Junction {
  x: number;
  y: number;
  r: number;
  level: Level;
  creekId: string;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface NetworkStats {
  counts: Record<Level, number>;
  lengths: Record<Level, number>;
  meanWidths: Record<Level, number>;
  totalLength: number;
  junctionCount: number;
  headMin: number;
  headMax: number;
  bounds: Bounds;
  areaKm2: number;
  densityKmPerKm2: number;
  meanSinuosity: number;
  pointCount: number;
}

export interface ClassTable {
  length: { breaks: number[]; min: number; max: number };
  density: { breaks: number[]; min: number; max: number };
  elevation: { breaks: number[]; min: number; max: number };
}

export interface Network {
  params: NetworkParams;
  terrain: TerrainModel;
  creeks: Creek[];
  junctions: Junction[];
  bounds: Bounds;
  stats: NetworkStats;
  classes: ClassTable;
  fingerprint: string;
  generatedAt?: string;
}

/**
 * 锁定段: 以起点为原点、起点切向为 +x 保存的局部坐标。
 * 重生成时只做刚体变换 (旋转 + 平移), 因此长度/偏转/弯曲形态严格不变,
 * 起点又贴在父沟的新位置上, 从而"锁定段形态不变并和新网络接上"。
 */
export interface CreekLock {
  creekId: string;
  level: Level;
  parentId: string | null;
  parentU: number;
  side: -1 | 0 | 1;
  /** 捕获时相对父沟切向的起始转角 (弧度) */
  relativeAngle: number;
  /** 局部坐标 (x,y 交替), 起点在 (0,0) */
  localPts: number[];
  length: number;
  mouthWidth: number;
  widthScale: number;
  /** 刚体不变形状签名 */
  shapeSignature: string;
  capturedAt: string;
}
