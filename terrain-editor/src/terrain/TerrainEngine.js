/**
 * TerrainEngine —— 纯 JS 地形引擎（不依赖 DOM，可在 Node 下单测）。
 *
 * 职责：
 *  - 全量生成 / 参数变化时只重算受影响且未锁定的区块
 *  - 锁定（手工修过）区块在重算时保留，并在边界自动平滑过渡
 *  - 笔刷：刷高 / 削平 / 挖沟；拖框锁定/解锁
 *  - 高度指纹（质检同 seed 重跑一致性比对）
 *  - 导出 16bit PNG 高度图、OBJ 网格
 */
import {
  FIELD_SIZE,
  CHUNKS_PER_SIDE,
  CHUNK_SIZE,
  CELLS_PER_CHUNK,
  CELLS_PER_SIDE,
  CELL_STEP,
  VERTS_PER_SIDE,
  BLEND_RADIUS,
  normalizeParams,
  defaultParams
} from './config.js'
import {
  buildLayout,
  proceduralHeight,
  activeFeatures,
  chunksTouchedByFeature,
  HALF
} from './features.js'
import { makeValueNoise2D, clamp, smoothstep } from './random.js'
import { encodeHeightPng, makePngMeta } from './png-encode.js'
import { buildObj } from './obj-export.js'

const V = VERTS_PER_SIDE
const idx = (i, k) => k * V + i // i: x 方向列, k: z 方向行

export class TerrainEngine {
  constructor(seed, params) {
    this.seed = String(seed)
    this.params = normalizeParams(params || defaultParams())
    this.layout = buildLayout(this.seed)
    this.noise = makeValueNoise2D(this.seed)
    // 程序化高度（重算只动这张图的未锁定部分）
    this.proc = new Float32Array(V * V)
    // 最终高度 = 程序高度 + 手工编辑增量；锁定区块的最终值被冻结
    this.heights = new Float32Array(V * V)
    // 手工编辑增量（锁定区块保留它，解锁后仍可重算）
    this.edits = new Float32Array(V * V)
    this.chunks = []
    for (let cz = 0; cz < CHUNKS_PER_SIDE; cz++) {
      for (let cx = 0; cx < CHUNKS_PER_SIDE; cx++) {
        this.chunks.push({
          id: cz * CHUNKS_PER_SIDE + cx,
          cx,
          cz,
          locked: false,
          edited: false,
          featureTags: new Set(),
          triCount: CELLS_PER_CHUNK * CELLS_PER_CHUNK * 2,
          genMs: 0,
          version: 0
        })
      }
    }
    this.genCount = 0
    this._lockedVerts = new Uint8Array(V * V)
  }

  // ---------- 坐标工具 ----------
  static worldToGrid(x, z) {
    return {
      i: clamp(Math.round((x + HALF) / CELL_STEP), 0, V - 1),
      k: clamp(Math.round((z + HALF) / CELL_STEP), 0, V - 1)
    }
  }
  static gridToWorld(i, k) {
    return { x: -HALF + i * CELL_STEP, z: -HALF + k * CELL_STEP }
  }
  chunkAtWorld(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null
    const cx = clamp(Math.floor((x + HALF) / CHUNK_SIZE), 0, CHUNKS_PER_SIDE - 1)
    const cz = clamp(Math.floor((z + HALF) / CHUNK_SIZE), 0, CHUNKS_PER_SIDE - 1)
    return this.chunks[cz * CHUNKS_PER_SIDE + cx]
  }
  chunkById(id) {
    return this.chunks[id]
  }
  getHeight(x, z) {
    const { i, k } = TerrainEngine.worldToGrid(x, z)
    return this.heights[idx(i, k)]
  }

  // ---------- 全量生成 ----------
  generateAll() {
    const t0 = performance.now()
    this._tagChunks()
    const mask = this._buildLockedVerts()
    // 锁定顶点的程序高度先快照，fill 后恢复，保证锁定区重生成时不动
    const saved = new Map()
    if (mask.some(Boolean)) {
      for (let n = 0; n < mask.length; n++) if (mask[n]) saved.set(n, this.proc[n])
    }
    this.proc.fill(0)
    for (const [n, v] of saved) this.proc[n] = v
    // 只清除非锁定顶点的手工编辑；锁定区保留人工成果
    for (let n = 0; n < this.edits.length; n++) if (!mask[n]) this.edits[n] = 0
    for (const ch of this.chunks) {
      if (ch.locked) continue
      ch.edited = false
      this._regenChunkProc(ch)
    }
    this._blendLockedBoundaries()
    this._compose()
    this.genCount++
    const totalMs = performance.now() - t0
    return { chunks: this.chunks.length, totalMs }
  }

