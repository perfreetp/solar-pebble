export type ArchiveStatus = 'draft' | 'archived';

/** 编号档案: 每个潮沟网络的正式调查档案 */
export interface ArchiveRecord {
  id: string;
  /** 档案编号, 例如 TC-2026-DL-001 */
  code: string;
  name: string;
  year: number;
  /** 区域 / 岸段 */
  region: string;
  /** 调查队 / 单位 */
  surveyor: string;
  /** 观测日期 ISO yyyy-mm-dd */
  observedAt: string;
  status: ArchiveStatus;
  notes: string;
  /** 生成参数快照 */
  params: Record<string, unknown>;
  /** 参数指纹 */
  fingerprint: string;
  /** 统计快照 */
  stats: {
    counts: Record<string, number>;
    totalLength: number;
    junctionCount: number;
    densityKmPerKm2: number;
    headMin: number;
    headMax: number;
    meanSinuosity: number;
  };
  /** 各级沟道数 (供按沟级别检索) */
  levelCounts: Record<string, number>;
  /** 锁定段数量 */
  lockCount: number;
  /** 与航拍底图的配准信息 */
  basemap?: BasemapRef | null;
  createdAt: string;
  updatedAt: string;
}

export interface BasemapRef {
  /** 底图名 */
  name: string;
  /** data URL 或对象 URL (本地会话) */
  src: string;
  /** 底图配准: 图像覆盖的世界范围 */
  world: { minX: number; minY: number; maxX: number; maxY: number };
  /** 像素尺寸 */
  pixel: { width: number; height: number };
  opacity: number;
  /** 航片编号 */
  flightCode?: string;
}

/** 历史版本: 每次生成 / 编辑都可另存为版本 */
export interface VersionRecord {
  id: string;
  archiveId: string;
  label: string;
  createdAt: string;
  fingerprint: string;
  params: Record<string, unknown>;
  stats: Record<string, unknown>;
  /** 完整几何快照 (JSON) — 与当前结果并排比对 */
  payload: NetworkPayload;
}

export interface NetworkPayload {
  params: Record<string, unknown>;
  creeks: {
    id: string;
    level: number;
    parentId: string | null;
    parentU: number;
    side: number;
    pts: number[];
    widths: number[];
    edited?: boolean;
  }[];
  fingerprint: string;
  generatedAt?: string;
}

export interface LockRecord {
  lockId: string;
  archiveId: string;
  creekId: string;
  level: number;
  parentId: string | null;
  parentU: number;
  side: number;
  relativeAngle: number;
  localPts: number[];
  length: number;
  mouthWidth: number;
  widthScale: number;
  shapeSignature: string;
  capturedAt: string;
}

export interface DbShape {
  version: 1;
  archives: ArchiveRecord[];
  versions: VersionRecord[];
  locks: LockRecord[];
  counter: number;
}
