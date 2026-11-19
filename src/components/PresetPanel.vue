<template>
  <div class="panel">
    <div class="panel-title">姿势预设</div>
    <div class="panel-body">
      <label class="field">
        <span>把当前帧区间存为预设（动作片段复用）</span>
      </label>
      <div class="row" style="margin-bottom:10px">
        <input v-model="from" type="number" min="0" title="起始帧" />
        <span class="muted">至</span>
        <input v-model="to" type="number" min="0" title="结束帧" />
      </div>
      <div class="row" style="margin-bottom:12px">
        <input v-model="name" placeholder="预设名称，如：据枪瞄准段" />
        <button class="primary" @click="save">存预设</button>
      </div>

      <div class="preset-list">
        <div v-if="!presets.length" class="muted small">暂无预设，先在时间轴上打好一段关键帧。</div>
        <div v-for="p in presets" :key="p.id" class="preset-item">
          <div>
            <strong>{{ p.name }}</strong>
            <div class="muted small">{{ p.keys.length }} 个关键帧 · 跨度 {{ p.span }}F · {{ fmt(p.createdAt) }}</div>
          </div>
          <div class="row">
            <button @click="apply(p)">套到 {{ target }}F</button>
            <button class="danger ghost" @click="remove(p)">删</button>
          </div>
        </div>
      </div>
      <label class="field" style="margin-top:10px">
        <span>套用目标起始帧</span>
        <input v-model.number="target" type="number" min="0" />
      </label>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useEditorStore } from '../stores/editor.js'
import { listPresets, createPreset, deletePreset, applyPreset } from '../engine/presets.js'

const store = useEditorStore()
const name = ref('据枪瞄准段')
const from = ref(0)
const to = ref(24)
const target = ref(0)
const presets = ref(listPresets())

function save() {
  if (from.value > to.value) return alert('起始帧不能大于结束帧')
  createPreset(name.value || '未命名预设', store.timeline, from.value, to.value)
  presets.value = listPresets()
  store.persist()
}
function apply(p) {
  applyPreset(p, store.timeline, target.value)
  store.seekFrame(target.value)
  store.persist()
  alert(`预设「${p.name}」已套用到第 ${target.value} 帧起的动作段`)
}
function remove(p) {
  if (!confirm(`删除预设「${p.name}」？`)) return
  deletePreset(p.id)
  presets.value = listPresets()
}
function fmt(iso) {
  return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
</script>

<style scoped>
.preset-list { display: flex; flex-direction: column; gap: 8px; max-height: 260px; overflow: auto; }
.preset-item {
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
  border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; background: #f8fafc;
}
.small { font-size: 12px; }
</style>
