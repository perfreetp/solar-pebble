// OffscreenCanvas 离屏预览 Worker：在工作线程渲染，拖动播放不掉帧
import { solveFK, findRangeViolations } from '../engine/skeleton.js'
import { evaluate, frameToTime } from '../engine/animation.js'
import { renderFrame, buildScene } from '../engine/render-core.js'

let canvas = null
let ctx = null
let state = null // { bones, parts, timeline, width, height, playing, frame, speed }

self.onmessage = (e) => {
  const msg = e.data
  switch (msg.type) {
    case 'init':
      canvas = msg.canvas
      ctx = canvas.getContext('2d')
      state = { ...msg.state, frame: 0, playing: false, last: 0, raf: 0 }
      draw(0)
      break
    case 'state':
      // 项目状态更新（骨骼/部件/时间轴）
      if (state) {
        state.bones = msg.state.bones ?? state.bones
        state.parts = msg.state.parts ?? state.parts
        state.timeline = msg.state.timeline ?? state.timeline
        draw(state.frame)
      }
      break
    case 'sync':
      // 高频同步：仅骨骼与时间轴（不含 ImageBitmap 部件，避免反复克隆）
      if (state) {
        state.bones = msg.bones ?? state.bones
        state.timeline = msg.timeline ?? state.timeline
      }
      break
    case 'parts':
      if (state) {
        state.parts = msg.parts
        draw(state.frame)
      }
      break
    case 'play':
      if (!state) return
      state.playing = true
      state.last = performance.now()
      loop()
      break
    case 'pause':
      if (state) state.playing = false
      break
    case 'seek':
      if (!state) return
      state.frame = msg.frame
      draw(state.frame)
      break
    case 'resize':
      if (canvas && msg.width) {
        canvas.width = msg.width
        canvas.height = msg.height
        state.width = msg.width
        state.height = msg.height
        draw(state.frame)
      }
      break
  }
}

function loop() {
  if (!state.playing) return
  const now = performance.now()
  const dt = (now - state.last) / 1000
  state.last = now
  const tl = state.timeline
  state.frame += dt * tl.fps
  const lastFrame = tl.keys.length ? Math.max(...tl.keys) : 0
  if (state.frame > lastFrame) state.frame = 0
  draw(state.frame)
  self.postMessage({ type: 'tick', frame: state.frame, time: frameToTime(tl, state.frame) })
  state.raf = requestAnimationFrame(loop)
}

function draw(frame) {
  if (!ctx || !state) return
  const { bones, parts, timeline, width, height } = state
  const { pose, extras } = evaluate(timeline, frame)
  const fk = solveFK(bones, pose)
  const violations = new Set(findRangeViolations(bones, pose).map((v) => v.key))
  // 呼吸：按时间推进相位，幅度取当前帧求值值
  const breathPhase = (frameToTime(timeline, frame) * Math.PI * 2) / 2.4 // 约 2.4s 一个呼吸周期
  const scene = buildScene(bones, parts, fk, {
    breathAmp: extras.breathAmp ?? 0,
    breathPhase,
    violations,
    mode: null
  })
  renderFrame(ctx, scene, width, height)
}
