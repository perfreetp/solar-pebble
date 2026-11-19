<template>
  <div class="wf-layout">
    <div class="panel">
      <div class="panel-title">
        课件派单流程
        <span class="tag blue">{{ wf.roleLabel }}视图 · {{ wf.currentUser.name }}</span>
      </div>
      <div class="panel-body">
        <div class="flow-steps">
          <span v-for="(s, i) in flowDef" :key="s.key" class="step" :class="{ on: true }">
            <b>{{ i + 1 }}</b> {{ s.label }}
            <i v-if="i < flowDef.length - 1">→</i>
          </span>
        </div>

        <!-- 教练：提交需求 -->
        <div v-if="wf.currentRole === 'coach'" class="create-box">
          <h4>提交射击姿势课件需求</h4>
          <div class="form-grid">
            <label class="field"><span>课件名称</span><input v-model="form.title" placeholder="如：手枪据枪站姿精讲" /></label>
            <label class="field"><span>课程章节</span><input v-model="form.courseName" placeholder="如：基础射击 · 第3课" /></label>
          </div>
          <label class="field"><span>动作与教学要求</span>
            <textarea v-model="form.requirement" rows="3" placeholder="描述需要演示的姿势要点：躯干前倾、持枪臂抬起、呼吸节奏等"></textarea>
          </label>
          <button class="primary" @click="submitReq">提交需求给管理员</button>
        </div>

        <table style="margin-top:16px">
          <thead>
            <tr><th>工单号</th><th>课件/需求</th><th>状态</th><th>负责人</th><th>返工</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="t in wf.visibleTickets" :key="t.id" @click="selected = t"
                :class="{ rowSel: selected?.id === t.id }">
              <td><strong>{{ t.id }}</strong><div class="muted small">{{ fmt(t.createdAt) }}</div></td>
              <td>
                <strong>{{ t.title }}</strong>
                <div class="muted small">{{ t.courseName }}</div>
                <div class="muted small req">{{ t.requirement }}</div>
                <div v-if="t.rejectReason" class="reject-reason">打回原因：{{ t.rejectReason }}</div>
              </td>
              <td><span class="tag" :class="statusClass(t.status)">{{ STATUS_LABELS[t.status] }}</span></td>
              <td>{{ t.makerName || '—' }}</td>
              <td><span :class="{ 'rework-badge': t.reworkCount > 0 }">{{ t.reworkCount }} 次</span></td>
              <td>
                <div class="row actions">
                  <template v-for="action in availableActions(t)" :key="action.v">
                    <button v-if="action.v !== 'reject'" :class="action.v === 'pass' ? 'primary' : ''"
                            @click="doAct(t, action.v)">{{ action.label }}</button>
                    <button v-else class="danger" @click="doReject(t)">{{ action.label }}</button>
                  </template>
                  <RouterLink v-if="canEdit(t)" to="/editor" class="link-btn">打开编辑器 →</RouterLink>
                </div>
              </td>
            </tr>
            <tr v-if="!wf.visibleTickets.length">
              <td colspan="6" class="muted" style="text-align:center;padding:26px">暂无工单</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel side-log">
      <div class="panel-title">流转记录（选中工单）</div>
      <div class="panel-body">
        <div v-if="!selected" class="muted small">点击工单行查看记录</div>
        <div v-for="(l, i) in selected?.logs || []" :key="i" class="log-item">
          <div class="dot"></div>
          <div>
            <div>{{ l.text }}</div>
            <div class="muted small">{{ roleName(l.role) }} · {{ fmt(l.at) }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useWorkflowStore, STATUS_LABELS, TRANSITIONS, ROLES } from '../stores/workflow.js'

const wf = useWorkflowStore()
const form = reactive({ title: '', courseName: '', requirement: '' })
const selected = ref(null)

const flowDef = [
  { key: 'draft', label: '教练提交' },
  { key: 'submitted', label: '管理员分派' },
  { key: 'in_progress', label: '制作提交' },
  { key: 'qc_pending', label: '质检抽查' },
  { key: 'done', label: '入库/打回' }
]

function submitReq() {
  if (!form.title.trim()) return alert('请填写课件名称')
  const t = wf.createTicket({ title: form.title, courseName: form.courseName, requirement: form.requirement })
  wf.act(t.id, 'submit')
  form.title = ''; form.courseName = ''; form.requirement = ''
  selected.value = wf.tickets.find((x) => x.id === t.id)
}

function availableActions(t) {
  const map = TRANSITIONS[t.status] || {}
  return Object.entries(map)
    .filter(([v]) => wf.canDo(t, v))
    .map(([v, cfg]) => ({ v, label: cfg.label }))
}

function doAct(t, action) {
  if (action === 'assign') {
    const r = wf.act(t.id, 'assign', { makerId: wf.users.maker.id, makerName: wf.users.maker.name })
    if (!r.ok) alert(r.msg)
    return
  }
  const r = wf.act(t.id, action)
  if (!r.ok) alert(r.msg)
}

function doReject(t) {
  const reason = prompt('请输入质检不合格原因（将记录返工次数）：', '姿势角度不达标，需调整躯干前倾与持枪臂')
  if (reason == null) return
  const r = wf.act(t.id, 'reject', { reason })
  if (!r.ok) alert(r.msg)
}

function canEdit(t) {
  return ['assigned', 'in_progress', 'rejected'].includes(t.status) && (wf.currentRole === 'maker')
}

function statusClass(s) {
  return {
    draft: 'gray', submitted: 'amber', assigned: 'blue', in_progress: 'blue',
    qc_pending: 'amber', rejected: 'red', done: 'green'
  }[s]
}
function fmt(ts) {
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function roleName(id) {
  return ROLES.find((r) => r.id === id)?.label || id
}
</script>

<style scoped>
.wf-layout { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 14px; align-items: start; }
.flow-steps { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 16px; }
.step { display: inline-flex; align-items: center; gap: 6px; background: #f1f5fb; border-radius: 999px; padding: 5px 12px; font-size: 12.5px; }
.step b { background: var(--blue); color: #fff; border-radius: 50%; width: 18px; height: 18px; display: inline-grid; place-items: center; font-size: 11px; }
.step i { color: var(--muted); font-style: normal; margin-left: 4px; }
.create-box { border: 1px dashed #b6c2d6; border-radius: 10px; padding: 14px; background: #fbfcfe; }
.create-box h4 { margin: 0 0 10px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.req { max-width: 340px; }
.reject-reason { color: var(--red); font-size: 12px; margin-top: 3px; font-weight: 600; }
.rework-badge { color: var(--red); font-weight: 700; }
.actions { flex-wrap: wrap; }
.link-btn { color: var(--blue); text-decoration: none; font-size: 12.5px; padding: 6px 4px; font-weight: 600; }
.side-log { position: sticky; top: 0; }
.log-item { display: flex; gap: 9px; padding: 7px 0; border-bottom: 1px dashed var(--line); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--blue); margin-top: 6px; flex: none; }
.small { font-size: 12px; }
tr { cursor: pointer; }
tr.rowSel { background: #f0f6ff; }
@media (max-width: 1100px) { .wf-layout { grid-template-columns: 1fr; } }
</style>
