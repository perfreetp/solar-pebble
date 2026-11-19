import type {
  Creek,
  CreekLock,
  Junction,
  Level,
  Network,
  NetworkParams,
  NetworkStats,
  Bounds,
  ClassTable,
  LevelTuning,
} from './types';
import { Terrain } from './terrain';
import { Rng, stream } from './rng';
import {
  clamp,
  lerp,
  smoothstep,
  TAU,
  DEG,
  wrapAngle,
  headingToRadians,
  polylineLength,
  cumulativeLengths,
  shapeSignature,
  closestPointOnPolyline,
  resample,
  dist,
} from './geom';

/* ------------------------------------------------------------------ *
 * 分级参数
 *
 * 每一级有自己的宽度衰减、弯曲噪声强度与频率、分叉间距和可爬升高程。
 * "可爬升高程"是这一级沟道能比口门抬高多少: 主干可一直爬到终止高程,
 * 支沟和毛细沟因汇水面积小、下切能力弱, 在更低的滩面就自然收尾。
 * ------------------------------------------------------------------ */

export const DEFAULT_LEVEL_TUNING: Record<Level, LevelTuning> = {
  1: { widthDecay: 0.1, meanderScale: 0.8, widthScale: 1 },
  2: { widthDecay: 0.28, meanderScale: 1.25, widthScale: 1 },
  3: { widthDecay: 0.45, meanderScale: 1.8, widthScale: 1 },
};

export interface LevelProfile {
  level: Level;
  label: string;
  /** 口宽相对父沟的比例 */
  widthRatio: number;
  /** 每 100 m 的宽度衰减比例 */
  widthDecay: number;
  minWidth: number;
  /** 弯曲噪声相对强度 */
  meanderNoise: number;
  /** 弯曲噪声频率倍数 */
  meanderFreq: number;
  /** 分叉间距基准 (m) */
  branchSpacing: number;
  /** 单条父沟最多分叉数 */
  maxBranches: number;
  /** 中心线积分步长 (m) */
  step: number;
  /** 与已有沟道的最小净距 (m) */
  clearance: number;
  widthScale: number;
  /** 相对汇入点最多能爬升的高程 (m); Infinity 表示以终止高程为限 */
  climbCap: number;
}

export function levelProfiles(params: NetworkParams): Record<Level, LevelProfile> {
  const t: Record<Level, LevelTuning> = {
    ...DEFAULT_LEVEL_TUNING,
    ...(params.levelTuning ?? {}),
  };
  const d = clamp(params.density, 0, 1);
  return {
    1: {
      level: 1,
      label: '主干',
      widthRatio: 1,
      widthDecay: clamp(t[1].widthDecay, 0, 0.9),
      minWidth: 2.4,
      meanderNoise: t[1].meanderScale * 0.8,
      meanderFreq: 1,
      branchSpacing: lerp(380, 130, d),
      maxBranches: Math.round(lerp(6, 18, d)),
      step: 3,
      clearance: 22,
      widthScale: Math.max(0.05, t[1].widthScale),
      climbCap: Infinity,
    },
    2: {
      level: 2,
      label: '支沟',
      widthRatio: lerp(0.4, 0.58, d),
      widthDecay: clamp(t[2].widthDecay, 0, 0.9),
      minWidth: 1.15,
      meanderNoise: t[2].meanderScale * 1.15,
      meanderFreq: 1.7,
      branchSpacing: lerp(210, 78, d),
      maxBranches: Math.round(lerp(3, 10, d)),
      step: 2.2,
      clearance: 9,
      widthScale: Math.max(0.05, t[2].widthScale),
      climbCap: 0.55,
    },
    3: {
      level: 3,
      label: '毛细沟',
      widthRatio: lerp(0.4, 0.56, d),
      widthDecay: clamp(t[3].widthDecay, 0, 0.9),
      minWidth: 0.55,
      meanderNoise: t[3].meanderScale * 1.55,
      meanderFreq: 2.6,
      branchSpacing: lerp(170, 62, d),
      maxBranches: Math.round(lerp(2, 6, d)),
      step: 1.6,
      clearance: 3.6,
      widthScale: Math.max(0.05, t[3].widthScale),
      climbCap: 0.2,
    },
  };
}

export const MOUTH_WIDTH = 24;

/* ------------------------------------------------------------------ *
 * 空间净距索引
 * ------------------------------------------------------------------ */

class ClearanceIndex {
  private cell: number;
  private buckets = new Map<number, number[]>();
  private ids: number[] = [];
  private idOf = new Map<string, number>();

  constructor(cell = 40) {
    this.cell = cell;
  }

  private key(cx: number, cy: number): number {
    return (cx + 4096) * 8192 + (cy + 4096);
  }

  private idFor(creekId: string): number {
    let v = this.idOf.get(creekId);
    if (v === undefined) {
      v = this.ids.length;
      this.ids.push(v);
      this.idOf.set(creekId, v);
    }
    return v;
  }

