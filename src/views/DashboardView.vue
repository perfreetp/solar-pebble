<template>
  <div class="dash-view scroll">
    <div class="dash-inner">
      <header class="dash-head">
        <div>
          <h1 class="fs-22 w-600" style="letter-spacing: -0.02em">产能看板</h1>
          <p class="fs-12 t-fg3">各建模师傅完成量、返工率与质检节律 · 数据取自工单流转记录</p>
        </div>
        <div class="row g8">
          <span class="fs-10 t-fg4 mono">更新于 {{ updatedLabel }}</span>
          <button class="btn btn-sm" :disabled="loading" @click="load">
            <RefreshCw :size="12" :class="{ spin: loading }" /> 刷新
          </button>
        </div>
      </header>

      <div v-if="!data" class="empty" style="height: 300px">
        <Loader :size="20" class="spin t-fg3" />
        <span class="fs-12">统计中…</span>
      </div>

      <template v-else>
        <!-- KPI -->
        <section class="kpi-row">
          <div class="kpi" v-for="k in kpis" :key="k.key">
            <div class="kpi-top">
              <component :is="k.icon" :size="14" class="kpi-icon" :class="k.tone" />
              <span class="kpi-label">{{ k.label }}</span>
            </div>
            <div class="kpi-v num" :class="k.tone">{{ k.value }}</div>
            <div class="kpi-sub">{{ k.sub }}</div>
            <div v-if="k.spark" class="kpi-spark">
              <span v-for="(v, i) in k.spark" :key="i" :style="{ height: `${Math.max(6, v * 100)}%` }"></span>
            </div>
          </div>
        </section>

        <div class="main-grid">
          <!-- 各人完成量 -->
          <section class="panel chart-panel">
            <div class="panel-head">
              <span class="panel-title"><BarChart3 :size="12" /> 各师傅完成量</span>
              <div class="row g8">
                <span class="legend"><i style="background: var(--green)"></i>已通过</span>
                <span class="legend"><i style="background: var(--lunar)"></i>在制</span>
                <span class="legend"><i style="background: var(--violet)"></i>待质检</span>
                <span class="legend"><i style="background: var(--red)"></i>返工中</span>
              </div>
            </div>
            <div class="panel-body">
              <div class="hbars">
                <div v-for="m in data.perModeler" :key="m.id" class="hbar-row">
                  <div class="hbar-who">
                    <span class="avatar" :style="avatarStyle(m)">{{ m.avatar }}</span>
                    <div class="col" style="gap: 0">
                      <span class="fs-12 w-500">{{ m.name }}</span>
                      <span class="fs-9.5 t-fg4">{{ specialtyLabel(m.specialty) }}</span>
                    </div>
                  </div>
                  <div class="hbar-track">
                    <div class="hbar-seg done" :style="{ width: segWidth(m.completed) }">
                      <span v-if="m.completed" class="hbar-lab num">{{ m.completed }}</span>
                    </div>
                    <div class="hbar-seg active" :style="{ width: segWidth(m.inFlight) }">
                      <span v-if="m.inFlight >= 1" class="hbar-lab num">{{ m.inFlight }}</span>
                    </div>
                    <div class="hbar-seg review" :style="{ width: segWidth(m.awaitingQc) }">
                      <span v-if="m.awaitingQc >= 1" class="hbar-lab num">{{ m.awaitingQc }}</span>
                    </div>
                    <div class="hbar-seg rework" :style="{ width: segWidth(m.reworking) }">
                      <span v-if="m.reworking >= 1" class="hbar-lab num">{{ m.reworking }}</span>
                    </div>
                  </div>
                  <div class="hbar-total num">{{ m.total }}</div>
                </div>
              </div>
              <div class="chart-foot">
                <span>横轴为承接工单数（含已交付）；“待质检”指已提交、等质检抽查</span>
                <span class="grow"></span>
                <span class="mono">{{ data.perModeler.reduce((a, m) => a + m.completed, 0) }} 单已交付</span>
              </div>
            </div>
          </section>

          <!-- 返工率 -->
          <section class="panel">
            <div class="panel-head">
              <span class="panel-title"><Percent :size="12" /> 返工率与一次通过</span>
            </div>
            <div class="panel-body">
              <div class="rework-list">
                <div v-for="m in sortedByRework" :key="m.id" class="rw-row">
                  <span class="avatar sm" :style="avatarStyle(m)">{{ m.avatar }}</span>
                  <div class="col grow g3" style="min-width: 0">
                    <div class="row between">
                      <span class="fs-11.5">{{ m.name }}</span>
                      <span class="fs-10 mono rw-rate" :class="rateClass(m.reworkRate)">
                        {{ (m.reworkRate * 100).toFixed(0) }}%
                      </span>
                    </div>
                    <div class="rate-bar">
                      <i :style="{ width: `${Math.min(100, m.reworkRate * 100)}%`, background: rateColor(m.reworkRate) }"></i>
                    </div>
                  </div>
                  <div class="col" style="align-items: flex-end; gap: 0; width: 78px">
                    <span class="fs-10 t-fg4">一次过 · 均次</span>
                    <span class="fs-10 mono t-fg2">
                      <span class="rw-first">{{ m.firstPassRate === null ? '—' : `${(m.firstPassRate * 100).toFixed(0)}%` }}</span>
                      · <span class="rw-avg">{{ (m.avgRework ?? 0).toFixed(1) }}</span>
                    </span>
                  </div>
                </div>
              </div>
              <div class="panel-note">
                返工率 = 被打回过的工单数 / 已送检工单数。均次 = 每条送检工单平均被打回几次。
              </div>
            </div>
          </section>

          <!-- 状态分布 -->
          <section class="panel">
            <div class="panel-head">
              <span class="panel-title"><PieChart :size="12" /> 工单状态分布</span>
              <span class="fs-10 t-fg4 mono">共 {{ data.totals.orders }}</span>
            </div>
            <div class="panel-body">
              <div class="stack-bar">
                <div
                  v-for="s in statusRows"
                  :key="s.key"
                  class="stack-seg"
                  :style="{ width: `${(s.n / data.totals.orders) * 100}%`, background: s.color }"
                  :title="`${s.label} ${s.n}`"
                ></div>
              </div>
              <div class="status-legend">
                <div v-for="s in statusRows" :key="s.key" class="sl-row">
                  <span class="sl-dot" :style="{ background: s.color }"></span>
                  <span class="fs-11 t-fg2 grow">{{ s.label }}</span>
                  <span class="fs-11 mono t-fg1">{{ s.n }}</span>
                  <span class="fs-10 mono t-fg4" style="width: 34px; text-align: right">
                    {{ data.totals.orders ? ((s.n / data.totals.orders) * 100).toFixed(0) : 0 }}%
                  </span>
                </div>
              </div>
            </div>
          </section>

          <!-- 节律 -->
          <section class="panel chart-panel">
            <div class="panel-head">
              <span class="panel-title"><Activity :size="12" /> 近 14 天送检 / 打回 / 通过</span>
              <div class="row g8">
                <span class="legend"><i style="background: var(--violet)"></i>送检</span>
                <span class="legend"><i style="background: var(--red)"></i>打回</span>
                <span class="legend"><i style="background: var(--green)"></i>通过</span>
              </div>
            </div>
            <div class="panel-body">
              <div class="day-chart">
                <div v-for="d in data.days" :key="d.date" class="day-col">
                  <div class="day-bars">
                    <div class="db submitted" :style="{ height: barH(d.submitted) }" :title="`送检 ${d.submitted}`"></div>
                    <div class="db rejected" :style="{ height: barH(d.rejected) }" :title="`打回 ${d.rejected}`"></div>
                    <div class="db passed" :style="{ height: barH(d.passed) }" :title="`通过 ${d.passed}`"></div>
                  </div>
                  <span class="day-lb">{{ d.date.slice(5).replace('-', '/') }}</span>
                </div>
              </div>
            </div>
          </section>
        </div>

        <!-- 质检队列 + 动态 -->
        <div class="bottom-grid">
          <section class="panel">
            <div class="panel-head">
              <span class="panel-title"><ScanSearch :size="12" /> 质检队列</span>
              <span class="fs-10 mono t-fg4">{{ data.qcQueue.length }} 单待查</span>
            </div>
            <div class="panel-body" style="padding: 6px">
              <div v-if="!data.qcQueue.length" class="fs-11 t-fg3" style="padding: 14px">质检队列已清空。</div>
              <button
                v-for="o in data.qcQueue"
                :key="o.id"
                class="queue-row"
                @click="$router.push('/qc')"
              >
                <span class="mono fs-10 t-fg3">{{ o.code }}</span>
                <span class="fs-11.5 grow truncate">{{ o.title }}</span>
                <span v-if="o.reworkCount" class="tag rework-tag">返工 {{ o.reworkCount }}</span>
                <span v-if="o.assigneeInfo" class="row g4 fs-10 t-fg3">
                  <span class="avatar xs" :style="avatarStyle(o.assigneeInfo)">{{ o.assigneeInfo.avatar }}</span>
                  {{ o.assigneeName }}
                </span>
                <ChevronRight :size="11" class="t-fg4" />
              </button>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <span class="panel-title"><Clock :size="12" /> 最近动态</span>
            </div>
            <div class="panel-body" style="padding: 8px 14px; max-height: 300px; overflow-y: auto">
              <div v-for="(h, i) in data.recent.slice(0, 12)" :key="i" class="feed-row">
                <span class="feed-dot" :class="`feed-${h.kind}`"></span>
                <span class="fs-11 t-fg2 truncate" style="flex: 1">{{ h.text }}</span>
                <span class="fs-9.5 t-fg4 mono shrink">{{ h.code }}</span>
                <span class="fs-9.5 t-fg4 shrink">{{ formatTime(h.at) }}</span>
              </div>
            </div>
          </section>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import {
  RefreshCw, Loader, BarChart3, Percent, PieChart, Activity, ScanSearch, Clock,
  ChevronRight, PackageCheck, Users, RotateCcw, AlertTriangle, Boxes,
} from 'lucide-vue-next';
import { appState, apiClient, avatarStyle, formatTime, toast } from '../state.js';

