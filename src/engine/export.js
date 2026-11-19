// 导出：PNG 序列帧 + 带关键帧数据的 JSON，JSZip 打包
import JSZip from 'jszip'
import { solveFK, findRangeViolations } from './skeleton.js'
import { evaluate, frameToTime } from './animation.js'
import { renderFrame, buildScene } from './render-core.js'

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function toBlob(canvas) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: 'image/png' })
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

function pad4(n) {
  return String(n).padStart(4, '0')
}

// 构造导出用 JSON（完整工程可再导入）
export function buildProjectJSON(project) {
  return {
    format: 'shooting-pose-editor',
    version: 1,
    exportedAt: new Date().toISOString(),
    project: {
      id: project.id,
      title: project.title,
      width: project.width,
      height: project.height
    },
    skeleton: project.bones,
    partsMeta: Object.fromEntries(
      Object.entries(project.parts || {}).map(([k, p]) => [k, { w: p.w, h: p.h, pivot: p.pivot, src: p.src, placeholder: !!p.placeholder }])
    ),
    timeline: project.timeline,
    fps: project.timeline.fps
  }
}

// 逐帧离屏渲染并打包
export async function exportSequence(project, { onProgress } = {}) {
  const { bones, parts, timeline, width, height } = project
  const zip = new JSZip()
  const frames = []
  if (timeline.keys.length) {
    const last = Math.max(...timeline.keys)
    for (let f = 0; f <= last; f++) frames.push(f)
  }
  const seqFolder = zip.folder('png')
  const canvas = makeCanvas(width, height)
  const ctx = canvas.getContext('2d')
  let lastBlob = null

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    const { pose, extras } = evaluate(timeline, f)
    const fk = solveFK(bones, pose)
    const violations = new Set(findRangeViolations(bones, pose).map((v) => v.key))
    const breathPhase = (frameToTime(timeline, f) * Math.PI * 2) / 2.4
    const scene = buildScene(bones, parts, fk, {
      breathAmp: extras.breathAmp ?? 0,
      breathPhase,
      violations
    })
    renderFrame(ctx, scene, width, height)
    lastBlob = await toBlob(canvas)
    seqFolder.file(`pose_${pad4(f)}.png`, lastBlob)
    if (onProgress) onProgress(Math.round(((i + 1) / frames.length) * 100), f)
  }

  const json = buildProjectJSON(project)
  zip.file('keyframes.json', JSON.stringify(json, null, 2))
  const content = await zip.generateAsync({ type: 'blob' })
  return { blob: content, count: frames.length, lastFrameBlob: lastBlob, json }
}

// 仅导出 JSON
export function exportJSONOnly(project) {
  const json = buildProjectJSON(project)
  return new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