  addPolyline(pts: Float64Array, creekId: string): void {
    const n = pts.length / 2;
    const id = this.idFor(creekId);
    for (let i = 0; i < n - 1; i++) {
      const ax = pts[i * 2], ay = pts[i * 2 + 1];
      const bx = pts[i * 2 + 2], by = pts[i * 2 + 3];
      const x0 = Math.floor(Math.min(ax, bx) / this.cell);
      const x1 = Math.floor(Math.max(ax, bx) / this.cell);
      const y0 = Math.floor(Math.min(ay, by) / this.cell);
      const y1 = Math.floor(Math.max(ay, by) / this.cell);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const k = this.key(cx, cy);
          let arr = this.buckets.get(k);
          if (!arr) {
            arr = [];
            this.buckets.set(k, arr);
          }
          arr.push(ax, ay, bx, by, id);
        }
      }
    }
  }

  /** 到已有沟道的最小距离; excludeId 指定的沟道不计入 */
  minDistance(px: number, py: number, excludeId?: string): number {
    const skip = excludeId !== undefined ? this.idOf.get(excludeId) : undefined;
    return this.scan(px, py, skip, false);
  }

  private scan(px: number, py: number, id: number | undefined, matchId: boolean): number {
    const cx = Math.floor(px / this.cell);
    const cy = Math.floor(py / this.cell);
    let best = Infinity;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const arr = this.buckets.get(this.key(cx + i, cy + j));
        if (!arr) continue;
        for (let s = 0; s < arr.length; s += 5) {
          if (id !== undefined && (arr[s + 4] === id) !== matchId) continue;
          const d = segDist(px, py, arr[s], arr[s + 1], arr[s + 2], arr[s + 3]);
          if (d < best) best = d;
        }
      }
    }
    return best;
  }
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let u = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  return Math.hypot(px - (ax + dx * u), py - (ay + dy * u));
}

/* ------------------------------------------------------------------ *
 * 曲流场
 * ------------------------------------------------------------------ */

interface MeanderField {
  /** 主导波动幅度 (弧度) */
  amp: number;
  harmonics: { wavelength: number; phase: number; weight: number }[];
  /** 整体缓慢偏转 (rad/m) */
  drift: number;
}

function meanderField(rng: Rng, profile: LevelProfile, meander: number): MeanderField {
  const m = clamp(meander, 0, 1);
  // 方向角振幅 (弧度): 曲流幅度直接控制蛇曲的摆幅。
  // 分级系数开平方, 避免各级叠加后振幅大到绕圈 (>~1.2 rad 就开始打结)。
  const amp = clamp((0.06 + 1.55 * Math.pow(m, 1.3)) * Math.sqrt(profile.meanderNoise), 0, 1.5);
  const baseWave = 360 / profile.meanderFreq;
  const harmonics = [
    { wavelength: baseWave * rng.range(0.85, 1.18), phase: rng.range(0, TAU), weight: 1 },
    { wavelength: baseWave * rng.range(0.42, 0.6), phase: rng.range(0, TAU), weight: 0.36 },
    { wavelength: baseWave * rng.range(2.0, 3.0), phase: rng.range(0, TAU), weight: 0.5 },
  ];
  const norm = harmonics.reduce((a, h) => a + h.weight, 0);
  for (const h of harmonics) h.weight /= norm;
  return {
    amp,
    drift: rng.range(-0.00004, 0.00004) * (0.3 + m),
    harmonics,
  };
}

/**
 * 方向角: 基准方向 + 缓慢偏转 + 多谐波正弦。
 * 因为是直接对角度叠加带限正弦, 曲率 (角度的导数) 有界且连续,
 * 中心线不会出现急折角; 而振幅直接决定蛇曲强度。
 */
function headingAt(field: MeanderField, s: number, base: number, damp: number): number {
  let a = base + field.drift * s;
  for (const h of field.harmonics) {
    a += field.amp * h.weight * Math.sin((TAU * s) / h.wavelength + h.phase) * damp;
  }
  return a;
}

/* ------------------------------------------------------------------ *
 * 中心线生长: 沟头按高程自然收尾
 * ------------------------------------------------------------------ */

export type StopReason = 'elevation' | 'collision' | 'extent' | 'maxLength';

interface GrowOpts {
  startX: number;
  startY: number;
  startAngle: number;
  maxLength: number;
  minLength: number;
  profile: LevelProfile;
  terrain: Terrain;
  /** 该条沟的沟头终止高程 */
  headTarget: number;
  extent: number;
  field: MeanderField;
  collision: ClearanceIndex;
  /** 起始多少米内不做净距检查 (允许贴着父沟) */
  clearanceGrace: number;
  /** 净距检测时忽略的沟道 (自己的父沟) */
  skipId?: string;
  /** 顺坡下行时转向上坡的强度 0..1 */
  guideStrength?: number;
}

interface GrowResult {
  pts: Float64Array;
  length: number;
  stop: StopReason;
  headElevation: number;
}

