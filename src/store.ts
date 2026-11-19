import { CATALOG, DEFAULT_MASTERS, loadState, saveState, uid } from './catalog';
import { surfaceAlign } from './geometry';
import type {
  AppState, ComponentKind, Job, JobStatus, Master, SceneComponent, TransformMode
} from './types';

export interface EditorSettings {
  gridSize: number;      // 网格间距（米）
  gridDivisions: number; // 网格细分格数
  snapStep: number;      // 平移吸附步长（米）
  angleSnap: number;     // 旋转吸附（度）
  topView: boolean;      // 俯视图
  showFootprint: boolean;// 展箱占位轮廓
  transformMode: TransformMode;
}

type Listener = () => void;

class EditorStore {
  components: SceneComponent[] = [];
  jobs: Job[] = [];
  masters: Master[] = [...DEFAULT_MASTERS];
  jobSeq = 0;
  selection = new Set<string>();
  settings: EditorSettings = {
    gridSize: 0.1,
    gridDivisions: 40,
    snapStep: 0.05,
    angleSnap: 15,
    topView: false,
    showFootprint: true,
    transformMode: 'translate'
  };

  private listeners = new Set<Listener>();

  constructor() {
    const saved = loadState<AppState>(() => ({
      components: [], jobs: [], masters: DEFAULT_MASTERS, jobSeq: 0
    }));
    this.components = saved.components ?? [];
    this.jobs = saved.jobs ?? [];
    this.masters = saved.masters?.length ? saved.masters : [...DEFAULT_MASTERS];
    this.jobSeq = saved.jobSeq ?? 0;
    if (this.components.length === 0) this.seedDemo();
  }

  /** 初始示例：一个展箱 + 几件构件，方便打开即看到效果 */
  private seedDemo(): void {
    const tank = this.createComponent('tank', { x: 0, y: 0, z: 0 }, null);
    tank.name = '1号展箱';
    const log = this.createComponent('log', { x: -0.2, y: 0, z: 0.1 }, tank.id);
    log.rotation.y = 0.4;
    const moss = this.createComponent('moss', { x: 0.25, y: 0, z: -0.15 }, tank.id);
    const basin = this.createComponent('basin', { x: 0.3, y: 0, z: 0.2 }, tank.id);
    const panel = this.createComponent('backpanel', { x: 0, y: 0, z: -0.36 }, tank.id);
    this.components.push(tank, panel, log, moss, basin);
    this.alignAllToSurface();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    saveState({
      components: this.components,
      jobs: this.jobs,
      masters: this.masters,
      jobSeq: this.jobSeq
    });
    this.listeners.forEach((fn) => fn());
  }

  // ---------------- 构件 CRUD ----------------

  createComponent(kind: ComponentKind, position: { x: number; y: number; z: number }, tankId: string | null): SceneComponent {
    const def = CATALOG.find((c) => c.kind === kind)!;
    const c: SceneComponent = {
      id: uid(kind),
      kind,
      name: `${def.label} ${this.components.filter((x) => x.kind === kind).length + 1}`,
      tankId,
      position: { ...position },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      size: { ...def.defaultSize },
      color: def.color
    };
    if (kind === 'tank') {
      // 展箱原点在几何中心，底面落在 y=0 台面上
      c.position.y = def.defaultSize.y / 2;
    }
    return c;
  }

  addComponent(c: SceneComponent): void {
    this.components.push(c);
    this.selection.clear();
    this.selection.add(c.id);
    this.emit();
  }

  updateComponent(id: string, patch: Partial<SceneComponent>): void {
    const i = this.components.findIndex((c) => c.id === id);
    if (i >= 0) {
      this.components[i] = { ...this.components[i], ...patch };
      this.emit();
    }
  }

  /** 批量替换（对齐 / 排布 / 拖拽提交时用，避免频繁 emit） */
  replaceComponents(next: SceneComponent[], emit = true): void {
    const map = new Map(next.map((c) => [c.id, c]));
    this.components = this.components.map((c) => map.get(c.id) ?? c);
    if (emit) this.emit();
  }

  removeSelected(): void {
    const removing = new Set(this.selection);
    // 删展箱时连带箱内构件
    const tankIds = new Set(
      this.components.filter((c) => removing.has(c.id) && c.kind === 'tank').map((t) => t.id)
    );
    this.components = this.components.filter(
      (c) => !removing.has(c.id) && !(c.tankId && tankIds.has(c.tankId))
    );
    this.selection.clear();
    this.emit();
  }

  getSelected(): SceneComponent[] {
    return this.components.filter((c) => this.selection.has(c.id));
  }

