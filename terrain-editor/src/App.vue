<script setup>
import { ref, computed } from 'vue'
import OrderListView from './views/OrderListView.vue'
import EditorView from './views/EditorView.vue'
import QcView from './views/QcView.vue'
import DashboardView from './views/DashboardView.vue'

const tabs = [
  { key: 'orders', label: '需求单', icon: '📋' },
  { key: 'editor', label: '生成编辑', icon: '🛠️' },
  { key: 'qc', label: '质检', icon: '✅' },
  { key: 'dashboard', label: '看板', icon: '📊' }
]
const active = ref('orders')
// 从需求单/质检跳入编辑器时携带的工单与 seed
const editingOrder = ref(null)
function openEditor(order) {
  editingOrder.value = order
  active.value = 'editor'
}
</script>

<template>
  <div class="app-shell">
    <aside class="side">
      <div class="brand">
        <div class="logo">RT</div>
        <div>
          <div class="title">野外测试场</div>
          <div class="sub">路面过程式生成平台</div>
        </div>
      </div>
      <nav>
        <button
          v-for="t in tabs"
          :key="t.key"
          :class="['nav-item', { on: active === t.key }]"
          @click="active = t.key"
        >
          <span class="icon">{{ t.icon }}</span>{{ t.label }}
        </button>
      </nav>
      <div class="side-foot muted">
        Vue 3 · WebGPU<br />40m × 40m / 8×8 区块
      </div>
    </aside>
    <main class="main">
      <OrderListView v-if="active === 'orders'" @open-editor="openEditor" @go-tab="(k) => (active = k)" />
      <EditorView v-else-if="active === 'editor'" :order="editingOrder" />
      <QcView v-else-if="active === 'qc'" @open-editor="openEditor" />
      <DashboardView v-else />
    </main>
  </div>
</template>

<style scoped>
.app-shell { display: flex; height: 100%; }
.side {
  width: 210px;
  background: var(--panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 18px 12px;
  gap: 8px;
}
.brand { display: flex; gap: 10px; align-items: center; padding: 4px 8px 18px; }
.logo {
  width: 40px; height: 40px; border-radius: 10px;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  display: grid; place-items: center; font-weight: 700; color: #fff;
}
.title { font-weight: 600; }
.sub { color: var(--muted); font-size: 12px; }
nav { display: flex; flex-direction: column; gap: 6px; }
.nav-item {
  display: flex; align-items: center; gap: 10px;
  background: transparent; border: none; text-align: left;
  padding: 10px 12px; font-size: 14px; color: var(--muted);
}
.nav-item .icon { font-size: 16px; }
.nav-item.on { background: var(--panel-2); color: #fff; border-radius: 8px; }
.nav-item:hover { color: #fff; }
.side-foot { margin-top: auto; font-size: 12px; line-height: 1.7; padding: 8px; }
.main { flex: 1; min-width: 0; height: 100%; }
</style>
