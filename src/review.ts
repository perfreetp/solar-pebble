import type { Annotation, Feature, FeatureDiff, ReviewVersion } from './types';

/** 本地持久化结构：要素数据可由种子重建，只存版本元数据与批注 */
export interface PersistedState {
  versions: {
    id: string;
    label: string;
    createdAt: string;
    note: string;
    seed: number;
    baseVersionId: string | null;
    annotations: Annotation[];
  }[];
}

const STORAGE_KEY = 'spaceport-review-state-v1';

export function loadPersisted(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PersistedState) : null;
  } catch {
    return null;
  }
}

export function savePersisted(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('批注持久化失败', e);
  }
}

let idCounter = 0;
export function uid(prefix: string): string {
  idCounter++;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function nowString(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function makeAnnotation(
  featureId: string | null,
  x: number,
  y: number,
  author: string,
  content: string,
): Annotation {
  return {
    id: uid('ann'),
    featureId,
    x,
    y,
    author,
    content,
    createdAt: nowString(),
    status: 'open',
    replies: [],
  };
}

/** 计算两个版本之间的要素差异：新增绿 / 删除红 / 修改黄 */
export function diffVersions(
  before: Record<string, Feature>,
  after: Record<string, Feature>,
): FeatureDiff[] {
  const diffs: FeatureDiff[] = [];
  for (const [id, afterF] of Object.entries(after)) {
    const beforeF = before[id];
    if (!beforeF) {
      diffs.push({ kind: 'added', featureId: id, layerId: afterF.layerId, after: afterF });
    } else if (!featureEqual(beforeF, afterF)) {
      diffs.push({ kind: 'modified', featureId: id, layerId: afterF.layerId, before: beforeF, after: afterF });
    }
  }
  for (const [id, beforeF] of Object.entries(before)) {
    if (!after[id]) {
      diffs.push({ kind: 'removed', featureId: id, layerId: beforeF.layerId, before: beforeF });
    }
  }
  return diffs;
}

export function featureEqual(a: Feature, b: Feature): boolean {
  return JSON.stringify(a.geom) === JSON.stringify(b.geom) && JSON.stringify(a.props) === JSON.stringify(b.props);
}

export function diffMap(diffs: FeatureDiff[]): Map<string, FeatureDiff['kind']> {
  return new Map(diffs.map((d) => [d.featureId, d.kind]));
}

export function buildVersion(
  id: string,
  label: string,
  note: string,
  features: readonly Feature[],
  annotations: Annotation[],
): ReviewVersion {
  const map: Record<string, Feature> = {};
  for (const f of features) map[f.id] = f;
  return { id, label, createdAt: nowString(), note, features: map, annotations };
}

export function featureArray(v: ReviewVersion): Feature[] {
  return Object.values(v.features);
}
