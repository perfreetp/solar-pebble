/** 记忆库: localStorage 持久化, 提供档案 / 版本 / 锁定段的增删查改 */
import type {
  ArchiveRecord,
  BasemapRef,
  DbShape,
  LockRecord,
  VersionRecord,
} from './core/archive-types';
import type { CreekLock, Network } from './core/types';
import { toPayload } from './core/serialize';

const KEY = 'tidal-creek-studio:v1';

function empty(): DbShape {
  return { version: 1, archives: [], versions: [], locks: [], counter: 0 };
}

function nowIso(): string {
  return new Date().toISOString();
}

/** 常见岸段 → 两位字母代号; 未知区域取拼音首字母之外的稳定短码 */
const REGION_CODES: Record<string, string> = {
  江苏中部岸段: 'JS-C',
  江苏北部岸段: 'JS-N',
  江苏南部岸段: 'JS-S',
  盐城: 'YC',
  南通: 'NT',
  连云港: 'LYG',
  上海: 'SH',
  浙江: 'ZJ',
  福建: 'FJ',
  山东: 'SD',
  广东: 'GD',
  广西: 'GX',
  海南: 'HN',
  河北: 'HE',
  天津: 'TJ',
  辽宁: 'LN',
};

function nextCode(db: DbShape, year: number, region: string): string {
  db.counter += 1;
  const known = REGION_CODES[region];
  let regionCode = known;
  if (!regionCode) {
    const ascii = region.match(/[A-Za-z]{2,}/);
    if (ascii) regionCode = ascii[0].toUpperCase().slice(0, 3);
    else {
      // 无对应代号时, 用区域名 C0 散列生成稳定的两位字母/数字
      const h = [...region].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 7);
      regionCode = `R${(h % 97).toString(36).toUpperCase().padStart(2, '0')}`;
    }
  }
  return `TC-${year}-${regionCode}-${String(db.counter).padStart(3, '0')}`;
}

export class Studio {
  private db: DbShape;

  constructor() {
    this.db = this.load();
  }

