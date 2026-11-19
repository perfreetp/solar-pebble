<script setup>
import { ref, onMounted, computed } from 'vue'
import { repo, STATUSES } from '../store/repo.js'

const stats = ref(repo.stats())
const orders = ref(repo.list())
const statusMap = Object.fromEntries(STATUSES.map((s) => [s.key, s.label]))

function refresh() {
  stats.value = repo.stats()
  orders.value = repo.list()
}
onMounted(refresh)

const maxDone = computed(() => Math.max(1, ...stats.value.rows.map((r) => r.done)))
const maxRework = computed(() => Math.max(1, ...stats.value.rows.map((r) => r.rework)))

const statusFlow = computed(() =>
  STATUSES.map((s) => ({ ...s, count: orders.value.filter((o) => o.status === s.key).length }))
)

function seedDemo() {
  // 灌入演示数据，便于直接看看板效果
  const p = {
    slopeGrade: 12, stepHeight: 0.2, rubbleDensity: 20, trenchWidth: 0.5, waterDepth: 0.25
  }
  const names = ['王建模', '李建模']
  const demos = [
    { title: '爬坡性能测试路面', client: '华东机器人', assignee: '王建模', status: 'done', rework: 0 },
    { title: '台阶通过性场地', client: '华东机器人', assignee: '王建模', status: 'done', rework: 1 },
    { title: '碎石颠簸路', client: '北方智驾', assignee: '李建模', status: 'done', rework: 0 },
    { title: '沟槽跨越测试', client: '北方智驾', assignee: '李建模', status: 'rework', rework: 2 },
    { title: '涉水池综合场', client: '南方装备', assignee: '王建模', status: 'qc', rework: 0 },
    { title: '复合障碍综合路', client: '南方装备', assignee: '李建模', status: 'assigned', rework: 0 }
  ]
  for (const d of demos) {
    const o = repo.create({
      title: d.title, client: d.client, requirement: '演示数据',
      seed: Math.floor(100000 + Math.random() * 900000), params: { ...p }
    })
    repo.assign(o.id, d.assignee, '前台')
    if (d.status === 'done') {
      repo.submitQc(o.id, Math.random().toString(16).slice(2, 10), { heightmap: 'demo.png', obj: 'demo.obj', triCount: 131072 }, d.assignee)
      for (let i = 0; i < d.rework; i++) {
        repo.qcReject(o.id, '赵质检', '演示打回', {})
        repo.resubmit(o.id, Math.random().toString(16).slice(2, 10), { heightmap: 'demo.png', obj: 'demo.obj', triCount: 131072 }, d.assignee)
      }
      repo.qcPass(o.id, '赵质检')
    } else if (d.status === 'qc') {
      repo.submitQc(o.id, Math.random().toString(16).slice(2, 10), { heightmap: 'demo.png', obj: 'demo.obj', triCount: 131072 }, d.assignee)
    } else if (d.status === 'rework') {
      repo.submitQc(o.id, 'a', {}, d.assignee)
      for (let i = 0; i < d.rework; i++) repo.qcReject(o.id, '赵质检', '演示打回', {})
    }
  }
  refresh()
}
</script>

