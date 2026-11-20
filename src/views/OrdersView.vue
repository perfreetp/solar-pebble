<template>
  <div class="orders-view">
    <!-- 左侧：筛选与人员负荷 -->
    <aside class="sidebar">
      <div class="side-head">
        <div>
          <h1 class="fs-18 w-600" style="letter-spacing: -0.01em">接单台</h1>
          <p class="fs-11 t-fg3">概念设计组 · 基地建模工单</p>
        </div>
        <button
          v-if="canCreate"
          class="btn btn-primary btn-sm"
          @click="openCreate"
        >
          <Plus :size="13" :stroke-width="2.4" /> 接单
        </button>
      </div>

      <div class="search-wrap">
        <Search :size="13" class="search-icon" />
        <input
          v-model="query"
          class="input search"
          placeholder="搜订单号 / 标题 / 委托方 / 要求"
        />
        <button v-if="query" class="clear" @click="query = ''"><X :size="12" /></button>
      </div>

      <div class="filters">
        <button
          v-for="f in filters"
          :key="f.key"
          class="filter-chip"
          :class="{ on: statusFilter === f.key }"
          @click="statusFilter = f.key"
        >
          {{ f.label }}
          <span class="chip-count">{{ countOf(f.key) }}</span>
        </button>
      </div>

      <div class="side-scroll scroll">
        <div class="side-section">
          <div class="track-wide" style="padding: 0 2px 8px">建模师傅负荷</div>
          <button
            v-for="m in modelers"
            :key="m.id"
            class="load-row"
            :class="{ on: assigneeFilter === m.id }"
            @click="assigneeFilter = assigneeFilter === m.id ? null : m.id"
          >
            <span class="avatar" :style="avatarStyle(m)">{{ m.avatar }}</span>
            <span class="grow col" style="align-items: flex-start; gap: 3px">
              <span class="row between" style="width: 100%">
                <span class="fs-12 w-500">{{ m.name }}</span>
                <span class="fs-10 mono t-fg3">{{ loadOf(m.id).active }} 在制 / {{ loadOf(m.id).done }} 完成</span>
              </span>
              <span class="bar" style="width: 100%">
                <i :style="{ width: barWidth(m.id), background: barColor(m.id) }"></i>
              </span>
            </span>
          </button>
          <button v-if="assigneeFilter" class="btn btn-ghost btn-sm" style="width: 100%; margin-top: 6px" @click="assigneeFilter = null">
            清除人员筛选
          </button>
        </div>

        <div class="side-section">
          <div class="track-wide" style="padding: 0 2px 8px">流程说明</div>
          <ol class="flow">
            <li><span class="flow-n">1</span><span>前台接单，录入尺寸与功能要求</span></li>
            <li><span class="flow-n">2</span><span>分派给建模师傅，进建模台搭体素</span></li>
            <li><span class="flow-n">3</span><span>提交质检，抽查不合格打回并计返工</span></li>
            <li><span class="flow-n">4</span><span>通过后导出 obj，看板累计完成量</span></li>
          </ol>
        </div>
      </div>
    </aside>

    <!-- 右侧：订单列表 -->
    <section class="list-area">
      <div class="list-head">
        <div class="row g12">
          <span class="fs-12 t-fg2">
            <b class="num fs-14" style="color: var(--fg-0)">{{ filtered.length }}</b> 个工单
          </span>
          <span v-if="activeFilterDesc" class="fs-11 t-fg3">· {{ activeFilterDesc }}</span>
        </div>
        <div class="row g6">
          <div class="segmented">
            <button :class="{ on: sortBy === 'due' }" @click="sortBy = 'due'">按截止</button>
            <button :class="{ on: sortBy === 'recent' }" @click="sortBy = 'recent'">按更新</button>
            <button :class="{ on: sortBy === 'rework' }" @click="sortBy = 'rework'">按返工</button>
          </div>
          <button class="btn btn-sm" @click="reload" :disabled="loading">
            <RefreshCw :size="12" :class="{ spin: loading }" /> 刷新
          </button>
        </div>
      </div>

      <div class="list-scroll scroll">
        <div v-if="!appState.ready" class="empty">
          <Loader :size="20" class="spin t-fg3" />
          <span class="fs-12">正在连接本地服务…</span>
        </div>

        <div v-else-if="!filtered.length" class="empty">
          <ClipboardList :size="28" :stroke-width="1.4" />
          <span class="fs-13">没有匹配的工单</span>
          <button v-if="canCreate && !query" class="btn btn-primary btn-sm" @click="openCreate">
            <Plus :size="12" /> 录一单
          </button>
        </div>

        <div v-else class="cards">
          <article
            v-for="o in filtered"
            :key="o.id"
            class="order-card"
            :class="{ urgent: o.priority === 'urgent' && !isDone(o) }"
            @click="openOrder(o)"
          >
            <div class="card-rail" :class="`rail-${o.statusMeta?.tone}`"></div>

            <div class="card-main">
              <div class="card-row1">
                <span class="mono fs-11 t-fg3">{{ o.code }}</span>
                <StatusPill :status="o.status" />
                <span v-if="o.priority !== 'normal'" class="tag" :class="`prio-${o.priority}`">
                  {{ appState.priorities[o.priority] }}
                </span>
                <span v-if="o.reworkCount" class="tag rework-tag">
                  <RotateCcw :size="9" /> 返工 {{ o.reworkCount }}
                </span>
                <span class="grow"></span>
                <span class="due" :class="`due-${o.dueState?.tone}`">{{ o.dueState?.label }}</span>
              </div>

              <h3 class="card-title">{{ o.title }}</h3>

              <div class="card-reqs">
                <span v-for="(r, i) in (o.requirements || []).slice(0, 3)" :key="i" class="req">
                  <span class="req-k">{{ r.k }}</span>
                  <span class="req-v">{{ r.v }}</span>
                </span>
                <span v-if="(o.requirements || []).length > 3" class="req-more">
                  +{{ o.requirements.length - 3 }}
                </span>
                <span v-if="!(o.requirements || []).length" class="fs-11 t-fg3">需求待录入</span>
              </div>

              <div class="card-row3">
                <span class="client">
                  <Building2 :size="11" /> {{ o.client }}
                </span>
                <span class="grow"></span>
                <span v-if="o.analysis && o.analysis.issues?.length" class="check-flag" :class="{ bad: !o.analysis.ok }">
                  <AlertTriangle :size="11" />
                  {{ o.analysis.ok ? `${o.analysis.issues.length} 项提示` : '体检未过' }}
                </span>
                <span v-if="o.assignee" class="assignee">
                  <span class="avatar xs" :style="avatarStyle(o.assigneeInfo)">{{ o.assigneeInfo?.avatar }}</span>
                  {{ o.assigneeName }}
                </span>
                <span v-else class="assignee unassigned">
                  <UserPlus :size="11" /> 未分派
                </span>
              </div>
            </div>

            <div class="card-side">
              <div class="side-stat">
                <span class="side-stat-v mono">{{ o.modelCells ? fmtK(o.modelCells) : '—' }}</span>
                <span class="side-stat-k">体素</span>
              </div>
              <div class="side-stat">
                <span class="side-stat-v mono">{{ qcCount(o) }}</span>
                <span class="side-stat-k">质检次</span>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>

    <CreateOrderModal
      v-if="createOpen"
      @close="createOpen = false"
      @created="onCreated"
    />
    <OrderDetailDrawer
      v-if="detailOrder"
      :order-id="detailOrder.id"
      @close="detailOrder = null"
      @changed="onDetailChanged"
    />
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  Plus, Search, X, RefreshCw, ClipboardList, Building2, AlertTriangle,
  RotateCcw, UserPlus, Loader,
} from 'lucide-vue-next';
import {
  appState, avatarStyle, refreshOrders, toast,
} from '../state.js';
import StatusPill from '../components/StatusPill.vue';
import CreateOrderModal from '../components/CreateOrderModal.vue';
import OrderDetailDrawer from '../components/OrderDetailDrawer.vue';

