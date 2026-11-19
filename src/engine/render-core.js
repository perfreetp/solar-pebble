// 与运行环境无关的渲染核心：输入 canvas 上下文 + 场景数据即可绘制
// 同时供主线程编辑器、OffscreenCanvas Worker、导出帧渲染使用
import { drawGrid, drawScene } from './renderer.js'

export function renderFrame(ctx, scene, canvasW, canvasH) {
  ctx.clearRect(0, 0, canvasW, canvasH)
  drawGrid(ctx, canvasW, canvasH)
  drawScene(ctx, { ...scene, canvasW, canvasH })
}

// 把骨骼 + 时间轴求值结果组装成渲染场景
export function buildScene(bones, parts, fk, opts = {}) {
  return {
    bones,
    parts,
    fk,
    breathing: {
      amplitude: opts.breathAmp ?? 0,
      phase: opts.breathPhase ?? 0
    },
    violations: opts.violations || new Set(),
    mode: opts.mode || null,
    selectedKey: opts.selectedKey || null,
    showSkeleton: opts.showSkeleton
  }
}
