import type { Creek, CreekLock, Network, NetworkParams } from './types';
import type { NetworkPayload } from './archive-types';
import { captureLockFor, generateNetwork } from './generator';
import { Terrain } from './terrain';

export function toPayload(network: Network): NetworkPayload {
  return {
    params: { ...network.params } as unknown as Record<string, unknown>,
    fingerprint: network.fingerprint,
    generatedAt: network.generatedAt,
    creeks: network.creeks.map((c) => ({
      id: c.id,
      level: c.level,
      parentId: c.parentId,
      parentU: c.parentU,
      side: c.side,
      pts: Array.from(c.pts),
      widths: Array.from(c.widths),
      edited: c.edited,
    })),
  };
}

/** 从快照恢复网络 (不重新生成, 保留手工编辑) */
export function fromPayload(payload: NetworkPayload): Network {
  const params = payload.params as unknown as NetworkParams;
  const terrain = new Terrain(params);
  const creeks: Creek[] = payload.creeks.map((c) => {
    const pts = Float64Array.from(c.pts);
    const widths = Float32Array.from(c.widths);
    const s = new Float32Array(pts.length / 2);
    let total = 0;
    for (let i = 1; i < pts.length / 2; i++) {
      total += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
      s[i] = total;
    }
    const chord = pts.length >= 4
      ? Math.hypot(pts[pts.length - 2] - pts[0], pts[pts.length - 1] - pts[1])
      : 0;
    const n = pts.length / 2;
    return {
      id: c.id,
      level: c.level as 1 | 2 | 3,
      parentId: c.parentId,
      parentU: c.parentU,
      side: c.side as -1 | 0 | 1,
      pts,
      widths,
      s,
      length: total,
      mouthWidth: widths[0] ?? 0,
      headWidth: widths[n - 1] ?? 0,
      startElevation: n ? terrain.elevationAt(pts[0], pts[1]) : 0,
      headElevation: n ? terrain.elevationAt(pts[(n - 1) * 2], pts[(n - 1) * 2 + 1]) : 0,
      sinuosity: chord > 1 ? total / chord : 1,
      densityValue: 0,
      classIdx: { length: 0, density: 0, elevation: 0 },
      headTarget: NaN,
      stopReason: 'locked' as const,
      edited: c.edited,
    };
  });
  const byId = new Map(creeks.map((c) => [c.id, c]));
  const junctions = creeks
    .filter((c) => c.parentId && byId.has(c.parentId))
    .map((c) => {
      const p = byId.get(c.parentId!)!;
      return { x: c.pts[0], y: c.pts[1], r: Math.max(c.mouthWidth * 0.6, p.mouthWidth * 0.4), level: p.level, creekId: c.id };
    });
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of creeks) {
    for (let i = 0; i < c.pts.length / 2; i++) {
      minX = Math.min(minX, c.pts[i * 2]);
      maxX = Math.max(maxX, c.pts[i * 2]);
      minY = Math.min(minY, c.pts[i * 2 + 1]);
      maxY = Math.max(maxY, c.pts[i * 2 + 1]);
    }
  }
  const bounds = isFinite(minX)
    ? { minX: minX - 30, minY: minY - 30, maxX: maxX + 30, maxY: maxY + 30 }
    : { minX: -10, minY: -10, maxX: 10, maxY: 10 };
  // 走一遍默认派生量
  const shell = generateNetwork(params);
  const result: Network = {
    params,
    terrain: terrain.model,
    creeks,
    junctions,
    bounds,
    stats: { ...shell.stats, bounds },
    classes: shell.classes,
    fingerprint: payload.fingerprint,
    generatedAt: payload.generatedAt,
  };
  return result;
}

/** 把当前网络中的锁定段导出为 lock 记录 */
export function exportLocks(
  network: Network,
  lockIds: Set<string>,
  archiveId: string,
  at: string,
): CreekLock[] {
  const out: CreekLock[] = [];
  for (const c of network.creeks) {
    if (!lockIds.has(c.id)) continue;
    out.push(captureLockFor(network.creeks, c, at));
  }
  void archiveId;
  return out;
}
