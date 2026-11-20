<template>
  <div class="drawer-mask" @click.self="$emit('close')">
    <aside class="drawer">
      <header class="drawer-head">
        <div class="row g10" style="align-items: flex-start">
          <div class="grow col g6" style="min-width: 0">
            <div class="row g8">
              <span class="mono fs-11 t-fg3">{{ order?.code }}</span>
              <StatusPill v-if="order" :status="order.status" />
              <span v-if="order?.reworkCount" class="tag rework-tag">返工 {{ order.reworkCount }} 次</span>
            </div>
            <h2 class="fs-16 w-600" style="line-height: 1.35">{{ order?.title || '加载中…' }}</h2>
          </div>
          <button class="btn btn-ghost btn-icon" @click="$emit('close')"><X :size="15" /></button>
        </div>
      </header>

      <div v-if="order" class="drawer-body scroll">
        <!-- 状态与操作 -->
        <section class="d-section">
          <div class="d-meta-grid">
            <div class="d-meta">
              <span class="d-k">委托方</span>
              <span class="d-v">{{ order.client }}</span>
            </div>
            <div class="d-meta">
              <span class="d-k">优先级</span>
              <span class="d-v" :class="`prio-${order.priority}`">{{ appState.priorities[order.priority] }}</span>
            </div>
            <div class="d-meta">
              <span class="d-k">交期</span>
              <span class="d-v" :class="order.dueState?.tone === 'danger' ? 't-red' : ''">
                {{ order.dueAt ? formatDate(order.dueAt) : '未设' }}
                <span class="fs-10 t-fg3" style="margin-left: 4px">{{ order.dueState?.label }}</span>
              </span>
            </div>
            <div class="d-meta">
              <span class="d-k">承接师傅</span>
              <span class="d-v row g5">
                <template v-if="order.assigneeInfo">
                  <span class="avatar xs" :style="avatarStyle(order.assigneeInfo)">{{ order.assigneeInfo.avatar }}</span>
                  {{ order.assigneeName }}
                </template>
                <span v-else class="t-amber">未分派</span>
              </span>
            </div>
          </div>

          <div class="actions">
            <!-- 前台/组长：分派 -->
            <div v-if="canAssign" class="assign-box">
              <span class="fs-11 t-fg3 shrink">分派</span>
              <select
                class="select"
                style="height: 28px"
                :value="order.assignee || ''"
                :disabled="busy"
                @change="doAssign($event.target.value)"
              >
                <option value="">暂不分派</option>
                <option v-for="m in modelers" :key="m.id" :value="m.id">
                  {{ m.name }}（在制 {{ loadOf(m.id) }}）
                </option>
              </select>
            </div>

            <button v-if="canBuild" class="btn btn-primary btn-sm" @click="openEditor">
              <Box :size="12" /> 进入建模台
            </button>
            <button
              v-if="canStart"
              class="btn btn-teal btn-sm"
              :disabled="busy"
              @click="setStatus('building')"
            >
              <Play :size="12" /> 开始建模
            </button>
            <button
              v-if="canSubmit"
              class="btn btn-teal btn-sm"
              :disabled="busy"
              @click="submitQc"
            >
              <Send :size="12" /> 提交质检
            </button>
            <button v-if="canQc" class="btn btn-sm" @click="$router.push('/qc')">
              <ScanSearch :size="12" /> 去质检台
            </button>
            <button
              v-if="canDeliver"
              class="btn btn-sm"
              :disabled="busy"
              @click="setStatus('delivered')"
            >
              <PackageCheck :size="12" /> 标记交付
            </button>
          </div>
        </section>

        <!-- 需求 -->
        <section class="d-section">
          <div class="d-title"><ListChecks :size="12" /> 建模要求</div>
          <div class="req-list">
            <div v-for="(r, i) in order.requirements" :key="i" class="req-item">
              <span class="req-dot"></span>
              <span class="req-kk">{{ r.k }}</span>
              <span class="req-vv">{{ r.v }}</span>
            </div>
            <p v-if="!order.requirements?.length" class="fs-11 t-fg3">尚未录入具体要求。</p>
          </div>
          <p v-if="order.brief" class="brief">{{ order.brief }}</p>
        </section>

        <!-- 模型状态 -->
        <section class="d-section">
          <div class="d-title"><Cuboid :size="12" /> 模型状态</div>
          <div class="model-status">
            <div class="ms-item">
              <span class="ms-v num">{{ order.modelCells ? fmtK(order.modelCells) : '—' }}</span>
              <span class="ms-k">体素总数</span>
            </div>
            <div class="ms-item">
              <span class="ms-v num">{{ gridLabel }}</span>
              <span class="ms-k">网格</span>
            </div>
            <div class="ms-item">
              <span class="ms-v num">{{ layerSize }}</span>
              <span class="ms-k">可编辑层</span>
            </div>
          </div>
          <div v-if="order.analysis" class="analysis-box" :class="{ bad: !order.analysis.ok }">
            <div class="row g6">
              <component :is="order.analysis.ok ? CheckCircle2 : AlertOctagon" :size="13" />
              <span class="fs-12 w-500">
                {{ order.analysis.ok ? '合并前体检可过' : '合并前体检未通过' }}
              </span>
            </div>
            <ul class="issue-list">
              <li v-for="iss in order.analysis.issues" :key="iss.code">
                <span class="issue-sev" :class="iss.severity"></span>
                <span>{{ iss.title }}</span>
                <span class="t-fg3 fs-11">— {{ iss.detail }}</span>
              </li>
              <li v-if="!order.analysis.issues.length" class="t-green fs-11">未发现悬空体或薄壁。</li>
            </ul>
          </div>
        </section>

        <!-- 质检记录 -->
        <section class="d-section">
          <div class="d-title">
            <ScanLine :size="12" /> 质检记录
            <span class="fs-10 t-fg4" style="margin-left: auto">{{ order.qcNotes?.length || 0 }} 次</span>
          </div>
          <div v-if="!order.qcNotes?.length" class="fs-11 t-fg3">还没有质检记录。</div>
          <div v-else class="qc-notes">
            <div v-for="(n, i) in [...order.qcNotes].reverse()" :key="i" class="qc-note" :class="n.kind">
              <div class="row g6">
                <component :is="n.kind === 'pass' ? CheckCircle2 : XCircle" :size="12" />
                <span class="fs-11 w-600">{{ n.kind === 'pass' ? '通过' : '打回' }}</span>
                <span class="fs-10 t-fg3">{{ memberName(n.by) }} · {{ formatTime(n.at) }}</span>
              </div>
              <p class="qc-text">{{ n.text }}</p>
            </div>
          </div>
        </section>

        <!-- 动态 -->
        <section class="d-section">
          <div class="d-title"><History :size="12" /> 工单动态</div>
          <div class="timeline">
            <div v-for="(h, i) in [...(order.history || [])].reverse()" :key="i" class="tl-item">
              <span class="tl-dot" :class="`tl-${h.kind}`"></span>
              <span class="tl-text">{{ h.text }}</span>
              <span class="tl-meta">{{ memberName(h.by) }} · {{ formatTime(h.at) }}</span>
            </div>
          </div>
        </section>
      </div>

      <div v-else class="drawer-body center">
        <Loader :size="18" class="spin t-fg3" />
      </div>
    </aside>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  X, Box, Play, Send, ScanSearch, PackageCheck, ListChecks, Cuboid, ScanLine,
  History, CheckCircle2, XCircle, AlertOctagon, Loader,
} from 'lucide-vue-next';
import {
  appState, apiClient, avatarStyle, formatDate, formatTime, memberName, toast,
} from '../state.js';
import StatusPill from './StatusPill.vue';

