import type { PathData, Pt } from '../types';
import { bboxOf, movePath } from './geometry';

/** 左对齐:所有选中路径左边界对齐到最小 x */
export function alignLeft(paths: PathData[]): void {
  if (paths.length < 2) return;
  const minX = Math.min(...paths.map(p => bboxOf(p.nodes).x));
  paths.forEach(p => {
    const b = bboxOf(p.nodes);
    movePath(p, minX - b.x, 0);
  });
}

export function alignCenterX(paths: PathData[]): void {
  if (paths.length < 2) return;
  const centers = paths.map(p => {
    const b = bboxOf(p.nodes);
    return b.x + b.w / 2;
  });
  const target = (Math.min(...centers) + Math.max(...centers)) / 2;
  paths.forEach((p, i) => movePath(p, target - centers[i], 0));
}

export function alignTop(paths: PathData[]): void {
  if (paths.length < 2) return;
  const minY = Math.min(...paths.map(p => bboxOf(p.nodes).y));
  paths.forEach(p => {
    const b = bboxOf(p.nodes);
    movePath(p, 0, minY - b.y);
  });
}

export function alignCenterY(paths: PathData[]): void {
  if (paths.length < 2) return;
  const centers = paths.map(p => {
    const b = bboxOf(p.nodes);
    return b.y + b.h / 2;
  });
  const target = (Math.min(...centers) + Math.max(...centers)) / 2;
  paths.forEach((p, i) => movePath(p, 0, target - centers[i]));
}

/** 横向等间距分布:按当前左边界排序,相邻路径间隙相等 */
export function distributeX(paths: PathData[]): void {
  if (paths.length < 3) return;
  const items = paths.map(p => ({ p, b: bboxOf(p.nodes) })).sort((a, b) => a.b.x - b.b.x);
  const totalWidth = items.reduce((s, it) => s + it.b.w, 0);
  const span = (items[items.length - 1].b.x + items[items.length - 1].b.w) - items[0].b.x;
  const gap = (span - totalWidth) / (items.length - 1);
  let cursor = items[0].b.x;
  items.forEach(it => {
    const dx = cursor - it.b.x;
    if (Math.abs(dx) > 0.01) movePath(it.p, dx, 0);
    cursor += it.b.w + gap;
  });
}

export function distributeY(paths: PathData[]): void {
  if (paths.length < 3) return;
  const items = paths.map(p => ({ p, b: bboxOf(p.nodes) })).sort((a, b) => a.b.y - b.b.y);
  const totalHeight = items.reduce((s, it) => s + it.b.h, 0);
  const span = (items[items.length - 1].b.y + items[items.length - 1].b.h) - items[0].b.y;
  const gap = (span - totalHeight) / (items.length - 1);
  let cursor = items[0].b.y;
  items.forEach(it => {
    const dy = cursor - it.b.y;
    if (Math.abs(dy) > 0.01) movePath(it.p, 0, dy);
    cursor += it.b.h + gap;
  });
}

export type AlignAction = 'left' | 'centerX' | 'top' | 'centerY' | 'distX' | 'distY';

export function applyAlign(action: AlignAction, paths: PathData[]): Pt | null {
  switch (action) {
    case 'left': alignLeft(paths); break;
    case 'centerX': alignCenterX(paths); break;
    case 'top': alignTop(paths); break;
    case 'centerY': alignCenterY(paths); break;
    case 'distX': distributeX(paths); break;
    case 'distY': distributeY(paths); break;
  }
  return null;
}
