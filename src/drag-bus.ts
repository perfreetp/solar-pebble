import type { ComponentKind } from './types';

/** 构件库拖拽中的类型传递（dragover 阶段 getData 受保护，用模块变量中转） */
let current: ComponentKind | null = null;

export const dragBus = {
  start(kind: ComponentKind): void {
    current = kind;
  },
  get kind(): ComponentKind | null {
    return current;
  },
  end(): void {
    current = null;
  }
};
