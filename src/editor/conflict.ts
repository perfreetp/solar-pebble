/**
 * 版面冲突检测：管线（pipeline）与标识牌（sign）发生压盖时标红。
 * 判据：管线采样点落在标识牌多边形内，或两者线段相交。
 * 分区线（zone）之间不判冲突。
 */
import type { Matrix, Pt, VecPath } from './types';
import { pointInPolygon, segIntersect, worldSamples } from './geometry';

export interface ConflictInfo {
  itemId: string;
  with: string[];
}

export function detectConflicts(
  items: VecPath[],
  groupTx: (item: VecPath) => Matrix | null,
): Map<string, ConflictInfo> {
  const result = new Map<string, ConflictInfo>();
  const signs = items.filter((i) => i.type === 'sign' && i.closed);
  const pipelines = items.filter((i) => i.type === 'pipeline');
  if (!signs.length || !pipelines.length) return result;

  const signPolys = signs.map((s) => ({ item: s, pts: worldSamples(s, groupTx(s)) }));

  for (const pipe of pipelines) {
    const ppts = worldSamples(pipe, groupTx(pipe));
    const hitWith: string[] = [];
    for (const sp of signPolys) {
      if (sp.item.id === pipe.id) continue;
      let overlap = false;
      // 管线点进入标识牌区域（含少量压边容差，工程上沿边压盖也算冲突）
      const tol = 6;
      for (const p of ppts) {
        if (pointInPolygon(p, sp.pts) || nearPolygonEdge(p, sp.pts, tol)) {
          overlap = true;
          break;
        }
      }
      // 或线段相交
      if (!overlap) {
        outer: for (let i = 0; i < ppts.length - 1; i++) {
          for (let j = 0; j < sp.pts.length - 1; j++) {
            if (segIntersect(ppts[i], ppts[i + 1], sp.pts[j], sp.pts[j + 1])) {
              overlap = true;
              break outer;
            }
          }
          if (sp.pts.length > 2 &&
            segIntersect(ppts[i], ppts[i + 1], sp.pts[sp.pts.length - 1], sp.pts[0])) {
            overlap = true;
            break;
          }
        }
      }
      if (overlap) hitWith.push(sp.item.id);
    }
    if (hitWith.length) result.set(pipe.id, { itemId: pipe.id, with: hitWith });
  }
  return result;
}

/** 点是否贴近多边形的任意边（压边容差判定） */
function nearPolygonEdge(p: Pt, poly: Pt[], tol: number): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const v = { x: b.x - a.x, y: b.y - a.y };
    const l2 = v.x * v.x + v.y * v.y || 1;
    let t = ((p.x - a.x) * v.x + (p.y - a.y) * v.y) / l2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(p.x - (a.x + t * v.x), p.y - (a.y + t * v.y));
    if (d <= tol) return true;
  }
  return false;
}
