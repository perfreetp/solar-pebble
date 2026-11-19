// 全局类型定义：构件、展箱、工单、看板

export type ComponentKind =
  | 'tank'      // 展箱（容器，自带台面）
  | 'log'       // 枯木
  | 'moss'      // 苔藓块
  | 'net'       // 攀爬网
  | 'basin'     // 水盆
  | 'backpanel';// 背板

export type TransformMode = 'translate' | 'rotate' | 'scale';

export interface Vec3Tuple {
  x: number;
  y: number;
  z: number;
}

/** 构件实例（序列化进场景 JSON） */
export interface SceneComponent {
  id: string;
  kind: ComponentKind;
  name: string;
  /** 所属展箱 id；展箱自身为 null */
  tankId: string | null;
  position: Vec3Tuple;
  /** 欧拉角，弧度 */
  rotation: Vec3Tuple;
  /** 本地缩放（实际尺寸 = 基础尺寸 × scale） */
  scale: Vec3Tuple;
  /** 基础尺寸（米），未缩放 */
  size: Vec3Tuple;
  color: number;
}

/** 构件库目录项 */
export interface CatalogItem {
  kind: ComponentKind;
  label: string;
  defaultSize: Vec3Tuple;
  color: number;
  unit: string;
  desc: string;
}

// ---------------- 工单 / 派工 / 质检 ----------------

export type JobStatus = 'pending' | 'assigned' | 'submitted' | 'rejected' | 'done';

export interface Job {
  id: string;
  code: string;            // 单号，如 JOB-20261120-001
  title: string;
  requirement: string;     // 前台录入的需求
  sceneSnapshot: string;   // 场景 JSON 快照
  master: string;          // 负责师傅，空串=未分派
  status: JobStatus;
  createdAt: number;
  assignedAt?: number;
  submittedAt?: number;
  finishedAt?: number;
  qcNote?: string;         // 质检意见
  reworkCount: number;     // 打回次数
  timeline: { t: number; text: string }[];
}

export interface Master {
  id: string;
  name: string;
  role: string;
}

export interface AppState {
  components: SceneComponent[];
  jobs: Job[];
  masters: Master[];
  jobSeq: number;
}
