<template>
  <div class="admin">
    <div class="sec-title">设备外形尺寸与允许安装面(运营后台维护)</div>
    <table>
      <thead>
        <tr>
          <th>设备</th><th>长(m)</th><th>宽(m)</th><th>高(m)</th><th>采样高度(m)</th><th>允许安装面</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="t in draft" :key="t.key">
          <td><span class="swatch" :style="{ background: t.color }"></span> {{ t.name }}</td>
          <td><input type="number" step="0.1" min="0.1" v-model.number="t.l" /></td>
          <td><input type="number" step="0.1" min="0.1" v-model.number="t.w" /></td>
          <td><input type="number" step="0.1" min="0.1" v-model.number="t.h" /></td>
          <td><input type="number" step="0.5" min="0" v-model.number="t.sampleHeight" /></td>
          <td>
            <label v-for="k in kinds" :key="k" class="klabel">
              <input type="checkbox" :checked="t.allowed.includes(k)" @change="toggle(t, k)" />
              {{ kindName[k] }}
            </label>
          </td>
        </tr>
      </tbody>
    </table>
    <div class="ops">
      <button class="primary" @click="save">保存并生效</button>
      <span class="dim">保存后场景内设备将按新尺寸重算包围盒与吸附面</span>
    </div>

    <div class="sec-title">区域布点目标(看板基准)</div>
    <table>
      <thead><tr><th>区域</th><th>设备</th><th>目标数量</th></tr></thead>
      <tbody>
        <tr v-for="(q, i) in store.required" :key="i">
          <td>{{ regionName(q.region) }}</td>
          <td>{{ typeName(q.type) }}</td>
          <td><input type="number" min="0" v-model.number="q.count" @change="actions.persist()" /></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { store, actions, showToast, SURFACE_KIND_NAME } from '../store'

const kinds = ['ground', 'rack', 'wall']
const kindName = SURFACE_KIND_NAME
const draft = ref(JSON.parse(JSON.stringify(Object.values(store.deviceTypes))))

function toggle(t, k) {
  const i = t.allowed.indexOf(k)
  if (i >= 0) t.allowed.splice(i, 1)
  else t.allowed.push(k)
}

function save() {
  const next = {}
  for (const t of draft.value) {
    if (!t.allowed.length) { showToast(`「${t.name}」至少保留一种允许安装面`); return }
    next[t.key] = { ...t }
  }
  actions.saveDeviceTypes(next)
  showToast('设备库配置已保存并生效')
}

const regionName = (id) => store.regions.find(r => r.id === id)?.name || id
const typeName = (k) => store.deviceTypes[k]?.name || k
</script>

<style scoped>
.admin { padding: 10px; display: flex; flex-direction: column; gap: 10px; }
.sec-title { color: var(--fg-dim); font-size: 12px; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
.swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
.klabel { margin-right: 8px; white-space: nowrap; }
.ops { display: flex; align-items: center; gap: 10px; }
.dim { color: var(--fg-dim); font-size: 11px; }
</style>
