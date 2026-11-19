/** 应用状态: 单一数据源 + 订阅 */
import type { ColorMode, CreekLock, Network, NetworkParams } from '../core/types';
import { DEFAULT_PARAMS } from '../core/types';
import type { BasemapRef, ArchiveRecord, VersionRecord } from '../core/archive-types';
import type { LockReport } from '../core/generator';

export type Tool = 'pan' | 'edit' | 'lock' | 'inspect';
export type MainView = 'workspace' | 'archive' | 'compare' | 'report';

export interface AppState {
  params: NetworkParams;
  network: Network | null;
  locks: CreekLock[];
  selectedCreekId: string | null;
  hoverCreekId: string | null;
  lockedIds: Set<string>;
  tool: Tool;
  view: MainView;
  colorMode: ColorMode;
  levelAlpha: Record<1 | 2 | 3, number>;
  levelVisible: Record<1 | 2 | 3, boolean>;
  showContours: boolean;
  showGrid: boolean;
  showBasemap: boolean;
  basemap: BasemapRef | null;
  basemapImage: ImageBitmap | null;
  lockReport: LockReport[];
  compareVersionId: string | null;
  compareNetwork: Network | null;
  activeArchiveId: string | null;
  generating: boolean;
  toast: { text: string; kind: 'info' | 'ok' | 'warn' | 'error' } | null;
  surveyor: string;
  region: string;
  observedAt: string;
  archiveName: string;
}

type Listener = (s: AppState, patch: Partial<AppState>) => void;

export class Store {
  private state: AppState;
  private listeners = new Set<Listener>();

  constructor() {
    const today = new Date();
    this.state = {
      params: { ...DEFAULT_PARAMS },
      network: null,
      locks: [],
      selectedCreekId: null,
      hoverCreekId: null,
      lockedIds: new Set(),
      tool: 'pan',
      view: 'workspace',
      colorMode: 'level',
      levelAlpha: { 1: 1, 2: 0.94, 3: 0.82 },
      levelVisible: { 1: true, 2: true, 3: true },
      showContours: true,
      showGrid: true,
      showBasemap: true,
      basemap: null,
      basemapImage: null,
      lockReport: [],
      compareVersionId: null,
      compareNetwork: null,
      activeArchiveId: null,
      generating: false,
      toast: null,
      surveyor: '海岸带调查一队',
      region: '江苏中部岸段',
      observedAt: today.toISOString().slice(0, 10),
      archiveName: '潮沟网络调查成果',
    };
  }

  get(): AppState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  set(patch: Partial<AppState>): void {
    const prev = this.state;
    this.state = { ...prev, ...patch };
    for (const fn of this.listeners) fn(this.state, patch);
  }

  setParams(patch: Partial<NetworkParams>): void {
    this.set({ params: { ...this.state.params, ...patch } });
  }

  toast(text: string, kind: AppState['toast'] extends infer T ? (T extends { kind: infer K } ? K : never) : never = 'info'): void {
    this.set({ toast: { text, kind } });
    window.setTimeout(() => {
      if (this.state.toast?.text === text) this.set({ toast: null });
    }, 4200);
  }
}

/* 档案相关的小工具 */
export type { ArchiveRecord, VersionRecord };
