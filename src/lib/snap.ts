import type { Pt } from '../types';
import type { PathData, GuideLine } from '../types';

export interface SnapResult {
  point: Pt;
  target:
    | { type: 'node'; pathId: string; index: number; point: Pt }
    | { type: 'hguide'; id: string; pos: number }
    | { type: 'vguide'; id: string; pos: number }
    | null;
  /** 智能辅助线(与其它节点同 x / 同 y 时给出) */
  smartGuides: { orientation: 'h' | 'v'; pos: number }[];
}

const SNAP_THRESHOLD = 12; // 屏幕像素

/**
 * 拖动节点时的吸附:
 * 1. 其它路径的节点 2. 水平/垂直参考线 3. 其它节点的 x/y 投影(智能参考线)
 */
export function snapPoint(
  p: Pt,
  paths: PathData[],
  guides: GuideLine[],
  exclude: { pathId: string; index: number },
  scale: number,
): SnapResult {
  const threshold = SNAP_THRESHOLD / scale;
  let best: { d: number; point: Pt; target: SnapResult['target'] } | null = null;
  const smart: { orientation: 'h' | 'v'; pos: number }[] = [];

  // 节点吸附
  for (const path of paths) {
    if (!path.visible || path.locked) continue;
    for (let i = 0; i < path.nodes.length; i++) {
      if (path.id === exclude.pathId && i === exclude.index) continue;
      const n = path.nodes[i];
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < threshold && (!best || d < best.d)) {
        best = { d, point: { ...n }, target: { type: 'node', pathId: path.id, index: i, point: n } };
      }
      // 智能投影参考线
      if (Math.abs(n.x - p.x) < threshold) smart.push({ orientation: 'v', pos: n.x });
      if (Math.abs(n.y - p.y) < threshold) smart.push({ orientation: 'h', pos: n.y });
    }
  }

  // 参考线吸附
  for (const g of guides) {
    const d = g.orientation === 'h' ? Math.abs(g.pos - p.y) : Math.abs(g.pos - p.x);
    if (d < threshold && (!best || d < best.d)) {
      const point = g.orientation === 'h' ? { x: p.x, y: g.pos } : { x: g.pos, y: p.y };
      best = {
        d, point,
        target: g.orientation === 'h'
          ? { type: 'hguide', id: g.id, pos: g.pos }
          : { type: 'vguide', id: g.id, pos: g.pos },
      };
    }
  }

  if (best) {
    return { point: best.point, target: best.target, smartGuides: dedupeSmart(smart) };
  }
  // 没有强吸附时,智能投影也可以直接吸附坐标
  const vg = smart.find(s => s.orientation === 'v');
  const hg = smart.find(s => s.orientation === 'h');
  const point = { x: vg ? vg.pos : p.x, y: hg ? hg.pos : p.y };
  if (vg || hg) {
    return { point, target: null, smartGuides: dedupeSmart(smart) };
  }
  return { point: p, target: null, smartGuides: [] };
}

function dedupeSmart(list: { orientation: 'h' | 'v'; pos: number }[]) {
  const seen = new Set<string>();
  return list.filter(s => {
    const k = `${s.orientation}:${Math.round(s.pos)}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).slice(0, 4);
}