const data = ref(null);
const loading = ref(false);
const updatedAt = ref(null);

const STATUS_COLORS = {
  draft: '#4b5262',
  queued: '#5fa8d8',
  building: '#e2a04d',
  submitted: '#9a8ce0',
  rejected: '#e5626a',
  approved: '#67c56b',
  delivered: '#3f7d55',
};

const kpis = computed(() => {
  const t = data.value?.totals || {};
  return [
    {
      key: 'orders', label: '工单总数', icon: Boxes, value: t.orders ?? 0,
      sub: `${t.active ?? 0} 单在制 · ${t.awaitingQc ?? 0} 单待质检`, tone: 'fg',
    },
    {
      key: 'delivered', label: '已交付', icon: PackageCheck, value: t.delivered ?? 0,
      sub: `另有 ${t.approved ?? 0} 单质检通过待交付`, tone: 'green',
    },
    {
      key: 'rework', label: '累计返工', icon: RotateCcw, value: t.reworkTotal ?? 0,
      sub: `${t.reworkOrders ?? 0}/${t.reviewed ?? 0} 单被打回 · 返工率 ${((t.reworkRate ?? 0) * 100).toFixed(0)}%`,
      tone: (t.reworkRate ?? 0) > 0.5 ? 'red' : (t.reworkRate ?? 0) > 0.25 ? 'amber' : 'green',
    },
    {
      key: 'overdue', label: '超期工单', icon: AlertTriangle, value: t.overdue ?? 0,
      sub: t.overdue ? '需要前台跟催' : '交期全部在控', tone: t.overdue ? 'red' : 'green',
    },
  ];
});