  /** 给每个区块打上要素标签（哪些要素会影响它） */
  _tagChunks() {
    const tagMap = new Map()
    for (const key of ['slope', 'step', 'rubble', 'trench', 'water']) {
      const set = chunksTouchedByFeature(this.layout, key)
      for (const id of set) {
        if (!tagMap.has(id)) tagMap.set(id, new Set())
        tagMap.get(id).add(key)
      }
    }
    for (const ch of this.chunks) ch.featureTags = tagMap.get(ch.id) || new Set()
  }

  /** 重算一个区块（含共享边：区块拥有 i/k 落在 [base, base+32] 的顶点）的程序高度。
   *  锁定顶点（含与锁定区块共享的边界顶点）跳过，冻结原值。 */
  _regenChunkProc(ch) {
    const t0 = performance.now()
    const mask = this._lockedVerts
    const i0 = ch.cx * CELLS_PER_CHUNK
    const k0 = ch.cz * CELLS_PER_CHUNK
    for (let k = k0; k <= k0 + CELLS_PER_CHUNK; k++) {
      for (let i = i0; i <= i0 + CELLS_PER_CHUNK; i++) {
        const p = idx(i, k)
        if (mask && mask[p]) continue
        const { x, z } = TerrainEngine.gridToWorld(i, k)
        this.proc[p] = proceduralHeight(x, z, this.params, this.layout, this.noise)
      }
    }
    ch.genMs = performance.now() - t0
    ch.version++
  }

  /**
   * 参数变化：只重算受影响要素覆盖、且未锁定的区块。
   * @returns 重算的区块 id 列表与跳过（锁定）的区块 id 列表
   */
  updateParams(nextParams) {
    const prev = this.params
    const next = normalizeParams(nextParams)
    const changedFeatures = []
    for (const g of [
      ['slopeGrade', 'slope'],
      ['stepHeight', 'step'],
      ['rubbleDensity', 'rubble'],
      ['trenchWidth', 'trench'],
      ['waterDepth', 'water']
    ]) {
      if (prev[g[0]] !== next[g[0]]) changedFeatures.push(g[1])
    }
    this.params = next
    if (changedFeatures.length === 0) return { regenerated: [], skippedLocked: [], changedFeatures }

    const targets = new Set()
    for (const f of changedFeatures) {
      for (const id of chunksTouchedByFeature(this.layout, f)) targets.add(id)
    }
    const regenerated = []
    const skippedLocked = []
    this._buildLockedVerts()
    for (const id of targets) {
      const ch = this.chunks[id]
      if (ch.locked) {
        skippedLocked.push(id)
        continue
      }
      this._regenChunkProc(ch)
      regenerated.push(id)
    }
    this._blendLockedBoundaries()
    this._compose()
    this.genCount++
    return { regenerated, skippedLocked, changedFeatures }
  }

  /**
   * 计算锁定顶点掩码：顶点相邻的任一 cell 属于锁定区块即锁定。
   * 锁定/未锁定区块的共享边顶点因此被冻结，重算时不会被覆盖。
   */
  _buildLockedVerts() {
    const mask = new Uint8Array(V * V)
    const cellLocked = (ci, ck) =>
      this.chunks[
        Math.min(CHUNKS_PER_SIDE - 1, Math.max(0, ck)) * CHUNKS_PER_SIDE +
          Math.min(CHUNKS_PER_SIDE - 1, Math.max(0, ci))
      ].locked
    for (let k = 0; k < V; k++) {
      for (let i = 0; i < V; i++) {
        const ci = Math.floor(i / CELLS_PER_CHUNK)
        const ck = Math.floor(k / CELLS_PER_CHUNK)
        const ciPrev = Math.floor((i - 1) / CELLS_PER_CHUNK)
        const ckPrev = Math.floor((k - 1) / CELLS_PER_CHUNK)
        if (
          cellLocked(ci, ck) ||
          (i > 0 && cellLocked(ciPrev, ck)) ||
          (k > 0 && cellLocked(ci, ckPrev)) ||
          (i > 0 && k > 0 && cellLocked(ciPrev, ckPrev))
        ) {
          mask[idx(i, k)] = 1
        }
      }
    }
    this._lockedVerts = mask
    return mask
  }

