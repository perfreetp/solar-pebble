/**
 * 场地全局常量与参数定义。
 * 40m 见方，切 8×8 区块，每块 5m；网格间距 0.15625m（每块 32×32 cell）。
 */
export const FIELD_SIZE = 40 // 米
export const CHUNKS_PER_SIDE = 8
export const CHUNK_SIZE = FIELD_SIZE / CHUNKS_PER_SIDE // 5m
export const CELLS_PER_CHUNK = 32
export const CELLS_PER_SIDE = CHUNKS_PER_SIDE * CELLS_PER_CHUNK // 256
export const CELL_STEP = FIELD_SIZE / CELLS_PER_SIDE // 0.15625m
export const VERTS_PER_SIDE = CELLS_PER_SIDE + 1 // 257
export const BLEND_RADIUS = 3 // 锁定边界自动过渡半径（米）

export const PARAM_GROUPS = [
  {
    key: 'slopeGrade',
    label: '坡度档位',
    unit: '%',
    min: 0,
    max: 30,
    step: 1,
    default: 12,
    affect: 'slope',
    desc: '坡面的平均纵坡（高/长），0 档不生成坡道'
  },
  {
    key: 'stepHeight',
    label: '台阶高度',
    unit: 'm',
    min: 0,
    max: 0.6,
    step: 0.02,
    precision: 2,
    default: 0.2,
    affect: 'step',
    desc: '台阶段每一级台阶的高度（平台高度随机 ±15%）'
  },
  {
    key: 'rubbleDensity',
    label: '碎石密度',
    unit: '块/100m²',
    min: 0,
    max: 60,
    step: 1,
    default: 20,
    affect: 'rubble',
    desc: '碎石区内单位面积的石块数量，0 档为平整碎石基底'
  },
  {
    key: 'trenchWidth',
    label: '沟槽宽度',
    unit: 'm',
    min: 0,
    max: 1.2,
    step: 0.05,
    precision: 2,
    default: 0.5,
    affect: 'trench',
    desc: '沟槽上口宽度（深度固定为宽度的 0.8 倍），0 档不挖沟'
  },
  {
    key: 'waterDepth',
    label: '涉水深度',
    unit: 'm',
    min: 0,
    max: 0.8,
    step: 0.02,
    precision: 2,
    default: 0.25,
    affect: 'water',
    desc: '涉水池水面高度，池底按 1:6 缓坡下沉，0 档不生成涉水段'
  }
]

export function defaultParams() {
  const p = {}
  for (const g of PARAM_GROUPS) p[g.key] = g.default
  return p
}

/** 参数 → 五类要素的受影响表（供“只重算受影响区块”使用） */
export const FEATURE_KEYS = ['slope', 'step', 'rubble', 'trench', 'water']

/** 规范化参数（量化到 step，消除浮点漂移对指纹的影响） */
export function normalizeParams(params) {
  const out = {}
  for (const g of PARAM_GROUPS) {
    const precision = g.precision ?? (g.step >= 1 ? 0 : 4)
    let v = Number(params[g.key])
    if (!Number.isFinite(v)) v = g.default
    v = Math.round(v / g.step) * g.step
    out[g.key] = Number(v.toFixed(precision))
  }
  return out
}