function growCenterline(o: GrowOpts): GrowResult {
  const ds = o.profile.step;
  const cap = Math.ceil(o.maxLength / ds) + 4;
  const buf = new Float64Array(cap * 2);
  let x = o.startX;
  let y = o.startY;
  let angle = o.startAngle;
  let s = 0;
  let count = 1;
  let stop: StopReason = 'maxLength';
  const limit = clamp(o.extent, 200, 5000);
  const checkEvery = Math.max(2, Math.round(10 / ds));
  const startElev = o.terrain.elevationAt(x, y);
  const climb = Math.max(0.02, o.headTarget - startElev);

  buf[0] = x;
  buf[1] = y;

  // 曲流幅度按"能否展开"缩放: 短沟 (高滩面上的小支沟) 没有足够长度完成
  // 一个完整波, 强制使用完整振幅会绕圈。用弧长/波长归一化后整体缩放。
  const dominantWave = o.field.harmonics.reduce((a, h) => (h.weight > a.weight ? h : a)).wavelength;
  // 一个完整蛇曲需要约 2 个波长; 长度不足时按比例收敛
  const spanFactor = clamp(o.maxLength / (dominantWave * 2.4), 0.15, 1);
  const meanderScale = spanFactor * spanFactor * (3 - 2 * spanFactor);
  // 短沟额外收紧转角上限, 避免原地绕圈
  const turnCapScale = 0.3 + 0.7 * spanFactor;

  // 地名学上的"基础轴向": 沟道整体沿滩面梯度方向伸展。
  // 这个轴向缓慢转向滩面上坡方向, 而曲流只是围绕它摆动 —— 两者互不干扰,
  // 否则地形引导会把曲流拉直。
  const guideStrength = o.guideStrength ?? 0.55;
  let baseAxis = o.startAngle;
  let hintAngle = o.startAngle;
  let hintReady = false;
  let prevStep = 0;
  const axisRate = 0.006 * ds; // 每步最多转 0.34°/m
  // 曲率上限: 每步允许的最大转角 (保守), 随曲流幅度放宽但有界
  // 曲率上限: 主干约 0.03 rad/m (转弯半径 33 m), 毛细沟约 0.06 rad/m,
  // 也就是转弯半径不小于约 16 m —— 足够蛇曲, 又不会绕圈
  const maxTurnPerStep = (0.022 + 0.06 * clamp(o.field.amp, 0, 1.25)) * ds;

  for (let i = 0; i < cap; i++) {
    const elevHere = o.terrain.elevationAt(x, y);
    const remaining = o.headTarget - elevHere;
    // 接近沟头时曲流衰减, 沟头收得自然
    const damp = clamp(remaining / (climb * 0.4 + 0.05), 0.1, 1);

    // 入口 50 m 内曲流逐步引入, 沟口方向严格等于分叉角
    const entryT = clamp(s / 50, 0, 1);
    const entry = entryT * entryT * (3 - 2 * entryT);

    // 每 6 m 低通更新一次"上坡方向"参考
    if (i % Math.max(2, Math.round(6 / ds)) === 0) {
      const g = o.terrain.gradientAt(x, y);
      if (Math.hypot(g.gx, g.gy) > 6e-6) {
        const uphill = Math.atan2(g.gy, g.gx);
        hintAngle = hintReady ? hintAngle + wrapAngle(uphill - hintAngle) * 0.18 : uphill;
        hintReady = true;
      }
    }
    // 轴向: 大部分时间沿自身方向伸展, 只有明显顺坡下行时才轻微转向坡上。
    // 潮沟天然向陆延伸, 过多的地形引导会把它们拉得平行滩面等深线。
    if (hintReady) {
      const axisDescent = Math.cos(baseAxis - hintAngle);
      const bias = clamp(-axisDescent - 0.35, 0, 1);
      if (bias > 0) {
        const turn = wrapAngle(hintAngle - baseAxis);
        baseAxis += clamp(turn, -axisRate, axisRate) * bias * guideStrength;
      }
    }

    const target = headingAt(o.field, s, baseAxis, damp * entry * meanderScale);

    // 曲率限制: 每步转角有上限, 并且相邻两步的转角变化也有上限 (限加加速度),
    // 这样即使方向目标来回跳, 中心线也不会绕圈。
    const want = wrapAngle(target - angle);
    const cap = maxTurnPerStep * turnCapScale;
    const step = clamp(want, -cap, cap);
    const dStep = step - prevStep;
    const stepJerk = maxTurnPerStep * 0.75;
    prevStep += clamp(dStep, -stepJerk, stepJerk);
    angle += prevStep;

    const nx = x + Math.cos(angle) * ds;
    const ny = y + Math.sin(angle) * ds;

    if (Math.abs(nx) > limit || Math.abs(ny) > limit) {
      const kx = (limit - Math.abs(x)) / Math.max(1e-9, Math.abs(nx - x));
      const ky = (limit - Math.abs(y)) / Math.max(1e-9, Math.abs(ny - y));
      const k = clamp(Math.min(kx, ky), 0, 1);
      x += (nx - x) * k;
      y += (ny - y) * k;
      s += ds * k;
      buf[count * 2] = x;
      buf[count * 2 + 1] = y;
      count++;
      stop = 'extent';
      break;
    }

    x = nx;
    y = ny;
    s += ds;
    buf[count * 2] = x;
    buf[count * 2 + 1] = y;
    count++;

    const elev = o.terrain.elevationAt(x, y);
    if (s >= o.minLength && elev >= o.headTarget) {
      stop = 'elevation';
      break;
    }
    if (s > o.clearanceGrace && i % checkEvery === 0) {
      if (o.collision.minDistance(x, y, o.skipId) < o.profile.clearance) {
        stop = 'collision';
        break;
      }
    }
    if (s >= o.maxLength) {
      stop = 'maxLength';
      break;
    }
  }

  const pts = buf.slice(0, count * 2);
  return {
    pts,
    length: s,
    stop,
    headElevation: o.terrain.elevationAt(pts[(count - 1) * 2], pts[(count - 1) * 2 + 1]),
  };
}

/** 把方向朝向陆一侧修正, 保证沟道有足够的向陆分量 (否则永远到不了沟头高程) */
function landwardBias(angle: number, inlandAngle: number, minCos: number): number {
  const d = wrapAngle(angle - inlandAngle);
  const c = Math.cos(d);
  if (c >= minCos) return angle;
  const allowed = Math.acos(minCos);
  const sign = d >= 0 ? 1 : -1;
  return inlandAngle + sign * allowed;
}

/* ------------------------------------------------------------------ *
 * 宽度
 * ------------------------------------------------------------------ */

export function widthAtS(mouthWidth: number, length: number, s: number, profile: LevelProfile): number {
  const decay = Math.pow(1 - profile.widthDecay, s / 100);
  const base = mouthWidth * decay;
  // 沟头最后 30% 逐渐收窄, 形成自然的尖灭
  const t = clamp((s / Math.max(length, 1) - 0.7) / 0.3, 0, 1);
  const taper = 1 - 0.88 * smoothstep(t);
  return Math.max(profile.minWidth * 0.45, base * taper);
}