const props = defineProps({
  orderId: { type: String, required: true },
});
const emit = defineEmits(['close', 'changed']);
const router = useRouter();

const order = ref(null);
const busy = ref(false);

const me = computed(() => appState.me);
const isOwner = computed(() => order.value?.assignee === me.value?.id);
const isStaff = computed(() => ['clerk', 'admin'].includes(me.value?.role));
const isQc = computed(() => ['qc', 'admin'].includes(me.value?.role));
const modelers = computed(() => appState.members.filter((m) => m.role === 'modeler'));

const canAssign = computed(() => isStaff.value && order.value);
const canBuild = computed(() => order.value && (isOwner.value || me.value?.role === 'admin'));
const canStart = computed(
  () => isOwner.value && order.value && ['queued', 'rejected'].includes(order.value.status)
);
const canSubmit = computed(
  () => isOwner.value && order.value && ['building', 'rejected'].includes(order.value.status)
);
const canQc = computed(() => isQc.value && order.value?.status === 'submitted');
const canDeliver = computed(
  () => isStaff.value && order.value?.status === 'approved'
);

const gridLabel = computed(() => {
  const g = order.value?.grid;
  return g ? `${g.sizeX}×${g.sizeY}×${g.sizeZ}` : '—';
});
const layerSize = computed(() => (order.value?.grid ? order.value.grid.sizeZ : '—'));

function fmtK(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  return n.toLocaleString('zh-CN');
}

function loadOf(id) {
  return appState.orders.filter((o) => o.assignee === id && ['queued', 'building', 'rejected'].includes(o.status)).length;
}

