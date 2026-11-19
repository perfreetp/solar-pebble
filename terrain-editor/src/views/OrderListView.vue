<script setup>
import { ref, computed } from 'vue'
import { repo, STATUSES } from '../store/repo.js'
import { PARAM_GROUPS, defaultParams } from '../terrain/config.js'

const emit = defineEmits(['open-editor', 'go-tab'])
const orders = ref(repo.list())
const users = ref(repo.users().filter((u) => u.role === 'modeler'))
const showForm = ref(false)
const form = ref({
  title: '',
  client: '',
  requirement: '',
  seed: Math.floor(100000 + Math.random() * 900000),
  params: defaultParams()
})
const statusMap = Object.fromEntries(STATUSES.map((s) => [s.key, s.label]))
const filter = ref('all')

const filtered = computed(() =>
  filter.value === 'all' ? orders.value : orders.value.filter((o) => o.status === filter.value)
)

function refresh() {
  orders.value = repo.list()
}
function submit() {
  if (!form.value.title.trim() || !form.value.client.trim()) {
    alert('请填写单标题与客户名称')
    return
  }
  repo.create({ ...form.value })
  showForm.value = false
  form.value = {
    title: '', client: '', requirement: '',
    seed: Math.floor(100000 + Math.random() * 900000),
    params: defaultParams()
  }
  refresh()
}
function assign(o, ev) {
  repo.assign(o.id, ev.target.value, '前台')
  refresh()
}
function fmtTime(ts) {
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function paramSummary(p) {
  return `坡${p.slopeGrade}% / 台${p.stepHeight}m / 碎石${p.rubbleDensity} / 沟${p.trenchWidth}m / 水${p.waterDepth}m`
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2>测试需求单</h2>
        <p class="muted">客户提测试需求后前台建单，按参数指定 seed，再分给建模员出场地</p>
      </div>
      <button class="primary" @click="showForm = !showForm">＋ 新建需求单</button>
    </div>

    <div v-if="showForm" class="card form-card">
      <div class="grid2">
        <div>
          <label>单标题</label>
          <input v-model="form.title" placeholder="例如：爬坡+台阶综合路面验证" />
        </div>
        <div>
          <label>客户名称</label>
          <input v-model="form.client" placeholder="例如：XX 机器人事业部" />
        </div>
      </div>
      <div style="margin-top: 12px">
        <label>测试需求描述</label>
        <textarea v-model="form.requirement" rows="2" placeholder="测试目标、车型、关注指标…"></textarea>
      </div>
      <div class="grid2" style="margin-top: 12px">
        <div>
          <label>种子 seed（同 seed + 同参数结果完全一致）</label>
          <input v-model="form.seed" type="number" />
        </div>
        <div class="row" style="align-items: end">
          <button @click="form.seed = Math.floor(100000 + Math.random() * 900000)">🎲 随机种子</button>
        </div>
      </div>
      <div class="param-grid">
        <div v-for="g in PARAM_GROUPS" :key="g.key">
          <label>{{ g.label }}（{{ g.unit }}）</label>
          <input v-model.number="form.params[g.key]" type="number" :min="g.min" :max="g.max" :step="g.step" />
          <div class="muted hint">{{ g.desc }}</div>
        </div>
      </div>
      <div class="row" style="margin-top: 14px; gap: 8px">
        <button class="primary" @click="submit">提交建单</button>
        <button @click="showForm = false">取消</button>
      </div>
    </div>

    <div class="card" style="margin-top: 16px">
      <div class="row" style="margin-bottom: 10px; gap: 8px">
        <button :class="{ primary: filter === 'all' }" @click="filter = 'all'">全部</button>
        <button v-for="s in STATUSES" :key="s.key" :class="{ primary: filter === s.key }" @click="filter = s.key">
          {{ s.label }}
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>工单号</th><th>标题 / 客户</th><th>seed</th><th>参数摘要</th>
            <th>状态</th><th>负责人</th><th>建单时间</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in filtered" :key="o.id">
            <td class="mono">{{ o.id }}</td>
            <td>
              <div>{{ o.title }}</div>
              <div class="muted">{{ o.client }}</div>
            </td>
            <td class="mono">{{ o.seed }}</td>
            <td class="muted" style="font-size: 12px">{{ paramSummary(o.params) }}</td>
            <td><span class="tag" :class="o.status">{{ statusMap[o.status] }}</span></td>
            <td>
              <select v-if="o.status === 'new' || o.status === 'assigned'" :value="o.assignee || ''" @change="assign(o, $event)">
                <option value="" disabled>分配给…</option>
                <option v-for="u in users" :key="u.id" :value="u.name">{{ u.name }}</option>
              </select>
              <span v-else>{{ o.assignee || '—' }}</span>
            </td>
            <td class="muted">{{ fmtTime(o.createdAt) }}</td>
            <td>
              <button @click="emit('open-editor', o)">打开编辑器</button>
            </td>
          </tr>
          <tr v-if="!filtered.length">
            <td colspan="8" class="muted" style="text-align: center; padding: 28px">暂无工单，点击右上角新建</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.page { padding: 22px 26px; height: 100%; overflow: auto; }
.page-head { display: flex; justify-content: space-between; align-items: flex-start; }
h2 { margin: 0 0 4px; }
.form-card { margin-top: 16px; }
.param-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-top: 14px; }
.hint { font-size: 11px; margin-top: 3px; line-height: 1.4; }
</style>
