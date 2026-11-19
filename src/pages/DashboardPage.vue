<template>
  <div class="dash">
    <div class="stat-row">
      <div v-for="c in counters" :key="c.key" class="panel stat-card">
        <div class="num" :style="{ color: c.color }">{{ wf.statusCounters[c.key] ?? 0 }}</div>
        <div class="muted">{{ c.label }}</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">
        制作者完成量与返工率看板
        <span class="muted small">返工率 = 打回次数 ÷（完成数 + 打回次数）</span>
      </div>
      <div class="panel-body">
        <table>
          <thead>
            <tr><th>制作者</th><th>承接工单数</th><th>进行中</th><th>已完成</th><th>累计打回</th><th>返工率</th><th>质量条</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in wf.dashboard" :key="r.uid">
              <td><strong>{{ r.name }}</strong></td>
              <td>{{ r.total }}</td>
              <td>{{ r.active }}</td>
              <td><span class="tag green">{{ r.done }}</span></td>
              <td><span :class="{ 'rework': r.reworks > 0 }">{{ r.reworks }} 次</span></td>
              <td><strong :style="{ color: r.rate > 20 ? 'var(--red)' : r.rate > 0 ? 'var(--amber)' : 'var(--green)' }">{{ r.rate }}%</strong></td>
              <td>
                <div class="rate-bar">
                  <div class="rate-fill" :style="{ width: (100 - r.rate) + '%', background: r.rate > 20 ? '#dc2626' : r.rate > 0 ? '#d97706' : '#16a34a' }"></div>
                </div>
              </td>
            </tr>
            <tr v-if="!wf.dashboard.length">
              <td colspan="7" class="muted" style="text-align:center;padding:26px">
                还没有分派工单。切换到「管理员」角色，在派单流程页分派教练提交的需求。
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">全部工单明细</div>
      <div class="panel-body">
        <table>
          <thead><tr><th>工单</th><th>课件</th><th>状态</th><th>制作者</th><th>返工次数</th><th>更新时间</th></tr></thead>
          <tbody>
            <tr v-for="t in wf.tickets" :key="t.id">
              <td>{{ t.id }}</td>
              <td>{{ t.title }}</td>
              <td><span class="tag" :class="statusClass(t.status)">{{ STATUS_LABELS[t.status] }}</span></td>
              <td>{{ t.makerName || '—' }}</td>
              <td :class="{ rework: t.reworkCount > 0 }">{{ t.reworkCount }}</td>
              <td class="muted small">{{ fmt(t.updatedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useWorkflowStore, STATUS_LABELS } from '../stores/workflow.js'
const wf = useWorkflowStore()
const counters = [
  { key: 'submitted', label: '待分派', color: '#d97706' },
  { key: 'in_progress', label: '制作中', color: '#2563eb' },
  { key: 'qc_pending', label: '待质检', color: '#7c3aed' },
  { key: 'rejected', label: '已打回', color: '#dc2626' },
  { key: 'done', label: '已完成', color: '#16a34a' }
]
function statusClass(s) {
  return { draft: 'gray', submitted: 'amber', assigned: 'blue', in_progress: 'blue', qc_pending: 'amber', rejected: 'red', done: 'green' }[s]
}
function fmt(ts) {
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
</script>

<style scoped>
.dash { display: flex; flex-direction: column; gap: 14px; }
.stat-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
.stat-card { padding: 14px; text-align: center; }
.stat-card .num { font-size: 30px; font-weight: 800; line-height: 1.2; }
.rate-bar { width: 160px; height: 10px; background: #eef1f6; border-radius: 999px; overflow: hidden; }
.rate-fill { height: 100%; border-radius: 999px; transition: width .3s; }
.rework { color: var(--red); font-weight: 700; }
.rowSel { background: #f0f6ff; }
.small { font-size: 12px; }
@media (max-width: 900px) { .stat-row { grid-template-columns: repeat(2, 1fr); } }
</style>
