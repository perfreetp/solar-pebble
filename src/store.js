import { reactive, watch } from 'vue'

export const MAP = { w: 80, h: 60 } // 厂区地图尺寸(米)
const LS_KEY = 'pml-store-v1'

let uid = 1
const nid = (p) => `${p}-${Date.now().toString(36)}-${uid++}`

/* ---------------- 默认数据 ---------------- */

const defaultDeviceTypes = {
  air:   { key: 'air',   name: '微型空气站', l: 1.2, w: 0.9, h: 1.8, color: '#4fc3f7', allowed: ['ground', 'rack'],          sampleHeight: 3.0 },
  noise: { key: 'noise', name: '噪声传感器', l: 0.5, w: 0.5, h: 0.8, color: '#aed581', allowed: ['ground', 'rack', 'wall'],  sampleHeight: 1.5 },
  probe: { key: 'probe', name: '采样探头',   l: 0.6, w: 0.6, h: 1.2, color: '#ffb74d', allowed: ['rack', 'wall'],            sampleHeight: 4.5 },
  met:   { key: 'met',   name: '气象杆',     l: 0.8, w: 0.8, h: 3.2, color: '#ce93d8', allowed: ['ground'],                  sampleHeight: 10.0 },
}

// 厂区构筑物:rack=管廊(顶面可装) wall=围墙(顶面可装) block=建筑(非安装面)
const defaultStructures = [
  { id: 'rackA', kind: 'rack',  name: '综合管廊A', x: 8,    y: 18,   l: 44, w: 2.5, h: 5.0 },
  { id: 'rackB', kind: 'rack',  name: '综合管廊B', x: 30,   y: 34,   l: 2.5, w: 22, h: 5.0 },
  { id: 'wallN', kind: 'wall',  name: '北围墙',   x: 0,    y: 0,    l: 80, w: 0.4, h: 2.4 },
  { id: 'wallS', kind: 'wall',  name: '南围墙',   x: 0,    y: 59.6, l: 80, w: 0.4, h: 2.4 },
  { id: 'wallW', kind: 'wall',  name: '西围墙',   x: 0,    y: 0,    l: 0.4, w: 60, h: 2.4 },
  { id: 'wallE', kind: 'wall',  name: '东围墙',   x: 79.6, y: 0,    l: 0.4, w: 60, h: 2.4 },
  { id: 'bld1',  kind: 'block', name: '综合楼',   x: 58,   y: 6,    l: 14, w: 9,  h: 7.5 },
  { id: 'bld2',  kind: 'block', name: '泵房',     x: 12,   y: 40,   l: 10, w: 8,  h: 4.5 },
]

const defaultRegions = [
  { id: 'r-west',  name: '西区罐区',   x: 0,  y: 0,  w: 40, h: 30, color: '#90caf9' },
  { id: 'r-east',  name: '东区装置区', x: 40, y: 0,  w: 40, h: 30, color: '#ef9a9a' },
  { id: 'r-south', name: '南区装卸区', x: 0,  y: 30, w: 40, h: 30, color: '#a5d6a7' },
  { id: 'r-north', name: '北区办公区', x: 40, y: 30, w: 40, h: 30, color: '#fff59d' },
]

// 布点目标(看板"待布点"基准),运营后台可维护
const defaultRequired = [
  { region: 'r-east',  type: 'air',   count: 2 },
  { region: 'r-east',  type: 'noise', count: 2 },
  { region: 'r-east',  type: 'probe', count: 3 },
  { region: 'r-east',  type: 'met',   count: 1 },
  { region: 'r-west',  type: 'air',   count: 1 },
  { region: 'r-west',  type: 'probe', count: 2 },
  { region: 'r-west',  type: 'noise', count: 1 },
  { region: 'r-south', type: 'noise', count: 2 },
  { region: 'r-south', type: 'air',   count: 1 },
  { region: 'r-north', type: 'met',   count: 1 },
  { region: 'r-north', type: 'noise', count: 1 },
]

/* ---------------- 全局状态 ---------------- */

export const store = reactive({
  role: 'editor',            // editor=布点运维 | chief=站长 | admin=运营后台
  view: 'iso',               // iso=等轴测 | top=俯视正交
  deviceTypes: JSON.parse(JSON.stringify(defaultDeviceTypes)),
  structures: defaultStructures,
  regions: defaultRegions,
  required: JSON.parse(JSON.stringify(defaultRequired)),
  devices: [],               // {id,type,name,x,y,z,rot,surface,surfaceKind,invalid,review}
  plan: { status: 'draft', history: [] }, // draft|pending|approved|returned
  selectedId: null,
  dragInfo: null,            // 拖动中实时坐标 {x,y,z,surface,valid}
  conflicts: [],             // 包围盒相交的设备 id
  basemap: null,             // {dataUrl, w, h}
  renderTick: 0,             // 场景重绘信号
  locateId: null,
  locateTick: 0,
  toast: null,
})

