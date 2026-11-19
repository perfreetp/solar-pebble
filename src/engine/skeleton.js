// 骨骼数据模型：部件、关节、父子层级、活动范围、FK 求解
import { RAD, angleInRange, normalizeAngle } from './math.js'

// 分层部件定义（头、躯干、上臂、前臂、手、枪，左右对称）
export const PART_DEFS = [
  { id: 'head', label: '头', side: null },
  { id: 'torso', label: '躯干', side: null },
  { id: 'upperArm', label: '上臂', side: 'L' },
  { id: 'upperArm', label: '上臂', side: 'R' },
  { id: 'forearm', label: '前臂', side: 'L' },
  { id: 'forearm', label: '前臂', side: 'R' },
  { id: 'hand', label: '手', side: 'L' },
  { id: 'hand', label: '手', side: 'R' },
  { id: 'gun', label: '枪', side: null }
]

export function partKey(def) {
  return def.side ? `${def.side}.${def.id}` : def.id
}

// 关节活动范围（度，相对父骨骼的局部旋转；0=绑定静止方向，顺时针为正）
export const JOINT_RANGES = {
  head: { min: -60, max: 60, label: '颈部转动' },
  torso: { min: -30, max: 45, label: '躯干前倾' }, // 正=前倾
  'L.upperArm': { min: -160, max: 170, label: '左肩' },
  'R.upperArm': { min: -170, max: 160, label: '右肩' },
  'L.forearm': { min: -160, max: 0, label: '左肘' },
  'R.forearm': { min: 0, max: 155, label: '右肘' },
  'L.hand': { min: -70, max: 70, label: '左腕' },
  'R.hand': { min: -70, max: 70, label: '右腕' },
  gun: { min: -45, max: 45, label: '握持角' }
}

// 默认层级（根为 torso）
export const DEFAULT_HIERARCHY = {
  torso: null,
  head: 'torso',
  'R.upperArm': 'torso',
  'R.forearm': 'R.upperArm',
  'R.hand': 'R.forearm',
  gun: 'R.hand',
  'L.upperArm': 'torso',
  'L.forearm': 'L.upperArm',
  'L.hand': 'L.forearm'
}

export function createDefaultSkeleton() {
  const bones = {}
  for (const def of PART_DEFS) {
    const key = partKey(def)
    const range = JOINT_RANGES[key] || { min: -180, max: 180 }
    bones[key] = {
      key,
      partId: def.id,
      side: def.side,
      label: def.side ? `${def.side === 'L' ? '左' : '右'}${def.label}` : def.label,
      parent: DEFAULT_HIERARCHY[key] ?? null,
      anchor: { x: 0, y: 0 },
      offset: { x: 0, y: 0 },
      restAngle: 0,      // 绑定时的世界朝向（由锚点布局推算）
      bindLocal: 0,      // 绑定时相对父级的局部角
      localRot: 0,       // 姿势局部旋转（关键帧记录的量）
      range: { ...range }
    }
  }
  // 锚点即关节：子骨锚点与父骨锚点重合于同一关节，肢体图由 pivot+offset 沿骨线延伸
  const layout = {
    torso: [430, 268],        // 躯干锚点=颈根（图向上延伸到骨盆）
    head: [430, 268],         // 颈关节（与躯干锚点重合，头图向上偏移）
    'R.upperArm': [468, 278], // 右肩（上臂近端）
    'R.forearm': [558, 278],  // 右肘（上臂远端=前臂近端）
    'R.hand': [642, 278],     // 右腕（前臂远端=手近端）
    gun: [668, 278],          // 握持点（手部远端）
    'L.upperArm': [392, 278], // 左肩
    'L.forearm': [392, 278],  // 左肘
    'L.hand': [350, 374]      // 左腕
  }
  for (const [k, [x, y]] of Object.entries(layout)) bones[k].anchor = { x, y }
  // 占位部件默认偏移（局部坐标，沿骨线方向；竖直骨的 +y 偏移即画面上方）
  const defaultOffsets = {
    head: { x: 0, y: -44 },
    torso: { x: 0, y: 0 },
    'R.upperArm': { x: 14, y: 0 },
    'R.forearm': { x: 12, y: 0 },
    'R.hand': { x: 10, y: 0 },
    'L.upperArm': { x: 14, y: 0 },
    'L.forearm': { x: 12, y: 0 },
    'L.hand': { x: 10, y: 0 },
    gun: { x: 20, y: 0 }
  }
  for (const [k, o] of Object.entries(defaultOffsets)) bones[k].offset = { ...o }
  finalizeBind(bones)
  return bones
}

