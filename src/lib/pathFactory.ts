import type { PathData, PathKind, Pt } from '../types';
import { uid } from './geometry';

const PALETTE = {
  vein: '#1f7a43',
  pattern: '#c07a2b',
};

export function makePath(kind: PathKind, name?: string): PathData {
  const n = kind === 'vein' ? '翅脉' : '斑纹';
  return {
    id: uid('path'),
    name: name || `${n} ${Math.floor(Math.random() * 900 + 100)}`,
    kind,
    closed: false,
    nodes: [],
    handlesIn: [],
    handlesOut: [],
    visible: true,
    locked: false,
    color: PALETTE[kind],
    holes: [],
  };
}

export function makeNode(p: Pt): { node: Pt; hIn: null; hOut: null } {
  return { node: { ...p }, hIn: null, hOut: null };
}

/** 对称控制柄:拖一个柄时对侧镜像 */
export function mirrorHandle(h: Pt): Pt {
  return { x: -h.x, y: -h.y };
}

/** 默认给平滑节点生成短柄 */
export function autoHandle(prev: Pt, cur: Pt, next: Pt, len = 28): { hIn: Pt; hOut: Pt } {
  const a = Math.atan2(next.y - prev.y, next.x - prev.x);
  return {
    hIn: { x: -Math.cos(a) * len, y: -Math.sin(a) * len },
    hOut: { x: Math.cos(a) * len, y: Math.sin(a) * len },
  };
}
