<template>
  <div class="props">
    <template v-if="dev">
      <div class="row title">
        <span class="swatch" :style="{ background: type.color }"></span>
        <b>{{ dev.name }}</b>
        <span class="chip" :class="dev.invalid ? 'bad' : 'ok'">{{ dev.invalid ? '非法安装面' : '已吸附' }}</span>
      </div>
      <div class="row"><span>类型</span><span>{{ type.name }}</span></div>
      <div class="row">
        <span>坐标 X</span>
        <input type="number" step="0.1" :value="fmt(pos.x)" @change="setPos('x', $event)" /> m
      </div>
      <div class="row">
        <span>坐标 Y</span>
        <input type="number" step="0.1" :value="fmt(pos.y)" @change="setPos('y', $event)" /> m
      </div>
      <div class="row">
        <span>标高 Z</span>
        <input type="number" step="0.1" :value="fmt(pos.z)" @change="setPos('z', $event)" /> m
      </div>
      <div class="row"><span>安装面</span><span>{{ dev.surface }}</span></div>
      <div class="row">
        <span>旋转角</span>
        <span>
          <button @click="actions.rotateDevice(dev.id, -15)">−15°</button>
          <b class="rot">{{ dev.rot }}°</b>
          <button @click="actions.rotateDevice(dev.id, 15)">+15°</button>
        </span>
      </div>
      <div class="row"><span>支架长度</span><span>{{ bracket.toFixed(1) }} m</span></div>
      <div class="row" v-if="conflict"><span class="warn-text">⚠ 包围盒与其他设备相交</span></div>
      <div class="row" v-if="dev.review?.result === 'rejected'">
        <span class="warn-text">⚠ 站长退回:{{ dev.review.comment || '未填写意见' }}</span>
      </div>
      <div class="row btns">
        <button class="danger" @click="actions.removeDevice(dev.id)">删除设备</button>
      </div>
    </template>
    <div v-else class="empty">未选中设备<br /><span class="dim">点击场景中的设备查看属性</span></div>

    <div v-if="store.dragInfo" class="live">
      拖动中 → X {{ fmt(store.dragInfo.x) }} / Y {{ fmt(store.dragInfo.y) }} / Z {{ fmt(store.dragInfo.z) }} m
      <br />吸附面:{{ store.dragInfo.surface }}
      <span v-if="!store.dragInfo.valid" class="warn-text">(非法)</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { store, actions, bracketLength } from '../store'

const dev = computed(() => store.devices.find(d => d.id === store.selectedId) || null)
const type = computed(() => (dev.value ? store.deviceTypes[dev.value.type] : {}))
const pos = computed(() => store.dragInfo && dev.value ? { x: store.dragInfo.x, y: store.dragInfo.y, z: store.dragInfo.z } : (dev.value || { x: 0, y: 0, z: 0 }))
const conflict = computed(() => dev.value && store.conflicts.includes(dev.value.id))
const bracket = computed(() => (dev.value ? bracketLength(dev.value) : 0))

const fmt = (v) => Number(v).toFixed(1)

function setPos(axis, e) {
  const v = parseFloat(e.target.value)
  if (isNaN(v) || !dev.value) return
  if (axis === 'z') actions.setDeviceZ(dev.value.id, v)
  else actions.moveDevice(dev.value.id, axis === 'x' ? v : dev.value.x, axis === 'y' ? v : dev.value.y)
  actions.persist()
  store.dragInfo = null
  store.renderTick++
}
</script>

<style scoped>
.props { padding: 10px; display: flex; flex-direction: column; gap: 6px; }
.row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.row.title { border-bottom: 1px solid var(--border); padding-bottom: 6px; }
.swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
.rot { margin: 0 8px; }
.btns { margin-top: 8px; justify-content: flex-end; }
.empty { color: var(--fg-dim); text-align: center; padding: 30px 0; }
.dim { font-size: 11px; }
.warn-text { color: var(--red); font-size: 12px; }
.live {
  margin-top: 10px; padding: 8px; border: 1px dashed var(--accent);
  border-radius: 6px; color: var(--accent); font-size: 12px;
}
</style>
