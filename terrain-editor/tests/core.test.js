/**
 * 引擎核心测试（node tests/core.test.js），不依赖浏览器。
 * 覆盖：同 seed 确定性、参数变化只重算受影响区块、锁定保留与边界过渡、
 * 笔刷、指纹、导出尺寸。
 */
import { TerrainEngine } from '../src/terrain/TerrainEngine.js'
import { defaultParams, CHUNKS_PER_SIDE, CELLS_PER_CHUNK, VERTS_PER_SIDE } from '../src/terrain/config.js'

// Node 下 performance 垫片
if (typeof globalThis.performance === 'undefined') {
  globalThis.performance = { now: () => Number(process.hrtime.bigint() / 1000n) / 1000 }
}

let pass = 0
let fail = 0
function assert(cond, msg) {
  if (cond) {
    pass++
  } else {
    fail++
    console.error('  ✗ ' + msg)
  }
}
function approx(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps
}

// 1) 同 seed + 同参数：两次生成逐位一致
{
  const p = defaultParams()
  const a = new TerrainEngine(20261120, p)
  const b = new TerrainEngine(20261120, { ...p })
  a.generateAll()
  b.generateAll()
  let same = true
  for (let i = 0; i < a.heights.length; i++) {
    if (a.heights[i] !== b.heights[i]) {
      same = false
      break
    }
  }
  assert(same, '同 seed 同参数两次生成高度应逐位一致')
  assert(a.fingerprint() === b.fingerprint(), '同 seed 同参数指纹应一致')
}

// 2) 不同 seed 结果应不同
{
  const p = defaultParams()
  const a = new TerrainEngine(111, p)
  const b = new TerrainEngine(222, p)
  a.generateAll()
  b.generateAll()
  assert(a.fingerprint() !== b.fingerprint(), '不同 seed 指纹应不同')
}

// 3) 改一个参数：只重算受影响区块，未受影响区块高度不变
{
  const eng = new TerrainEngine(777, defaultParams())
  eng.generateAll()
  const before = Float32Array.from(eng.heights)
  const p2 = { ...eng.params, rubbleDensity: eng.params.rubbleDensity + 5 }
  const res = eng.updateParams(p2)
  assert(res.changedFeatures.includes('rubble'), '应识别出 rubble 要素变化')
  assert(res.regenerated.length > 0 && res.regenerated.length < 64, '碎石参数只重算部分区块')
  const touched = new Set(res.regenerated.concat(res.skippedLocked))
  let untouchedChanged = 0
  for (const ch of eng.chunks) {
    if (touched.has(ch.id)) continue
    const i0 = ch.cx * CELLS_PER_CHUNK
    const k0 = ch.cz * CELLS_PER_CHUNK
    for (let k = k0; k < k0 + CELLS_PER_CHUNK; k++) {
      for (let i = i0; i < i0 + CELLS_PER_CHUNK; i++) {
        const n = k * VERTS_PER_SIDE + i
        if (!approx(before[n], eng.heights[n])) untouchedChanged++
      }
    }
  }
  assert(untouchedChanged === 0, `未受影响区块高度不应变化（发现 ${untouchedChanged} 个顶点变化）`)
}

// 4) 锁定区块：重算时冻结不动
{
  const eng = new TerrainEngine(888, defaultParams())
  eng.generateAll()
  eng.setLockRect(-20, -20, -14.9, -14.9, true) // 锁定左下角区块
  const locked = eng.chunkAtWorld(-17.5, -17.5)
  assert(locked.locked, '左下角区块应被锁定')
  const snapshot = Float32Array.from(eng.heights)
  eng.updateParams({ ...eng.params, slopeGrade: eng.params.slopeGrade + 4, waterDepth: 0.6 })
  let changed = 0
  const i0 = locked.cx * CELLS_PER_CHUNK
  const k0 = locked.cz * CELLS_PER_CHUNK
  for (let k = k0; k <= k0 + CELLS_PER_CHUNK; k++) {
    for (let i = i0; i <= i0 + CELLS_PER_CHUNK; i++) {
      const n = k * VERTS_PER_SIDE + i
      if (!approx(snapshot[n], eng.heights[n])) changed++
    }
  }
  assert(changed === 0, `锁定区块重算后应完全保留（${changed} 个顶点被改动）`)
}

// 5) 边界过渡：锁定/未锁定共享边无裂缝，且外侧过渡带逐格平滑
{
  const eng = new TerrainEngine(999, defaultParams())
  eng.generateAll()
  eng.setLockRect(-20, -20, -14.9, 20, true) // 锁定左两列（区块 0、1 列）
  eng.updateParams({ ...eng.params, stepHeight: 0.5, slopeGrade: 25 })
  const boundaryI = 2 * CELLS_PER_CHUNK // 共享边列 i=64（锁定顶点，冻结）
  let seamJump = 0 // 共享边 → 外侧第一个未锁定顶点
  let bandJump = 0 // 过渡带内（3m）最大逐格跳变
  const bandCells = Math.ceil(3 / (40 / 256))
  for (let k = 1; k < VERTS_PER_SIDE - 1; k++) {
    seamJump = Math.max(
      seamJump,
      Math.abs(eng.heights[k * VERTS_PER_SIDE + boundaryI] - eng.heights[k * VERTS_PER_SIDE + boundaryI + 1])
    )
    for (let i = boundaryI + 1; i < boundaryI + bandCells; i++) {
      bandJump = Math.max(
        bandJump,
        Math.abs(eng.heights[k * VERTS_PER_SIDE + i] - eng.heights[k * VERTS_PER_SIDE + i + 1])
      )
    }
  }
  assert(seamJump < 0.02, `共享边不应有裂缝（seamJump=${seamJump.toFixed(4)}m）`)
  assert(bandJump < 0.18, `过渡带逐格跳变应被摊薄（bandJump=${bandJump.toFixed(4)}m）`)
}

