// 时间轴 / 关键帧 / 插值求值
import { angleLerp, lerp, segmentEase, DEFAULT_BEZIER } from './math.js'

export const FPS = 24

export function createTimeline(durationFrames = 48) {
  return {
    fps: FPS,
    duration: durationFrames, // 总帧数
    keys: [],                 // 帧号，升序
    poses: {},                // frame -> { boneKey: {rot}, torso?:{...}, breathing? }
    segments: {},             // `${a}-${b}` -> { easing, bezier }
    extras: {}                // frame -> { torsoLean, armRaise, breathAmp }（数值微调通道）
  }
}

export function sortedKeys(tl) {
  return [...tl.keys].sort((a, b) => a - b)
}

export function segmentId(a, b) {
  return `${a}-${b}`
}

export function getSegment(tl, a, b) {
  return tl.segments[segmentId(a, b)] || { easing: 'linear', bezier: [...DEFAULT_BEZIER] }
}

export function setSegment(tl, a, b, patch) {
  const id = segmentId(a, b)
  const cur = getSegment(tl, a, b)
  tl.segments[id] = { ...cur, ...patch }
}

export function addKeyframe(tl, frame, pose, extras) {
  frame = Math.round(frame)
  if (!tl.keys.includes(frame)) {
    tl.keys.push(frame)
    tl.keys.sort((a, b) => a - b)
  }
  tl.poses[frame] = JSON.parse(JSON.stringify(pose))
  if (extras) tl.extras[frame] = JSON.parse(JSON.stringify(extras))
  // 新关键帧与相邻关键帧之间补默认段
  const idx = tl.keys.indexOf(frame)
  if (idx > 0) setSegment(tl, tl.keys[idx - 1], frame, getSegment(tl, tl.keys[idx - 1], frame))
  if (idx < tl.keys.length - 1) setSegment(tl, frame, tl.keys[idx + 1], getSegment(tl, frame, tl.keys[idx + 1]))
}

export function removeKeyframe(tl, frame) {
  const idx = tl.keys.indexOf(frame)
  if (idx < 0) return
  tl.keys.splice(idx, 1)
  delete tl.poses[frame]
  delete tl.extras[frame]
  // 重建受影响段
  const left = tl.keys[idx - 1], right = tl.keys[idx]
  Object.keys(tl.segments).forEach((id) => {
    const [a, b] = id.split('-').map(Number)
    if (a === frame || b === frame) delete tl.segments[id]
  })
  if (left != null && right != null) setSegment(tl, left, right, { easing: 'linear', bezier: [...DEFAULT_BEZIER] })
}

export function isKeyframe(tl, frame) {
  return tl.keys.includes(frame)
}

// 在任意帧求姿态（帧号可为小数）
export function evaluate(tl, frame) {
  const keys = sortedKeys(tl)
  if (keys.length === 0) return { pose: {}, extras: { torsoLean: 0, armRaise: 0, breathAmp: 0 } }
  if (frame <= keys[0]) return { pose: tl.poses[keys[0]], extras: tl.extras[keys[0]] || {}, atKey: keys[0] }
  if (frame >= keys[keys.length - 1]) {
    const last = keys[keys.length - 1]
    return { pose: tl.poses[last], extras: tl.extras[last] || {}, atKey: last }
  }
  let a = keys[0], b = keys[keys.length - 1]
  for (let i = 0; i < keys.length - 1; i++) {
    if (frame >= keys[i] && frame <= keys[i + 1]) { a = keys[i]; b = keys[i + 1]; break }
  }
  const rawT = (frame - a) / (b - a)
  const seg = getSegment(tl, a, b)
  const t = segmentEase(seg, rawT)
  const pa = tl.poses[a], pb = tl.poses[b]
  const allBoneKeys = new Set([...Object.keys(pa), ...Object.keys(pb)])
  const pose = {}
  for (const key of allBoneKeys) {
    const ra = pa[key]?.rot ?? 0
    const rb = pb[key]?.rot ?? 0
    pose[key] = { rot: angleLerp(ra, rb, t) }
  }
  const ea = tl.extras[a] || {}, eb = tl.extras[b] || {}
  const extras = {
    torsoLean: lerp(ea.torsoLean ?? 0, eb.torsoLean ?? 0, t),
    armRaise: lerp(ea.armRaise ?? 0, eb.armRaise ?? 0, t),
    breathAmp: lerp(ea.breathAmp ?? 0, eb.breathAmp ?? 0, t)
  }
  return { pose, extras, between: [a, b], rawT, easedT: t }
}

// 当前帧的可编辑姿态（落在关键帧上返回该帧；否则返回求值结果的快照）
export function editablePoseAt(tl, frame) {
  const f = Math.round(frame)
  if (isKeyframe(tl, f)) return { frame: f, pose: tl.poses[f], extras: tl.extras[f] || {}, keyframe: true }
  const { pose, extras } = evaluate(tl, frame)
  return { frame: f, pose: JSON.parse(JSON.stringify(pose)), extras: { ...extras }, keyframe: false }
}

export function timeToFrame(tl, seconds) {
  return seconds * tl.fps
}

export function frameToTime(tl, frame) {
  return frame / tl.fps
}