export function bump() { store.renderTick++ }

export function showToast(msg, ms = 2600) {
  store.toast = msg
  clearTimeout(showToast._t)
  showToast._t = setTimeout(() => { store.toast = null }, ms)
}

/* ---------------- 安装面 ---------------- */

export const SURFACE_KIND_NAME = { ground: '地面', rack: '管廊顶', wall: '围墙顶' }

export function getSurfaces() {
  const list = [{ id: 'ground', kind: 'ground', name: '地面', z: 0, x: 0, y: 0, l: MAP.w, w: MAP.h }]
  for (const s of store.structures) {
    if (s.kind === 'rack' || s.kind === 'wall') {
      list.push({ id: s.id, kind: s.kind, name: `${s.name}顶面`, z: s.h, x: s.x, y: s.y, l: s.l, w: s.w })
    }
  }
  return list
}

// 将 (x,y) 处、高度参考 zHint 的设备吸附到最近的合法安装面
export function snapDevice(typeKey, x, y, zHint = 0) {
  const t = store.deviceTypes[typeKey]
  const M = 0.3 // 边缘容差
  const containing = getSurfaces().filter(s =>
    x >= s.x - M && x <= s.x + s.l + M && y >= s.y - M && y <= s.y + s.w + M)
  const legal = containing.filter(s => t.allowed.includes(s.kind))
  const pool = legal.length ? legal : (containing.length ? containing : [getSurfaces()[0]])
  let best = pool[0], bd = Infinity
  for (const s of pool) {
    const d = Math.abs(s.z - zHint)
    if (d < bd) { bd = d; best = s }
  }
  return { z: best.z, surface: best.name, surfaceKind: best.kind, valid: legal.length > 0 }
}

/* ---------------- 设备操作 ---------------- */

