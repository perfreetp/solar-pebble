<template>
  <div class="panel timeline-panel">
    <div class="panel-title">
      <span>时间轴（{{ store.timeline.fps }} 帧/秒）</span>
      <div class="row">
        <button @click="toStart">⏮</button>
        <button class="primary" @click="togglePlay">{{ store.playing ? '⏸ 暂停' : '▶ 播放' }}</button>
        <button @click="step(-1)">−1F</button>
        <button @click="step(1)">+1F</button>
        <span class="frame-readout">{{ frameText }} / {{ totalTime }}</span>
      </div>
    </div>
    <div class="panel-body">
      <div ref="trackRef" class="track" @pointerdown="onTrackDown" @pointermove="onTrackMove" @pointerup="onTrackUp">
        <div class="ruler">
          <span v-for="t in ticks" :key="t.frame" class="tick" :style="{ left: pct(t.frame) + '%' }">
            <i></i>{{ t.frame }}
          </span>
        </div>
        <div class="lane">
          <div v-for="f in store.keyframeList" :key="f"
               class="key-diamond"
               :class="{ active: f === Math.round(store.currentFrame) }"
               :style="{ left: pct(f) + '%' }"
               :title="`第 ${f} 帧`"
               @pointerdown.stop="jumpTo(f)"></div>
          <div class="playhead" :style="{ left: pct(store.currentFrame) + '%' }"></div>
        </div>
      </div>

      <div v-if="seg" class="seg-bar">
        <span class="muted">段 {{ seg.a }}F → {{ seg.b }}F 插值：</span>
        <label v-for="opt in easings" :key="opt.v" class="seg-opt">
          <input type="radio" :value="opt.v" :checked="segConf.easing === opt.v" @change="pickEasing(opt.v)" />
          {{ opt.label }}
        </label>
        <button v-if="segConf.easing === 'bezier'" @click="emitCurve">打开曲线编辑器</button>
      </div>
      <div v-else class="muted small" style="margin-top:8px">至少打两个关键帧后，可在段上选择插值方式。</div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { useEditorStore } from '../stores/editor.js'
import { getSegment } from '../engine/animation.js'
import { frameToTime } from '../engine/animation.js'

const emit = defineEmits(['open-curve'])
const store = useEditorStore()
const trackRef = ref(null)
let timer = null

const easings = [
  { v: 'linear', label: '线性' },
  { v: 'easeInOut', label: '缓入缓出' },
  { v: 'bezier', label: '贝塞尔' }
]

const duration = computed(() => Math.max(store.timeline.duration, store.keyframeList.at(-1) ?? 0, 1))
const ticks = computed(() => {
  const step = duration.value > 72 ? 12 : duration.value > 36 ? 6 : 4
  const arr = []
  for (let f = 0; f <= duration.value; f += step) arr.push({ frame: f })
  return arr
})
const frameText = computed(() => `${String(Math.round(store.currentFrame)).padStart(3, '0')}F`)
const totalTime = computed(() => `${frameToTime(store.timeline, duration.value).toFixed(2)}s`)
const seg = computed(() => store.currentSegment())
const segConf = computed(() => (seg.value ? getSegment(store.timeline, seg.value.a, seg.value.b) : { easing: 'linear' }))

function pct(f) {
  return Math.min(100, (f / duration.value) * 100)
}
function frameFromEvent(e) {
  const rect = trackRef.value.querySelector('.lane').getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  return ratio * duration.value
}
function onTrackDown(e) {
  store.seekFrame(frameFromEvent(e))
  e.target.setPointerCapture?.(e.pointerId)
  trackRef.value.dataset.dragging = '1'
}
function onTrackMove(e) {
  if (trackRef.value.dataset.dragging) store.seekFrame(frameFromEvent(e))
}
function onTrackUp() {
  if (trackRef.value) trackRef.value.dataset.dragging = ''
}
function jumpTo(f) {
  store.seekFrame(f)
  trackRef.value.dataset.dragging = ''
}
function step(d) {
  store.seekFrame(Math.round(store.currentFrame) + d)
}
function toStart() {
  store.seekFrame(0)
}
function pickEasing(v) {
  if (seg.value) store.setSegmentEasing(seg.value.a, seg.value.b, v)
}
function emitCurve() {
  emit('open-curve', seg.value)
}
function togglePlay() {
  store.playing = !store.playing
  if (store.playing) {
    let last = performance.now()
    timer = setInterval(() => {
      const now = performance.now()
      const dt = (now - last) / 1000
      last = now
      let f = store.currentFrame + dt * store.timeline.fps
      const lastKey = store.keyframeList.at(-1) ?? 0
      if (f > lastKey) f = 0
      store.seekFrame(f)
    }, 33)
  } else {
    clearInterval(timer)
    timer = null
  }
}
onBeforeUnmount(() => timer && clearInterval(timer))
</script>

<style scoped>
.timeline-panel { flex: none; }
.track { user-select: none; }
.ruler { position: relative; height: 22px; border-bottom: 1px solid var(--line); }
.tick { position: absolute; top: 0; font-size: 10.5px; color: var(--muted); transform: translateX(-50%); }
.tick i { display: block; width: 1px; height: 6px; background: var(--line); margin: 0 auto 1px; }
.lane { position: relative; height: 46px; background: #f8fafc; border-radius: 0 0 8px 8px; cursor: pointer; }
.key-diamond {
  position: absolute; top: 14px; width: 14px; height: 14px;
  background: var(--blue); transform: translateX(-50%) rotate(45deg);
  border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); cursor: pointer;
}
.key-diamond.active { background: var(--amber); }
.playhead {
  position: absolute; top: 0; bottom: 0; width: 2px; background: var(--red);
  transform: translateX(-1px); pointer-events: none;
}
.playhead::before {
  content: ''; position: absolute; top: -3px; left: -5px;
  border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 7px solid var(--red);
}
.seg-bar { display: flex; align-items: center; gap: 14px; margin-top: 10px; flex-wrap: wrap; }
.seg-opt { display: inline-flex; align-items: center; gap: 4px; font-weight: 500; }
.seg-opt input { width: auto; }
.frame-readout { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--blue); }
.small { font-size: 12px; }
</style>