const statusRows = computed(() => {
  const c = data.value?.statusCounts || {};
  const labels = appState.statuses;
  return Object.keys(labels).map((key) => ({
    key,
    label: labels[key].label,
    n: c[key] || 0,
    color: STATUS_COLORS[key] || '#444',
  })).filter((s) => s.n > 0);
});

const sortedByRework = computed(() => {
  if (!data.value) return [];
  return [...data.value.perModeler].sort((a, b) => b.reworkRate - a.reworkRate);
});

const updatedLabel = computed(() => (updatedAt.value ? formatTime(updatedAt.value) : '—'));

function specialtyLabel(key) {
  return { cave: '洞体', lining: '内壁', habitat: '舱段', utility: '设备' }[key] || '综合';
}

function segWidth(n) {
  const max = Math.max(1, ...(data.value?.perModeler || []).map((m) => m.total));
  return `${(n / max) * 100}%`;
}

function rateColor(r) {
  if (r > 0.5) return 'var(--red)';
  if (r > 0.25) return 'var(--amber)';
  return 'var(--green)';
}

function rateClass(r) {
  if (r > 0.5) return 't-red';
  if (r > 0.25) return 't-amber';
  return 't-green';
}

function barH(n) {
  const max = Math.max(1, ...(data.value?.days || []).flatMap((d) => [d.submitted, d.rejected, d.passed]));
  return `${Math.max(2, (n / max) * 100)}%`;
}

async function load() {
  loading.value = true;
  try {
    data.value = await apiClient.dashboard();
    updatedAt.value = new Date().toISOString();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.dash-view {
  height: 100%;
  min-height: 0;
  background: var(--bg-0);
  overflow-y: auto;
}
.dash-inner {
  max-width: 1440px;
  margin: 0 auto;
  padding: 24px 28px 48px;
}
.dash-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 20px;
}

.kpi-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 14px;
}
.kpi {
  padding: 14px 16px;
  background: var(--bg-1);
  border: 1px solid var(--line-1);
  border-radius: var(--r-2);
  position: relative;
  overflow: hidden;
}
.kpi-top {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 6px;
}
.kpi-icon { color: var(--fg-3); }
.kpi-icon.green { color: var(--green); }
.kpi-icon.red { color: var(--red); }
.kpi-icon.amber { color: var(--amber); }
.kpi-label {
  font-size: 10px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--fg-3);
  font-weight: 600;
}
.kpi-v {
  font-size: 30px;
  font-weight: 600;
  line-height: 1.05;
  color: var(--fg-0);
  letter-spacing: -0.03em;
}
.kpi-v.green { color: var(--green); }
.kpi-v.red { color: var(--red); }
.kpi-v.amber { color: var(--amber); }
.kpi-sub {
  font-size: 10.5px;
  color: var(--fg-3);
  margin-top: 4px;
}

