// Canvas2D 渲染器：场景绘制 + 编辑器覆盖层 + 命中检测
import { DEG, clamp } from './math.js'

export function drawGrid(ctx, w, h) {
  ctx.save()
  ctx.fillStyle = '#f4f6fa'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = '#e2e8f0'
  ctx.lineWidth = 1
  for (let x = 0; x <= w; x += 25) {
    ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); ctx.stroke()
  }
  for (let y = 0; y <= h; y += 25) {
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke()
  }
  ctx.restore()
}

// 深度优先的绘制顺序：父部件先画，子部件盖在上面
export function drawOrder(bones) {
  const order = []
  const roots = Object.values(bones).filter((b) => b.parent == null).map((b) => b.key)
  const walk = (key) => {
    order.push(key)
    for (const b of Object.values(bones)) if (b.parent === key) walk(b.key)
  }
  roots.forEach(walk)
  return order
}

function ancestorKeys(bones, key) {
  const set = new Set()
  let cur = key
  while (cur) { set.add(cur); cur = bones[cur].parent }
  return set
}

// scene: { bones, parts, fk, breathing:{amplitude,phase}, violations:Set,
//          mode, selectedKey, showSkeleton, canvasW, canvasH }
export function drawScene(ctx, scene) {
  const { bones, parts, fk, mode } = scene
  const breathAmp = scene.breathing?.amplitude ?? 0
  const breathPhase = scene.breathing?.phase ?? 0
  const breathY = -breathAmp * Math.sin(breathPhase) // 吸气上抬
  const torsoFamily = bones.torso ? ancestorKeys(bones, 'torso') : new Set()
  const violations = scene.violations || new Set()

  for (const key of drawOrder(bones)) {
    const bone = bones[key]
    const part = parts[key]
    const solved = fk[key]
    if (!solved) continue
    const dy = torsoFamily.has(key) ? breathY : 0
    // 局部偏移随骨骼世界角旋转：offset.x 沿骨线方向、offset.y 垂直骨线
    const wa = solved.worldAngle * DEG
    const ox = (bone.offset.x || 0) * Math.cos(wa) - (bone.offset.y || 0) * Math.sin(wa)
    const oy = (bone.offset.x || 0) * Math.sin(wa) + (bone.offset.y || 0) * Math.cos(wa)
    ctx.save()
    ctx.translate(solved.x + ox, solved.y + oy + dy)
    ctx.rotate((solved.worldAngle + (part?.bias || 0)) * DEG)

    if (part) {
      const px = -part.pivot.x, py = -part.pivot.y
      ctx.drawImage(part.bitmap, px, py)
      if (violations.has(key)) {
        // 超限标红：只在本部件像素上叠红色
        ctx.globalCompositeOperation = 'source-atop'
        ctx.fillStyle = 'rgba(220, 38, 38, 0.42)'
        ctx.fillRect(px, py, part.w, part.h)
        ctx.globalCompositeOperation = 'source-over'
      }
      if (scene.selectedKey === key && mode) {
        ctx.strokeStyle = '#2563eb'
        ctx.lineWidth = 2
        ctx.strokeRect(px - 2, py - 2, part.w + 4, part.h + 4)
      }
    } else {
      ctx.fillStyle = '#94a3b8'
      ctx.fillRect(-8, -8, 16, 16)
    }
    ctx.restore()
  }

  if (scene.showSkeleton !== false && mode) drawOverlays(ctx, scene, breathY)
}

// 局部偏移按骨骼世界角旋转后的世界位移
function worldOffset(solved, bone) {
  const wa = solved.worldAngle * DEG
  const ox = (bone.offset.x || 0) * Math.cos(wa) - (bone.offset.y || 0) * Math.sin(wa)
  const oy = (bone.offset.x || 0) * Math.sin(wa) + (bone.offset.y || 0) * Math.cos(wa)
  return { x: solved.x + ox, y: solved.y + oy }
}