// 6) 笔刷：刷高/削平/挖沟 + 自动锁定
{
  const eng = new TerrainEngine(555, defaultParams())
  eng.generateAll()
  const before = eng.getHeight(0, 0)
  const ids = eng.applyBrush('raise', 0, 0, 1.2, 0.3)
  assert(ids.length > 0, '刷高应触及至少一个区块')
  assert(eng.getHeight(0, 0) > before, '刷高后中心高度应增加')
  assert(eng.chunkAtWorld(0, 0).locked, '笔刷触及区块应自动锁定')

  const flat = eng.getHeight(2, 2)
  eng.applyBrush('flatten', 2, 2, 1.0, 1)
  const h1 = eng.getHeight(1.4, 2)
  const h2 = eng.getHeight(2.6, 2)
  assert(Math.abs(h1 - flat) < 0.05 && Math.abs(h2 - flat) < 0.05, '削平后半径内地形应接近目标高度')

  const beforeD = eng.getHeight(6, 6)
  eng.applyBrush('trench', 6, 6, 1.0, 0.4)
  assert(eng.getHeight(6, 6) < beforeD, '挖沟后中心高度应下降')

  // 负坐标（场地西南角）笔刷不应产生负区块索引
  let threw = false
  try {
    eng.applyBrush('raise', -19.5, -19.5, 1.5, 0.3)
    eng.applyBrush('flatten', -18, -17, 1.0, 1)
    eng.applyBrush('trench', -16, -19, 1.2, 0.3)
  } catch (e) {
    threw = true
  }
  assert(!threw, '负坐标笔刷不应抛错')
  assert(eng.chunkAtWorld(-19.5, -19.5)?.locked, '负坐标区块应被笔刷锁定')
}

// 7) 解锁后区块恢复参数驱动，且与全新生成结果一致
{
  const eng = new TerrainEngine(333, defaultParams())
  eng.generateAll()
  eng.applyBrush('raise', -17, -17, 1.5, 0.5)
  eng.setLockRect(-20, -20, -14.9, -14.9, false)
  const ref = new TerrainEngine(333, defaultParams())
  ref.generateAll()
  const ch = eng.chunkAtWorld(-17.5, -17.5)
  let maxDiff = 0
  const i0 = ch.cx * CELLS_PER_CHUNK
  const k0 = ch.cz * CELLS_PER_CHUNK
  for (let k = k0; k < k0 + CELLS_PER_CHUNK; k++) {
    for (let i = i0; i < i0 + CELLS_PER_CHUNK; i++) {
      const n = k * VERTS_PER_SIDE + i
      maxDiff = Math.max(maxDiff, Math.abs(eng.heights[n] - ref.heights[n]))
    }
  }
  assert(maxDiff < 1e-6, `解锁重算后应与全新生成一致（maxDiff=${maxDiff}）`)
}

// 8) 指纹对编辑敏感；diffAgainst 能发现差异
{
  const a = new TerrainEngine(444, defaultParams())
  const b = new TerrainEngine(444, defaultParams())
  a.generateAll()
  b.generateAll()
  b.applyBrush('raise', 5, 5, 1, 0.2)
  const d = a.diffAgainst(b)
  assert(!d.sameFingerprint && d.mismatch > 0, '编辑后指纹应不同且 diff 能检出')
  const c = new TerrainEngine(444, defaultParams())
  c.generateAll()
  const d0 = a.diffAgainst(c)
  assert(d0.sameFingerprint && d0.mismatch === 0, '两份全新生成应 diff 全同')
}

// 9) 导出尺寸
await (async () => {
  const eng = new TerrainEngine(666, defaultParams())
  eng.generateAll()
  assert(eng.totalTriangles() === 256 * 256 * 2, '整片场地三角面数应为 131072')
  const { blob, meta } = eng.exportHeightPng()
  assert(blob.type === 'image/png' && blob.size > 1000, 'PNG 高度图应成功编码')
  assert(meta.gridSize === VERTS_PER_SIDE, '元数据网格尺寸应为 257')
  const obj = eng.exportObj()
  const text = await obj.text()
  assert(obj.type === 'text/plain' && obj.size > 1_000_000, 'OBJ 应包含完整网格')
  assert(text.startsWith('o terrain'), 'OBJ 头应正确')
  assert(text.split('\n').filter((l) => l.startsWith('f ')).length === 256 * 256 * 2, 'OBJ 面数应为 131072')
})()

console.log(`\n核心测试：${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
