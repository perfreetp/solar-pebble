/** 角色与数据模型定义 */
export type Role = 'customer' | 'worker' | 'supervisor';

export const ROLE_NAMES: Record<Role, string> = {
  customer: '客户',
  worker: '制作员',
  supervisor: '主管',
};

export type ShotStatus = '未开始' | '制作中' | '待审核' | '退回修改' | '已通过';

export interface Project {
  id: string;
  name: string;
  customer: string;      // 下单客户
  brief: string;         // 需求描述(任务背景、目标小天体等)
  deadline: string;      // 截止时间 YYYY-MM-DD
  voxelLimit: number;    // 体素上限
  targetFaces: number;   // 减面目标面数
  gridSize: number;      // 体素网格边长
  reworkCount: number;   // 返工次数
  delivered: boolean;
  deliveredAt?: number;
  createdAt: number;
}

export interface Shot {
  id: string;
  projectId: string;
  name: string;          // 镜头名,如 "全景环绕镜头"
  assignee: string;      // 制作员
  status: ShotStatus;
  reviewComment: string; // 主管退回时填写的问题说明
  voxelData: string;     // base64 编码的 Uint8Array 体素数据
  voxelCount: number;
  updatedAt: number;
}

/** 项目状态由镜头状态推导 */
export function projectStatus(p: Project, shots: Shot[]): string {
  if (p.delivered) return '已交付';
  const mine = shots.filter(s => s.projectId === p.id);
  if (mine.length === 0) return '制作中';
  if (mine.some(s => s.status === '退回修改')) return '退回修改';
  if (mine.every(s => s.status === '已通过')) return '待交付';
  if (mine.some(s => s.status === '待审核')) return '审核中';
  return '制作中';
}

export function statusBadgeClass(status: string): string {
  switch (status) {
    case '制作中': return 'st-doing';
    case '待审核': case '审核中': return 'st-review';
    case '退回修改': return 'st-reject';
    case '已通过': case '待交付': return 'st-pass';
    case '已交付': return 'st-done';
    default: return '';
  }
}
