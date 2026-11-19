import type { PathData, Pt, ViewTransform } from '../types';
import { distToPath, flattenPath } from './geometry';

export const HANDLE_HIT = 8; // 屏幕 px
export const NODE_HIT = 9;
export const STROKE_HIT = 7;

export function screenToDoc(sx: number, sy: number, view: ViewTransform): Pt {
  return { x: (sx - view.offsetX) / view.scale, y: (sy - view.offsetY) / view.scale };
}
export function docToScreen(dx: number, dy: number, view: ViewTransform): Pt {
  return { x: dx * view.scale + view.offsetX, y: dy * view.scale + view.offsetY };
}

export type Hit =
  | { kind: 'handle'; pathId: string; nodeIndex: number; which: 'in' | 'out' }
  | { kind: 'node'; pathId: string; nodeIndex: number }
  | { kind: 'stroke'; pathId: string; point: Pt }
  | { kind: 'empty' };

/** 命中测试:控制柄 → 节点 → 路径描边(锁定/隐藏的路径不参与) */
export function hitTest(
  docPt: Pt,
  paths: PathData[],
  view: ViewTransform,
): Hit {
  const tolNode = NODE_HIT / view.scale;
  const tolHandle = HANDLE_HIT / view.scale;
  const tolStroke = STROKE_HIT / view.scale;

  // 先在选中路径里找控制柄/节点,再全局找
  for (const p of paths) {
    if (!p.visible || p.locked) continue;
    for (let i = 0; i < p.nodes.length; i++) {
      const n = p.nodes[i];
      const hIn = p.handlesIn[i];
      const hOut = p.handlesOut[i];
      if (hIn) {
        const q = { x: n.x + hIn.x, y: n.y + hIn.y };
        if (Math.hypot(q.x - docPt.x, q.y - docPt.y) <= tolHandle) {
          return { kind: 'handle', pathId: p.id, nodeIndex: i, which: 'in' };
        }
      }
      if (hOut) {
        const q = { x: n.x + hOut.x, y: n.y + hOut.y };
        if (Math.hypot(q.x - docPt.x, q.y - docPt.y) <= tolHandle) {
          return { kind: 'handle', pathId: p.id, nodeIndex: i, which: 'out' };
        }
      }
    }
  }
  for (const p of paths) {
    if (!p.visible || p.locked) continue;
    for (let i = 0; i < p.nodes.length; i++) {
      if (Math.hypot(p.nodes[i].x - docPt.x, p.nodes[i].y - docPt.y) <= tolNode) {
        return { kind: 'node', pathId: p.id, nodeIndex: i };
      }
    }
  }
  // 描边命中:从上图层往下
  for (let pi = paths.length - 1; pi >= 0; pi--) {
    const p = paths[pi];
    if (!p.visible || p.locked) continue;
    const flat = flattenPath(p, 14);
    if (flat.length < 2) continue;
    const { d } = distToPath(docPt, flat, p.closed);
    if (d <= tolStroke) {
      return { kind: 'stroke', pathId: p.id, point: docPt };
    }
  }
  return { kind: 'empty' };
}

/** 命中参考线(屏幕距离 6px) */
export function hitGuide(docPt: Pt, guides: { id: string; orientation: 'h' | 'v'; pos: number }[], view: ViewTransform) {
  const tol = 6 / view.scale;
  for (const g of guides) {
    const d = g.orientation === 'h' ? Math.abs(g.pos - docPt.y) : Math.abs(g.pos - docPt.x);
    if (d <= tol) return g;
  }
  return null;
}

export interface DragState {
  type: 'node' | 'handle' | 'path' | 'pan' | 'guide';
  pathId?: string;
  nodeIndex?: number;
  which?: 'in' | 'out';
  startDoc: Pt;
  startNodes?: Pt[];
  startHandles?: { in: Pt | null; out: Pt | null }[];
  guideId?: string;
  moved: boolean;
  pointerId: number;
}

/** 控制柄联动:拖 in/out 之一时,按住 Shift 断开对称,否则对侧镜像 */
export function linkedHandlePos(dragged: Pt, opposite: Pt | null, broken: boolean): Pt | null {
  if (broken) return opposite;
  return { x: -dragged.x, y: -dragged.y };
}