<template>
  <div class="dash-page">
    <div class="page-head">
      <div>
        <h2>生产看板</h2>
        <p class="muted">按建模员统计完成单量、在制单量与返工率</p>
      </div>
      <div class="row">
        <button @click="seedDemo">＋ 灌入演示数据</button>
        <button @click="refresh">↻ 刷新</button>
      </div>
    </div>

    <div class="kpi-row">
      <div class="card kpi"><div class="kpi-num">{{ stats.summary.total }}</div><div class="muted">工单总数</div></div>
      <div class="card kpi"><div class="kpi-num cyan">{{ stats.summary.newCount }}</div><div class="muted">待分配</div></div>
      <div class="card kpi"><div class="kpi-num orange">{{ stats.summary.doingCount }}</div><div class="muted">进行中</div></div>
      <div class="card kpi"><div class="kpi-num green">{{ stats.summary.doneCount }}</div><div class="muted">已完成</div></div>
      <div class="card kpi">
        <div class="kpi-num" :class="stats.summary.passRate >= 0.8 ? 'green' : 'red'">
          {{ (stats.summary.passRate * 100).toFixed(0) }}%
        </div>
        <div class="muted">质检一次通过率</div>
      </div>
    </div>

    <div class="card">
      <h3>建模员产出</h3>
      <table>
        <thead>
          <tr>
            <th>建模员</th><th>总单量</th><th>已完成</th><th>在制</th>
            <th style="width: 200px">完成单量</th><th>返工次数</th>
            <th style="width: 200px">返工率</th><th>返工率数值</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in stats.rows" :key="r.name">
            <td><b>{{ r.name }}</b></td>
            <td>{{ r.total }}</td>
            <td class="green">{{ r.done }}</td>
            <td class="cyan">{{ r.inProgress }}</td>
            <td>
              <div class="bar-track">
                <div class="bar green-bar" :style="{ width: (r.done / maxDone) * 100 + '%' }"></div>
              </div>
            </td>
            <td :class="{ red: r.rework > 0 }">{{ r.rework }}</td>
            <td>
              <div class="bar-track">
                <div
                  class="bar"
                  :class="r.reworkRate > 0.3 ? 'red-bar' : r.reworkRate > 0.1 ? 'orange-bar' : 'green-bar'"
                  :style="{ width: (r.reworkRate * 100).toFixed(1) + '%' }"
                ></div>
              </div>
            </td>
            <td class="mono" :class="{ red: r.reworkRate > 0.3 }">{{ (r.reworkRate * 100).toFixed(1) }}%</td>
          </tr>
        </tbody>
      </table>
      <p class="muted tiny" style="margin-top: 8px">
        返工率 = 返工次数 ÷ 提交质检次数；超过 30% 标红，10%~30% 标橙。
      </p>
    </div>

    <div class="card" style="margin-top: 14px">
      <h3>工单状态流转</h3>
      <div class="flow">
        <template v-for="(s, i) in statusFlow" :key="s.key">
          <div class="flow-node">
            <span class="tag" :class="s.key">{{ s.label }}</span>
            <div class="flow-count">{{ s.count }}</div>
          </div>
          <div v-if="i < statusFlow.length - 1" class="flow-arrow">→</div>
        </template>
      </div>
    </div>

    <div class="card" style="margin-top: 14px">
      <h3>最近工单</h3>
      <table>
        <thead><tr><th>工单</th><th>标题</th><th>负责人</th><th>状态</th><th>返工</th><th>指纹</th></tr></thead>
        <tbody>
          <tr v-for="o in orders.slice(0, 8)" :key="o.id">
            <td class="mono tiny">{{ o.id }}</td>
            <td>{{ o.title }}</td>
            <td>{{ o.assignee || '—' }}</td>
            <td><span class="tag" :class="o.status">{{ statusMap[o.status] }}</span></td>
            <td :class="{ red: o.reworkCount > 0 }">{{ o.reworkCount }}</td>
            <td class="mono tiny">{{ o.fingerprint || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.dash-page { padding: 22px 26px; height: 100%; overflow: auto; }
.page-head { display: flex; justify-content: space-between; align-items: flex-start; }
h2 { margin: 0 0 4px; }
h3 { margin: 0 0 14px; font-size: 15px; }
.kpi-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin: 16px 0; }
.kpi-num { font-size: 30px; font-weight: 700; }
.cyan { color: var(--accent-2); }
.orange { color: var(--warn); }
.green { color: var(--ok); }
.red { color: var(--bad); }
.bar-track { background: var(--panel-2); border-radius: 6px; height: 14px; overflow: hidden; }
.bar { height: 100%; border-radius: 6px; min-width: 2px; }
.green-bar { background: var(--ok); }
.orange-bar { background: var(--warn); }
.red-bar { background: var(--bad); }
.flow { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.flow-node { text-align: center; }
.flow-count { font-size: 22px; font-weight: 700; margin-top: 6px; }
.flow-arrow { color: var(--muted); font-size: 22px; }
.tiny { font-size: 12px; }
</style>
