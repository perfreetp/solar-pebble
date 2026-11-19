// 全局领域类型定义

export type LayerId = 'topsoil' | 'ejecta' | 'bedrock';

export interface LayerMeta {
  id: LayerId;
  name: string;
  color: number;
  emissive?: number;
  desc: string;
}

/** 体素整数坐标,一个单位 = 0.5 米 */
export interface VoxelCoord {
  x: number;
  y: number;
  z: number;
}

export type VoxelMap = Map<string, LayerId>;

export type IssueLevel = 'severe' | 'notice';
export type IssueStatus = 'open' | 'confirmed' | 'rejected';
export type ItemStatus = 'pending' | 'approved' | 'rejected';
export type BatchStatus = 'checking' | 'pending_review' | 'released' | 'returned';

export interface CheckIssue {
  id: string;
  level: IssueLevel;
  rule: string;
  message: string;
  status: IssueStatus;
  reviewer?: string;
  reviewedAt?: number;
}

export interface MaterialItem {
  id: string;
  name: string;
  ext: string;
  sizeKb: number;
  declaredLayer: LayerId | 'unspecified';
  checksum: string;
  status: ItemStatus;
  issues: CheckIssue[];
}

export interface MaterialBatch {
  id: string;
  supplier: string;
  arrivedAt: number;
  status: BatchStatus;
  items: MaterialItem[];
  returnReason?: string;
  releasedAt?: number;
}

export type ViewId = 'model' | 'batches' | 'review' | 'release';