  /**
   * 锁定边界自动过渡。
   * 锁定顶点（含锁定/未锁定共享边）逐位冻结，人工成果完全保留；
   * 未锁定一侧用 2×BLEND_RADIUS 过渡带把“新程序高度 → 锁定冻结高度”的
   * 整段高差均匀摊薄，相邻处贴齐、向外 smoothstep 缓出，边界无裂缝无陡变。
   */
  _blendLockedBoundaries() {
    const lockedVerts = this._buildLockedVerts()
    if (!lockedVerts.some(Boolean)) return

    const radiusCells = Math.ceil((BLEND_RADIUS * 2) / CELL_STEP)
    // 先按当前参数完整算出一版程序高度作为未锁定侧目标
    const procNew = new Float32Array(this.proc.length)
    for (let k = 0; k < V; k++) {
      for (let i = 0; i < V; i++) {
        const { x, z } = TerrainEngine.gridToWorld(i, k)
        procNew[idx(i, k)] = proceduralHeight(x, z, this.params, this.layout, this.noise)
      }
    }

    for (let k = 0; k < V; k++) {
      for (let i = 0; i < V; i++) {
        const p = idx(i, k)
        if (lockedVerts[p]) continue // 锁定顶点不动
        let bestD = radiusCells + 1
        let bestH = 0
        for (let dk = -radiusCells; dk <= radiusCells; dk++) {
          const kk = k + dk
          if (kk < 0 || kk >= V) continue
          for (let di = -radiusCells; di <= radiusCells; di++) {
            const ii = i + di
            if (ii < 0 || ii >= V) continue
            if (!lockedVerts[idx(ii, kk)]) continue
            const d = Math.hypot(di, dk)
            if (d < bestD) {
              bestD = d
              bestH = this.heights[idx(ii, kk)] // 锁定侧冻结高度
            }
          }
        }
        if (bestD > radiusCells) {
          this.proc[p] = procNew[p]
          continue
        }
        let w
        if (bestD <= 2) w = 1 // 共享边及外侧第一格贴齐，杜绝裂缝
        else {
          const t = (bestD - 2) / (radiusCells - 2)
          w = 1 - t * t * (3 - 2 * t)
        }
        this.proc[p] = procNew[p] * (1 - w) + bestH * w
      }
    }
  }

  /** 最终高度 = 程序高度 + 编辑增量 */
  _compose() {
    for (let n = 0; n < this.heights.length; n++) this.heights[n] = this.proc[n] + this.edits[n]
  }

  // ---------- 锁定 / 解锁（拖框） ----------
  setLockRect(x0, z0, x1, z1, locked) {
    const a = TerrainEngine.worldToGrid(Math.min(x0, x1), Math.min(z0, z1))
    const b = TerrainEngine.worldToGrid(Math.max(x0, x1), Math.max(z0, z1))
    const ids = new Set()
    const ci0 = Math.floor(a.i / CELLS_PER_CHUNK)
    const ci1 = Math.floor(b.i / CELLS_PER_CHUNK)
    const ck0 = Math.floor(a.k / CELLS_PER_CHUNK)
    const ck1 = Math.floor(b.k / CELLS_PER_CHUNK)
    for (let cz = ck0; cz <= ck1; cz++) {
      for (let cx = ci0; cx <= ci1; cx++) {
        if (cx < 0 || cx >= CHUNKS_PER_SIDE || cz < 0 || cz >= CHUNKS_PER_SIDE) continue
        const ch = this.chunks[cz * CHUNKS_PER_SIDE + cx]
        ch.locked = locked
        ids.add(ch.id)
      }
    }
    if (locked) {
      this._blendLockedBoundaries()
      this._compose()
    } else {
      // 解锁：清掉这些区块上的手工编辑，重算恢复参数驱动的程序高度
      this._buildLockedVerts()
      for (const id of ids) {
        const ch = this.chunks[id]
        ch.edited = false
        const i0 = ch.cx * CELLS_PER_CHUNK
        const k0 = ch.cz * CELLS_PER_CHUNK
        for (let k = k0; k <= k0 + CELLS_PER_CHUNK; k++) {
          for (let i = i0; i <= i0 + CELLS_PER_CHUNK; i++) this.edits[idx(i, k)] = 0
        }
        this._regenChunkProc(ch)
      }
      this._blendLockedBoundaries()
      this._compose()
    }
    return [...ids]
  }

