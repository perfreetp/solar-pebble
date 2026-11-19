import { defineStore } from 'pinia'
import { createDefaultSkeleton, findRangeViolations, reparent as doReparent, finalizeBind } from '../engine/skeleton.js'
import { createPlaceholderParts, loadImageBitmap, matchPart } from '../engine/parts.js'
import { createTimeline, addKeyframe, removeKeyframe, evaluate, editablePoseAt, sortedKeys } from '../engine/animation.js'
import { DEFAULT_BEZIER } from '../engine/math.js'

const PROJECT_KEY = 'spe_project_v1'

function freshProject() {
  return {
    id: `PRJ-${Date.now()}`,
    title: '未命名射击姿势课件',
    width: 900,
    height: 650,
    bones: createDefaultSkeleton(),
    parts: {}, // 由 initParts 异步填充 ImageBitmap 部件
    timeline: createTimeline(48)
  }
}

export const useEditorStore = defineStore('editor', {
  state: () => ({
    project: freshProject(),
    mode: 'rig', // rig | pose
    selectedKey: 'torso',
    currentFrame: 0,
    playing: false,
    // 数值微调通道（同时写入关键帧 extras）
    torsoLean: 0,
    armRaise: 0,
    breathAmp: 4,
    // 当前编辑姿态的逐骨旋转（帧求值快照）
    pose: {},
    violations: [],
    importLog: [],
    exportProgress: 0
  }),
  getters: {
    bones: (s) => s.project.bones,
    parts: (s) => s.project.parts,
    timeline: (s) => s.project.timeline,
    violationSet: (s) => new Set(s.violations.map((v) => v.key)),
    selectedBone(s) {
      return s.project.bones[s.selectedKey] || null
    },
    onKeyframe(s) {
      return s.timeline.keys.includes(Math.round(s.currentFrame))
    },
    keyframeList(s) {
      return sortedKeys(s.timeline)
    }
  },
  actions: {
    async initParts() {
      if (!this.project.parts || Object.keys(this.project.parts).length === 0) {
        this.project.parts = await createPlaceholderParts()
      }
    },
    setPartBias(key, bias) {
      if (this.parts[key]) this.parts[key].bias = Number(bias)
    },
    // ---------- 持久化 ----------
    persist() {
      // 部件里的 canvas/bitmap 不可序列化，只持久化骨架与时间轴
      const dump = {
        id: this.project.id,
        title: this.project.title,
        width: this.project.width,
        height: this.project.height,
        bones: this.project.bones,
        timeline: this.timeline
      }
      localStorage.setItem(PROJECT_KEY, JSON.stringify(dump))
    },
    async restore() {
      try {
        const raw = localStorage.getItem(PROJECT_KEY)
        if (!raw) return false
        const dump = JSON.parse(raw)
        this.project.id = dump.id
        this.project.title = dump.title
        this.project.width = dump.width || 900
        this.project.height = dump.height || 650
        this.project.bones = dump.bones
        this.project.timeline = dump.timeline
        this.project.parts = await createPlaceholderParts()
        this.seekFrame(0)
        return true
      } catch {
        return false
      }
    },
    resetProject() {
      this.project = freshProject()
      this.currentFrame = 0
      this.pose = {}
      this.initParts().then(() => this.seekFrame(0))
      this.persist()
    },

    // ---------- 部件导入 ----------
    async importFiles(fileList) {
      const logs = []
      for (const file of fileList) {
        const key = matchPart(file.name)
        if (!key) {
          logs.push(`未识别「${file.name}」，已跳过`)
          continue
        }
        try {
          const { bitmap, w, h } = await loadImageBitmap(file)
          this.parts[key] = { bitmap, w, h, pivot: { x: w / 2, y: h / 2 }, placeholder: false, src: file.name }
          logs.push(`已导入 ${this.bones[key].label} ← ${file.name}`)
        } catch (err) {
          logs.push(`导入失败「${file.name}」：${err.message}`)
        }
      }
      this.importLog = logs
      return logs
    },
    async assignPart(key, file) {
      const prevBias = this.parts[key]?.bias || 0
      const { bitmap, w, h } = await loadImageBitmap(file)
      this.parts[key] = { bitmap, w, h, pivot: { x: w / 2, y: h / 2 }, bias: prevBias, placeholder: false, src: file.name }
    },

    // ---------- 绑骨 ----------
    moveAnchor(key, x, y) {
      const b = this.bones[key]
      b.anchor.x = Math.round(x)
      b.anchor.y = Math.round(y)
      finalizeBind(this.project.bones)
      this.recomputeViolations()
    },
    reparentBone(key, newParent) {
      return doReparent(this.project.bones, key, newParent || null)
    },
    setRange(key, min, max) {
      const b = this.bones[key]
      b.range.min = Number(min)
      b.range.max = Number(max)
      this.recomputeViolations()
    },

    // ---------- 摆姿势 ----------
    selectBone(key) {
      this.selectedKey = key
    },
    setBoneRot(key, deg) {
      // 写当前帧姿态
      if (!this.pose[key]) this.pose[key] = { rot: 0 }
      this.pose[key].rot = Math.round(deg * 100) / 100
      // 同步数值微调通道显示
      if (key === 'torso') this.torsoLean = this.pose[key].rot
      if (key === 'R.upperArm') this.armRaise = this.pose[key].rot
      this.recomputeViolations()
      if (this.onKeyframe) this.writeCurrentKeyframe()
    },
    setTorsoLean(v) {
      this.torsoLean = Number(v)
      this.setBoneRot('torso', this.torsoLean)
    },
    setArmRaise(v) {
      this.armRaise = Number(v)
      this.setBoneRot('R.upperArm', this.armRaise)
    },
    setBreathAmp(v) {
      this.breathAmp = Number(v)
      if (this.onKeyframe) this.writeCurrentKeyframe()
    },
    recomputeViolations() {
      this.violations = findRangeViolations(this.bones, this.pose)
    },

    // ---------- 时间轴 ----------
    seekFrame(frame) {
      this.currentFrame = Math.max(0, frame)
      const { pose, extras } = editablePoseAt(this.timeline, this.currentFrame)
      this.pose = pose
      this.torsoLean = extras.torsoLean ?? pose.torso?.rot ?? 0
      this.armRaise = extras.armRaise ?? pose['R.upperArm']?.rot ?? 0
      this.breathAmp = extras.breathAmp ?? 4
      this.recomputeViolations()
    },
    writeCurrentKeyframe() {
      const f = Math.round(this.currentFrame)
      const extras = { torsoLean: this.torsoLean, armRaise: this.armRaise, breathAmp: this.breathAmp }
      addKeyframe(this.timeline, f, this.pose, extras)
    },
    addKeyHere() {
      this.writeCurrentKeyframe()
      this.persist()
    },
    removeKeyHere() {
      const f = Math.round(this.currentFrame)
      removeKeyframe(this.timeline, f)
      this.seekFrame(f)
      this.persist()
    },
    setSegmentEasing(a, b, easing, bezier) {
      const cur = this.timeline.segments[`${a}-${b}`] || { easing, bezier: [...DEFAULT_BEZIER] }
      this.timeline.segments[`${a}-${b}`] = { ...cur, easing, bezier: bezier || cur.bezier || [...DEFAULT_BEZIER] }
      this.persist()
    },
    currentSegment() {
      const keys = this.keyframeList
      const f = Math.round(this.currentFrame)
      for (let i = 0; i < keys.length - 1; i++) {
        if (f >= keys[i] && f <= keys[i + 1]) return { a: keys[i], b: keys[i + 1] }
      }
      return null
    },
    evaluateAt(frame) {
      return evaluate(this.timeline, frame)
    }
  }
})
