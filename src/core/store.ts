// 全局应用状态：项目数据 + 编辑设置，localStorage 持久化，轻量事件总线
import {
  GRID,
  MIRROR_PLANE,
  PALETTE,
  keyOf,
  uid,
  type Layer,
  type LayerData,
  type Project,
  type ProjectData,
  type ToolMode,
} from './types';
import { VoxelModel } from './voxel-model';

export interface EditorSettings {
  tool: ToolMode;
  color: number;
  brushSize: number;
  mirrorX: boolean;
  editActiveOnly: boolean;
  ortho: boolean;
}

type Handler = () => void;

const STORAGE_KEY = 'rocket-voxel-workbench-v1';

export class Store {
  projects: Project[] = [];
  currentProjectId: string | null = null;
  model = new VoxelModel();
  settings: EditorSettings = {
    tool: 'paint',
    color: PALETTE[0],
    brushSize: 1,
    mirrorX: false,
    editActiveOnly: false,
    ortho: false,
  };
  /** 撤销/重做栈：每个条目是一次可回滚的编辑 */
  undoStack: HistoryEntry[] = [];
  redoStack: HistoryEntry[] = [];

  private handlers = new Set<Handler>();

  subscribe(fn: Handler): () => void {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  emit(): void {
    this.persist();
    for (const fn of this.handlers) fn();
  }

  // ---------- 项目管理 ----------

  createProject(name: string, owner: string, deadline: string, code?: string): Project {
    const layers: Layer[] = [
      VoxelModel.createLayer('芯级主体', 'core'),
      VoxelModel.createLayer('助推器 A', 'booster'),
      VoxelModel.createLayer('整流罩', 'fairing'),
      VoxelModel.createLayer('尾翼', 'fin'),
    ];
    const now = new Date().toISOString();
    const proj: Project = {
      id: uid('prj'),
      code: code ?? 'RW-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
      name,
      owner,
      status: 'draft',
      deadline,
      returns: 0,
      maxReturns: 2,
      createdAt: now,
      updatedAt: now,
      activeLayerId: layers[0].id,
      layers,
    };
    this.projects.push(proj);
    this.openProject(proj.id);
    this.emit();
    return proj;
  }

  openProject(id: string): void {
    const p = this.projects.find((x) => x.id === id);
    if (!p) return;
    this.currentProjectId = id;
    this.model.layers = p.layers;
    this.undoStack = [];
    this.redoStack = [];
    this.emit();
  }

  closeProject(): void {
    this.currentProjectId = null;
    this.model.layers = [];
    this.emit();
  }

  get current(): Project | undefined {
    return this.projects.find((p) => p.id === this.currentProjectId);
  }

  get activeLayer(): Layer | undefined {
    const p = this.current;
    if (!p) return undefined;
    return p.layers.find((l) => l.id === p.activeLayerId) ?? p.layers[0];
  }

  setActiveLayer(id: string): void {
    const p = this.current;
    if (!p) return;
    p.activeLayerId = id;
    this.emit();
  }

  addLayer(name: string, group: Layer['group']): Layer {
    const layer = VoxelModel.createLayer(name, group);
    this.model.layers.push(layer);
    this.current!.activeLayerId = layer.id;
    this.emit();
    return layer;
  }

  // ---------- 历史 ----------

  pushHistory(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    entry.undo();
    this.redoStack.push(entry);
    this.emit();
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    entry.redo();
    this.undoStack.push(entry);
    this.emit();
  }

  // ---------- 审核流 ----------

  submitReview(): void {
    const p = this.current;
    if (!p || p.status !== 'draft') return;
    p.status = 'review';
    p.updatedAt = new Date().toISOString();
    this.emit();
  }

  /** 主管退回；达到两次退回上限则锁定条目 */
  returnEntry(reason: string): void {
    const p = this.current;
    if (!p || p.status !== 'review') return;
    p.returns += 1;
    p.status = p.returns >= p.maxReturns ? 'locked' : 'draft';
    p.updatedAt = new Date().toISOString();
    console.info(`[退回 ${p.returns}/${p.maxReturns}] ${reason}`);
    this.emit();
  }

  approve(): void {
    const p = this.current;
    if (!p || p.status !== 'review') return;
    p.status = 'approved';
    p.updatedAt = new Date().toISOString();
    this.emit();
  }

  /** 打包交付给展陈方 */
  deliver(): void {
    const p = this.current;
    if (!p || p.status !== 'approved') return;
    p.status = 'delivered';
    p.updatedAt = new Date().toISOString();
    this.emit();
  }

  // ---------- 持久化 ----------

  persist(): void {
    try {
      const data = {
        projects: this.projects.map(serializeProject),
        currentProjectId: this.currentProjectId,
        settings: this.settings,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('持久化失败', e);
    }
  }

  load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        this.seedDemo();
        return;
      }
      const data = JSON.parse(raw) as {
        projects: ProjectData[];
        currentProjectId: string | null;
        settings: EditorSettings;
      };
      this.projects = data.projects.map(deserializeProject);
      Object.assign(this.settings, data.settings);
      if (data.currentProjectId) this.openProject(data.currentProjectId);
    } catch (e) {
      console.warn('读取存档失败，使用示例数据', e);
      this.seedDemo();
    }
  }

  /** 首次使用的演示项目：一枚简化小火箭，便于立刻看到效果 */
  private seedDemo(): void {
    const p = this.createProject(
      '长征系列演示火箭',
      '制作员·小宇',
      new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    );
    const [core, booster, fairing, fin] = p.layers;
    const cx = MIRROR_PLANE;
    const white = PALETTE[0], blue = PALETTE[4], red = PALETTE[5], gray = PALETTE[2];
    // 芯级：圆柱近似（半径 7，高度 60）
    for (let y = 14; y < 74; y++) {
      for (let dx = -7; dx <= 7; dx++) {
        for (let dz = -7; dz <= 7; dz++) {
          if (dx * dx + dz * dz <= 49) {
            const band = y > 64 ? blue : white;
            core.voxels.set(keyOf(cx + dx, y, cx + dz), band);
          }
        }
      }
    }
    // 整流罩：锥形
    for (let y = 74; y < 92; y++) {
      const r = Math.max(1, Math.round(7 * (1 - (y - 74) / 20)));
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx * dx + dz * dz <= r * r) {
            fairing.voxels.set(keyOf(cx + dx, y, cx + dz), white);
          }
        }
      }
    }
    // 四枚助推器（绕 Y 轴 90° 阵列位置）
    const offs: Array<[number, number]> = [[14, 0], [-14, 0], [0, 14], [0, -14]];
    for (const [ox, oz] of offs) {
      for (let y = 8; y < 40; y++) {
        for (let dx = -3; dx <= 3; dx++) {
          for (let dz = -3; dz <= 3; dz++) {
            if (dx * dx + dz * dz <= 10) {
              booster.voxels.set(keyOf(cx + ox + dx, y, cx + oz + dz), y < 12 ? red : white);
            }
          }
        }
      }
    }
    // 四片尾翼
    for (const [ox, oz] of offs) {
      for (let y = 14; y < 26; y++) {
        const reach = 26 - y;
        for (let t = 0; t < reach; t++) {
          const sx = ox === 0 ? 0 : Math.sign(ox) * (8 + t);
          const sz = oz === 0 ? 0 : Math.sign(oz) * (8 + t);
          fin.voxels.set(keyOf(cx + sx, y, cx + sz), gray);
        }
      }
    }
    this.undoStack = [];
    this.redoStack = [];
    this.emit();
  }
}

export interface HistoryEntry {
  label: string;
  undo: () => void;
  redo: () => void;
}

function serializeProject(p: Project): ProjectData {
  return {
    ...p,
    layers: p.layers.map((l): LayerData => ({
      id: l.id,
      name: l.name,
      group: l.group,
      visible: l.visible,
      locked: l.locked,
      voxels: Object.fromEntries(l.voxels),
    })),
  };
}

function deserializeProject(d: ProjectData): Project {
  return {
    ...d,
    layers: d.layers.map((l) => ({
      ...l,
      voxels: new Map(Object.entries(l.voxels).map(([k, v]) => [k, Number(v)])),
    })),
  };
}

export const store = new Store();
export { GRID };