async function load() {
  try {
    order.value = await apiClient.order(props.orderId);
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function doAssign(assignee) {
  busy.value = true;
  try {
    order.value = await apiClient.assign(props.orderId, { assignee });
    toast(assignee ? '已分派' : '已取消分派', 'ok');
    emit('changed');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    busy.value = false;
  }
}

async function setStatus(status) {
  busy.value = true;
  try {
    order.value = await apiClient.setStatus(props.orderId, { status });
    toast('状态已更新', 'ok');
    emit('changed');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    busy.value = false;
  }
}

async function submitQc() {
  busy.value = true;
  try {
    order.value = await apiClient.setStatus(props.orderId, { status: 'submitted' });
    toast('已提交质检', 'ok');
    emit('changed');
  } catch (err) {
    if (err.status === 422) {
      toast('体检未通过：存在悬空体素簇，请先在建模台处理', 'err', 5000);
      order.value = await apiClient.order(props.orderId);
    } else {
      toast(err.message, 'err');
    }
  } finally {
    busy.value = false;
  }
}

function openEditor() {
  router.push(`/build/${props.orderId}`);
  emit('close');
}

onMounted(load);
</script>

<style scoped>
.drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(4, 5, 8, 0.6);
  z-index: 180;
  display: flex;
  justify-content: flex-end;
  animation: fade 0.15s;
}
.drawer {
  width: min(560px, 92vw);
  height: 100%;
  background: var(--bg-1);
  border-left: 1px solid var(--line-2);
  box-shadow: -20px 0 60px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  animation: slideIn 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}
@keyframes slideIn {
  from { transform: translateX(28px); opacity: 0; }
}
.drawer-head {
  padding: 18px 20px 16px;
  border-bottom: 1px solid var(--line-1);
}
.drawer-body {
  flex: 1;
  min-height: 0;
}

.d-section {
  padding: 16px 20px;
  border-bottom: 1px solid var(--line-1);
}

.d-meta-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;
  margin-bottom: 14px;
}
.d-meta { display: flex; flex-direction: column; gap: 3px; }
.d-k {
  font-size: 9.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-4);
  font-weight: 600;
}
.d-v { font-size: 12.5px; color: var(--fg-1); }
.avatar.xs { width: 17px; height: 17px; font-size: 7.5px; }

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 12px;
  border-top: 1px dashed var(--line-1);
}
.assign-box {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 1;
  min-width: 190px;
}

.d-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--fg-3);
  margin-bottom: 11px;
}

.req-list { display: flex; flex-direction: column; gap: 6px; }
.req-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
}
.req-dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--lunar);
  flex-shrink: 0;
  margin-top: 6px;
}
.req-kk { color: var(--fg-3); min-width: 76px; flex-shrink: 0; }
.req-vv { color: var(--fg-1); font-family: var(--font-mono); font-size: 11.5px; }

.brief {
  margin-top: 12px;
  padding: 10px 12px;
  background: var(--bg-2);
  border-left: 2px solid rgba(226, 160, 77, 0.4);
  border-radius: 0 var(--r-1) var(--r-1) 0;
  font-size: 11.5px;
  line-height: 1.65;
  color: var(--fg-2);
}

.model-status {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}
.ms-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 9px 10px;
  background: var(--bg-2);
  border: 1px solid var(--line-1);
  border-radius: var(--r-1);
}
.ms-v { font-size: 13px; font-weight: 600; }
.ms-k { font-size: 9px; color: var(--fg-4); text-transform: uppercase; letter-spacing: 0.07em; }

.analysis-box {
  padding: 11px 12px;
  border-radius: var(--r-1);
  background: var(--teal-soft);
  border: 1px solid rgba(79, 195, 173, 0.22);
  color: #8fe7d5;
}
.analysis-box.bad {
  background: var(--red-soft);
  border-color: rgba(229, 98, 106, 0.3);
  color: #f19aa0;
}
.issue-list {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.issue-list li {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 11px;
  color: var(--fg-2);
}
.issue-sev {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--amber);
}
.issue-sev.error { background: var(--red); }
.issue-sev.info { background: var(--fg-4); }

.qc-notes { display: flex; flex-direction: column; gap: 8px; }
.qc-note {
  padding: 9px 11px;
  border-radius: var(--r-1);
  background: var(--bg-2);
  border-left: 2px solid var(--red);
}
.qc-note.pass { border-left-color: var(--green); }
.qc-note.reject { border-left-color: var(--red); }
.qc-text {
  margin-top: 4px;
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--fg-2);
  padding-left: 18px;
}

.timeline { display: flex; flex-direction: column; gap: 0; }
.tl-item {
  display: grid;
  grid-template-columns: 12px 1fr auto;
  gap: 8px;
  align-items: baseline;
  padding: 5px 0;
  font-size: 11.5px;
  position: relative;
}
.tl-item:not(:last-child)::after {
  content: '';
  position: absolute;
  left: 4px;
  top: 16px;
  bottom: -3px;
  width: 1px;
  background: var(--line-1);
}
.tl-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--bg-4);
  box-shadow: 0 0 0 2px var(--bg-1);
  margin-top: 4px;
}
.tl-dot.tl-reject { background: var(--red); }
.tl-dot.tl-pass { background: var(--green); }
.tl-dot.tl-submit { background: var(--violet); }
.tl-dot.tl-create { background: var(--lunar); }
.tl-dot.tl-deliver { background: var(--teal); }
.tl-text { color: var(--fg-1); }
.tl-meta { color: var(--fg-4); font-size: 10px; white-space: nowrap; }

.prio-urgent { color: #f08b91; }
.prio-high { color: var(--lunar); }
.prio-low { color: var(--fg-3); }

.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