.main-grid {
  display: grid;
  grid-template-columns: 1.55fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
}
.bottom-grid {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 12px;
}

.legend {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--fg-3);
}
.legend i {
  width: 7px;
  height: 7px;
  border-radius: 1px;
}

.hbars {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.hbar-row {
  display: grid;
  grid-template-columns: 132px 1fr 34px;
  align-items: center;
  gap: 10px;
}
.hbar-who {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.hbar-track {
  display: flex;
  height: 20px;
  border-radius: 2px;
  overflow: hidden;
  background: var(--bg-2);
  gap: 1px;
}
.hbar-seg {
  height: 100%;
  position: relative;
  transition: width 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);
  min-width: 0;
}
.hbar-seg.done { background: linear-gradient(90deg, #4f9e55, var(--green)); }
.hbar-seg.active { background: linear-gradient(90deg, #b57b34, var(--lunar)); }
.hbar-seg.review { background: linear-gradient(90deg, #6d5fb0, var(--violet)); }
.hbar-seg.rework { background: var(--red); opacity: 0.85; }
.hbar-lab {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 9px;
  color: rgba(0, 0, 0, 0.7);
  font-weight: 700;
}
.hbar-total {
  font-size: 11px;
  color: var(--fg-3);
  text-align: right;
}
.chart-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px dashed var(--line-1);
  font-size: 10px;
  color: var(--fg-4);
}

.rework-list {
  display: flex;
  flex-direction: column;
  gap: 11px;
}
.rw-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.avatar.sm { width: 20px; height: 20px; font-size: 8px; }
.rate-bar {
  height: 3px;
  background: var(--bg-3);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 2px;
}
.rate-bar > i {
  display: block;
  height: 100%;
  border-radius: 2px;
  transition: width 0.4s;
}
.panel-note {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px dashed var(--line-1);
  font-size: 10px;
  color: var(--fg-4);
}

.stack-bar {
  display: flex;
  height: 14px;
  border-radius: 2px;
  overflow: hidden;
  background: var(--bg-2);
  margin-bottom: 14px;
}
.stack-seg { height: 100%; transition: width 0.4s; }
.stack-seg + .stack-seg { border-left: 1px solid var(--bg-1); }

.status-legend {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sl-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sl-dot {
  width: 7px;
  height: 7px;
  border-radius: 1px;
}

.day-chart {
  display: flex;
  gap: 4px;
  align-items: flex-end;
  height: 150px;
  padding-top: 8px;
}
.day-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  height: 100%;
}
.day-bars {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 2px;
}
.db {
  flex: 1;
  max-width: 9px;
  border-radius: 1px 1px 0 0;
  min-height: 2px;
  transition: height 0.4s;
}
.db.submitted { background: var(--violet); opacity: 0.8; }
.db.rejected { background: var(--red); }
.db.passed { background: var(--green); }
.day-lb {
  font-size: 8.5px;
  color: var(--fg-4);
  font-family: var(--font-mono);
  white-space: nowrap;
}

.queue-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--r-1);
  text-align: left;
  transition: 0.12s;
}
.queue-row:hover { background: var(--bg-2); }
.rework-tag { background: var(--red-soft); color: #f08b91; }
.avatar.xs { width: 16px; height: 16px; font-size: 7px; }

.feed-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  border-bottom: 1px solid var(--line-1);
}
.feed-row:last-child { border-bottom: none; }
.feed-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--fg-3);
  flex-shrink: 0;
}
.feed-dot.feed-reject { background: var(--red); }
.feed-dot.feed-pass { background: var(--green); }
.feed-dot.feed-submit { background: var(--violet); }
.feed-dot.feed-create { background: var(--lunar); }
.feed-dot.feed-assign { background: var(--cyan); }
.feed-dot.feed-deliver { background: var(--teal); }
.feed-dot.feed-save, .feed-dot.feed-start { background: var(--fg-4); }

.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 1100px) {
  .kpi-row { grid-template-columns: repeat(2, 1fr); }
  .main-grid, .bottom-grid { grid-template-columns: 1fr; }
}
</style>
