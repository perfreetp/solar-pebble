import type { GuideLine, PathData } from '../types';
import { HISTORY_LIMIT } from '../types';
import { clonePath } from './geometry';

export interface DocSnapshot {
  paths: PathData[];
  guides: GuideLine[];
}

export function snapshot(paths: PathData[], guides: GuideLine[]): DocSnapshot {
  return {
    paths: paths.map(clonePath),
    guides: guides.map(g => ({ ...g })),
  };
}

/** 每个文档独立的撤销/重做栈,上限 80 步(满足 ≥50 步要求) */
export class HistoryStack {
  private past: DocSnapshot[] = [];
  private future: DocSnapshot[] = [];
  private lastPush = 0;
  /** 拖拽合并:同一交互序列内只保留首次快照 */
  private interactionDepth = 0;

  beginInteraction() { this.interactionDepth++; }
  endInteraction() { this.interactionDepth = Math.max(0, this.interactionDepth - 1); }

  push(snap: DocSnapshot) {
    const now = performance.now();
    // 交互进行中且 800ms 内连续变更 → 合并,不新增历史项
    if (this.interactionDepth > 0 && now - this.lastPush < 800 && this.past.length) {
      this.lastPush = now;
      return;
    }
    this.past.push(snap);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this.lastPush = now;
  }

  undo(current: DocSnapshot): DocSnapshot | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(current);
    return prev;
  }

  redo(current: DocSnapshot): DocSnapshot | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    return next;
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  get sizes() { return { undo: this.past.length, redo: this.future.length }; }
}
