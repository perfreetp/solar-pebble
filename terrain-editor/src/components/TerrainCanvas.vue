<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { initWebGPU } from '../render/gpu-device.js'
import { TerrainRenderer } from '../render/TerrainRenderer.js'

const props = defineProps({
  engine: { type: Object, required: true },
  wireframe: Boolean,
  showWater: Boolean,
  tool: String, // 'select-lock' | 'select-unlock' | 'raise' | 'flatten' | 'trench'
  brushRadius: Number,
  brushStrength: Number
})
const emit = defineEmits(['select-rect', 'brush', 'hover-chunk', 'gpu-status'])

const canvasEl = ref(null)
const gpuError = ref('')
let renderer = null
let raf = 0
let painting = false
let alive = false
let resizeObserver = null

onMounted(async () => {
  const gpu = await initWebGPU()
  if (!gpu.ok) {
    gpuError.value = gpu.reason
    emit('gpu-status', { ok: false, reason: gpu.reason })
    return
  }
  alive = true
  renderer = new TerrainRenderer(canvasEl.value, props.engine, gpu.device)
  const resize = () => {
    const c = canvasEl.value
    if (!c) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.width = Math.max(2, Math.floor(c.clientWidth * dpr))
    c.height = Math.max(2, Math.floor(c.clientHeight * dpr))
  }
  resize()
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(canvasEl.value)
  renderer.lockMode = 'lock'
  renderer.onSelectRect = (r) => emit('select-rect', r)
  renderer.onClickGround = (pt, ev) => {
    if (!pt || !props.tool.startsWith('select')) return
    // 单击：锁定/解锁单个区块
    const ch = props.engine.chunkAtWorld(pt.x, pt.z)
    if (!ch) return
    const x0 = -20 + ch.cx * 5
    const z0 = -20 + ch.cz * 5
    emit('select-rect', { x0, z0, x1: x0 + 4.99, z1: z0 + 4.99, mode: props.tool === 'select-lock' ? 'lock' : 'unlock' })
  }
  renderer.emitHover = (pt) => {
    if (!pt) return
    const ch = props.engine.chunkAtWorld(pt.x, pt.z)
    emit('hover-chunk', { chunk: ch, point: pt })
  }
  emit('gpu-status', { ok: true, info: gpu.info })
  const loop = () => {
    if (!alive) return
    if (renderer && canvasEl.value?.isConnected) {
      renderer.wireframe = props.wireframe
      renderer.showWater = props.showWater
      try {
        renderer.frame()
      } catch (e) {
        console.error('渲染帧失败', e)
        alive = false
      }
    }
    raf = requestAnimationFrame(loop)
  }
  loop()

  canvasEl.value.addEventListener('pointerdown', onPaintDown)
  window.addEventListener('pointerup', onPaintUp)
})

onBeforeUnmount(() => {
  alive = false
  cancelAnimationFrame(raf)
  resizeObserver?.disconnect()
  window.removeEventListener('pointerup', onPaintUp)
})

function onPaintDown(e) {
  if (!props.tool || props.tool.startsWith('select')) return
  painting = true
  stroke(e)
  canvasEl.value.addEventListener('pointermove', stroke)
}
function onPaintUp() {
  painting = false
  canvasEl.value?.removeEventListener('pointermove', stroke)
}
function stroke(e) {
  if (!painting || !renderer) return
  const pt = renderer.screenToGround(e.clientX, e.clientY)
  if (!pt) return
  emit('brush', { mode: props.tool, x: pt.x, z: pt.z, radius: props.brushRadius, strength: props.brushStrength })
}

watch(() => props.tool, (t) => {
  if (renderer) renderer.lockMode = t === 'select-unlock' ? 'unlock' : 'lock'
})

defineExpose({
  screenshot() {
    return canvasEl.value?.toDataURL?.('image/png') || null
  }
})
</script>

<template>
  <div class="canvas-wrap">
    <div v-if="gpuError" class="gpu-fallback">
      <div class="fallback-card">
        <h3>⚠️ WebGPU 不可用</h3>
        <p>{{ gpuError }}</p>
        <p class="muted">地形引擎与导出仍可正常工作，请使用 Chrome/Edge 113+ 并在浏览器中启用 WebGPU。</p>
      </div>
    </div>
    <canvas ref="canvasEl" class="gpu-canvas"></canvas>
    <div class="canvas-hint muted">
      左键拖拽：框选/笔刷 ｜ Shift/右键拖拽：平移 ｜ 滚轮：缩放
    </div>
  </div>
</template>

<style scoped>
.canvas-wrap { position: relative; width: 100%; height: 100%; min-height: 420px; }
.gpu-canvas { width: 100%; height: 100%; display: block; border-radius: 8px; }
.gpu-fallback {
  position: absolute; inset: 0; z-index: 5;
  background: rgba(10, 14, 20, 0.92);
  display: grid; place-items: center;
  border-radius: 8px;
}
.fallback-card { max-width: 420px; text-align: center; }
.canvas-hint {
  position: absolute; left: 12px; bottom: 10px;
  background: rgba(15, 21, 29, 0.75);
  padding: 5px 10px; border-radius: 6px; font-size: 12px;
  pointer-events: none;
}
</style>
