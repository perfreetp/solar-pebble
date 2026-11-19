<template>
  <div class="canvas-wrap panel">
    <div class="panel-title">
      <span>{{ mode === 'rig' ? '绑骨模式：拖蓝色锚点定位关节，橙色方块调整图片偏移' : '摆姿势模式：拖圆形旋转手柄，或在右侧数值微调' }}</span>
      <div class="row">
        <button :class="{ primary: mode === 'rig' }" @click="setMode('rig')">绑骨</button>
        <button :class="{ primary: mode === 'pose' }" @click="setMode('pose')">摆姿势</button>
      </div>
    </div>
    <div class="panel-body" style="padding:10px">
      <canvas
        ref="canvasRef"
        class="editor"
        :width="store.project.width"
        :height="store.project.height"
        :style="canvasStyle"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
      />
      <div v-if="store.violations.length" class="violation-bar">
        <strong>⚠ 关节超出活动范围：</strong>
        <span v-for="v in store.violations" :key="v.key" class="vio-item">
          {{ v.label }} {{ v.value }}°（允许 {{ v.min }}°~{{ v.max }}°）
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useEditorStore } from '../stores/editor.js'
import { solveFK } from '../engine/skeleton.js'
import { hitTest, pointerWorldAngle } from '../engine/renderer.js'
import { renderFrame, buildScene } from '../engine/render-core.js'

const store = useEditorStore()
const canvasRef = ref(null)
let ctx = null
let raf = 0
let drag = null // { type, key, lastX, lastY }

const mode = computed(() => store.mode)
const canvasStyle = computed(() => ({
  width: '100%',
  maxWidth: store.project.width + 'px',
  aspectRatio: `${store.project.width} / ${store.project.height}`
}))

function setMode(m) {
  store.mode = m
  drag = null
}

function scene() {
  const fk = solveFK(store.bones, store.pose)
  const breathPhase = (store.currentFrame / store.timeline.fps * Math.PI * 2) / 2.4
  return buildScene(store.bones, store.parts, fk, {
    breathAmp: store.breathAmp,
    breathPhase,
    violations: store.violationSet,
    mode: store.mode,
    selectedKey: store.selectedKey
  })
}

function draw() {
  if (!ctx) return
  renderFrame(ctx, scene(), store.project.width, store.project.height)
}

function scheduleDraw() {
  if (raf) return
  raf = requestAnimationFrame(() => { raf = 0; draw() })
}

function toLocal(e) {
  const rect = canvasRef.value.getBoundingClientRect()
  const sx = canvasRef.value.width / rect.width
  const sy = canvasRef.value.height / rect.height
  return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy }
}

function onDown(e) {
  const p = toLocal(e)
  const hit = hitTest(scene(), p.x, p.y)
  canvasRef.value.setPointerCapture(e.pointerId)
  if (!hit) {
    drag = { type: 'pan', lastX: p.x, lastY: p.y }
    return
  }
  store.selectBone(hit.key)
  drag = { type: hit.type, key: hit.key, lastX: p.x, lastY: p.y }
}

function onMove(e) {
  const p = toLocal(e)
  const c = canvasRef.value
  if (!drag) {
    const hit = hitTest(scene(), p.x, p.y)
    c.style.cursor = hit ? 'pointer' : 'crosshair'
    return
  }
  const dx = p.x - drag.lastX
  const dy = p.y - drag.lastY
  if (drag.type === 'anchor' && store.mode === 'rig') {
    const b = store.bones[drag.key]
    store.moveAnchor(drag.key, b.anchor.x + dx, b.anchor.y + dy)
  } else if (drag.type === 'offset' && store.mode === 'rig') {
    // 把世界位移投影到骨骼局部坐标（沿骨线 x、垂直骨线 y）
    const fk0 = solveFK(store.bones, store.pose)
    const wa = fk0[drag.key].worldAngle * Math.PI / 180
    const lx = dx * Math.cos(wa) + dy * Math.sin(wa)
    const ly = -dx * Math.sin(wa) + dy * Math.cos(wa)
    const b = store.bones[drag.key]
    b.offset.x = Math.round((b.offset.x || 0) + lx)
    b.offset.y = Math.round((b.offset.y || 0) + ly)
  } else if (drag.type === 'rotate' && store.mode === 'pose') {
    const targetWorld = pointerWorldAngle(scene(), drag.key, p.x, p.y)
    const bone = store.bones[drag.key]
    // 世界角 = 父世界角 + bindLocal + localRot
    const fk = solveFK(store.bones, store.pose)
    let parentWorld = 0
    if (bone.parent) parentWorld = fk[bone.parent].worldAngle
    const local = targetWorld - parentWorld - bone.bindLocal
    store.setBoneRot(drag.key, Math.round(local * 10) / 10)
  }
  drag.lastX = p.x
  drag.lastY = p.y
  scheduleDraw()
}

function onUp() {
  if (drag) store.persist()
  drag = null
}

watch(() => [store.pose, store.currentFrame, store.mode, store.selectedKey, store.breathAmp, store.bones, store.parts], scheduleDraw, { deep: true })

onMounted(() => {
  ctx = canvasRef.value.getContext('2d')
  store.seekFrame(0)
  draw()
})
onBeforeUnmount(() => { if (raf) cancelAnimationFrame(raf) })

defineExpose({ redraw: draw })
</script>

<style scoped>
.violation-bar {
  margin-top: 8px; padding: 8px 10px; border-radius: 8px;
  background: var(--red-soft); color: var(--red); font-size: 12.5px;
  display: flex; flex-wrap: wrap; gap: 12px; align-items: center;
}
.vio-item { font-weight: 600; }
</style>
