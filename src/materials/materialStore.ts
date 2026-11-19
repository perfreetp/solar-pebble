import { createSignal } from 'solid-js';
import type {
  BatchStatus,
  CheckIssue,
  ItemStatus,
  MaterialBatch,
  MaterialItem,
} from '../types';
import { batchIsReleasable, checkMaterialFile, type IncomingFile } from './checkRules';

const STORAGE_KEY = 'crater-material-batches-v1';
const REVIEWER = '复核员·当前工位';

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

function loadBatches(): MaterialBatch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as MaterialBatch[];
  } catch {
    /* 损坏存档忽略 */
  }
  return seedDemo();
}

/** 首次使用时给两批演示数据,展示检查/复核/放行全流程 */
function seedDemo(): MaterialBatch[] {
  const goodFiles: IncomingFile[] = [
    { name: 'topsoil_diffuse_01.png', sizeKb: 8420 },
    { name: 'topsoil_normal_01.png', sizeKb: 6100 },
    { name: 'ejecta_diffuse_02.ktx2', sizeKb: 3200 },
    { name: 'bedrock_scan_03.glb', sizeKb: 24800 },
    { name: 'bedrock_scan_texture_03.png', sizeKb: 7200 },
    { name: 'ejecta_grain_meta.json', sizeKb: 86 },
  ];
  const badFiles: IncomingFile[] = [
    { name: '奇怪的文件.exe', sizeKb: 1200 },
    { name: 'topsoil_diffuse_01.png', sizeKb: 8420 }, // 与上一批同校验和(跨批不判重,批内另有重复)
    { name: 'topsoil_diffuse_01.png', sizeKb: 8420 },
    { name: 'raw_photo.bmp', sizeKb: 42000 },
    { name: 'ejecta_model_highdetail.obj', sizeKb: 96 * 1024 },
    { name: 'empty_sheet.csv', sizeKb: 0 },
    { name: 'mystery_texture.png', sizeKb: 5400 },
  ];
  const build = (
    id: string,
    supplier: string,
    files: IncomingFile[],
    status: BatchStatus,
    arrivedAt: number,
  ): MaterialBatch => ({
    id,
    supplier,
    arrivedAt,
    status,
    items: files.map((f, i) => {
      const checked = checkMaterialFile(f, i, files);
      return { ...checked, id: uid('itm'), status: 'pending' as ItemStatus };
    }),
  });

  const b1 = build(
    uid('bat'),
    '戈壁地质素材供应站',
    goodFiles,
    'pending_review',
    Date.now() - 1000 * 60 * 60 * 26,
  );
  const b2 = build(
    uid('bat'),
    '远控扫描外包队',
    badFiles,
    'pending_review',
    Date.now() - 1000 * 60 * 42,
  );
  return [b2, b1];
}

const [batches, setBatches] = createSignal<MaterialBatch[]>(loadBatches());
const [activeBatchId, setActiveBatchId] = createSignal<string | null>(
  batches()[0]?.id ?? null,
);

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persist(next: MaterialBatch[]) {
  setBatches(next);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* 满额静默 */
    }
  }, 300);
}

function mutate(batchId: string, fn: (b: MaterialBatch) => void) {
  const next = batches().map((b) => {
    if (b.id !== batchId) return b;
    const clone: MaterialBatch = structuredClone(b);
    fn(clone);
    return clone;
  });
  persist(next);
}

/** 一批素材导入:登记 → 自动逐项检查 → 进入待复核 */
function ingestBatch(supplier: string, files: IncomingFile[]): MaterialBatch {
  const id = uid('bat');
  const items: MaterialItem[] = files.map((f, i) => {
    const checked = checkMaterialFile(f, i, files);
    return { ...checked, id: uid('itm'), status: 'pending' };
  });
  const batch: MaterialBatch = {
    id,
    supplier: supplier || '未登记供应方',
    arrivedAt: Date.now(),
    status: 'checking',
    items,
  };
  persist([batch, ...batches()]);
  // 模拟检查流水线,给界面一个可见的「检查中→待复核」过程
  setTimeout(() => {
    mutate(id, (b) => {
      b.status = 'pending_review';
    });
  }, 900);
  setActiveBatchId(id);
  return batch;
}

/** 复核一条问题:确认(接受)/ 驳回 */
function reviewIssue(batchId: string, itemId: string, issueId: string, accept: boolean) {
  mutate(batchId, (b) => {
    const item = b.items.find((i) => i.id === itemId);
    const iss = item?.issues.find((x) => x.id === issueId);
    if (!iss || !item) return;
    iss.status = accept ? 'confirmed' : 'rejected';
    iss.reviewer = REVIEWER;
    iss.reviewedAt = Date.now();
    item.status = deriveItemStatus(item);
  });
}

/** 整素材条目一键复核全部未决问题 */
function reviewAllOpen(batchId: string, itemId: string, accept: boolean) {
  mutate(batchId, (b) => {
    const item = b.items.find((i) => i.id === itemId);
    if (!item) return;
    for (const iss of item.issues) {
      if (iss.status !== 'open') continue;
      iss.status = accept ? 'confirmed' : 'rejected';
      iss.reviewer = REVIEWER;
      iss.reviewedAt = Date.now();
    }
    item.status = deriveItemStatus(item);
  });
}

function deriveItemStatus(item: MaterialItem): ItemStatus {
  if (item.issues.some((i: CheckIssue) => i.status === 'rejected')) return 'rejected';
  if (item.issues.every((i) => i.status !== 'open')) return 'approved';
  return 'pending';
}

/** 整批达标才放行 */
function releaseBatch(batchId: string): boolean {
  const b = batches().find((x) => x.id === batchId);
  if (!b || !batchIsReleasable(b.items)) return false;
  mutate(batchId, (x) => {
    x.status = 'released';
    x.releasedAt = Date.now();
    for (const item of x.items) {
      if (item.status === 'pending') item.status = 'approved';
    }
  });
  return true;
}

/** 退回供应方:含驳回项或复核不通过的批次整批退回 */
function returnBatch(batchId: string, reason: string) {
  mutate(batchId, (b) => {
    b.status = 'returned';
    b.returnReason = reason;
  });
}

function activeBatch(): MaterialBatch | null {
  return batches().find((b) => b.id === activeBatchId()) ?? null;
}

/** 顶部导航角标统计:待复核问题数 */
function openIssueCount(): number {
  let n = 0;
  for (const b of batches()) {
    if (b.status !== 'pending_review' && b.status !== 'checking') continue;
    for (const item of b.items) {
      n += item.issues.filter((i) => i.status === 'open').length;
    }
  }
  return n;
}

export const materialStore = {
  batches,
  activeBatchId,
  setActiveBatchId,
  activeBatch,
  ingestBatch,
  reviewIssue,
  reviewAllOpen,
  releaseBatch,
  returnBatch,
  openIssueCount,
};