const router = useRouter();
const query = ref('');
const statusFilter = ref('active');
const assigneeFilter = ref(null);
const sortBy = ref('due');
const loading = ref(false);
const createOpen = ref(false);
const detailOrder = ref(null);

const MODELER_ROLES = ['modeler'];

const canCreate = computed(() => ['clerk', 'admin'].includes(appState.me?.role));

const modelers = computed(() => appState.members.filter((m) => MODELER_ROLES.includes(m.role)));

const filters = [
  { key: 'active', label: '进行中' },
  { key: 'all', label: '全部' },
  { key: 'submitted', label: '待质检' },
  { key: 'rejected', label: '被打回' },
  { key: 'done', label: '已交付' },
  { key: 'mine', label: '分派给我' },
];

function countOf(key) {
  const all = appState.orders;
  switch (key) {
    case 'active':
      return all.filter((o) => ['queued', 'building', 'rejected', 'draft'].includes(o.status)).length;
    case 'submitted':
      return all.filter((o) => o.status === 'submitted').length;
    case 'rejected':
      return all.filter((o) => o.status === 'rejected').length;
    case 'done':
      return all.filter((o) => ['approved', 'delivered'].includes(o.status)).length;
    case 'mine':
      return all.filter((o) => o.assignee === appState.me?.id).length;
    default:
      return all.length;
  }
}

