// 核心数据模型与类型定义

/** 图层（要素类别）标识 */
export type LayerId =
  | 'tower' // 塔架
  | 'diversion' // 导流槽
  | 'fueling' // 加注区
  | 'lightning' // 避雷塔
  | 'cordon' // 警戒线
  | 'firelane' // 消防通道
  | 'camera'; // 摄像点位

export type GeometryKind = 'point' | 'line' | 'polygon';

export interface PointGeom {
  kind: 'point';
  x: number;
  y: number;
}

export interface LineGeom {
  kind: 'line';
  /** 折线顶点，世界坐标（米） */
  coords: [number, number][];
}

export interface PolygonGeom {
  kind: 'polygon';
  /** 外环顶点，世界坐标（米） */
  ring: [number, number][];
}

export type Geometry = PointGeom | LineGeom | PolygonGeom;

/** 要素属性（审片属性卡展示） */
export interface FeatureProps {
  name: string;
  code: string;
  spec?: string;
  status: string;
  owner: string;
  updatedAt: string;
  [key: string]: string | number | undefined;
}

export interface Feature {
  id: string;
  layerId: LayerId;
  geom: Geometry;
  props: FeatureProps;
}

/** 图层样式与元信息 */
export interface LayerMeta {
  id: LayerId;
  name: string;
  kind: GeometryKind;
  color: string;
  /** 面图层填充色（带透明度的 rgba） */
  fill?: string;
  /** 该图层要素出现的最低 LOD（0=最概览 … 3=最详细），低于此级别不单独绘制 */
  minLod: number;
  /** 是否参与低级别同类合并 */
  clusterable: boolean;
}

export interface LayerState {
  visible: boolean;
  opacity: number; // 0..1
  /** 叠放顺序（值小的在下方） */
  zOrder: number;
}

// ---------------- 审片 / 版本 / 批注 ----------------

export type AnnotationStatus = 'open' | 'resolved' | 'rejected';

export interface AnnotationReply {
  id: string;
  author: string;
  /** 制作方处置结论 */
  action: 'resolved' | 'rejected';
  content: string;
  createdAt: string;
}

export interface Annotation {
  id: string;
  /** 关联要素 id，可空（打在空白处的批注） */
  featureId: string | null;
  /** 批注锚点，世界坐标 */
  x: number;
  y: number;
  author: string;
  content: string;
  createdAt: string;
  status: AnnotationStatus;
  replies: AnnotationReply[];
}

export interface ReviewVersion {
  id: string;
  label: string;
  createdAt: string;
  note: string;
  /** 该版本提交时刻的要素快照（id -> Feature） */
  features: Record<string, Feature>;
  annotations: Annotation[];
}

/** 版本差异类型 */
export type DiffKind = 'added' | 'removed' | 'modified';

export interface FeatureDiff {
  kind: DiffKind;
  featureId: string;
  layerId: LayerId;
  /** modified 时携带新旧要素 */
  before?: Feature;
  after?: Feature;
}

// ---------------- 视图状态 ----------------

export interface ViewTransform {
  /** 世界坐标 -> 画布坐标：screen = world * scale + offset */
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface CameraState extends ViewTransform {
  /** 当前 LOD 级别 0..3 */
  lod: number;
}
