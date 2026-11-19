<template>
  <div class="layout">
    <TopBar @export-map="onExportMap" @toggle-bom="bomOpen = !bomOpen" @fit="sceneRef?.fitView()" />
    <div class="main">
      <aside class="left"><DeviceLibrary /></aside>
      <section class="center">
        <SceneView ref="sceneRef" />
        <div v-if="store.conflicts.length" class="conflict-banner">
          ⚠ {{ store.conflicts.length }} 台设备包围盒相交(红色轮廓),请调整位置
        </div>
      </section>
      <aside class="rightside">
        <div class="tabs">
          <button v-for="t in tabs" :key="t.key" :class="{ on: tab === t.key }" @click="tab = t.key">
            {{ t.name }}
            <span v-if="t.key === 'review' && rejectedCount" class="badge">{{ rejectedCount }}</span>
          </button>
        </div>
        <div class="tab-body">
          <PropsPanel v-if="tab === 'props'" />
          <ReviewPanel v-else-if="tab === 'review'" />
          <Dashboard v-else-if="tab === 'dash'" />
          <AdminPanel v-else-if="tab === 'admin'" />
        </div>
      </aside>
    </div>
    <BomPanel v-if="bomOpen" @close="bomOpen = false" />
    <div v-if="store.toast" class="toast">{{ store.toast }}</div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import TopBar from './components/TopBar.vue'
import DeviceLibrary from './components/DeviceLibrary.vue'
import SceneView from './components/SceneView.vue'
import PropsPanel from './components/PropsPanel.vue'
import ReviewPanel from './components/ReviewPanel.vue'
import Dashboard from './components/Dashboard.vue'
import AdminPanel from './components/AdminPanel.vue'
import BomPanel from './components/BomPanel.vue'
import { store } from './store'

const sceneRef = ref(null)
const bomOpen = ref(false)
const tab = ref('props')

const tabs = computed(() => {
  const base = [
    { key: 'props', name: '属性' },
    { key: 'review', name: '审核' },
    { key: 'dash', name: '看板' },
  ]
  if (store.role === 'admin') base.push({ key: 'admin', name: '后台' })
  return base
})

const rejectedCount = computed(() => store.devices.filter(d => d.review?.result === 'rejected').length)

watch(() => store.role, (r) => { tab.value = r === 'admin' ? 'admin' : r === 'chief' ? 'review' : 'props' })
watch(() => store.selectedId, (id) => { if (id && tab.value !== 'props' && store.role === 'editor') tab.value = 'props' })

function onExportMap() {
  sceneRef.value?.exportImage()
}
</script>

<style scoped>
.layout { display: flex; flex-direction: column; height: 100%; }
.main { flex: 1; display: flex; min-height: 0; }
.left { width: 220px; background: var(--panel); border-right: 1px solid var(--border); flex: none; }
.center { flex: 1; position: relative; min-width: 0; }
.rightside {
  width: 320px; background: var(--panel); border-left: 1px solid var(--border);
  display: flex; flex-direction: column; flex: none;
}
.tabs { display: flex; border-bottom: 1px solid var(--border); }
.tabs button { flex: 1; border: none; border-radius: 0; padding: 8px 0; background: transparent; position: relative; }
.tabs button.on { color: var(--accent); border-bottom: 2px solid var(--accent); }
.badge {
  background: var(--red); color: #fff; border-radius: 8px;
  font-size: 10px; padding: 0 5px; margin-left: 2px;
}
.tab-body { flex: 1; overflow-y: auto; }
.conflict-banner {
  position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
  background: rgba(120, 20, 20, 0.9); color: #ffcdd2; border: 1px solid var(--red);
  padding: 5px 14px; border-radius: 6px; font-size: 12px; pointer-events: none;
}
.toast {
  position: fixed; bottom: 26px; left: 50%; transform: translateX(-50%);
  background: #22304f; border: 1px solid var(--accent); color: var(--fg);
  padding: 8px 18px; border-radius: 8px; z-index: 99; font-size: 13px;
}
</style>