  setSelection(ids: string[], additive = false): void {
    if (!additive) this.selection.clear();
    ids.forEach((id) => this.selection.add(id));
    this.emit();
  }

  toggleSelection(id: string): void {
    if (this.selection.has(id)) this.selection.delete(id);
    else this.selection.add(id);
    this.emit();
  }

  clearSelection(): void {
    if (this.selection.size === 0) return;
    this.selection.clear();
    this.emit();
  }

  updateSettings(patch: Partial<EditorSettings>): void {
    this.settings = { ...this.settings, ...patch };
    this.emit();
  }

  /** 全部构件重新贴面（初始化 / 批量操作后用） */
  alignAllToSurface(): void {
    // 逐类按高度排序后贴面，保证下层先落位
    const nonTanks = this.components.filter((c) => c.kind !== 'tank');
    for (const c of nonTanks) {
      const p = surfaceAlign(c, this.components);
      c.position = { x: p.x, y: p.y, z: p.z };
    }
  }

  // ---------------- 工单 ----------------

  nextJobCode(): string {
    this.jobSeq += 1;
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    return `JOB-${ymd}-${String(this.jobSeq).padStart(3, '0')}`;
  }

  createJob(title: string, requirement: string): Job {
    const job: Job = {
      id: uid('job'),
      code: this.nextJobCode(),
      title,
      requirement,
      sceneSnapshot: JSON.stringify(this.components),
      master: '',
      status: 'pending',
      createdAt: Date.now(),
      reworkCount: 0,
      timeline: [{ t: Date.now(), text: '前台接单，等待分派' }]
    };
    this.jobs = [job, ...this.jobs];
    this.emit();
    return job;
  }

  assignJob(jobId: string, masterId: string): void {
    this.mutateJob(jobId, (j) => {
      j.master = masterId;
      j.status = 'assigned';
      j.assignedAt = Date.now();
      j.timeline.push({ t: Date.now(), text: `分派给 ${this.masterName(masterId)}` });
    });
  }

  submitJob(jobId: string): void {
    this.mutateJob(jobId, (j) => {
      j.status = 'submitted';
      j.submittedAt = Date.now();
      j.timeline.push({ t: Date.now(), text: `${this.masterName(j.master)} 提交完工，待质检` });
    });
  }

  reviewJob(jobId: string, pass: boolean, note: string): void {
    this.mutateJob(jobId, (j) => {
      j.qcNote = note;
      if (pass) {
        j.status = 'done';
        j.finishedAt = Date.now();
        j.timeline.push({ t: Date.now(), text: `质检通过：${note || '合格'}` });
      } else {
        j.status = 'rejected';
        j.reworkCount += 1;
        j.timeline.push({ t: Date.now(), text: `质检不合格打回：${note}` });
      }
    });
  }

  /** 师傅返工后重新提交 */
  resubmitJob(jobId: string): void {
    this.mutateJob(jobId, (j) => {
      j.status = 'submitted';
      j.submittedAt = Date.now();
      j.timeline.push({ t: Date.now(), text: `${this.masterName(j.master)} 返工后重新提交` });
    });
  }

  masterName(id: string): string {
    return this.masters.find((m) => m.id === id)?.name ?? '未分派';
  }

  private mutateJob(jobId: string, fn: (j: Job) => void): void {
    this.jobs = this.jobs.map((j) => {
      if (j.id !== jobId) return j;
      const copy: Job = JSON.parse(JSON.stringify(j));
      fn(copy);
      return copy;
    });
    this.emit();
  }

  /** 看板统计 */
  stats(): {
    total: number; done: number; inProgress: number; rejected: number;
    completionRate: number; reworkRate: number; byMaster: { name: string; total: number; done: number; rework: number }[];
  } {
    const total = this.jobs.length;
    const done = this.jobs.filter((j) => j.status === 'done').length;
    const inProgress = this.jobs.filter((j) => ['assigned', 'submitted', 'rejected'].includes(j.status)).length;
    const rejected = this.jobs.filter((j) => j.reworkCount > 0).length;
    const byMaster = this.masters.map((m) => {
      const mine = this.jobs.filter((j) => j.master === m.id);
      return {
        name: m.name,
        total: mine.length,
        done: mine.filter((j) => j.status === 'done').length,
        rework: mine.reduce((s, j) => s + j.reworkCount, 0)
      };
    });
    return {
      total, done, inProgress, rejected,
      completionRate: total ? done / total : 0,
      reworkRate: total ? rejected / total : 0,
      byMaster
    };
  }

  statusLabel(s: JobStatus): string {
    return {
      pending: '待分派',
      assigned: '制作中',
      submitted: '待质检',
      rejected: '已打回',
      done: '已完成'
    }[s];
  }
}

export const store = new EditorStore();
