<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7">
            <path d="M3 16c0-3 3.5-7 9-7s9 4 9 7" stroke-linecap="round" />
            <path d="M2 16h20" stroke-linecap="round" />
            <path d="M7.5 16v-3.2M16.5 16v-3.2" stroke-linecap="round" opacity=".55" />
            <circle cx="12" cy="5.6" r="1.5" />
          </svg>
        </div>
        <div class="brand-text">
          <span class="brand-name">熔岩管工坊</span>
          <span class="brand-sub">LAVA TUBE WORKS</span>
        </div>
      </div>

      <nav class="nav">
        <RouterLink
          v-for="item in navItems"
          :key="item.name"
          :to="item.to"
          class="nav-link"
          :class="{ on: isActive(item) }"
        >
          <component :is="item.icon" :size="14" :stroke-width="1.9" />
          <span>{{ item.label }}</span>
          <span v-if="item.badge" class="nav-badge">{{ item.badge }}</span>
        </RouterLink>
      </nav>

      <div class="topbar-right">
        <div class="conn" :class="appState.online ? 'ok' : 'bad'">
          <i></i>
          <span>{{ appState.online ? '本地服务' : '离线' }}</span>
        </div>
        <button class="identity" @click="identityOpen = true">
          <span class="avatar" :style="avatarStyle(appState.me)">{{ appState.me?.avatar || '··' }}</span>
          <span class="identity-text">
            <span class="identity-name">{{ appState.me?.name || '未选择' }}</span>
            <span class="identity-role">{{ appState.me?.title || '' }}</span>
          </span>
          <ChevronDown :size="13" class="t-fg3" />
        </button>
      </div>
    </header>

    <main class="app-main">
      <RouterView v-slot="{ Component }">
        <component :is="Component" />
      </RouterView>
    </main>

    <div class="toasts">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind">
        <component :is="toastIcon(t.kind)" :size="14" />
        <span>{{ t.message }}</span>
      </div>
    </div>

    <IdentityModal v-if="identityOpen" @close="identityOpen = false" />

    <div v-if="appState.error && !appState.ready" class="boot-error">
      <p class="fs-16 w-600">无法连接本地服务</p>
      <p class="fs-12 t-fg2">{{ appState.error }}</p>
      <p class="fs-12 t-fg3">请确认已运行 <code class="mono">npm run dev</code>，服务端口 8788。</p>
      <button class="btn" @click="retry">重试</button>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import {
  ClipboardList, Box, ScanSearch, LayoutDashboard, ChevronDown,
  CheckCircle2, AlertTriangle, Info, XCircle,
} from 'lucide-vue-next';
import { appState, loadBootstrap, toasts, avatarStyle } from './state.js';
import IdentityModal from './components/IdentityModal.vue';

const route = useRoute();
const identityOpen = ref(false);

const navItems = computed(() => {
  const list = [
    { name: 'orders', to: '/orders', label: '接单台', icon: ClipboardList },
    { name: 'build', to: '/orders', label: '建模台', icon: Box, match: ['build'] },
    { name: 'qc', to: '/qc', label: '质检', icon: ScanSearch, badge: qcBadge.value || null },
    { name: 'dashboard', to: '/dashboard', label: '看板', icon: LayoutDashboard },
  ];
  return list;
});

const qcBadge = computed(() => appState.orders.filter((o) => o.status === 'submitted').length);

function isActive(item) {
  if (item.match) return item.match.includes(route.name);
  return route.name === item.name;
}

function toastIcon(kind) {
  if (kind === 'ok') return CheckCircle2;
  if (kind === 'err') return XCircle;
  if (kind === 'warn') return AlertTriangle;
  return Info;
}

async function retry() {
  try {
    await loadBootstrap(true);
  } catch {
    /* 保持错误态 */
  }
}

onMounted(() => {
  loadBootstrap().catch(() => {});
});
</script>

<style scoped>
.app-shell {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-0);
}

.topbar {
  height: var(--topbar-h);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 0 16px 0 18px;
  border-bottom: 1px solid var(--line-1);
  background: linear-gradient(180deg, #0e1116, #0a0c10);
  position: relative;
  z-index: 50;
}

.topbar::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(226, 160, 77, 0.24) 18%, rgba(79, 195, 173, 0.16) 70%, transparent);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.brand-mark {
  width: 30px;
  height: 30px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  background: linear-gradient(150deg, #2a2118, #171a20);
  border: 1px solid rgba(226, 160, 77, 0.28);
  color: var(--lunar);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}
.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}
.brand-name {
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.brand-sub {
  font-family: var(--font-mono);
  font-size: 8px;
  letter-spacing: 0.19em;
  color: var(--fg-4);
  margin-top: 1px;
}

.nav {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
}
.nav-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 11px;
  border-radius: var(--r-1);
  font-size: 12.5px;
  font-weight: 500;
  color: var(--fg-2);
  transition: 0.14s;
  position: relative;
}
.nav-link:hover {
  color: var(--fg-0);
  background: rgba(255, 255, 255, 0.04);
}
.nav-link.on {
  color: var(--fg-0);
  background: rgba(255, 255, 255, 0.06);
}
.nav-link.on::after {
  content: '';
  position: absolute;
  left: 11px;
  right: 11px;
  bottom: -11px;
  height: 2px;
  background: var(--lunar);
  border-radius: 2px 2px 0 0;
}
.nav-badge {
  min-width: 16px;
  height: 15px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--red);
  color: #190508;
  font-size: 9.5px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-mono);
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
.conn {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  color: var(--fg-3);
  font-family: var(--font-mono);
  letter-spacing: 0.03em;
}
.conn i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--green);
  box-shadow: 0 0 6px rgba(103, 197, 107, 0.7);
}
.conn.bad i {
  background: var(--red);
  box-shadow: 0 0 6px rgba(229, 98, 106, 0.7);
}

.identity {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 8px 0 5px;
  border-radius: 18px;
  border: 1px solid var(--line-1);
  background: var(--bg-2);
  transition: 0.14s;
}
.identity:hover {
  border-color: var(--line-3);
  background: var(--bg-3);
}
.identity-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.2;
}
.identity-name {
  font-size: 12px;
  font-weight: 600;
}
.identity-role {
  font-size: 9.5px;
  color: var(--fg-3);
}

.app-main {
  flex: 1;
  min-height: 0;
  position: relative;
}

.boot-error {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: var(--bg-0);
  z-index: 300;
}
.boot-error code {
  background: var(--bg-3);
  padding: 2px 5px;
  border-radius: 2px;
  color: var(--lunar);
}
</style>
