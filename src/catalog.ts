import type { CatalogItem, ComponentKind, Master } from './types';

/** 构件库目录 */
export const CATALOG: CatalogItem[] = [
  {
    kind: 'tank',
    label: '生态展箱',
    defaultSize: { x: 1.2, y: 0.9, z: 0.8 },
    color: 0x9fc7d8,
    unit: '个',
    desc: '玻璃展箱容器，自带台面，其他构件布置在箱内'
  },
  {
    kind: 'log',
    label: '枯木',
    defaultSize: { x: 0.5, y: 0.12, z: 0.12 },
    color: 0x8a5a33,
    unit: '根',
    desc: '供昆虫攀爬栖息的沉木 / 枯枝'
  },
  {
    kind: 'moss',
    label: '苔藓块',
    defaultSize: { x: 0.3, y: 0.06, z: 0.25 },
    color: 0x5d8a4a,
    unit: '块',
    desc: '保湿苔藓，铺设于台面或构件上方'
  },
  {
    kind: 'net',
    label: '攀爬网',
    defaultSize: { x: 0.45, y: 0.5, z: 0.02 },
    color: 0xb8b0a0,
    unit: '张',
    desc: '贴背板安装的网状攀爬面'
  },
  {
    kind: 'basin',
    label: '水盆',
    defaultSize: { x: 0.22, y: 0.07, z: 0.22 },
    color: 0x4a90b8,
    unit: '个',
    desc: '浅水盆，保持箱内水源'
  },
  {
    kind: 'backpanel',
    label: '背板',
    defaultSize: { x: 1.0, y: 0.7, z: 0.03 },
    color: 0x7d7468,
    unit: '块',
    desc: '展箱后壁挡板，攀爬网可贴附其上'
  }
];

export const KIND_LABEL: Record<ComponentKind, string> = {
  tank: '生态展箱',
  log: '枯木',
  moss: '苔藓块',
  net: '攀爬网',
  basin: '水盆',
  backpanel: '背板'
};

export const DEFAULT_MASTERS: Master[] = [
  { id: 'm1', name: '张师傅', role: '木作 / 枯木造景' },
  { id: 'm2', name: '李师傅', role: '水路 / 水盆安装' },
  { id: 'm3', name: '王师傅', role: '网面 / 背板装配' },
  { id: 'm4', name: '赵师傅', role: '苔藓 / 植物布置' }
];

const STORAGE_KEY = 'ecovivarium-editor-state-v1';

export function loadState<T>(fallback: () => T): T {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback();
    return { ...fallback(), ...(JSON.parse(raw) as object) } as T;
  } catch {
    return fallback();
  }
}

export function saveState(state: unknown): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* 存储不可用时静默 */
  }
}

let seq = 0;
/** 生成 id，时间戳 + 计数器，避免 Date.now 在特殊环境的限制 */
export function uid(prefix = 'c'): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}${Math.floor(performance.now()).toString(36)}`;
}