export function widthsForPolyline(pts: Float64Array, mouthWidth: number, profile: LevelProfile): Float32Array {
  const n = pts.length / 2;
  const out = new Float32Array(n);
  if (n === 0) return out;
  const { s, total } = cumulativeLengths(pts);
  for (let i = 0; i < n; i++) out[i] = widthAtS(mouthWidth, total, s[i], profile);
  return out;
}

export function widthAt(creek: Creek, u: number): number {
  const n = creek.widths.length;
  if (n === 0) return 0;
  const total = creek.s[n - 1] || 0;
  const target = clamp(u, 0, 1) * total;
  let lo = 0, hi = n - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (creek.s[mid] < target) lo = mid;
    else hi = mid;
  }
  const span = creek.s[hi] - creek.s[lo] || 1;
  const f = clamp((target - creek.s[lo]) / span, 0, 1);
  return creek.widths[lo] + (creek.widths[hi] - creek.widths[lo]) * f;
}

/** 折线归一化位置 u 处的点与切向 */
export function sampleAtU(creek: Creek, u: number): { x: number; y: number; angle: number } {
  const n = creek.pts.length / 2;
  if (n === 0) return { x: 0, y: 0, angle: 0 };
  if (n === 1) return { x: creek.pts[0], y: creek.pts[1], angle: 0 };
  const total = creek.s[n - 1] || 0;
  const target = clamp(u, 0, 1) * total;
  let lo = 0, hi = n - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (creek.s[mid] < target) lo = mid;
    else hi = mid;
  }
  const span = creek.s[hi] - creek.s[lo] || 1;
  const f = clamp((target - creek.s[lo]) / span, 0, 1);
  const ax = creek.pts[lo * 2], ay = creek.pts[lo * 2 + 1];
  const bx = creek.pts[hi * 2], by = creek.pts[hi * 2 + 1];
  return { x: lerp(ax, bx, f), y: lerp(ay, by, f), angle: Math.atan2(by - ay, bx - ax) };
}

/* ------------------------------------------------------------------ *
 * Creek 构造
 * ------------------------------------------------------------------ */

function makeCreek(
  id: string,
  level: Level,
  parentId: string | null,
  parentU: number,
  side: -1 | 0 | 1,
  pts: Float64Array,
  widths: Float32Array,
  terrain: Terrain,
  headTarget: number,
  stopReason: Creek['stopReason'] = 'locked',
): Creek {
  const { s, total } = cumulativeLengths(pts);
  const n = pts.length / 2;
  const headElevation = n ? terrain.elevationAt(pts[(n - 1) * 2], pts[(n - 1) * 2 + 1]) : 0;
  const startElevation = n ? terrain.elevationAt(pts[0], pts[1]) : 0;
  const chord = n > 1 ? dist(pts[0], pts[1], pts[(n - 1) * 2], pts[(n - 1) * 2 + 1]) : 0;
  return {
    id,
    level,
    parentId,
    parentU,
    side,
    pts,
    widths,
    s,
    length: total,
    mouthWidth: widths[0] ?? 0,
    headWidth: widths[n - 1] ?? 0,
    startElevation,
    headElevation,
    headTarget,
    stopReason,
    sinuosity: chord > 1 ? total / chord : 1,
    densityValue: 0,
    classIdx: { length: 0, density: 0, elevation: 0 },
  };
}

/* ------------------------------------------------------------------ *
 * 锁定段: 刚体落位
 * ------------------------------------------------------------------ */

/**
 * 把一条沟道的当前几何固化为锁定记录。
 *
 * `parentAngle` 是捕获时父沟在该汇入点的切向 (无父沟传 null)。
 * 记录相对转角后, 重生成时可以只用"父沟新切向 + 相对转角"复原朝向,
 * 这样锁定段随父沟旋转, 同时保持它原本与该父沟的分叉角。
 */
export function capturesLock(
  creek: Creek,
  at: string,
  parentAngle: number | null = null,
): CreekLock {
  const n = creek.pts.length / 2;
  const i1 = Math.min(n - 1, 1);
  const ang = Math.atan2(creek.pts[i1 * 2 + 1] - creek.pts[1], creek.pts[i1 * 2] - creek.pts[0]);
  const cos = Math.cos(-ang);
  const sin = Math.sin(-ang);
  const ax = creek.pts[0], ay = creek.pts[1];
  const localPts = new Array<number>(n * 2);
  for (let i = 0; i < n; i++) {
    const dx = creek.pts[i * 2] - ax;
    const dy = creek.pts[i * 2 + 1] - ay;
    localPts[i * 2] = dx * cos - dy * sin;
    localPts[i * 2 + 1] = dx * sin + dy * cos;
  }
  const relativeAngle = parentAngle === null ? 0 : wrapAngle(ang - parentAngle);
  return {
    creekId: creek.id,
    level: creek.level,
    parentId: creek.parentId,
    parentU: creek.parentU,
    side: creek.side,
    relativeAngle,
    localPts,
    length: creek.length,
    mouthWidth: creek.mouthWidth,
    widthScale: 1,
    shapeSignature: shapeSignature(creek.pts, creek.length),
    capturedAt: at,
  };
}

/**
 * 从网络上下文捕获锁定段: 自动取父沟在该汇入点的切向作为参考,
 * 记录相对转角, 保证重生成后锁定段仍与父沟保持原有分叉角。
 */
export function captureLockFor(creeks: Creek[], creek: Creek, at: string): CreekLock {
  if (!creek.parentId) return capturesLock(creek, at, null);
  const parent = creeks.find((c) => c.id === creek.parentId);
  if (!parent) return capturesLock(creek, at, null);
  const anchor = sampleAtU(parent, creek.parentU);
  return capturesLock(creek, at, anchor.angle);
}

/** 锁定段相对父沟切向的转角 */
export function lockRelativeAngle(_parent: Creek | null, lock: CreekLock): number {
  return lock.relativeAngle ?? 0;
}

