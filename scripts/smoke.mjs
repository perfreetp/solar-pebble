// 引擎冒烟测试（Node 环境，无 DOM）：node scripts/smoke.mjs
import assert from 'node:assert/strict'
import { cubicBezier, segmentEase, angleLerp, DEFAULT_BEZIER } from '../src/engine/math.js'
import {
  createDefaultSkeleton, solveFK, findRangeViolations, reparent, finalizeBind, childrenOf, JOINT_RANGES
} from '../src/engine/skeleton.js'
import { createTimeline, addKeyframe, evaluate, removeKeyframe } from '../src/engine/animation.js'
import { drawScene, drawOrder, hitTest } from '../src/engine/renderer.js'

let passed = 0
const ok = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

// ---- 数学 ----
ok('cubicBezier 端点与单调性', () => {
  const f = cubicBezier(0.42, 0, 0.58, 1)
  assert.equal(f(0), 0)
  assert.equal(f(1), 1)
  let prev = -1
  for (let i = 0; i <= 20; i++) { const v = f(i / 20); assert.ok(v >= prev); prev = v }
})
ok('线性缓动恒等', () => assert.equal(segmentEase({ easing: 'linear' }, 0.37), 0.37))
ok('缓入缓出在中点附近接近 0.5', () => {
  const v = segmentEase({ easing: 'easeInOut' }, 0.5)
  assert.ok(Math.abs(v - 0.5) < 0.02)
})
ok('角度最短弧插值', () => assert.ok(Math.abs(angleLerp(350, 10, 0.5) - 360) < 1e-9))

// ---- 骨架 ----
const bones = createDefaultSkeleton()
ok('默认骨架 9 个部件且根为 torso', () => {
  assert.equal(Object.keys(bones).length, 9)
  assert.equal(bones.torso.parent, null)
  assert.equal(bones.gun.parent, 'R.hand')
})
ok('静止 FK：躯干竖直朝上(-90°)，右肘在范围内屈曲', () => {
  const fk = solveFK(bones, {})
  assert.equal(fk.torso.worldAngle, -90)
  assert.ok(bones['R.forearm'].bindLocal >= JOINT_RANGES['R.forearm'].min
    && bones['R.forearm'].bindLocal <= JOINT_RANGES['R.forearm'].max)
  assert.ok(bones['L.forearm'].bindLocal >= JOINT_RANGES['L.forearm'].min
    && bones['L.forearm'].bindLocal <= JOINT_RANGES['L.forearm'].max)
})
ok('默认静止姿态无超限', () => assert.equal(findRangeViolations(bones, {}).length, 0))
ok('超限检测：右肘反转到 -90 应标红', () => {
  const v = findRangeViolations(bones, { 'R.forearm': { rot: -90 } })
  assert.equal(v.length, 1)
  assert.equal(v[0].key, 'R.forearm')
})
ok('躯干前倾 30° 沿层级传递到头部', () => {
  const fk = solveFK(bones, { torso: { rot: 30 } })
  assert.equal(fk.torso.worldAngle, -60)
  assert.equal(fk.head.worldAngle, -60 + bones.head.bindLocal)
})
ok('重挂防成环', () => {
  const b2 = createDefaultSkeleton()
  assert.equal(reparent(b2, 'torso', 'head'), false) // 挂到自己子节点
  assert.equal(reparent(b2, 'gun', 'R.forearm'), true)
  assert.equal(b2.gun.parent, 'R.forearm')
  assert.deepEqual(childrenOf(b2, 'R.forearm').sort(), ['R.hand', 'gun'].sort())
})
ok('finalizeBind：显式静止角优先，无显式角走锚点 atan2 推算', () => {
  const b3 = createDefaultSkeleton()
  finalizeBind(b3)
  assert.equal(b3.gun.restAngle, 0) // REST_ANGLES 优先，不受锚点影响
  // 临时自定义骨（不在 REST_ANGLES 中），父为 torso，锚点在正右方 → restAngle 0
  b3.custom = {
    key: 'custom', parent: 'torso', anchor: { x: 530, y: 268 }, offset: { x: 0, y: 0 },
    restAngle: 0, bindLocal: 0, range: { min: -180, max: 180 }
  }
  finalizeBind(b3)
  assert.ok(Math.abs(b3.custom.restAngle - 0) < 1e-9)
  assert.ok(Math.abs(b3.custom.bindLocal - 90) < 1e-9) // 0 - (-90) = 90
})

