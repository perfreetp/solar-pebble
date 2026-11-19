/** 编辑器核心数据模型 —— 场景中所有图元都用统一的 VecPath 表示 */

export type Pt = { x: number; y: number };

export type ItemType = 'pipeline' | 'sign' | 'zone' | 'generic';

export type ToolId =
  | 'select'
  | 'rect'
  | 'polygon'
  | 'polyline'
  | 'pen'
  | 'pan';

export type BoolOp = 'unite' | 'subtract' | 'intersect' | 'xor';

export interface ItemStyle {
  stroke: string;
  fill: string;
  strokeWidth: number;
  opacity: number;
  dash: number[]; // 空数组 = 实线
}

export interface VecPath {
  id: string;
  type: ItemType;
  name: string;
  layerId: string;
  closed: boolean;
  /** 局部坐标顶点（矩形/多边形/折线）；钢笔路径用 segments 存曲线 */
  points: Pt[];
  /** 钢笔贝塞尔：每个点带入/出控制柄，未使用时为 null */
  segments: { point: Pt; handleIn: Pt | null; handleOut: Pt | null }[];
  smooth: boolean;
  style: ItemStyle;
  transform: Matrix;
  groupId: string | null;
  /** 版面冲突标记（管线压住标识牌等），由冲突检测维护 */
  conflict?: boolean;
}

export interface VecGroup {
  id: string;
  name: string;
  transform: Matrix;
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  color: string;
}

/** 仿射矩阵 [a,b,c,d,tx,ty]（Pixi / Paper 通用约定） */
export type Matrix = [number, number, number, number, number, number];

export const identity = (): Matrix => [1, 0, 0, 1, 0, 0];

export interface DocState {
  items: VecPath[];
  groups: VecGroup[];
  layers: Layer[];
}

export interface LegendTemplate {
  id: string;
  name: string;
  appliesTo: ItemType[];
  style: ItemStyle;
}

// ---------- 工单 / 派工 / 质检 ----------

export type JobStatus =
  | 'intake' // 前台接单
  | 'assigned' // 已派工
  | 'in_progress' // 绘制中
  | 'submitted' // 已提交质检
  | 'returned' // 打回返工
  | 'approved'; // 质检通过

export interface Job {
  id: string;
  code: string;
  customer: string;
  station: string;
  requirements: string;
  assignee: string | null;
  status: JobStatus;
  createdAt: number;
  submittedAt: number | null;
  approvedAt: number | null;
  qcNote: string;
  /** 打回次数（返工率口径） */
  reworkCount: number;
  /** 每次质检记录 */
  qcHistory: { at: number; passed: boolean; note: string; reviewer: string }[];
  doc: DocState | null;
}

export interface Worker {
  id: string;
  name: string;
  role: 'designer' | 'qc' | 'frontdesk';
}