// 显式静止世界角（度）：锚点重合的关节无法用 atan2 推算，直接给定据枪站姿
const REST_ANGLES = {
  torso: -90,
  head: -90,
  'R.upperArm': -10,
  'R.forearm': 0,
  'R.hand': 0,
  gun: 0,
  'L.upperArm': -100,
  'L.forearm': 104,
  'L.hand': 104
}

// 根据锚点父子连线推算静止朝向，并计算局部绑定角
// REST_ANGLES 中显式给定的关节优先；其余用父子锚点连线 atan2 推算（用户拖锚点绑骨的常规路径）
export function finalizeBind(bones) {
  const angleTo = (from, to) => Math.atan2(to.y - from.y, to.x - from.x) * RAD
  for (const b of Object.values(bones)) {
    if (REST_ANGLES[b.key] != null) {
      b.restAngle = REST_ANGLES[b.key]
    } else if (b.parent && bones[b.parent]) {
      const p = bones[b.parent]
      const dx = b.anchor.x - p.anchor.x
      const dy = b.anchor.y - p.anchor.y
      if (Math.hypot(dx, dy) > 1e-6) b.restAngle = angleTo(p.anchor, b.anchor)
    } else if (b.parent == null) {
      b.restAngle = -90
    }
  }
  for (const b of Object.values(bones)) {
    if (b.parent && bones[b.parent]) {
      b.bindLocal = normalizeAngle(b.restAngle - bones[b.parent].restAngle + 180) - 180
    } else {
      b.bindLocal = 0
    }
  }
}

// 重挂父节点（防止成环），重挂后重新计算绑定角
export function reparent(bones, key, newParent) {
  if (newParent === key) return false
  if (newParent != null) {
    if (!bones[newParent]) return false
    let cur = newParent
    while (cur) {
      if (cur === key) return false
      cur = bones[cur].parent
    }
  }
  bones[key].parent = newParent
  finalizeBind(bones)
  return true
}

export function childrenOf(bones, key) {
  return Object.values(bones).filter((b) => b.parent === key).map((b) => b.key)
}

export function rootKeys(bones) {
  return Object.values(bones).filter((b) => b.parent == null).map((b) => b.key)
}

// FK 求解。pose: { key: { rot, anchor?, offset? } }
// 世界角 = 父世界角 + bindLocal + localRot（根 = restAngle + localRot）
export function solveFK(bones, pose = {}) {
  const result = {}
  const visit = (key) => {
    if (result[key]) return result[key]
    const b = bones[key]
    const p = pose[key] || {}
    const localRot = p.rot ?? b.localRot ?? 0
    const anchor = p.anchor ?? b.anchor
    const offset = p.offset ?? b.offset
    if (b.parent == null) {
      result[key] = { worldAngle: b.restAngle + localRot, x: anchor.x, y: anchor.y, offset }
    } else {
      const parent = visit(b.parent)
      result[key] = {
        worldAngle: parent.worldAngle + b.bindLocal + localRot,
        x: anchor.x,
        y: anchor.y,
        offset
      }
    }
    return result[key]
  }
  for (const key of Object.keys(bones)) visit(key)
  return result
}

// 检测超限关节
export function findRangeViolations(bones, pose = {}) {
  const out = []
  for (const b of Object.values(bones)) {
    const rot = pose[b.key]?.rot ?? b.localRot ?? 0
    const v = normalizeAngle(rot + 180) - 180
    if (!angleInRange(v, b.range.min, b.range.max)) {
      out.push({ key: b.key, label: b.label, value: Math.round(v * 10) / 10, min: b.range.min, max: b.range.max })
    }
  }
  return out
}

export function cloneBones(bones) {
  return JSON.parse(JSON.stringify(bones))
}