// ---- 时间轴 / 插值 ----
ok('24fps 时间轴关键帧求值：线性与贝塞尔差异', () => {
  const tl = createTimeline(48)
  assert.equal(tl.fps, 24)
  addKeyframe(tl, 0, { torso: { rot: 0 } }, { torsoLean: 0, armRaise: 0, breathAmp: 4 })
  addKeyframe(tl, 24, { torso: { rot: 40 } }, { torsoLean: 40, armRaise: 90, breathAmp: 8 })
  const mid = evaluate(tl, 12)
  assert.ok(Math.abs(mid.pose.torso.rot - 20) < 1e-6)
  assert.ok(Math.abs(mid.extras.breathAmp - 6) < 1e-6)
  tl.segments['0-24'] = { easing: 'easeInOut', bezier: [...DEFAULT_BEZIER] }
  const midEase = evaluate(tl, 12)
  assert.ok(Math.abs(midEase.pose.torso.rot - 20) < 0.5) // 中点仍约 20
  const q = evaluate(tl, 6)
  assert.ok(q.pose.torso.rot < 10) // 缓入：前段进度落后线性
})
ok('删除关键帧后段被重建', () => {
  const tl = createTimeline(48)
  addKeyframe(tl, 0, { gun: { rot: 0 } }, {})
  addKeyframe(tl, 12, { gun: { rot: 10 } }, {})
  addKeyframe(tl, 24, { gun: { rot: 0 } }, {})
  removeKeyframe(tl, 12)
  assert.deepEqual(tl.keys, [0, 24])
  assert.ok(tl.segments['0-24'])
})

// ---- 渲染管线（桩 context）----
ok('drawScene 在桩 ctx 上跑通并触发 drawImage', () => {
  const calls = []
  const ctx = new Proxy({}, {
    get(t, prop) {
      if (prop === 'canvas') return { width: 900, height: 650 }
      return (...args) => { calls.push(prop) }
    },
    set() { return true }
  })
  const fk = solveFK(bones, {})
  const parts = Object.fromEntries(Object.keys(bones).map((k) => [
    k, { bitmap: {}, w: 40, h: 40, pivot: { x: 20, y: 20 }, bias: 0 }
  ]))
  drawScene(ctx, {
    bones, parts, fk, breathing: { amplitude: 4, phase: 0.5 },
    violations: new Set(['R.forearm']), mode: 'pose', selectedKey: 'torso'
  })
  assert.ok(calls.includes('drawImage'))
  assert.ok(calls.includes('save') && calls.includes('restore'))
  assert.equal(drawOrder(bones)[0], 'torso')
})
ok('hitTest 命中锚点（含局部偏移旋转后的视觉位置）', () => {
  const fk = solveFK(bones, {})
  const parts = {}
  const scene = { bones, parts, fk, mode: 'rig', breathing: { amplitude: 0, phase: 0 } }
  // 右腕视觉点：锚点沿世界角方向平移 offset
  const sh = fk['R.hand']
  const waH = sh.worldAngle * Math.PI / 180
  const hx = sh.x + bones['R.hand'].offset.x * Math.cos(waH)
  const hy = sh.y + bones['R.hand'].offset.x * Math.sin(waH)
  const hit = hitTest(scene, hx, hy)
  assert.ok(hit && hit.key === 'R.hand', `expected R.hand got ${hit?.key}`)
  // 右肘同理
  const fe = fk['R.forearm']
  const wa = fe.worldAngle * Math.PI / 180
  const vx = fe.x + bones['R.forearm'].offset.x * Math.cos(wa)
  const vy = fe.y + bones['R.forearm'].offset.x * Math.sin(wa)
  const hit2 = hitTest(scene, vx, vy)
  assert.ok(hit2 && hit2.key === 'R.forearm')
})

console.log(`\n全部通过：${passed} 项`)
