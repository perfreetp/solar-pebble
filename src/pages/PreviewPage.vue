<template>
  <div class="preview-layout">
    <div class="panel">
      <div class="panel-title">
        OffscreenCanvas 离屏渲染预览
        <span class="tag" :class="supported ? 'green' : 'amber'">
          {{ supported ? 'Worker + OffscreenCanvas 硬件离屏' : '当前浏览器不支持，已回退主线程离屏 Canvas' }}
        </span>
      </div>
      <div class="panel-body">
        <canvas ref="canvasRef" class="preview-cv" :width="store.project.width" :height="store.project.height"></canvas>
        <div class="row controls">
          <button class="primary" @click="play">{{ playing ? '⏸ 暂停' : '▶ 播放' }}</button>
          <button @click="seek(0)">⏮ 回到首帧</button>
          <span class="muted">帧 {{ frameLabel }} · 拖动编辑不影响此预览的渲染帧率（工作线程独立 rAF）</span>
        </div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-title">渲染说明</div>
      <div class="panel-body muted small doc">
        <p>① 支持时把 canvas 通过 <code>transferControlToOffscreen()</code> 交给 Web Worker，动画循环与绘制全部在工作线程完成，主线程拖动锚点/手柄不会造成预览掉帧。</p>
        <p>② Worker 内每帧执行：时间轴求值（线性/缓入缓出/贝塞尔）→ FK 求解 → 关节超限检测 → Canvas2D 离屏绘制。</p>
        <p>③ 不支持 OffscreenCanvas 的环境自动回退：主线程内创建离屏 canvas 按 rAF 渲染，功能一致。</p>
        <p>④ 导出 PNG 序列帧同样走离屏 canvas（OffscreenCanvas.convertToBlob），不占用可见画布。</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useEditorStore } from '../stores/editor.js'
import { solveFK, findRangeViolations } from '../engine/skeleton.js'
import { evaluate, frameToTime } from '../engine/animation.js'
import { renderFrame, buildScene } from '../engine/render-core.js'

const store = useEditorStore()
const canvasRef = ref(null)
const supported = ref(false)
const playing = ref(false)
const currentFrame = ref(0)
const frameLabel = computed(() => `${String(Math.round(currentFrame.value)).padStart(3, '0')}F`)

let worker = null
let fallback = null
let raf = 0
let last = 0

function snapshotState() {
  return {
    bones: store.bones,
    parts: store.parts,
    timeline: store.timeline,
    width: store.project.width,
    height: store.project.height
  }
}

function drawFallback(frame) {
  const { bones, parts, timeline } = snapshotState()
  const { pose, extras } = evaluate(timeline, frame)
  const fk = solveFK(bones, pose)
  const violations = new Set(findRangeViolations(bones, pose).map((v) => v.key))
  const breathPhase = (frameToTime(timeline, frame) * Math.PI * 2) / 2.4
  const scene = buildScene(bones, parts, fk, { breathAmp: extras.breathAmp ?? 0, breathPhase, violations })
  renderFrame(fallback.ctx, scene, store.project.width, store.project.height)
}

function fallbackLoop(now) {
  if (!playing.value) return
  const dt = (now - last) / 1000
  last = now
  const tl = store.timeline
  currentFrame.value += dt * tl.fps
  const lastKey = tl.keys.length ? Math.max(...tl.keys) : 0
  if (currentFrame.value > lastKey) currentFrame.value = 0
  drawFallback(currentFrame.value)
  raf = requestAnimationFrame(fallbackLoop)
}

onMounted(() => {
  const canvas = canvasRef.value
  if (typeof Worker !== 'undefined' && 'OffscreenCanvas' in window && canvas.transferControlToOffscreen) {
    let off = null
    try {
      off = canvas.transferControlToOffscreen()
    } catch {
      setupFallback(canvas)
      return
    }
    try {
      worker = new Worker(new URL('../workers/preview.worker.js', import.meta.url), { type: 'module' })
      worker.postMessage({ type: 'init', canvas: off, state: snapshotState() }, [off])
      worker.onmessage = (e) => {
        if (e.data.type === 'tick') currentFrame.value = e.data.frame
      }
      supported.value = true
    } catch {
      // canvas 控制权已移交，无法在同一元素上回退，改用新建的离屏 canvas
      worker = null
      setupOffscreenFallback()
    }
  } else {
    setupFallback(canvas)
  }
})

function setupOffscreenFallback() {
  supported.value = false
  const host = canvasRef.value?.parentElement
  if (!host) return
  const c = document.createElement('canvas')
  c.width = store.project.width
  c.height = store.project.height
  c.className = 'preview-cv'
  canvasRef.value?.replaceWith(c)
  canvasRef.value = c
  fallback = { ctx: c.getContext('2d') }
  drawFallback(0)
}

function setupFallback(canvas) {
  supported.value = false
  fallback = { ctx: canvas.getContext('2d') }
  drawFallback(0)
}

function play() {
  playing.value = !playing.value
  if (supported.value && worker) {
    // 播放前全量同步一次，随后轮询只发骨骼/时间轴
    worker.postMessage({ type: 'state', state: snapshotState() })
    worker.postMessage({ type: playing.value ? 'play' : 'pause' })
    if (!playing.value) return
    const poll = setInterval(() => {
      if (!playing.value) return clearInterval(poll)
      worker.postMessage({ type: 'sync', bones: store.bones, timeline: store.timeline })
    }, 500)
  } else if (playing.value) {
    last = performance.now()
    raf = requestAnimationFrame(fallbackLoop)
  } else {
    cancelAnimationFrame(raf)
  }
}

// 部件图变更（导入/替换）时才同步 ImageBitmap
watch(
  () => store.parts,
  (parts) => {
    if (worker) worker.postMessage({ type: 'parts', parts })
  },
  { deep: false }
)

function seek(f) {
  currentFrame.value = f
  if (worker) worker.postMessage({ type: 'seek', frame: f })
  else drawFallback(f)
}

onBeforeUnmount(() => {
  worker?.terminate()
  cancelAnimationFrame(raf)
})
</script>

<style scoped>
.preview-layout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 14px; align-items: start; }
.preview-cv { width: 100%; border-radius: 8px; background: #f4f6fa; }
.controls { margin-top: 12px; flex-wrap: wrap; }
.doc p { line-height: 1.7; margin: 0 0 8px; }
.doc code { background: #eef1f6; padding: 1px 5px; border-radius: 4px; }
.small { font-size: 12.5px; }
@media (max-width: 1100px) { .preview-layout { grid-template-columns: 1fr; } }
</style>