  private load(): DbShape {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return empty();
      const parsed = JSON.parse(raw) as DbShape;
      if (!parsed || parsed.version !== 1) return empty();
      return {
        version: 1,
        archives: parsed.archives ?? [],
        versions: parsed.versions ?? [],
        locks: parsed.locks ?? [],
        counter: parsed.counter ?? 0,
      };
    } catch {
      return empty();
    }
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.db));
    } catch (e) {
      console.warn('[studio] 本地存储写入失败', e);
    }
  }

  /* ---- 档案 ---- */

  listArchives(): ArchiveRecord[] {
    return [...this.db.archives].sort((a, b) => b.year - a.year || b.updatedAt.localeCompare(a.updatedAt));
  }

  getArchive(id: string): ArchiveRecord | undefined {
    return this.db.archives.find((a) => a.id === id);
  }

  createArchive(input: {
    name: string;
    region: string;
    year: number;
    surveyor: string;
    observedAt: string;
    network: Network;
    notes?: string;
    basemap?: BasemapRef | null;
    lockCount?: number;
    status?: 'draft' | 'archived';
  }): ArchiveRecord {
    const year = input.year;
    const code = nextCode(this.db, year, input.region);
    const now = nowIso();
    const s = input.network.stats;
    const rec: ArchiveRecord = {
      id: `arc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      code,
      name: input.name,
      year,
      region: input.region,
      surveyor: input.surveyor,
      observedAt: input.observedAt,
      status: input.status ?? 'archived',
      notes: input.notes ?? '',
      params: { ...input.network.params } as unknown as Record<string, unknown>,
      fingerprint: input.network.fingerprint,
      stats: {
        counts: s.counts as unknown as Record<string, number>,
        totalLength: s.totalLength,
        junctionCount: s.junctionCount,
        densityKmPerKm2: s.densityKmPerKm2,
        headMin: s.headMin,
        headMax: s.headMax,
        meanSinuosity: s.meanSinuosity,
      },
      levelCounts: {
        '1': s.counts[1],
        '2': s.counts[2],
        '3': s.counts[3],
      },
      lockCount: input.lockCount ?? 0,
      basemap: input.basemap ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.db.archives.push(rec);
    this.save();
    return rec;
  }

  updateArchive(id: string, patch: Partial<ArchiveRecord>): ArchiveRecord | undefined {
    const rec = this.db.archives.find((a) => a.id === id);
    if (!rec) return undefined;
    Object.assign(rec, patch, { updatedAt: nowIso() });
    this.save();
    return rec;
  }

  deleteArchive(id: string): void {
    this.db.archives = this.db.archives.filter((a) => a.id !== id);
    this.db.versions = this.db.versions.filter((v) => v.archiveId !== id);
    this.db.locks = this.db.locks.filter((l) => l.archiveId !== id);
    this.save();
  }

  /** 检索: 年份 / 区域 / 沟级别 / 关键词 */
  searchArchives(q: {
    year?: number | 'all';
    region?: string;
    level?: 1 | 2 | 3 | 'all';
    keyword?: string;
  }): ArchiveRecord[] {
    const kw = (q.keyword ?? '').trim().toLowerCase();
    return this.listArchives().filter((a) => {
      if (q.year && q.year !== 'all' && a.year !== q.year) return false;
      if (q.region && q.region !== 'all' && a.region !== q.region) return false;
      if (q.level && q.level !== 'all') {
        const key = String(q.level);
        if ((a.levelCounts[key] ?? 0) <= 0) return false;
      }
      if (kw) {
        const hay = `${a.code} ${a.name} ${a.region} ${a.surveyor} ${a.notes}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }

  years(): number[] {
    return [...new Set(this.db.archives.map((a) => a.year))].sort((a, b) => b - a);
  }

  regions(): string[] {
    return [...new Set(this.db.archives.map((a) => a.region))].filter(Boolean).sort();
  }

  /* ---- 版本 ---- */

  listVersions(archiveId: string): VersionRecord[] {
    return this.db.versions
      .filter((v) => v.archiveId === archiveId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  listAllVersions(): VersionRecord[] {
    return [...this.db.versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  saveVersion(archiveId: string, label: string, network: Network): VersionRecord {
    const rec: VersionRecord = {
      id: `ver_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      archiveId,
      label,
      createdAt: nowIso(),
      fingerprint: network.fingerprint,
      params: { ...network.params } as unknown as Record<string, unknown>,
      stats: {
        totalLength: network.stats.totalLength,
        counts: network.stats.counts,
        junctionCount: network.stats.junctionCount,
        densityKmPerKm2: network.stats.densityKmPerKm2,
      },
      payload: toPayload(network),
    };
    this.db.versions.push(rec);
    // 单档案最多保留 40 个版本
    const mine = this.db.versions.filter((v) => v.archiveId === archiveId);
    if (mine.length > 40) {
      const drop = new Set(mine.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, mine.length - 40).map((v) => v.id));
      this.db.versions = this.db.versions.filter((v) => !drop.has(v.id));
    }
    this.save();
    return rec;
  }

  deleteVersion(id: string): void {
    this.db.versions = this.db.versions.filter((v) => v.id !== id);
    this.save();
  }

  /* ---- 锁定段 ---- */

  listLocks(archiveId: string): LockRecord[] {
    return this.db.locks.filter((l) => l.archiveId === archiveId);
  }

  listAllLocks(): LockRecord[] {
    return [...this.db.locks];
  }

  saveLock(archiveId: string, lock: CreekLock): LockRecord {
    const rec: LockRecord = {
      lockId: `lk_${lock.creekId}_${Date.now().toString(36)}`,
      archiveId,
      creekId: lock.creekId,
      level: lock.level,
      parentId: lock.parentId,
      parentU: lock.parentU,
      side: lock.side,
      relativeAngle: lock.relativeAngle,
      localPts: lock.localPts,
      length: lock.length,
      mouthWidth: lock.mouthWidth,
      widthScale: lock.widthScale,
      shapeSignature: lock.shapeSignature,
      capturedAt: lock.capturedAt || nowIso(),
    };
    this.db.locks.push(rec);
    this.save();
    return rec;
  }

  replaceLocks(archiveId: string, locks: CreekLock[]): void {
    this.db.locks = this.db.locks.filter((l) => l.archiveId !== archiveId);
    for (const l of locks) this.saveLock(archiveId, l);
  }

  removeLock(archiveId: string, creekId: string): void {
    this.db.locks = this.db.locks.filter((l) => !(l.archiveId === archiveId && l.creekId === creekId));
    this.save();
  }

  toCreekLock(rec: LockRecord): CreekLock {
    return {
      creekId: rec.creekId,
      level: rec.level as 1 | 2 | 3,
      parentId: rec.parentId,
      parentU: rec.parentU,
      side: rec.side as -1 | 0 | 1,
      relativeAngle: rec.relativeAngle,
      localPts: rec.localPts,
      length: rec.length,
      mouthWidth: rec.mouthWidth,
      widthScale: rec.widthScale,
      shapeSignature: rec.shapeSignature,
      capturedAt: rec.capturedAt,
    };
  }

  /* ---- 导入导出 ---- */

  exportAll(): DbShape {
    return JSON.parse(JSON.stringify(this.db)) as DbShape;
  }

  importAll(db: DbShape): void {
    if (!db || db.version !== 1) throw new Error('不支持的档案格式');
    this.db = {
      version: 1,
      archives: db.archives ?? [],
      versions: db.versions ?? [],
      locks: db.locks ?? [],
      counter: db.counter ?? 0,
    };
    this.save();
  }

  clearAll(): void {
    this.db = empty();
    this.save();
  }
}