function placeLocal(localPts: number[], ax: number, ay: number, angle: number): Float64Array {
  const n = localPts.length / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const out = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[i * 2] = ax + localPts[i * 2] * cos - localPts[i * 2 + 1] * sin;
    out[i * 2 + 1] = ay + localPts[i * 2] * sin + localPts[i * 2 + 1] * cos;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 主生成
 * ------------------------------------------------------------------ */

export interface GenerateOptions {
  locks?: CreekLock[];
  /** 默认 true: 锁定段跟随父沟新位置重新落位 */
  reattachLocks?: boolean;
}

export interface LockReport {
  creekId: string;
  ok: boolean;
  /** 长度偏差 (m) */
  deviation: number;
  /** 起点接合误差 (m) */
  attachError: number;
  reason?: string;
}

export interface GeneratedNetwork extends Network {
  orphans: CreekLock[];
  lockReport: LockReport[];
}

function creekId(level: Level, parentId: string, side: -1 | 0 | 1, ordinal: number): string {
  const tag = side > 0 ? 'R' : 'L';
  if (level === 2) return `B2-${parentId}-${tag}${String(ordinal).padStart(2, '0')}`;
  return `C3-${parentId}-${tag}${String(ordinal).padStart(2, '0')}`;
}

export function generateNetwork(params: NetworkParams, opts: GenerateOptions = {}): GeneratedNetwork {
  const terrain = new Terrain(params);
  const profiles = levelProfiles(params);
  const locks = opts.locks ?? [];
  const reattach = opts.reattachLocks !== false;
  const extent = 3400;
  const headLevel = params.headLevel;
  const inlandAngle = headingToRadians(params.heading);
  const d = clamp(params.density, 0, 1);

  const creeks: Creek[] = [];
  const orphans: CreekLock[] = [];
  const lockReport: LockReport[] = [];
  const collision = new ClearanceIndex(40);
  const byId = new Map<string, Creek>();

  const verifyLock = (lock: CreekLock, world: Float64Array, attachError: number): void => {
    const sig = shapeSignature(world, polylineLength(world));
    const ok = sig === lock.shapeSignature;
    lockReport.push({
      creekId: lock.creekId,
      ok: ok && attachError < 1e-6,
      deviation: Math.abs(polylineLength(world) - lock.length),
      attachError,
      reason: ok ? undefined : '形态签名不匹配',
    });
  };

  /**
   * 沟头终止高程 (按高程自然收尾)。
   *
   * 每条沟从汇入点向陆生长, 一路滩面抬升; 当沟底高程升到它"能爬到的高度"
   * 时便自然尖灭。主干能一直爬到调查区的高潮滩线 (headLevel); 支沟、毛细沟
   * 汇水面积更小、下切更弱, 只能抬高一段有限的落差, 因此更早收尾 ——
   * 这同时保证了三级网络的树枝状层次。
   */
  const headTargetFor = (level: Level, startElev: number): number => {
    const cap = profiles[level].climbCap;
    return isFinite(cap) ? Math.min(headLevel, startElev + cap) : headLevel;
  };

  /* ---- 主干 ---- */
  const mainLock = locks.find((l) => l.level === 1 && l.parentId === null);
  let main: Creek;
  if (mainLock && reattach) {
    const angle = headingToRadians(params.heading) + lockRelativeAngle(null, mainLock);
    const world = placeLocal(mainLock.localPts, 0, 0, angle);
    const profile = profiles[1];
    const mouthW = Math.max(profile.minWidth, MOUTH_WIDTH * mainLock.widthScale * profile.widthScale);
    const widths = widthsForPolyline(world, mouthW, profile);
    main = makeCreek(mainLock.creekId, 1, null, 0, 0, world, widths, terrain, headLevel);
    main.edited = true;
    verifyLock(mainLock, world, 0);
  } else {
    const rng = stream(params.seed, 'meander', 1, 'M1');
    const field = meanderField(rng, profiles[1], params.meander);
    const slope = Math.max(1e-5, params.slope);
    const budget = clamp(((headLevel - terrain.elevationAt(0, 0)) / slope) * 2.4, 600, 5200);
    const grown = growCenterline({
      startX: 0,
      startY: 0,
      startAngle: headingToRadians(params.heading),
      maxLength: budget,
      minLength: 220,
      profile: profiles[1],
      terrain,
      headTarget: headLevel,
      extent,
      field,
      collision,
      clearanceGrace: 0,
    });
    const pts = resample(grown.pts, profiles[1].step);
    const widths = widthsForPolyline(pts, MOUTH_WIDTH * profiles[1].widthScale, profiles[1]);
    main = makeCreek('M1', 1, null, 0, 0, pts, widths, terrain, headLevel);
    if (mainLock) {
      orphans.push(mainLock);
      lockReport.push({
        creekId: mainLock.creekId,
        ok: false,
        deviation: Infinity,
        attachError: Infinity,
        reason: '已关闭锁定重生成',
      });
    }
  }
  creeks.push(main);
  byId.set(main.id, main);
  collision.addPolyline(main.pts, main.id);

  /* ---- 锁定段落位 ---- */
  const attach = (lock: CreekLock, pool: Creek[]): Creek | null => {
    const parent = lock.parentId ? byId.get(lock.parentId) : null;
    if (!parent) {
      orphans.push(lock);
      lockReport.push({
        creekId: lock.creekId,
        ok: false,
        deviation: Infinity,
        attachError: Infinity,
        reason: '父沟已不存在',
      });
      return null;
    }
    const anchor = sampleAtU(parent, lock.parentU);
    const angle = anchor.angle + lockRelativeAngle(parent, lock);
    const world = placeLocal(lock.localPts, anchor.x, anchor.y, angle);
    const profile = profiles[lock.level];
    const parentW = widthAt(parent, lock.parentU);
    const mouthW = Math.max(
      profile.minWidth,
      Math.max(parentW * profile.widthRatio, lock.mouthWidth) * lock.widthScale * profile.widthScale,
    );
    const widths = widthsForPolyline(world, mouthW, profile);
    const c = makeCreek(
      lock.creekId,
      lock.level,
      lock.parentId,
      lock.parentU,
      lock.side,
      world,
      widths,
      terrain,
      headTargetFor(lock.level, terrain.elevationAt(world[0], world[1])),
    );
    c.edited = true;
    const attachError = Math.hypot(world[0] - anchor.x, world[1] - anchor.y);
    verifyLock(lock, world, attachError);
    collision.addPolyline(world, c.id);
    pool.push(c);
    byId.set(c.id, c);
    return c;
  };

  const lock2 = locks.filter((l) => l.level === 2);
  const lock3 = locks.filter((l) => l.level === 3);
  const L2: Creek[] = [];
  const L3: Creek[] = [];
  for (const lock of lock2) attach(lock, L2);

  /* ---- 分叉生长 (含确定性择优) ---- */
  const spawn = (
    parent: Creek,
    level: Level,
    out: Creek[],
    sideSign: -1 | 1,
    ordinal: number,
    u: number,
  ): Creek | null => {
    const profile = profiles[level];
    const total = parent.s[parent.pts.length / 2 - 1] || 0;
    if (total < 70) return null;
    const anchor = sampleAtU(parent, u);
    const parentW = widthAt(parent, u);
    if (parentW < profile.minWidth * 1.15) return null;
    const startElev = terrain.elevationAt(anchor.x, anchor.y);
    const headTarget = headTargetFor(level, startElev);
    const climb = headTarget - startElev;
    // 起点已接近终止高程 (滩面太高) → 该级沟道没有发育余地
    if (climb < 0.1) return null;

    // 用起始处沿程比降估算需要的长度, 让沟头正好落在目标高程
    const half = clamp(params.branchAngle, 6, 120) * 0.5 * DEG;

    let best: { pts: Float64Array; length: number; stop: StopReason; headElevation: number; score: number } | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const rng = stream(params.seed, 'branch', level, parent.id, sideSign, ordinal, attempt);
      const jitter = rng.gauss() * 3.6 * DEG;
      let angle = anchor.angle + sideSign * (half + jitter);
      // 支沟与毛细沟都应有向陆分量, 否则永远到不了沟头高程
      angle = landwardBias(angle, inlandAngle, level === 2 ? 0.45 : 0.32);

      // 直接沿起始方向探测滩面抬升率, 据此估算走到沟头高程所需的长度
      const probe = 120;
      const probeRise =
        terrain.elevationAt(anchor.x + Math.cos(angle) * probe, anchor.y + Math.sin(angle) * probe) - startElev;
      const riseRate = Math.max(probeRise / probe, Math.max(1e-5, params.slope) * 0.25);
      let budget = (climb / riseRate) * rng.range(1.2, 1.7);
      // 子沟长度不超过父沟: 毛细沟不能比它的支沟还长
      budget = Math.min(budget, total * (level === 2 ? 1.2 : 0.62));
      budget = clamp(budget, 45, 1800);

      const field = meanderField(rng, profile, params.meander * rng.range(0.72, 1.28));
      const grown = growCenterline({
        startX: anchor.x,
        startY: anchor.y,
        startAngle: angle,
        // 估算长度可能偏短 (曲流使实际抬升变慢), 给一倍余量让沟头真正爬到终止高程
        maxLength: budget * 2.0,
        minLength: 32,
        profile,
        terrain,
        headTarget,
        extent,
        field,
        collision,
        clearanceGrace: 12,
        skipId: parent.id,
      });
      // 被邻近沟道早早截断的残段不保留, 否则网络里会散落大量短桩
      if (grown.length < Math.min(48, budget * 0.45)) continue;
      const reached = grown.stop === 'elevation' ? 1 : 0;
      const headGap = Math.abs(headTarget - grown.headElevation);
      const score = reached * 1000 + grown.length - headGap * 120;
      if (!best || score > best.score) {
        best = { ...grown, score };
      }
      if (reached && attempt < 2) break;
    }
    if (!best) return null;

    const pts = resample(best.pts, profile.step);
    const mouthW = Math.max(
      profile.minWidth * 1.2,
      parentW * profile.widthRatio * (0.9 + 0.2 * (1 - clamp(climb / 1.5, 0, 1))),
    );
    const widths = widthsForPolyline(pts, mouthW, profile);
    const id = creekId(level, parent.id, sideSign, ordinal);
    const c = makeCreek(id, level, parent.id, u, sideSign, pts, widths, terrain, headTarget, best.stop);
    collision.addPolyline(pts, c.id);
    out.push(c);
    byId.set(c.id, c);
    return c;
  };

  const placeBranches = (parent: Creek, level: Level, out: Creek[]): Creek[] => {
    const profile = profiles[level];
    const total = parent.s[parent.pts.length / 2 - 1] || 0;
    if (total < 70) return [];
    const count = Math.min(profile.maxBranches, Math.max(1, Math.round(total / Math.max(profile.branchSpacing, 1))));
    const made: Creek[] = [];
    const p = 0.4 + 0.58 * d;
    // 沟头附近滩面已高, 沟道从向海一侧更发育
    const from = level === 3 ? 0.08 : 0.1;
    const to = level === 3 ? 0.74 : 0.93;

    for (const sideSign of [-1, 1] as const) {
      const rng = stream(params.seed, 'slots', level, parent.id, sideSign);
      let ordinal = 0;
      for (let i = 0; i < count; i++) {
        const u = clamp(from + ((to - from) * (i + 0.4)) / Math.max(count, 1), 0.05, 0.96);
        const occupied = locks.some(
          (l) =>
            l.level === level &&
            l.parentId === parent.id &&
            l.side === sideSign &&
            Math.abs(l.parentU - u) < 0.05,
        );
        if (occupied) continue;
        if (!rng.chance(p)) continue;
        const c = spawn(parent, level, out, sideSign, ordinal, u);
        if (c) made.push(c);
        ordinal++;
      }
    }
    return made;
  };

  placeBranches(main, 2, L2);
  creeks.push(...L2);

  // 毛细沟只发育在支沟上 (三级结构严格: 主干 → 支沟 → 毛细沟)
  for (const lock of lock3) attach(lock, L3);
  for (const parent of L2) placeBranches(parent, 3, L3);
  creeks.push(...L3);

  /* ---- 交汇口 ---- */
  const junctions: Junction[] = [];
  for (const c of creeks) {
    if (!c.parentId) continue;
    const parent = byId.get(c.parentId);
    if (!parent) continue;
    const pw = widthAt(parent, c.parentU);
    junctions.push({
      x: c.pts[0],
      y: c.pts[1],
      r: Math.max(c.mouthWidth * 0.5, pw * 0.42),
      level: parent.level,
      creekId: c.id,
    });
  }

  /* ---- 统计 / 分级 ---- */
  assignDensity(creeks);
  const bounds = computeBounds(creeks);
  const classes = computeClasses(creeks);
  for (const c of creeks) {
    c.classIdx = {
      length: classIndex(c.length, classes.length.breaks),
      density: classIndex(c.densityValue, classes.density.breaks),
      elevation: classIndex(c.headElevation, classes.elevation.breaks),
    };
  }
  const stats = computeStats(creeks, junctions, bounds);
  const fingerprint = computeFingerprint(params, creeks);

  return {
    params,
    terrain: terrain.model,
    creeks,
    junctions,
    bounds,
    stats,
    classes,
    fingerprint,
    orphans,
    lockReport,
  };
}

