// 姿势预设：把一段关键帧区间存成预设，套用到别的动作段
const STORE_KEY = 'spe_presets_v1'

export function listPresets() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '[]')
  } catch {
    return []
  }
}

function saveAll(list) {
  localStorage.setItem(STORE_KEY, JSON.stringify(list))
}

// 从时间轴抽取 [from,to] 区间生成预设（帧号重基到 0）
export function createPreset(name, timeline, from, to) {
  const keys = timeline.keys.filter((f) => f >= from && f <= to).sort((a, b) => a - b)
  const preset = {
    id: `ps_${Date.now()}`,
    name,
    createdAt: new Date().toISOString(),
    fps: timeline.fps,
    span: to - from,
    keys: keys.map((f) => f - from),
    poses: {},
    extras: {},
    segments: {}
  }
  for (const f of keys) {
    preset.poses[f - from] = JSON.parse(JSON.stringify(timeline.poses[f]))
    if (timeline.extras[f]) preset.extras[f - from] = JSON.parse(JSON.stringify(timeline.extras[f]))
  }
  for (const [id, seg] of Object.entries(timeline.segments)) {
    const [a, b] = id.split('-').map(Number)
    if (a >= from && b <= to) preset.segments[`${a - from}-${b - from}`] = JSON.parse(JSON.stringify(seg))
  }
  const list = listPresets()
  list.unshift(preset)
  saveAll(list)
  return preset
}

export function deletePreset(id) {
  saveAll(listPresets().filter((p) => p.id !== id))
}

// 把预设套用到时间轴的 targetFrame 起始位置；overwrite=true 时覆盖冲突关键帧
export function applyPreset(preset, timeline, targetFrame, { overwrite = true } = {}) {
  for (let i = 0; i < preset.keys.length; i++) {
    const srcF = preset.keys[i]
    const dstF = targetFrame + srcF
    if (!overwrite && timeline.keys.includes(dstF)) continue
    if (!timeline.keys.includes(dstF)) timeline.keys.push(dstF)
    timeline.poses[dstF] = JSON.parse(JSON.stringify(preset.poses[srcF]))
    if (preset.extras[srcF]) timeline.extras[dstF] = JSON.parse(JSON.stringify(preset.extras[srcF]))
  }
  for (const [id, seg] of Object.entries(preset.segments)) {
    const [a, b] = id.split('-').map(Number)
    timeline.segments[`${targetFrame + a}-${targetFrame + b}`] = JSON.parse(JSON.stringify(seg))
  }
  timeline.keys.sort((a, b) => a - b)
  timeline.duration = Math.max(timeline.duration, targetFrame + preset.span + 1)
}
