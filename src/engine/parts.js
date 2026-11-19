// 分层部件图导入：多文件选择、按文件名识别部件、内置占位部件
// 所有部件统一持有 ImageBitmap（可结构化克隆到 Worker，亦可离屏渲染）
import { PART_DEFS, partKey } from './skeleton.js'

const KEYWORD_RULES = [
  { partId: 'head', words: ['头', 'head', 'neck'] },
  { partId: 'torso', words: ['躯干', '身体', 'torso', 'body', 'chest'] },
  { partId: 'upperArm', words: ['上臂', '大臂', 'upperarm', 'upper_arm', 'humerus'] },
  { partId: 'forearm', words: ['前臂', '小臂', 'forearm', 'lower_arm'] },
  { partId: 'hand', words: ['手', 'hand', 'wrist', 'palm'] },
  { partId: 'gun', words: ['枪', 'gun', 'pistol', 'weapon'] }
]

export function matchPart(fileName) {
  const n = fileName.toLowerCase()
  let side = null
  if (/[_\-.\s]?l([._\s]|$)|左/.test(n)) side = 'L'
  if (/[_\-.\s]?r([._\s]|$)|右/.test(n)) side = 'R'
  for (const rule of KEYWORD_RULES) {
    if (rule.words.some((w) => n.includes(w.toLowerCase()))) {
      const def = PART_DEFS.find((d) => d.partId === rule.partId && (d.side === side || (d.side == null && side == null)))
      if (def) return partKey(def)
      // 无侧别信息的左右肢部件，默认挂右侧（持枪主侧）
      const fallback = PART_DEFS.find((d) => d.partId === rule.partId && (d.side === 'R' || d.side == null))
      return fallback ? partKey(fallback) : null
    }
  }
  return null
}

export async function loadImageBitmap(file) {
  const bitmap = await createImageBitmap(file)
  return { bitmap, w: bitmap.width, h: bitmap.height }
}

// ---- 内置占位部件（无素材时也能完整体验绑骨/摆姿势流程）----
function makeDrawCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

async function toBitmap(source) {
  if (source.transferToImageBitmap) return source.transferToImageBitmap()
  return createImageBitmap(source)
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

async function makePlaceholder(key) {
  const skin = '#e8b58e', suit = '#3d5a80', suitDark = '#2c4260', gunMetal = '#2b2d42'
  let c, pivot, bias = 0
  if (key === 'head') {
    c = makeDrawCanvas(78, 78); pivot = { x: 39, y: 39 }; bias = 90
    const ctx = c.getContext('2d')
    ctx.fillStyle = skin
    ctx.beginPath(); ctx.arc(39, 39, 32, 0, Math.PI * 2); ctx.fill()
    // 帽檐朝右（角度 0 方向），bias=90 使静止时朝上
    ctx.fillStyle = suitDark
    ctx.beginPath(); ctx.arc(39, 34, 32, Math.PI, 0); ctx.fill()
    ctx.fillRect(39, 8, 30, 7)
    ctx.fillStyle = '#333'
    ctx.beginPath(); ctx.arc(52, 40, 3.2, 0, Math.PI * 2); ctx.fill()
  } else if (key === 'torso') {
    c = makeDrawCanvas(120, 200); pivot = { x: 60, y: 16 }; bias = 90
    const ctx = c.getContext('2d')
    ctx.fillStyle = suit
    rr(ctx, 14, 0, 92, 190, 26); ctx.fill()
    ctx.fillStyle = suitDark
    rr(ctx, 44, 0, 32, 60, 10); ctx.fill() // 颈部
    ctx.fillStyle = '#98c1d9'
    rr(ctx, 30, 70, 60, 10, 5); ctx.fill() // 射击背心标识条
    ctx.fillStyle = 'rgba(0,0,0,.18)'
    rr(ctx, 14, 120, 92, 70, 24); ctx.fill()
  } else if (key.endsWith('upperArm')) {
    c = makeDrawCanvas(104, 34); pivot = { x: 14, y: 17 }
    const ctx = c.getContext('2d')
    ctx.fillStyle = suit
    rr(ctx, 4, 5, 96, 24, 12); ctx.fill()
    ctx.fillStyle = skin
    ctx.beginPath(); ctx.arc(14, 17, 12, 0, Math.PI * 2); ctx.fill()
  } else if (key.endsWith('forearm')) {
    c = makeDrawCanvas(96, 30); pivot = { x: 12, y: 15 }
    const ctx = c.getContext('2d')
    ctx.fillStyle = suit
    rr(ctx, 4, 5, 80, 20, 10); ctx.fill()
    ctx.fillStyle = skin
    ctx.beginPath(); ctx.arc(12, 15, 10, 0, Math.PI * 2); ctx.fill()
  } else if (key.endsWith('hand')) {
    c = makeDrawCanvas(44, 30); pivot = { x: 10, y: 15 }
    const ctx = c.getContext('2d')
    ctx.fillStyle = skin
    rr(ctx, 4, 6, 36, 18, 9); ctx.fill()
  } else if (key === 'gun') {
    c = makeDrawCanvas(96, 52); pivot = { x: 20, y: 20 }
    const ctx = c.getContext('2d')
    ctx.fillStyle = gunMetal
    rr(ctx, 8, 12, 78, 14, 4); ctx.fill()       // 枪身/套筒，指向右
    rr(ctx, 14, 24, 14, 24, 4); ctx.fill()      // 握把
    ctx.fillStyle = '#444'
    rr(ctx, 70, 6, 12, 8, 2); ctx.fill()        // 准星
    ctx.fillStyle = '#111'
    rr(ctx, 20, 26, 7, 18, 2); ctx.fill()
  } else {
    c = makeDrawCanvas(40, 40); pivot = { x: 20, y: 20 }
  }
  const bitmap = await toBitmap(c)
  return { bitmap, w: bitmap.width, h: bitmap.height, pivot, bias, placeholder: true, src: '内置占位部件' }
}

export async function createPlaceholderParts() {
  const parts = {}
  for (const def of PART_DEFS) {
    const key = partKey(def)
    parts[key] = await makePlaceholder(key)
  }
  return parts
}