/* ------------------------------------------------------------------ *
 * 统计 / 分级
 * ------------------------------------------------------------------ */

function assignDensity(creeks: Creek[]): void {
  const cell = 60;
  const lengths = new Map<number, number>();
  const key = (cx: number, cy: number) => (cx + 2048) * 4096 + (cy + 2048);
  for (const c of creeks) {
    const n = c.pts.length / 2;
    for (let i = 1; i < n; i++) {
      const ax = c.pts[i * 2 - 2], ay = c.pts[i * 2 - 1];
      const bx = c.pts[i * 2], by = c.pts[i * 2 + 1];
      const k = key(Math.floor((ax + bx) / 2 / cell), Math.floor((ay + by) / 2 / cell));
      lengths.set(k, (lengths.get(k) ?? 0) + Math.hypot(bx - ax, by - ay));
    }
  }
  for (const c of creeks) {
    const n = c.pts.length / 2;
    const stride = Math.max(1, Math.floor(n / 16));
    let acc = 0, cnt = 0;
    for (let i = 0; i < n; i += stride) {
      const cx = Math.floor(c.pts[i * 2] / cell);
      const cy = Math.floor(c.pts[i * 2 + 1] / cell);
      let v = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) v += lengths.get(key(cx + dx, cy + dy)) ?? 0;
      }
      acc += v / (9 * cell * cell);
      cnt++;
    }
    c.densityValue = cnt ? acc / cnt : 0;
  }
}