export const actions = {
  addDevice(typeKey, x, y, zHint = 0) {
    const t = store.deviceTypes[typeKey]
    if (!t) return null
    x = Math.min(Math.max(x, 0), MAP.w)
    y = Math.min(Math.max(y, 0), MAP.h)
    const snap = snapDevice(typeKey, x, y, zHint)
    const d = {
      id: nid('dev'), type: typeKey,
      name: `${t.name}-${String(store.devices.filter(v => v.type === typeKey).length + 1).padStart(2, '0')}`,
      x, y, z: snap.z, rot: 0,
      surface: snap.surface, surfaceKind: snap.surfaceKind, invalid: !snap.valid,
      review: null,
    }
    store.devices.push(d)
    store.selectedId = d.id
    actions.recomputeConflicts()
    actions.persist()
    bump()
    return d
  },

  moveDevice(id, x, y, zHint) {
    const d = store.devices.find(v => v.id === id)
    if (!d) return
    x = Math.min(Math.max(x, 0), MAP.w)
    y = Math.min(Math.max(y, 0), MAP.h)
    const snap = snapDevice(d.type, x, y, zHint == null ? d.z : zHint)
    d.x = x; d.y = y; d.z = snap.z
    d.surface = snap.surface; d.surfaceKind = snap.surfaceKind; d.invalid = !snap.valid
    store.dragInfo = { x: d.x, y: d.y, z: d.z, surface: d.surface, valid: snap.valid }
    actions.recomputeConflicts()
  },

  setDeviceZ(id, z) {
    const d = store.devices.find(v => v.id === id)
    if (!d) return
    const snap = snapDevice(d.type, d.x, d.y, z)
    d.z = snap.z; d.surface = snap.surface; d.surfaceKind = snap.surfaceKind; d.invalid = !snap.valid
    store.dragInfo = { x: d.x, y: d.y, z: d.z, surface: d.surface, valid: snap.valid }
    actions.recomputeConflicts()
  },

  rotateDevice(id, deltaDeg) {
    const d = store.devices.find(v => v.id === id)
    if (!d) return
    // 15° 档位吸附
    d.rot = ((Math.round((d.rot + deltaDeg) / 15) * 15) % 360 + 360) % 360
    actions.recomputeConflicts()
    actions.persist()
    bump()
  },
  rotateSelected(dir) { if (store.selectedId) actions.rotateDevice(store.selectedId, 15 * dir) },

  removeDevice(id) {
    const i = store.devices.findIndex(v => v.id === id)
    if (i >= 0) store.devices.splice(i, 1)
    if (store.selectedId === id) store.selectedId = null
    actions.recomputeConflicts()
    actions.persist()
    bump()
  },

  // 包围盒(旋转后 AABB)相交检测
  recomputeConflicts() {
    const boxes = store.devices.map(d => {
      const t = store.deviceTypes[d.type]
      const rad = d.rot * Math.PI / 180
      const c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad))
      const ex = (t.l * c + t.w * s) / 2, ey = (t.l * s + t.w * c) / 2
      return { id: d.id, x0: d.x - ex, x1: d.x + ex, y0: d.y - ey, y1: d.y + ey, z0: d.z, z1: d.z + t.h }
    })
    const bad = new Set()
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j]
        if (a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0 && a.z0 < b.z1 && a.z1 > b.z0) {
          bad.add(a.id); bad.add(b.id)
        }
      }
    }
    store.conflicts = [...bad]
  },

  /* ---------------- 审核流 ---------------- */

  submitPlan() {
    if (!store.devices.length) { showToast('当前方案为空,无法提交'); return }
    if (store.conflicts.length) { showToast('存在包围盒相交的设备,请先处理再提交'); return }
    if (store.devices.some(d => d.invalid)) { showToast('存在非法安装面的设备,请先处理再提交'); return }
    for (const d of store.devices) d.review = null
    store.plan.status = 'pending'
    store.plan.history.push({ time: new Date().toLocaleString(), by: '布点运维组', action: '提交审核', detail: `共 ${store.devices.length} 台设备` })
    actions.persist(); bump()
    showToast('方案已提交站长审核')
  },

  setReview(id, result, comment) {
    const d = store.devices.find(v => v.id === id)
    if (d) d.review = { result, comment: comment || '' }
  },

  finishReview() {
    const rejected = store.devices.filter(d => d.review?.result === 'rejected')
    const unreviewed = store.devices.filter(d => !d.review)
    if (unreviewed.length) { showToast(`还有 ${unreviewed.length} 台设备未逐条审核`); return }
    if (rejected.length) {
      store.plan.status = 'returned'
      store.plan.history.push({ time: new Date().toLocaleString(), by: '站长', action: '退回', detail: `${rejected.length} 条退回:${rejected.map(d => d.name).join('、')}` })
      showToast(`已退回 ${rejected.length} 条,运维组可定位整改`)
    } else {
      store.plan.status = 'approved'
      store.plan.history.push({ time: new Date().toLocaleString(), by: '站长', action: '审核通过', detail: `共 ${store.devices.length} 台设备` })
      showToast('方案已审核通过')
    }
    actions.persist(); bump()
  },

  locate(id) {
    store.selectedId = id
    store.locateId = id
    store.locateTick++
    bump()
  },

  /* ---------------- 后台维护 ---------------- */

  saveDeviceTypes(next) {
    store.deviceTypes = next
    // 尺寸/允许面变更后重新吸附并检测
    for (const d of store.devices) {
      const snap = snapDevice(d.type, d.x, d.y, d.z)
      d.z = snap.z; d.surface = snap.surface; d.surfaceKind = snap.surfaceKind; d.invalid = !snap.valid
    }
    actions.recomputeConflicts()
    actions.persist(); bump()
  },

  /* ---------------- 持久化 ---------------- */

  persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        deviceTypes: store.deviceTypes,
        devices: store.devices,
        plan: store.plan,
        required: store.required,
      }))
    } catch (e) { /* 忽略存储异常 */ }
  },

  restore() {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (!raw) return
      const s = JSON.parse(raw)
      if (s.deviceTypes) store.deviceTypes = s.deviceTypes
      if (s.devices) store.devices = s.devices
      if (s.plan) store.plan = s.plan
      if (s.required) store.required = s.required
    } catch (e) { /* 忽略 */ }
  },

  resetAll() {
    localStorage.removeItem(LS_KEY)
    store.deviceTypes = JSON.parse(JSON.stringify(defaultDeviceTypes))
    store.devices = []
    store.plan = { status: 'draft', history: [] }
    store.required = JSON.parse(JSON.stringify(defaultRequired))
    store.selectedId = null
    actions.recomputeConflicts()
    bump()
  },
}

/* ---------------- 统计 ---------------- */

export function regionOf(x, y) {
  return store.regions.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) || null
}

export function regionStats() {
  return store.regions.map(r => {
    const placed = store.devices.filter(d => regionOf(d.x, d.y)?.id === r.id)
    const req = store.required.filter(q => q.region === r.id)
    const reqTotal = req.reduce((s, q) => s + q.count, 0)
    const byType = {}
    for (const q of req) {
      const p = placed.filter(d => d.type === q.type).length
      byType[q.type] = { required: q.count, placed: p, todo: Math.max(0, q.count - p) }
    }
    return {
      region: r, byType,
      required: reqTotal,
      placed: placed.length,
      todo: Math.max(0, reqTotal - placed.length),
    }
  })
}

// 支架长度:采样要求高度 - 安装面标高(不低于 0.3m)
export function bracketLength(d) {
  const t = store.deviceTypes[d.type]
  return Math.max(0.3, (t?.sampleHeight || 0) - d.z)
}

actions.restore()
actions.recomputeConflicts()
