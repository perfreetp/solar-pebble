<template>
  <div class="topbar">
    <div class="brand">🏭 园区监测设备三维布点编辑器</div>

    <div class="group">
      <span class="lbl">角色</span>
      <button :class="{ on: store.role === 'editor' }" @click="store.role = 'editor'">布点运维</button>
      <button :class="{ on: store.role === 'chief' }" @click="store.role = 'chief'">站长审核</button>
      <button :class="{ on: store.role === 'admin' }" @click="store.role = 'admin'">运营后台</button>
    </div>

    <div class="group">
      <span class="lbl">视角</span>
      <button :class="{ on: store.view === 'iso' }" @click="store.view = 'iso'">等轴测</button>
      <button :class="{ on: store.view === 'top' }" @click="store.view = 'top'">俯视正交</button>
    </div>

    <div class="group">
      <button @click="importBasemap">导入底图</button>
      <button @click="$emit('export-map')">导出布点图</button>
      <button @click="$emit('toggle-bom')">支架清单</button>
      <button @click="$emit('fit')">复位视图</button>
    </div>

    <div class="group right">
      <span class="chip" :class="statusClass">{{ statusText }}</span>
      <button
        v-if="store.role === 'editor'"
        class="primary"
        :disabled="store.plan.status === 'pending' || store.plan.status === 'approved'"
        @click="actions.submitPlan()"
      >提交站长审核</button>
      <button class="danger" @click="onReset">清空重置</button>
    </div>
    <input ref="fileInput" type="file" accept="image/*" style="display:none" @change="onFile" />
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { store, actions, showToast } from '../store'

const emit = defineEmits(['export-map', 'toggle-bom', 'fit'])
const fileInput = ref(null)

const statusText = computed(() => ({
  draft: '方案:草拟中',
  pending: '方案:待站长审核',
  approved: '方案:已通过',
  returned: '方案:已退回整改',
}[store.plan.status]))

const statusClass = computed(() => ({
  draft: 'info', pending: 'warn', approved: 'ok', returned: 'bad',
}[store.plan.status]))

function importBasemap() { fileInput.value?.click() }

function onFile(e) {
  const f = e.target.files?.[0]
  if (!f) return
  const reader = new FileReader()
  reader.onload = () => {
    const img = new Image()
    img.onload = () => {
      store.basemap = { dataUrl: reader.result, w: img.width, h: img.height }
      showToast('厂区底图已导入,按地图范围贴合')
    }
    img.src = reader.result
  }
  reader.readAsDataURL(f)
  e.target.value = ''
}

function onReset() {
  if (confirm('确定清空全部设备与方案数据?')) actions.resetAll()
}
</script>

<style scoped>
.topbar {
  display: flex; align-items: center; gap: 18px;
  padding: 6px 14px; background: var(--panel);
  border-bottom: 1px solid var(--border); flex-wrap: wrap;
}
.brand { font-weight: bold; font-size: 14px; margin-right: 8px; }
.group { display: flex; align-items: center; gap: 6px; }
.group.right { margin-left: auto; }
.lbl { color: var(--fg-dim); font-size: 12px; }
button.on { border-color: var(--accent); color: var(--accent); background: #16324a; }
</style>