  // ---------- 笔刷编辑 ----------
  /**
   * @param mode 'raise' | 'flatten' | 'trench'
   * @param x,z 世界坐标中心；radius 米；strength 每次作用量
   * 笔刷触及的区块自动锁定（“手动修过的区域先锁住”）
   */
  applyBrush(mode, x, z, radius, strength) {
    const center = TerrainEngine.worldToGrid(x, z)
    const r = Math.max(1, Math.round(radius / CELL_STEP))
    const touched = new Set()
    const flattenTarget =
      mode === 'flatten' ? this.heights[idx(center.i, center.k)] : null

    for (let dk = -r; dk <= r; dk++) {
      for (let di = -r; di <= r; di++) {
        const i = center.i + di
        const k = center.k + dk
        if (i < 0 || i >= V || k < 0 || k >= V) continue
        const d = Math.hypot(di, dk)
        if (d > r) continue
        const falloff = 0.35 + 0.65 * (1 - smoothstep(0, r, d))
        const p = idx(i, k)
        const cur = this.heights[p]
        let next = cur
        if (mode === 'raise') next = cur + strength * falloff
        else if (mode === 'flatten') next = cur + (flattenTarget - cur) * falloff
        else if (mode === 'trench') next = cur - strength * falloff
        this.edits[p] += next - cur
        this.heights[p] = next
        const ccx = clamp(Math.floor(i / CELLS_PER_CHUNK), 0, CHUNKS_PER_SIDE - 1)
        const cck = clamp(Math.floor(k / CELLS_PER_CHUNK), 0, CHUNKS_PER_SIDE - 1)
        touched.add(ccx + cck * CHUNKS_PER_SIDE)
      }
    }
    for (const id of touched) {
      const ch = this.chunks[id]
      if (!ch) continue
      ch.locked = true
      ch.edited = true
      ch.version++
      ch.genMs = 0 // 手工编辑不计程序生成耗时
    }
    this._blendLockedBoundaries()
    this._compose()
    return [...touched]
  }

  // ---------- 指纹（质检） ----------
  /** 量化到 0.1mm 后做 FNV-1a，浮点顺序固定，跨机器一致 */
  fingerprint(includeEdits = true) {
    let h = 0x811c9dc5
    const src = includeEdits ? this.heights : this.proc
    for (let n = 0; n < src.length; n++) {
      const q = Math.round(src[n] * 10000)
      let v = q
      do {
        h ^= v & 0xff
        h = Math.imul(h, 0x01000193)
        v = Math.trunc(v / 256)
      } while (v !== 0)
    }
    return ('0000000' + (h >>> 0).toString(16)).slice(-8)
  }

  /** 与另一引擎逐顶点比对（同 seed 质检重跑用），返回差异统计 */
  diffAgainst(other) {
    let maxAbs = 0
    let sumAbs = 0
    let mismatch = 0
    for (let n = 0; n < this.heights.length; n++) {
      const d = Math.abs(this.heights[n] - other.heights[n])
      if (d > 1e-4) mismatch++
      if (d > maxAbs) maxAbs = d
      sumAbs += d
    }
    return {
      mismatch,
      total: this.heights.length,
      maxAbsDiff: maxAbs,
      meanAbsDiff: sumAbs / this.heights.length,
      sameFingerprint: this.fingerprint() === other.fingerprint()
    }
  }

  // ---------- 导出 ----------
  exportHeightPng() {
    const meta = makePngMeta(this.heights, V, this.params, this.seed)
    return { blob: encodeHeightPng(this.heights, V, meta), meta }
  }
  exportObj() {
    return buildObj(this.heights, V, CELL_STEP)
  }

  /** 供渲染器使用的三角面统计 */
  totalTriangles() {
    return CELLS_PER_SIDE * CELLS_PER_SIDE * 2
  }
}

export { idx as vertexIndex, V as VERTS }
