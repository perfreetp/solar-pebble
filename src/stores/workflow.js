import { defineStore } from 'pinia'

const STORE_KEY = 'spe_workflow_v1'

export const ROLES = [
  { id: 'coach', label: '教练' },
  { id: 'admin', label: '管理员' },
  { id: 'maker', label: '制作者' },
  { id: 'qc', label: '质检' }
]

// 工单状态机：当前状态 -> 可执行动作
export const TRANSITIONS = {
  draft: { submit: 'submitted', label: '提交需求' },
  submitted: { assign: 'assigned', label: '分派制作者' },
  assigned: { start: 'in_progress', label: '开始制作' },
  in_progress: { submit: 'qc_pending', label: '提交质检' },
  qc_pending: { pass: 'done', reject: 'rejected', label: '质检判定' },
  rejected: { start: 'in_progress', label: '返工' },
  done: {}
}

// 各角色允许的动作
const ROLE_ACTIONS = {
  coach: ['submit'],
  admin: ['assign'],
  maker: ['start', 'submit'],
  qc: ['pass', 'reject']
}

const DEMO_USERS = {
  coach: { id: 'u_coach', name: '李教练', role: 'coach' },
  admin: { id: 'u_admin', name: '王管理员', role: 'admin' },
  maker: { id: 'u_maker1', name: '张制作', role: 'maker' },
  qc: { id: 'u_qc1', name: '赵质检', role: 'qc' }
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* 损坏数据重新初始化 */
  }
  return { tickets: [], currentRole: 'coach', seq: 1 }
}

export const useWorkflowStore = defineStore('workflow', {
  state: () => ({ ...load(), users: DEMO_USERS }),

  getters: {
    currentUser: (s) => s.users[s.currentRole],
    roleLabel: (s) => ROLES.find((r) => r.id === s.currentRole)?.label || s.currentRole,
    visibleTickets(s) {
      const role = s.currentRole
      if (role === 'admin' || role === 'qc') return [...s.tickets].sort((a, b) => b.updatedAt - a.updatedAt)
      if (role === 'coach') return s.tickets.filter((t) => t.coachId === s.users.coach.id)
      if (role === 'maker') {
        return s.tickets.filter(
          (t) => t.makerId === s.users.maker.id || t.status === 'submitted' || t.status === 'assigned'
        )
      }
      return s.tickets
    },
    makers: (s) => [s.users.maker],
    // 看板：按制作者统计完成量与返工率
    dashboard(s) {
      const rows = new Map()
      const ensure = (uid, name) => {
        if (!rows.has(uid)) rows.set(uid, { uid, name, total: 0, done: 0, reworks: 0, active: 0, rate: 0 })
        return rows.get(uid)
      }
      for (const t of s.tickets) {
        if (!t.makerId) continue
        const r = ensure(t.makerId, t.makerName || t.makerId)
        r.total++
        if (t.status === 'done') r.done++
        if (['assigned', 'in_progress', 'rejected', 'qc_pending'].includes(t.status)) r.active++
        r.reworks += t.reworkCount || 0
      }
      for (const r of rows.values()) {
        // 返工率 = 打回次数 / (完成数 + 打回次数)
        const denom = r.done + r.reworks
        r.rate = denom ? Math.round((r.reworks / denom) * 1000) / 10 : 0
      }
      return [...rows.values()]
    },
    statusCounters(s) {
      const c = { draft: 0, submitted: 0, assigned: 0, in_progress: 0, qc_pending: 0, rejected: 0, done: 0 }
      for (const t of s.tickets) c[t.status] = (c[t.status] || 0) + 1
      return c
    }
  },

  actions: {
    persist() {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ tickets: this.tickets, currentRole: this.currentRole, seq: this.seq })
      )
    },
    switchRole(role) {
      this.currentRole = role
      this.persist()
    },
    canDo(ticket, action) {
      const allowed = ROLE_ACTIONS[this.currentRole] || []
      return allowed.includes(action) && !!(TRANSITIONS[ticket.status] || {})[action]
    },
    createTicket({ title, requirement, courseName }) {
      const now = Date.now()
      const ticket = {
        id: `WO-${String(this.seq).padStart(4, '0')}`,
        title,
        courseName: courseName || '',
        requirement: requirement || '',
        status: 'draft',
        coachId: this.users.coach.id,
        coachName: this.users.coach.name,
        makerId: null,
        makerName: null,
        reworkCount: 0,
        rejectReason: '',
        projectId: null,
        createdAt: now,
        updatedAt: now,
        logs: [{ at: now, role: 'coach', text: '教练创建需求工单' }]
      }
      this.seq++
      this.tickets.unshift(ticket)
      this.persist()
      return ticket
    },
    act(ticketId, action, payload = {}) {
      const t = this.tickets.find((x) => x.id === ticketId)
      if (!t) return { ok: false, msg: '工单不存在' }
      if (!this.canDo(t, action)) return { ok: false, msg: '当前角色无权执行该操作' }
      const next = TRANSITIONS[t.status][action]
      const now = Date.now()
      if (action === 'assign') {
        t.makerId = payload.makerId || this.users.maker.id
        t.makerName = payload.makerName || this.users.maker.name
        t.logs.push({ at: now, role: 'admin', text: `分派给 ${t.makerName}` })
      } else if (action === 'reject') {
        t.reworkCount++
        t.rejectReason = payload.reason || '质检不合格'
        t.logs.push({ at: now, role: 'qc', text: `质检打回（第 ${t.reworkCount} 次返工）：${t.rejectReason}` })
      } else if (action === 'pass') {
        t.logs.push({ at: now, role: 'qc', text: '质检通过，工单完成' })
      } else if (action === 'start') {
        const text = t.status === 'rejected' ? `开始第 ${t.reworkCount + 1} 次制作（返工）` : '开始制作'
        t.logs.push({ at: now, role: 'maker', text })
      } else if (action === 'submit') {
        t.logs.push({ at: now, role: 'maker', text: '提交质检（抽查）' })
      } else {
        t.logs.push({ at: now, role: this.currentRole, text: TRANSITIONS[t.status].label })
      }
      t.status = next
      t.updatedAt = now
      this.persist()
      return { ok: true }
    }
  }
})

export const STATUS_LABELS = {
  draft: '草稿',
  submitted: '待分派',
  assigned: '待制作',
  in_progress: '制作中',
  qc_pending: '待质检',
  rejected: '已打回',
  done: '已完成'
}
