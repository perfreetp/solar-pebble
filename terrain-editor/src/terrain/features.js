/**
 * 五类测试要素的确定性布局与高度贡献。
 * 布局只由 seed 决定；要素是否启用、强度由参数决定。
 * 同一 (seed, params) 下每个顶点高度逐位一致。
 */
import {
  FIELD_SIZE,
  CHUNKS_PER_SIDE,
  CHUNK_SIZE,
  CELL_STEP,
  VERTS_PER_SIDE,
  BLEND_RADIUS,
  normalizeParams
} from './config.js'
import { rngStream, hash32, clamp, lerp, smoothstep, makeValueNoise2D, distToSegment, insideRotRect } from './random.js'

const HALF = FIELD_SIZE / 2

/** 由 seed 决定五类要素的布局（与参数无关，改参数不改变布局，只改变强度/开关） */
export function buildLayout(seed) {
  const rng = rngStream(seed, 'layout-v1')
  const layout = {}

  // 1) 坡道：旋转矩形，沿局部 +z 抬升
  layout.slope = {
    cx: -13 + rng() * 2,
    cz: -12 + rng() * 2,
    ang: (-0.35 + rng() * 0.7).toFixed ? (-0.35 + rng() * 0.7) : 0,
    sx: 3.2 + rng() * 0.8,
    sz: 7 + rng() * 2,
    edge: 1.2
  }

  // 2) 台阶：旋转矩形 + 级数（高度由参数决定）
  layout.step = {
    cx: 12.5 + rng() * 2,
    cz: -12 + rng() * 2,
    ang: -0.3 + rng() * 0.6,
    sx: 3 + rng() * 0.8,
    sz: 7 + rng() * 2,
    levels: 4 + Math.floor(rng() * 3), // 4~6 级
    edge: 0.6
  }

  // 3) 碎石区：矩形区域，石块位置由独立随机流按密度生成
  layout.rubble = {
    cx: -12 + rng() * 2,
    cz: 12 + rng() * 2,
    ang: -0.25 + rng() * 0.5,
    sx: 5.5 + rng() * 1.5,
    sz: 5 + rng() * 1.5,
    edge: 1.5
  }

  // 4) 沟槽：折线（3~4 个点），走向穿过场地中部
  const pts = []
  const segCount = 2 + Math.floor(rng() * 2)
  let px = -17 + rng() * 3
  let pz = -2 + rng() * 4
  pts.push({ x: px, z: pz })
  for (let i = 0; i < segCount; i++) {
    px += 7 + rng() * 4
    pz += -3 + rng() * 6
    pts.push({ x: px, z: pz })
  }
  layout.trench = { path: pts, edge: 0.9 }

  // 5) 涉水池：旋转矩形，池底向中心缓沉
  layout.water = {
    cx: 12 + rng() * 2,
    cz: 12 + rng() * 2,
    ang: -0.2 + rng() * 0.4,
    sx: 5 + rng() * 1.5,
    sz: 4.5 + rng() * 1.5,
    edge: 2.0
  }

  // 碎石石块布局：按最大密度 60/100m² 预生成，实际按密度比例取前 N 块
  const rockRng = rngStream(seed, 'rocks-v1')
  const area = (layout.rubble.sx * 2) * (layout.rubble.sz * 2)
  const maxRocks = Math.round((area * 60) / 100)
  const rocks = []
  for (let i = 0; i < maxRocks; i++) {
    const lx = (rockRng() * 2 - 1) * layout.rubble.sx
    const lz = (rockRng() * 2 - 1) * layout.rubble.sz
    const c = Math.cos(layout.rubble.ang)
    const s = Math.sin(layout.rubble.ang)
    rocks.push({
      x: layout.rubble.cx + lx * c - lz * s,
      z: layout.rubble.cz + lx * s + lz * c,
      r: 0.12 + rockRng() * 0.28,
      h: 0.08 + rockRng() * 0.22
    })
  }
  layout.rubble.rocks = rocks
  layout.rubble.maxDensity = 60
  return layout
}

function localCoord(x, z, cx, cz, ang) {
  const dx = x - cx
  const dz = z - cz
  const c = Math.cos(-ang)
  const s = Math.sin(-ang)
  return { lx: dx * c - dz * s, lz: dx * s + dz * c }
}