function isDone(o) {
  return ['approved', 'delivered'].includes(o.status);
}

const filtered = computed(() => {
  let list = [...appState.orders];
  if (statusFilter.value === 'active') {
    list = list.filter((o) => ['queued', 'building', 'rejected', 'draft'].includes(o.status));
  } else if (statusFilter.value === 'done') {
    list = list.filter((o) => ['approved', 'delivered'].includes(o.status));
  } else if (statusFilter.value === 'submitted') {
    list = list.filter((o) => o.status === 'submitted');
  } else if (statusFilter.value === 'rejected') {
    list = list.filter((o) => o.status === 'rejected');
  } else if (statusFilter.value === 'mine') {
    list = list.filter((o) => o.assignee === appState.me?.id);
  }
  if (assigneeFilter.value) list = list.filter((o) => o.assignee === assigneeFilter.value);
  const q = query.value.trim().toLowerCase();
  if (q) {
    list = list.filter((o) =>
      [o.id, o.code, o.title, o.client, o.brief, o.assigneeName, ...(o.requirements || []).map((r) => `${r.k}${r.v}`)]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }
  const rank = { urgent: 0, high: 1, normal: 2, low: 3 };
  if (sortBy.value === 'due') {
    list.sort((a, b) => {
      if (isDone(a) !== isDone(b)) return isDone(a) ? 1 : -1;
      const at = a.dueState?.hours ?? 1e9;
      const bt = b.dueState?.hours ?? 1e9;
      return at - bt;
    });
  } else if (sortBy.value === 'rework') {
    list.sort((a, b) => (b.reworkCount || 0) - (a.reworkCount || 0));
  } else {
    list.sort((a, b) => new Date(b.history?.[b.history.length - 1]?.at || 0) - new Date(a.history?.[a.history.length - 1]?.at || 0));
  }
  return list;
});

const activeFilterDesc = computed(() => {
  switch (statusFilter.value) {
    case 'active': return '待开工 / 建模中 / 被打回';
    case 'submitted': return '等待质检抽查';
    case 'rejected': return '需要返工';
    case 'done': return '质检通过或已交付';
    case 'mine': return '我是承接人';
    default: return '';
  }
});

function loadOf(id) {
  const mine = appState.orders.filter((o) => o.assignee === id);
  return {
    active: mine.filter((o) => ['queued', 'building', 'rejected'].includes(o.status)).length,
    done: mine.filter((o) => ['approved', 'delivered'].includes(o.status)).length,
    total: mine.length,
  };
}

function barWidth(id) {
  const { active, total } = loadOf(id);
  return `${Math.min(100, (active / 3) * 100)}%`;
}

function barColor(id) {
  const { active } = loadOf(id);
  if (active === 0) return 'var(--fg-4)';
  if (active >= 3) return 'var(--red)';
  if (active === 2) return 'var(--amber)';
  return 'var(--teal)';
}

function qcCount(o) {
  return (o.qcNotes || []).length;
}

function fmtK(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  return n.toLocaleString('zh-CN');
}

function openOrder(o) {
  detailOrder.value = o;
}

function openCreate() {
  createOpen.value = true;
}

async function reload() {
  loading.value = true;
  try {
    await refreshOrders();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    loading.value = false;
  }
}

function onCreated(order) {
  createOpen.value = false;
  toast(`已接单 ${order.code}`, 'ok');
  refreshOrders().catch(() => {});
}

function onDetailChanged() {
  refreshOrders().catch(() => {});
}

let debounce = null;
watch(query, () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    refreshOrders(query.value).catch(() => {});
  }, 220);
});
</script>

<style scoped>
.orders-view {
  display: flex;
  height: 100%;
  min-height: 0;
}