function drawOverlays(ctx, scene, breathY) {
  const { bones, fk, mode, selectedKey } = scene
  const violations = scene.violations || new Set()
  const breathOf = (key) => (ancestorKeys(bones, key).has('torso') ? breathY : 0)
  ctx.save()
  // 骨骼连线（连接偏移后的关节视觉位置）
  ctx.strokeStyle = 'rgba(37, 99, 235, 0.55)'
  ctx.lineWidth = 1.5
  ctx.setLineDash([5, 4])
  for (const b of Object.values(bones)) {
    if (b.parent == null) continue
    const pa = worldOffset(fk[b.parent], bones[b.parent])
    const pc = worldOffset(fk[b.key], b)
    ctx.beginPath()
    ctx.moveTo(pa.x, pa.y + breathOf(b.parent))
    ctx.lineTo(pc.x, pc.y + breathOf(b.key))
    ctx.stroke()
  }
  ctx.setLineDash([])

  // 锚点 / 手柄
  for (const b of Object.values(bones)) {
    const s = fk[b.key]
    const p = worldOffset(s, b)
    const x = p.x
    const y = p.y + breathOf(b.key)
    const bad = violations.has(b.key)
    const selected = selectedKey === b.key
    if (mode === 'rig') {
      // 关节锚点（视觉关节位置）：实心圆
      ctx.fillStyle = bad ? '#dc2626' : selected ? '#2563eb' : '#1d4ed8'
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(x, y, selected ? 7 : 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      // 图片偏移手柄：橙色方块，位于逻辑锚点
      const oy0 = s.y + breathOf(b.key)
      ctx.fillStyle = '#f59e0b'
      ctx.strokeStyle = '#fff'
      ctx.fillRect(s.x - 4.5, oy0 - 4.5, 9, 9); ctx.strokeRect(s.x - 4.5, oy0 - 4.5, 9, 9)
    } else if (mode === 'pose') {
      // 旋转手柄：沿当前世界角方向的杠杆 + 握把
      const ang = s.worldAngle * DEG
      const hx = x + Math.cos(ang) * 48
      const hy = y + Math.sin(ang) * 48
      ctx.strokeStyle = bad ? '#dc2626' : 'rgba(37,99,235,.7)'
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(hx, hy); ctx.stroke()
      ctx.fillStyle = bad ? '#dc2626' : selected ? '#2563eb' : '#60a5fa'
      ctx.strokeStyle = '#fff'
      ctx.beginPath(); ctx.arc(hx, hy, selected ? 8 : 6.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      // 锚点小圆
      ctx.fillStyle = bad ? '#dc2626' : '#1e3a8a'
      ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill()
    }
  }
  ctx.restore()
}

// ---- 命中检测 ----
export function hitTest(scene, x, y) {
  const { bones, fk, mode, breathing } = scene
  const breathY = -(breathing?.amplitude ?? 0) * Math.sin(breathing?.phase ?? 0)
  const torsoFamily = bones.torso ? ancestorKeys(bones, 'torso') : new Set()
  const hits = []
  for (const b of Object.values(bones)) {
    const s = fk[b.key]
    if (!s) continue
    const dy = torsoFamily.has(b.key) ? breathY : 0
    const p = worldOffset(s, b)
    const ax = p.x
    const ay = p.y + dy
    if (mode === 'rig') {
      if (Math.hypot(x - ax, y - ay) <= 11) hits.push({ type: 'anchor', key: b.key, dist: Math.hypot(x - ax, y - ay) })
      if (Math.hypot(x - s.x, y - (s.y + dy)) <= 10) hits.push({ type: 'offset', key: b.key, dist: Math.hypot(x - s.x, y - (s.y + dy)) })
    } else if (mode === 'pose') {
      const ang = s.worldAngle * DEG
      const hx = ax + Math.cos(ang) * 48
      const hy = ay + Math.sin(ang) * 48
      if (Math.hypot(x - hx, y - hy) <= 11) hits.push({ type: 'rotate', key: b.key, dist: Math.hypot(x - hx, y - hy) })
      if (Math.hypot(x - ax, y - ay) <= 9) hits.push({ type: 'anchor', key: b.key, dist: Math.hypot(x - ax, y - ay) })
    }
  }
  hits.sort((a, b) => a.dist - b.dist)
  return hits[0] || null
}

// 由指针位置求骨骼目标世界角（度）
export function pointerWorldAngle(scene, key, x, y) {
  const s = scene.fk[key]
  return Math.atan2(y - s.y, x - s.x) / DEG
}

export { clamp }