/** 计算单个顶点在“给定要素集合”下的程序高度（不含手工编辑层） */
export function proceduralHeight(x, z, params, layout, noise) {
  let h = 0
  const active = activeFeatures(params)

  if (active.slope) {
    const { lx, lz } = localCoord(x, z, layout.slope.cx, layout.slope.cz, layout.slope.ang)
    const fx = 1 - smoothstep(layout.slope.sx, layout.slope.sx + layout.slope.edge, Math.abs(lx))
    const fz =
      smoothstep(-layout.slope.sz - layout.slope.edge, -layout.slope.sz, lz) *
      (1 - smoothstep(layout.slope.sz, layout.slope.sz + layout.slope.edge, lz))
    const f = fx * fz
    if (f > 0) {
      // 平均坡度 = grade%，坡面沿局部 z 从 0 升到 grade% * 2*sz
      const grade = params.slopeGrade / 100
      const target = grade * (lz + layout.slope.sz)
      h = lerp(h, Math.max(0, target), f)
    }
  }

  if (active.step) {
    const { lx, lz } = localCoord(x, z, layout.step.cx, layout.step.cz, layout.step.ang)
    const fx = 1 - smoothstep(layout.step.sx, layout.step.sx + layout.step.edge, Math.abs(lx))
    const fz =
      smoothstep(-layout.step.sz - layout.step.edge, -layout.step.sz, lz) *
      (1 - smoothstep(layout.step.sz, layout.step.sz + layout.step.edge, lz))
    const f = fx * fz
    if (f > 0) {
      const t = clamp((lz + layout.step.sz) / (2 * layout.step.sz), 0, 1)
      const level = Math.min(layout.step.levels - 1, Math.floor(t * layout.step.levels))
      // 同级平台高度 ±15% 抖动，由位置哈希决定（确定性）
      const jitter = ((hash32(`step-lvl-${level}`) / 4294967296) - 0.5) * 0.3
      const target = Math.max(0, params.stepHeight * (level + 1) * (1 + jitter))
      h = lerp(h, target, f)
    }
  }

  if (active.rubble) {
    const r = layout.rubble
    const { lx, lz } = localCoord(x, z, r.cx, r.cz, r.ang)
    const f =
      (1 - smoothstep(r.sx, r.sx + r.edge, Math.abs(lx))) *
      (1 - smoothstep(r.sz, r.sz + r.edge, Math.abs(lz)))
    if (f > 0) {
      // 碎石基底起伏（即使密度为 0 也保留粗糙地面）
      const base = noise(x * 1.6, z * 1.6) * 0.05 + noise(x * 4.5, z * 4.5) * 0.02
      let bump = 0
      const ratio = clamp(params.rubbleDensity / r.maxDensity, 0, 1)
      const count = Math.round(r.rocks.length * ratio)
      for (let i = 0; i < count; i++) {
        const rock = r.rocks[i]
        const d = Math.hypot(x - rock.x, z - rock.z)
        if (d < rock.r) {
          // 半球状石块
          bump += rock.h * Math.sqrt(Math.max(0, 1 - (d / rock.r) ** 2))
        }
      }
      h += f * (base + bump)
    }
  }

  if (active.trench) {
    const halfW = params.trenchWidth / 2
    const depth = params.trenchWidth * 0.8
    let best = Infinity
    const path = layout.trench.path
    for (let i = 0; i < path.length - 1; i++) {
      const d = distToSegment(x, z, path[i].x, path[i].z, path[i + 1].x, path[i + 1].z)
      if (d < best) best = d
    }
    const f = 1 - smoothstep(halfW, halfW + layout.trench.edge, best)
    if (f > 0) h -= f * depth
  }

  if (active.water) {
    const w = layout.water
    const { lx, lz } = localCoord(x, z, w.cx, w.cz, w.ang)
    const fx = 1 - smoothstep(w.sx, w.sx + w.edge, Math.abs(lx))
    const fz = 1 - smoothstep(w.sz, w.sz + w.edge, Math.abs(lz))
    const f = fx * fz
    if (f > 0) {
      // 1:6 缓坡下沉到 -waterDepth
      const inner = Math.max(Math.abs(lx) / w.sx, Math.abs(lz) / w.sz)
      const sink = clamp((1 - inner) * 6 * params.waterDepth, 0, params.waterDepth)
      h = lerp(h, Math.min(h, -sink), f)
    }
  }

  return h
}

export function activeFeatures(params) {
  return {
    slope: params.slopeGrade > 0,
    step: params.stepHeight > 0,
    rubble: true, // 碎石区基底始终存在，密度只控制石块数量
    trench: params.trenchWidth > 0,
    water: params.waterDepth > 0
  }
}

/** 要素包围盒（世界坐标 AABB），用于求受影响区块 */
export function featureBounds(layout, key) {
  const pad = 2.5
  if (key === 'trench') {
    const xs = layout.trench.path.map((p) => p.x)
    const zs = layout.trench.path.map((p) => p.z)
    return {
      minX: Math.min(...xs) - pad,
      maxX: Math.max(...xs) + pad,
      minZ: Math.min(...zs) - pad,
      maxZ: Math.max(...zs) + pad
    }
  }
  const r = layout[key]
  const ext = Math.hypot(r.sx, r.sz) + r.edge + pad
  return { minX: r.cx - ext, maxX: r.cx + ext, minZ: r.cz - ext, maxZ: r.cz + ext }
}

/** 返回受某要素影响的区块索引集合（cx,cz 均 0..7） */
export function chunksTouchedByFeature(layout, key) {
  const b = featureBounds(layout, key)
  const set = new Set()
  for (let cz = 0; cz < CHUNKS_PER_SIDE; cz++) {
    for (let cx = 0; cx < CHUNKS_PER_SIDE; cx++) {
      const x0 = -HALF + cx * CHUNK_SIZE
      const z0 = -HALF + cz * CHUNK_SIZE
      const x1 = x0 + CHUNK_SIZE
      const z1 = z0 + CHUNK_SIZE
      if (b.maxX >= x0 && b.minX <= x1 && b.maxZ >= z0 && b.minZ <= z1) {
        set.add(cz * CHUNKS_PER_SIDE + cx)
      }
    }
  }
  return set
}

export { HALF, CELL_STEP, VERTS_PER_SIDE, BLEND_RADIUS }