.sidebar {
  width: 268px;
  flex-shrink: 0;
  border-right: 1px solid var(--line-1);
  background: var(--bg-1);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.side-head {
  padding: 18px 16px 14px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.search-wrap {
  position: relative;
  padding: 0 14px 10px;
}
.search {
  height: 30px;
  padding-left: 28px;
  font-size: 12px;
}
.search-icon {
  position: absolute;
  left: 24px;
  top: 8px;
  color: var(--fg-3);
  pointer-events: none;
}
.clear {
  position: absolute;
  right: 22px;
  top: 8px;
  color: var(--fg-3);
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: 2px;
}
.clear:hover { background: var(--bg-4); color: var(--fg-0); }

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 0 14px 12px;
}
.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 8px;
  border-radius: 12px;
  border: 1px solid var(--line-1);
  background: transparent;
  font-size: 11px;
  color: var(--fg-2);
  transition: 0.12s;
}
.filter-chip:hover { border-color: var(--line-3); color: var(--fg-0); }
.filter-chip.on {
  background: var(--lunar-soft);
  border-color: rgba(226, 160, 77, 0.3);
  color: var(--lunar);
}
.chip-count {
  font-family: var(--font-mono);
  font-size: 9.5px;
  opacity: 0.7;
}

.side-scroll {
  flex: 1;
  min-height: 0;
  border-top: 1px solid var(--line-1);
}
.side-section {
  padding: 14px;
  border-bottom: 1px solid var(--line-1);
}

.load-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 6px;
  border-radius: var(--r-1);
  transition: 0.12s;
}
.load-row:hover { background: var(--bg-3); }
.load-row.on { background: rgba(226, 160, 77, 0.08); }
.avatar.xs { width: 18px; height: 18px; font-size: 8px; }

.flow {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.flow li {
  display: flex;
  gap: 9px;
  font-size: 11.5px;
  color: var(--fg-2);
  line-height: 1.45;
}
.flow-n {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--bg-4);
  color: var(--fg-2);
  font-family: var(--font-mono);
  font-size: 9.5px;
  display: grid;
  place-items: center;
  margin-top: 1px;
}

.list-area {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.list-head {
  height: 52px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  border-bottom: 1px solid var(--line-1);
  background: var(--bg-1);
}
.list-scroll {
  flex: 1;
  min-height: 0;
  padding: 16px 20px 40px;
}

.cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 1180px;
}

.order-card {
  display: flex;
  align-items: stretch;
  background: var(--bg-1);
  border: 1px solid var(--line-1);
  border-radius: var(--r-2);
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.14s, background 0.14s, transform 0.1s;
  position: relative;
}
.order-card:hover {
  border-color: var(--line-3);
  background: var(--bg-2);
}
.order-card:active { transform: translateY(1px); }

.card-rail {
  width: 3px;
  flex-shrink: 0;
  background: var(--fg-4);
}
.rail-active { background: var(--lunar); }
.rail-review { background: var(--violet); }
.rail-danger { background: var(--red); }
.rail-success { background: var(--green); }
.rail-info { background: var(--cyan); }
.rail-delivered { background: var(--fg-4); }
.rail-neutral { background: var(--fg-4); }

.card-main {
  flex: 1;
  min-width: 0;
  padding: 13px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card-row1 {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.prio-urgent { background: var(--red-soft); color: #f08b91; }
.prio-high { background: var(--lunar-soft); color: var(--lunar); }
.prio-low { color: var(--fg-3); }

.rework-tag {
  background: rgba(229, 98, 106, 0.1);
  color: #e8898f;
}

.due {
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-mono);
  letter-spacing: -0.01em;
}
.due-danger { color: var(--red); }
.due-warn { color: var(--amber); }
.due-info { color: var(--fg-2); }
.due-success { color: var(--fg-3); }
.due-neutral { color: var(--fg-3); }

.card-title {
  font-size: 14.5px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.35;
}

.card-reqs {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 12px;
  align-items: baseline;
}
.req {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  font-size: 11.5px;
}
.req-k {
  color: var(--fg-3);
}
.req-v {
  color: var(--fg-1);
  font-family: var(--font-mono);
  font-size: 11px;
}
.req-more {
  font-size: 10.5px;
  color: var(--fg-4);
}

.card-row3 {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 11px;
  color: var(--fg-3);
}
.client {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.assignee {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--fg-2);
  font-size: 11.5px;
}
.assignee.unassigned {
  color: var(--amber);
}
.check-flag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  color: var(--amber);
}
.check-flag.bad { color: var(--red); }

.card-side {
  width: 92px;
  flex-shrink: 0;
  border-left: 1px solid var(--line-1);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 12px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.14);
}
.side-stat {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.side-stat-v {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg-1);
}
.side-stat-k {
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--fg-4);
  text-transform: uppercase;
}

.spin {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 1100px) {
  .sidebar { width: 224px; }
  .card-side { display: none; }
}
</style>
