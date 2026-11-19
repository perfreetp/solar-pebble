<template>
  <div v-if="visible" class="modal-mask" @pointerdown.self="close">
    <div class="panel modal">
      <div class="panel-title">
        贝塞尔曲线编辑器 — 段 {{ seg?.a }}F → {{ seg?.b }}F
        <button class="ghost" @click="close">✕</button>
      </div>
      <div class="panel-body">
        <canvas ref="cvRef" width="420" height="420" class="curve-cv"
                @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp"></canvas>
        <div class="cp-grid">
          <label class="field"><span>控制点1 X（0~1）</span>
            <input type="number" step="0.01" min="0" max="1" :value="c[0]" @input="setC(0, +$event.target.value)" />
          </label>
          <label class="field"><span>控制点1 Y</span>
            <input type="number" step="0.01" :value="c[1]" @input="setC(1, +$event.target.value)" />
          </label>
          <label class="field"><span>控制点2 X（0~1）</span>
            <input type="number" step="0.01" min="0" max="1" :value="c[2]" @input="setC(2, +$event.target.value)" />
          </label>
          <label class="field"><span>控制点2 Y</span>
            <input type="number" step="0.01" :value="c[3]" @input="setC(3, +$event.target.value)" />
          </label>
        </div>
        <div class="row" style="flex-wrap:wrap; gap:8px">
          <button v-for="p in presets" :key="p.name" @click="applyPreset(p.v)">{{ p.name }}</button>
        </div>
        <p class="muted small">横轴为时间进度、纵轴为缓动输出；拖动两个蓝色控制点即可调整曲线（X 被限制在 0~1）。</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue'
import { useEditorStore } from '../stores/editor.js'
import { getSegment } from '../engine/animation.js'
import { cubicBezier, clamp } from '../engine/math.js'

const store = useEditorStore()
const visible = ref(false)
const seg = ref(null)
const c = ref([0.25, 0.1, 0.25, 1])
const cvRef = ref(null)
let dragIdx = -1

const PAD = 40
const SIZE = 420
const presets = [
  { name: '线性', v: [0, 0, 1, 1] },
  { name: '缓入', v: [0.42, 0, 1, 1] },
  { name: '缓出', v: [0, 0, 0.58, 1] },
  { name: '缓入缓出', v: [0.42, 0, 0.58, 1] },
  { name: '回弹预备', v: [0.34, 1.3, 0.64, 1] }
]

function open(s) {
  seg.value = s
  const conf = getSegment(store.timeline, s.a, s.b)
  c.value = [...(conf.bezier || [0.25, 0.1, 0.25, 1])]
  visible.value = true
  nextTick(draw)
}
function close() { visible.value = false }
defineExpose({ open })

function toPx(x, y) {
  return [PAD + x * (SIZE - PAD * 2), SIZE - PAD - y * (SIZE - PAD * 2)]
}
function fromPx(px, py) {
  const x = clamp((px - PAD) / (SIZE - PAD * 2), 0, 1)
  const y = clamp((SIZE - PAD - py) / (SIZE - PAD * 2), -0.6, 1.6)
  return [x, y]
}

function draw() {
  const cv = cvRef.value
  if (!cv) return
  const ctx = cv.getContext('2d')
  ctx.clearRect(0, 0, SIZE, SIZE)
  ctx.fillStyle = '#fafbfd'
  ctx.fillRect(0, 0, SIZE, SIZE)
  // 网格 + 边框
  ctx.strokeStyle = '#e5e9f0'; ctx.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    const g = PAD + (i / 4) * (SIZE - PAD * 2)
    ctx.beginPath(); ctx.moveTo(g, PAD); ctx.lineTo(g, SIZE - PAD); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(PAD, g); ctx.lineTo(SIZE - PAD, g); ctx.stroke()
  }
  ctx.strokeStyle = '#94a3b8'
  ctx.strokeRect(PAD, PAD, SIZE - PAD * 2, SIZE - PAD * 2)
  // 坐标轴文字
  ctx.fillStyle = '#6b7280'; ctx.font = '11px sans-serif'
  ctx.fillText('时间 t →', SIZE / 2 - 22, SIZE - 12)
  ctx.save(); ctx.translate(14, SIZE / 2 + 24); ctx.rotate(-Math.PI / 2); ctx.fillText('输出 y →', 0, 0); ctx.restore()

  const [x1, y1, x2, y2] = c.value
  const p0 = toPx(0, 0), p1 = toPx(x1, y1), p2 = toPx(x2, y2), p3 = toPx(1, 1)
  // 控制手柄线
  ctx.strokeStyle = '#94a3b8'; ctx.setLineDash([4, 3])
  ctx.beginPath(); ctx.moveTo(...p0); ctx.lineTo(...p1); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(...p3); ctx.lineTo(...p2); ctx.stroke()
  ctx.setLineDash([])
  // 贝塞尔曲线
  const ease = cubicBezier(x1, y1, x2, y2)
  ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2.5
  ctx.beginPath()
  for (let i = 0; i <= 100; i++) {
    const t = i / 100
    const [px, py] = toPx(t, ease(t))
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
  }
  ctx.stroke()
  // 端点与控制点
  for (const [p, color, r] of [[p0, '#16a34a', 6], [p3, '#16a34a', 6], [p1, '#2563eb', 8], [p2, '#d97706', 8]]) {
    ctx.fillStyle = color
    ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke()
  }
}

function pointer(e) {
  const rect = cvRef.value.getBoundingClientRect()
  return { x: (e.clientX - rect.left) * (SIZE / rect.width), y: (e.clientY - rect.top) * (SIZE / rect.height) }
}
function onDown(e) {
  const p = pointer(e)
  const pts = [toPx(c.value[0], c.value[1]), toPx(c.value[2], c.value[3])]
  dragIdx = pts.findIndex((q) => Math.hypot(q[0] - p.x, q[1] - p.y) <= 12)
  if (dragIdx < 0) dragIdx = 0 // 拖空白默认抓控制点1
  cvRef.value.setPointerCapture(e.pointerId)
  onMove(e)
}
function onMove(e) {
  if (dragIdx < 0) return
  const p = pointer(e)
  const [x, y] = fromPx(p.x, p.y)
  if (dragIdx === 0) { c.value[0] = round2(x); c.value[1] = round2(y) }
  else { c.value[2] = round2(x); c.value[3] = round2(y) }
  draw()
}
function onUp() {
  if (dragIdx >= 0) commit()
  dragIdx = -1
}
function setC(i, v) {
  c.value[i] = round2(v)
  draw(); commit()
}
function applyPreset(v) {
  c.value = [...v]
  draw(); commit()
}
function commit() {
  if (seg.value) store.setSegmentEasing(seg.value.a, seg.value.b, 'bezier', [...c.value])
}
function round2(v) { return Math.round(v * 100) / 100 }
watch(visible, (v) => { if (v) nextTick(draw) })
</script>

<style scoped>
.modal-mask {
  position: fixed; inset: 0; background: rgba(15,23,42,.45);
  display: flex; align-items: center; justify-content: center; z-index: 40;
}
.modal { width: 480px; max-width: 94vw; }
.curve-cv { width: 100%; border: 1px solid var(--line); border-radius: 8px; touch-action: none; }
.cp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
.small { font-size: 12px; }
</style>