function computeBounds(creeks: Creek[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of creeks) {
    const n = c.pts.length / 2;
    for (let i = 0; i < n; i++) {
      const x = c.pts[i * 2], y = c.pts[i * 2 + 1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!isFinite(minX)) return { minX: -10, minY: -10, maxX: 10, maxY: 10 };
  const pad = 30;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

export function quantileBreaks(values: number[], n: number): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const breaks: number[] = [];
  for (let i = 1; i < n; i++) {
    breaks.push(sorted[clamp(Math.floor((sorted.length * i) / n), 0, sorted.length - 1)]);
  }
  return breaks;
}

export const CLASS_COUNT = 5;

function computeClasses(creeks: Creek[]): ClassTable {
  const lengths = creeks.map((c) => c.length);
  const dens = creeks.map((c) => c.densityValue);
  const elevs = creeks.map((c) => c.headElevation);
  const spread = (arr: number[]) =>
    arr.length ? { min: Math.min(...arr), max: Math.max(...arr) } : { min: 0, max: 0 };
  return {
    length: { breaks: dedupe(quantileBreaks(lengths, CLASS_COUNT)), ...spread(lengths) },
    density: { breaks: dedupe(quantileBreaks(dens, CLASS_COUNT)), ...spread(dens) },
    elevation: { breaks: dedupe(quantileBreaks(elevs, CLASS_COUNT)), ...spread(elevs) },
  };
}

function dedupe(values: number[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (out.length === 0 || v - out[out.length - 1] > 1e-9) out.push(v);
  }
  return out;
}

export function classIndex(value: number, breaks: number[]): number {
  let i = 0;
  while (i < breaks.length && value >= breaks[i]) i++;
  return i;
}

function computeStats(creeks: Creek[], junctions: Junction[], bounds: Bounds): NetworkStats {
  const counts = { 1: 0, 2: 0, 3: 0 } as Record<Level, number>;
  const lengths = { 1: 0, 2: 0, 3: 0 } as Record<Level, number>;
  const widths = { 1: 0, 2: 0, 3: 0 } as Record<Level, number>;
  let totalLength = 0;
  let sinuosity = 0;
  let pointCount = 0;
  let headMin = Infinity;
  let headMax = -Infinity;
  for (const c of creeks) {
    counts[c.level]++;
    lengths[c.level] += c.length;
    widths[c.level] += c.mouthWidth;
    totalLength += c.length;
    sinuosity += c.sinuosity;
    pointCount += c.pts.length / 2;
    headMin = Math.min(headMin, c.headElevation);
    headMax = Math.max(headMax, c.headElevation);
  }
  for (const l of [1, 2, 3] as Level[]) if (counts[l]) widths[l] /= counts[l];
  const areaKm2 = Math.max(0.01, ((bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY)) / 1e6);
  return {
    counts,
    lengths,
    meanWidths: widths,
    totalLength,
    junctionCount: junctions.length,
    headMin: isFinite(headMin) ? headMin : 0,
    headMax: isFinite(headMax) ? headMax : 0,
    bounds,
    areaKm2,
    densityKmPerKm2: totalLength / 1000 / areaKm2,
    meanSinuosity: creeks.length ? sinuosity / creeks.length : 0,
    pointCount,
  };
}

/** 几何指纹: 参数 + 全部中心线量化后散列 */
export function computeFingerprint(params: NetworkParams, creeks: Creek[]): string {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v & 0xffffffff;
    h = Math.imul(h, 0x01000193);
  };
  const mixNum = (v: number) => {
    const q = Math.round(v * 1000);
    mix(q);
    mix(v * 1000 - q + 0.5);
  };
  const mixStr = (s: string) => {
    for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
  };
  mixStr(String(params.heading));
  mixStr(String(params.branchAngle));
  mixStr(String(params.density));
  mixStr(String(params.meander));
  mixStr(params.seed);
  mixStr(String(params.headLevel));
  mixStr(String(params.slope));
  mixStr(String(params.datum));
  if (params.levelTuning) mixStr(JSON.stringify(params.levelTuning));
  for (const c of creeks) {
    mixStr(c.id);
    mixNum(c.length);
    const n = c.pts.length / 2;
    for (let i = 0; i < n; i++) {
      mixNum(c.pts[i * 2]);
      mixNum(c.pts[i * 2 + 1]);
    }
    for (let i = 0; i < c.widths.length; i++) mixNum(c.widths[i]);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/* ------------------------------------------------------------------ *
 * 编辑
 * ------------------------------------------------------------------ */

/** 徒手编辑: 在 u 处施加横向平滑偏移, 返回新的 Creek (不改变 id) */
export function deformCreek(
  creek: Creek,
  u: number,
  delta: number,
  worldRadius: number,
  terrain: Terrain,
  profile: LevelProfile,
): Creek {
  const n = creek.pts.length / 2;
  const target = clamp(u, 0, 1) * (creek.s[n - 1] || 0);
  const pts = creek.pts.slice();
  const sigma = Math.max(10, worldRadius);
  for (let i = 0; i < n; i++) {
    const dd = (creek.s[i] - target) / sigma;
    const w = Math.exp(-dd * dd);
    if (w < 0.002) continue;
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);
    const tx = creek.pts[i1 * 2] - creek.pts[i0 * 2];
    const ty = creek.pts[i1 * 2 + 1] - creek.pts[i0 * 2 + 1];
    const tl = Math.hypot(tx, ty) || 1;
    // 两端固定, 沟口与沟头不脱离父沟和滩面
    const endGuard = smoothstep(clamp(Math.min(i, n - 1 - i) / 3, 0, 1));
    pts[i * 2] += (-ty / tl) * delta * w * endGuard;
    pts[i * 2 + 1] += (tx / tl) * delta * w * endGuard;
  }
  const out = makeCreek(
    creek.id,
    creek.level,
    creek.parentId,
    creek.parentU,
    creek.side,
    pts,
    creek.widths.slice(),
    terrain,
    creek.headTarget,
  );
  out.edited = true;
  out.widths = widthsForPolyline(pts, creek.mouthWidth, profile);
  out.headWidth = out.widths[out.widths.length - 1] ?? 0;
  return out;
}

export function pickCreek(creeks: Creek[], x: number, y: number, maxDist: number): { creek: Creek; u: number } | null {
  let best: { creek: Creek; u: number; d2: number } | null = null;
  for (let i = creeks.length - 1; i >= 0; i--) {
    const c = creeks[i];
    const hit = closestPointOnPolyline(x, y, c.pts);
    const tol = maxDist + c.mouthWidth;
    if (hit.d2 < tol * tol && (!best || hit.d2 < best.d2)) {
      best = { creek: c, u: hit.t, d2: hit.d2 };
    }
  }
  return best ? { creek: best.creek, u: best.u } : null;
}

/** 重新计算派生量 (编辑后) */
export function refreshDerived(network: Network): Network {
  assignDensity(network.creeks);
  const bounds = computeBounds(network.creeks);
  const classes = computeClasses(network.creeks);
  for (const c of network.creeks) {
    c.classIdx = {
      length: classIndex(c.length, classes.length.breaks),
      density: classIndex(c.densityValue, classes.density.breaks),
      elevation: classIndex(c.headElevation, classes.elevation.breaks),
    };
  }
  const byId = new Map(network.creeks.map((c) => [c.id, c]));
  const junctions: Junction[] = [];
  for (const c of network.creeks) {
    if (!c.parentId) continue;
    const p = byId.get(c.parentId);
    if (!p) continue;
    junctions.push({
      x: c.pts[0],
      y: c.pts[1],
      r: Math.max(c.mouthWidth * 0.5, widthAt(p, c.parentU) * 0.42),
      level: p.level,
      creekId: c.id,
    });
  }
  return {
    ...network,
    bounds,
    classes,
    junctions,
    stats: computeStats(network.creeks, junctions, bounds),
    fingerprint: computeFingerprint(network.params, network.creeks),
  };
}
