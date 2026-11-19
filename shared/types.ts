/** Shared domain types for the knock-down bed frame layout studio. */

export type Category = 'tube' | 'connector' | 'board' | 'carton' | 'hardware';

export const CATEGORY_LABEL: Record<Category, string> = {
  tube: '钢管床架件',
  connector: '注塑连接件',
  board: '床板 / 板材',
  carton: '包装箱',
  hardware: '五金配件',
};

export const CATEGORY_COLOR: Record<Category, string> = {
  tube: '#79a7c9',
  connector: '#e59a4a',
  board: '#c9a173',
  carton: '#b98b5e',
  hardware: '#8f9bb0',
};

export type LayerId = Category;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Size3 {
  w: number;
  d: number;
  h: number;
}

export type PortKind = 'pin' | 'socket';

/** A connection point on a part. Offsets are mm from the bottom-centre anchor. */
export interface PortDef {
  id: string;
  kind: PortKind;
  offset: Vec3;
  axis: 'x' | 'y' | 'z';
  dia: number;
}

export interface PartDef {
  id: string;
  partNo: string;
  name: string;
  category: Category;
  shape: 'cyl' | 'box';
  size: Size3;
  /** For cylinders: the long axis of the round profile. */
  axis?: 'x' | 'y' | 'z';
  color: string;
  material: string;
  /** g / cm^3 */
  density: number;
  /** Wall thickness for hollow tubes (mm). */
  wall?: number;
  /** Fixed unit weight (kg) overriding density maths. */
  unitWeight?: number;
  ports: PortDef[];
  spec: string;
  note?: string;
}

export interface Entity {
  uid: string;
  defId: string;
  /** Bottom-centre anchor, mm. */
  pos: Vec3;
  /** Yaw in degrees around the vertical axis. */
  rot: number;
  size?: Size3;
  color?: string;
  locked?: boolean;
  hidden?: boolean;
  label?: string;
}

export interface Joint {
  a: string;
  b: string;
  portA?: string;
  portB?: string;
}

export interface LayerState {
  visible: boolean;
  locked: boolean;
}

export interface SceneData {
  version: 1;
  project: string;
  projectCode: string;
  entities: Entity[];
  joints: Joint[];
  layers: Record<LayerId, LayerState>;
}

export interface Box3 {
  min: Vec3;
  max: Vec3;
}

export interface Rect2 {
  x: number;
  y: number;
  w: number;
  d: number;
}

export interface BOMRow {
  defId: string;
  partNo: string;
  name: string;
  spec: string;
  category: Category;
  material: string;
  qty: number;
  unitWeight: number;
  totalWeight: number;
  unitVolume: number;
  totalVolume: number;
  color: string;
}

export interface BOMData {
  rows: BOMRow[];
  totalParts: number;
  totalTypes: number;
  totalWeight: number;
  totalVolume: number;
  byCategory: { category: Category; label: string; qty: number; weight: number }[];
}

export interface InterferencePair {
  a: string;
  b: string;
  nameA: string;
  nameB: string;
  overlap: Vec3;
  volume: number;
  depth: number;
}

export interface TopRect {
  uid: string;
  defId: string;
  name: string;
  partNo: string;
  category: Category;
  color: string;
  x: number;
  y: number;
  w: number;
  d: number;
  rot: number;
  z: number;
  h: number;
  corners: { x: number; y: number }[];
}

export interface Aisle {
  /** 'v' corridor runs along the y axis (free strip in x); 'h' runs along x. */
  dir: 'v' | 'h';
  width: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  labelX: number;
  labelY: number;
  /** Clearance below the recommended aisle width. */
  narrow: boolean;
}

export interface TopViewData {
  rects: TopRect[];
  aisles: Aisle[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  depth: number;
}

export interface VersionSummary {
  id: number;
  project: string;
  name: string;
  status: VersionStatus;
  created_by: string;
  created_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewer: string | null;
  review_reason: string | null;
  share_token: string | null;
  note: string | null;
  thumb: TopViewData | null;
  part_count: number;
  weight: number;
  interference: number;
}

export type VersionStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export const STATUS_LABEL: Record<VersionStatus, string> = {
  draft: '草稿',
  submitted: '待评审',
  approved: '已通过',
  rejected: '已退回',
};

export interface VersionDetail extends VersionSummary {
  scene: SceneData;
  bom: BOMData;
  topview: TopViewData;
  report: InterferencePair[];
}
