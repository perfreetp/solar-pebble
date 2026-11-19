<template>
  <div class="dash">
    <div class="sec-title">各区域布点进度(已布点 / 目标)</div>
    <div v-for="s in stats" :key="s.region.id" class="region">
      <div class="r-head">
        <span class="dot" :style="{ background: s.region.color }"></span>
        <b>{{ s.region.name }}</b>
        <span class="nums">{{ s.placed }} / {{ s.required }}</span>
        <span class="chip" :class="s.todo === 0 ? 'ok' : 'warn'">待布点 {{ s.todo }}</span>
      </div>
      <div class="bar">
        <div class="fill" :style="{ width: pct(s) + '%' }"></div>
      </div>
      <div class="types">
        <span v-for="(v, tk) in s.byType" :key="tk" class="t-item" :class="{ lack: v.todo > 0 }">
          {{ typeName(tk) }} {{ v.placed }}/{{ v.required }}
        </span>
      </div>
    </div>
    <div class="total">
      全厂合计:已布点 <b>{{ total.placed }}</b> 台,目标 <b>{{ total.required }}</b> 台,
      待布点 <b :style="{ color: total.todo ? 'var(--orange)' : '#a5d6a7' }">{{ total.todo }}</b> 台
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { store, regionStats } from '../store'

const stats = computed(() => {
  store.renderTick // 依赖重绘信号刷新
  store.devices.length
  return regionStats()
})
const total = computed(() => stats.value.reduce((a, s) => ({
  placed: a.placed + s.placed, required: a.required + s.required, todo: a.todo + s.todo,
}), { placed: 0, required: 0, todo: 0 }))

const pct = (s) => (s.required ? Math.min(100, Math.round((s.placed / s.required) * 100)) : 100)
const typeName = (k) => store.deviceTypes[k]?.name || k
</script>

<style scoped>
.dash { padding: 10px; display: flex; flex-direction: column; gap: 12px; }
.sec-title { color: var(--fg-dim); font-size: 12px; }
.region { background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; }
.r-head { display: flex; align-items: center; gap: 8px; }
.dot { width: 10px; height: 10px; border-radius: 50%; }
.nums { margin-left: auto; color: var(--fg-dim); }
.bar { height: 6px; background: #0d1220; border-radius: 3px; margin: 6px 0; overflow: hidden; }
.fill { height: 100%; background: var(--accent); border-radius: 3px; transition: width 0.3s; }
.types { display: flex; flex-wrap: wrap; gap: 6px; }
.t-item { font-size: 11px; color: #a5d6a7; border: 1px solid #2e5c34; border-radius: 8px; padding: 0 6px; }
.t-item.lack { color: var(--orange); border-color: #6b4d1d; }
.total { border-top: 1px solid var(--border); padding-top: 8px; color: var(--fg-dim); }
</style>
