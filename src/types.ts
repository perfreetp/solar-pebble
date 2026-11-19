// 全局类型定义
export type Pt = { x: number; y: number };

export type PathKind = 'vein' | 'pattern';
export type BooleanOp = 'union' | 'difference' | 'intersection';

export interface PathData {
  id: string;
  name: string;
  kind: PathKind;
  closed: boolean;
  /** 主轮廓节点(锚点) */
  nodes: Pt[];
  /** 每个锚点的入柄(相对节点坐标, null = 无柄直线段) */
  handlesIn: (Pt | null)[];
  handlesOut: (Pt | null)[];
  visible: boolean;
  locked: boolean;
  color: string;
  /** 斑纹专用:镂空内环(贝塞尔展平后的多边形环,由切割生成) */
  holes: Pt[][];
}

export interface GuideLine {
  id: string;
  orientation: 'h' | 'v';
  pos: number;
}

export interface Specimen {
  id: string;
  code: string;        // 标本编号
  family: string;      // 科
  species: string;     // 种名
  bitmap?: ImageBitmap;
  bitmapWidth: number;
  bitmapHeight: number;
}

export interface WingDoc {
  id: string;
  specimenId: string;
  paths: PathData[];
  guides: GuideLine[];
  bgImage?: ImageBitmap;
  bgOpacity: number;
  showGrid: boolean;
}

export interface Template {
  id: string;
  name: string;
  family: string;
  createdAt: number;
  paths: PathData[];
}

export interface ExportPreset {
  id: string;
  name: string;
  veinColor: string;
  patternFill: string;
  patternOpacity: number;
  strokeWidth: number;
  splitLayers: boolean;
  includeBg: boolean;
}

export type AnnotationKind = 'reject' | 'approve';

export interface Annotation {
  id: string;
  kind: AnnotationKind;
  comment: string;
  /** 圈注圆,文档坐标 */
  cx: number;
  cy: number;
  r: number;
  author: string;
  createdAt: number;
}

export type SubmissionStatus = 'pending' | 'approved' | 'rejected';

export interface Submission {
  id: string;
  docId: string;
  specimenCode: string;
  family: string;
  species: string;
  illustrator: string;
  submittedAt: number;
  status: SubmissionStatus;
  /** 提交时刻的文档快照(结构化克隆,不含 bitmap) */
  snapshot: { paths: PathData[]; guides: GuideLine[]; bgOpacity: number };
  annotations: Annotation[];
  reviewedBy?: string;
  reviewedAt?: number;
}

export interface ViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface ToolMode {
  type: 'select' | 'pen' | 'pan' | 'guide';
}

export const DOC_W = 1280;
export const DOC_H = 960;
export const HISTORY_LIMIT = 80; // 撤销重做至少 50 步
