/**
 * 本地数据仓库：需求单 / 质检 / 看板统计。
 * 用 localStorage 持久化，模拟后端；数据结构按可替换成 REST API 设计。
 */
const KEY = 'terrain-editor-orders-v1'
const USERS_KEY = 'terrain-editor-users-v1'

export const STATUSES = [
  { key: 'new', label: '待分配' },
  { key: 'assigned', label: '建模中' },
  { key: 'qc', label: '待质检' },
  { key: 'rework', label: '返工' },
  { key: 'done', label: '已完成' }
]

export const DEFAULT_USERS = [
  { id: 'u1', name: '王建模', role: 'modeler' },
  { id: 'u2', name: '李建模', role: 'modeler' },
  { id: 'u3', name: '赵质检', role: 'qc' }
]

function readUsers() {
  const raw = localStorage.getItem(USERS_KEY)
  if (raw) return JSON.parse(raw)
  localStorage.setItem(USERS_KEY, JSON.stringify(DEFAULT_USERS))
  return [...DEFAULT_USERS]
}

function readOrders() {
  const raw = localStorage.getItem(KEY)
  return raw ? JSON.parse(raw) : []
}
function writeOrders(list) {
  localStorage.setItem(KEY, JSON.stringify(list))
}

export const repo = {
  users() {
    return readUsers()
  },
  list() {
    return readOrders().sort((a, b) => b.createdAt - a.createdAt)
  },
  get(id) {
    return readOrders().find((o) => o.id === id)
  },
  create(payload) {
    const list = readOrders()
    const id = 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + (list.length + 1).toString().padStart(2, '0')
    const order = {
      id,
      title: payload.title,
      client: payload.client,
      requirement: payload.requirement,
      seed: String(payload.seed),
      params: payload.params,
      status: 'new',
      assignee: null,
      creator: payload.creator || '前台',
      createdAt: Date.now(),
      history: [{ at: Date.now(), action: '建单', by: payload.creator || '前台' }],
      qc: null,
      reworkCount: 0,
      fingerprint: null,
      exports: null
    }
    list.push(order)
    writeOrders(list)
    return order
  },
  update(id, patch, note) {
    const list = readOrders()
    const o = list.find((x) => x.id === id)
    if (!o) throw new Error('工单不存在: ' + id)
    Object.assign(o, patch)
    if (note) o.history.push({ at: Date.now(), action: note.action, by: note.by, detail: note.detail || '' })
    writeOrders(list)
    return o
  },
  assign(id, assignee, by) {
    return this.update(id, { status: 'assigned', assignee }, { action: '分配给 ' + assignee, by })
  },
  submitQc(id, fingerprint, exports, by) {
    return this.update(
      id,
      { status: 'qc', fingerprint, exports, submittedAt: Date.now() },
      { action: '提交质检', by, detail: '指纹 ' + fingerprint }
    )
  },
  qcPass(id, by) {
    return this.update(id, { status: 'done', qc: { pass: true, at: Date.now(), by } }, { action: '质检通过', by })
  },
  qcReject(id, by, reason, diff) {
    const o = this.get(id)
    return this.update(
      id,
      {
        status: 'rework',
        reworkCount: (o.reworkCount || 0) + 1,
        qc: { pass: false, at: Date.now(), by, reason, diff }
      },
      { action: '质检打回', by, detail: reason }
    )
  },
  resubmit(id, fingerprint, exports, by) {
    return this.update(
      id,
      { status: 'qc', fingerprint, exports, submittedAt: Date.now(), qc: null },
      { action: '返工后重新提交', by, detail: '指纹 ' + fingerprint }
    )
  },
  /** 看板：按人统计完成单量、返工率、在制单量 */
  stats() {
    const list = readOrders()
    const users = readUsers()
    const rows = users
      .filter((u) => u.role === 'modeler')
      .map((u) => {
        const mine = list.filter((o) => o.assignee === u.name)
        const done = mine.filter((o) => o.status === 'done').length
        const inProgress = mine.filter((o) => ['assigned', 'qc', 'rework'].includes(o.status)).length
        const reworkTotal = mine.reduce((s, o) => s + (o.reworkCount || 0), 0)
        const submitted = mine.filter((o) => o.qc || o.status === 'done').length + mine.reduce((s, o) => s + (o.reworkCount || 0), 0)
        return {
          name: u.name,
          total: mine.length,
          done,
          inProgress,
          rework: reworkTotal,
          reworkRate: submitted ? reworkTotal / submitted : 0
        }
      })
    const summary = {
      total: list.length,
      newCount: list.filter((o) => o.status === 'new').length,
      doingCount: list.filter((o) => ['assigned', 'qc', 'rework'].includes(o.status)).length,
      doneCount: list.filter((o) => o.status === 'done').length,
      passRate: (() => {
        const qcCount = list.filter((o) => o.qc).length
        if (!qcCount) return 0
        return list.filter((o) => o.qc && o.qc.pass).length / qcCount
      })()
    }
    return { rows, summary }
  },
  reset() {
    localStorage.removeItem(KEY)
  }
}
