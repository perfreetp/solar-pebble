import * as PIXI from 'pixi.js'
import { store, actions, bump, showToast, getSurfaces, MAP } from '../store'

const SCALE = 14 // 缩放 1.0 时每米对应的像素

/* 投影:世界坐标(米,z 向上) -> 投影平面坐标 */
const ISO = {
  project(x, y, z) { return [(x - y) * 0.8660254, (x + y) * 0.5 - z] },
  unproject(sx, sy, z = 0) {
    return { x: (sx / 0.8660254 + (sy + z) / 0.5) / 2, y: ((sy + z) / 0.5 - sx / 0.8660254) / 2 }
  },
  viewDir: [1, 1, 1],
}
const TOP = {
  project(x, y) { return [x, y] },
  unproject(sx, sy) { return { x: sx, y: sy } },
  viewDir: [0, 0, 1],
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function shade(hex, k) {
  const [r, g, b] = hexToRgb(hex)
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)))
  return (c(r) << 16) | (c(g) << 8) | c(b)
}
function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx, cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}
function pointInPoly(px, py, pts) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export class IsoScene {
  constructor(container) {
    this.container = container
    this.app = new PIXI.Application({
      resizeTo: container,
      antialias: true,
      background: 0x0f1420,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    })
    container.appendChild(this.app.view)
    this.app.view.style.display = 'block'

    this.viewport = new PIXI.Container()
    this.groundLayer = new PIXI.Container()
    this.bodyLayer = new PIXI.Container()
    this.bodyLayer.sortableChildren = true
    this.overlayLayer = new PIXI.Container()
    this.viewport.addChild(this.groundLayer, this.bodyLayer, this.overlayLayer)
    this.app.stage.addChild(this.viewport)

    this.cam = { x: 0, y: 0, zoom: 1 }
    this.drag = null
    this.flash = null // 定位闪烁 {id, until}
    this.hintText = null

    this.bindEvents()
    this.fitView()
    this.app.ticker.add(() => this.tick())
    this.renderAll()
  }

  get proj() { return store.view === 'top' ? TOP : ISO }
  get scale() { return SCALE * this.cam.zoom }

  applyCam() {
    this.viewport.scale.set(this.scale)
    this.viewport.position.set(this.cam.x, this.cam.y)
  }

  fitView() {
    const w = this.container.clientWidth || 800
    const h = this.container.clientHeight || 600
    const corners = [
      this.proj.project(0, 0, 0), this.proj.project(MAP.w, 0, 0),
      this.proj.project(0, MAP.h, 0), this.proj.project(MAP.w, MAP.h, 0),
    ]
    const xs = corners.map(c => c[0]), ys = corners.map(c => c[1])
    const pw = Math.max(...xs) - Math.min(...xs), ph = Math.max(...ys) - Math.min(...ys)
    this.cam.zoom = Math.min(w / (pw * SCALE), h / (ph * SCALE)) * 0.85
    this.cam.x = w / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * this.scale
    this.cam.y = h / 2 - ((Math.max(...ys) + Math.min(...ys)) / 2) * this.scale
    this.applyCam()
  }

  pointerPos(e) {
    const r = this.app.view.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  screenToProj(p) {
    return { x: (p.x - this.cam.x) / this.scale, y: (p.y - this.cam.y) / this.scale }
  }
  screenToGround(p) {
    const q = this.screenToProj(p)
    return this.proj.unproject(q.x, q.y)
  }

  /* 视觉表面拾取:指针在屏幕上指向的"最高合法安装面"。
     等轴测下同一屏幕点在不同高度面对应不同世界坐标,
     对每个候选面按 z 反解世界坐标,落在面内即为命中,取最高者。 */
  surfacePick(typeKey, p) {
    const q = this.screenToProj(p)
    const t = store.deviceTypes[typeKey]
    if (!t) return null
    const M = 0.3
    const surfs = getSurfaces().filter(s => t.allowed.includes(s.kind))
    let best = null
    for (const s of surfs) {
      const g = this.proj.unproject(q.x, q.y, s.z)
      if (g.x >= s.x - M && g.x <= s.x + s.l + M && g.y >= s.y - M && g.y <= s.y + s.w + M) {
        if (!best || s.z > best.z) best = { x: g.x, y: g.y, z: s.z }
      }
    }
    return best
  }

  /* ================= 事件 ================= */

  bindEvents() {
    const v = this.app.view
    v.addEventListener('pointerdown', (e) => this.onDown(e))
    window.addEventListener('pointermove', (e) => this.onMove(e))
    window.addEventListener('pointerup', (e) => this.onUp(e))
    v.addEventListener('wheel', (e) => {
      e.preventDefault()
      const p = this.pointerPos(e)
      const before = this.screenToProj(p)
      this.cam.zoom = Math.max(0.25, Math.min(4, this.cam.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
      const after = this.screenToProj(p)
      this.cam.x += (after.x - before.x) * this.scale
      this.cam.y += (after.y - before.y) * this.scale
      this.applyCam()
    }, { passive: false })
    v.addEventListener('contextmenu', (e) => e.preventDefault())
    v.addEventListener('dblclick', () => this.fitView())
  }

  onDown(e) {
    const p = this.pointerPos(e)
    if (e.button === 1 || e.button === 2) {
      this.drag = { mode: 'pan', sx: p.x, sy: p.y, cx: this.cam.x, cy: this.cam.y }
      return
    }
    // 1. 命中变换手柄?
    if (store.selectedId && store.view === 'iso') {
      const axis = this.hitGizmo(p)
      if (axis) {
        const d = store.devices.find(v => v.id === store.selectedId)
        this.drag = { mode: 'axis', axis, id: d.id, start: { x: d.x, y: d.y, z: d.z }, sp: p }
        return
      }
    }
    // 2. 命中设备?(按深度从前往后)
    const hit = this.pickDevice(p)
    if (hit) {
      store.selectedId = hit.id
      bump()
      const sp = this.surfacePick(hit.type, p) || this.screenToGround(p)
      this.drag = { mode: 'body', id: hit.id, offX: hit.x - sp.x, offY: hit.y - sp.y }
      return
    }
    // 3. 空白:平移
    store.selectedId = null
    bump()
    this.drag = { mode: 'pan', sx: p.x, sy: p.y, cx: this.cam.x, cy: this.cam.y }
  }

  onMove(e) {
    if (!this.drag) return
    const p = this.pointerPos(e)
    const d = this.drag
    if (d.mode === 'pan') {
      this.cam.x = d.cx + (p.x - d.sx)
      this.cam.y = d.cy + (p.y - d.sy)
      this.applyCam()
      return
    }
    const dev = store.devices.find(v => v.id === d.id)
    if (!dev) { this.drag = null; return }

    if (d.mode === 'body') {
      const sp = this.surfacePick(dev.type, p) || this.screenToGround(p)
      actions.moveDevice(dev.id, sp.x + d.offX, sp.y + d.offY, sp.z ?? dev.z)
      this.renderAll()
      return
    }
    if (d.mode === 'axis') {
      // 把屏幕位移投影到轴的屏幕方向上,求世界位移量
      const origin = this.proj.project(d.start.x, d.start.y, d.start.z)
      const vec = { x: 0, y: 0, z: 0 }
      vec[d.axis] = 1
      const tip = this.proj.project(d.start.x + vec.x, d.start.y + vec.y, d.start.z + vec.z)
      const ax = (tip[0] - origin[0]) * this.scale
      const ay = (tip[1] - origin[1]) * this.scale
      const len2 = ax * ax + ay * ay
      if (!len2) return
      const t = ((p.x - d.sp.x) * ax + (p.y - d.sp.y) * ay) / len2
      if (d.axis === 'z') {
        actions.setDeviceZ(dev.id, d.start.z + t)
      } else {
        const nx = d.start.x + (d.axis === 'x' ? t : 0)
        const ny = d.start.y + (d.axis === 'y' ? t : 0)
        actions.moveDevice(dev.id, nx, ny, dev.z)
      }
      this.renderAll()
    }
  }

  onUp() {
    if (this.drag && (this.drag.mode === 'body' || this.drag.mode === 'axis')) {
      const dev = store.devices.find(v => v.id === this.drag.id)
      if (dev) {
        actions.moveDevice(dev.id, dev.x, dev.y, dev.z) // 落地吸附
        if (dev.invalid) showToast(`「${dev.name}」所在位置无合法安装面(${dev.type === 'probe' ? '采样探头仅允许管廊/围墙' : '请检查设备允许安装面'})`)
        if (store.conflicts.includes(dev.id)) showToast(`「${dev.name}」与其他设备包围盒相交`, 3000)
        actions.persist()
      }
      store.dragInfo = null
      bump()
    }
    this.drag = null
  }

  /* ================= 拾取(深度排序) ================= */

  deviceFaces(dev) {
    const t = store.deviceTypes[dev.type]
    const rad = (dev.rot * Math.PI) / 180
    const cos = Math.cos(rad), sin = Math.sin(rad)
    const hx = t.l / 2, hy = t.w / 2
    const corner = (dx, dy, dz) => {
      const x = dev.x + dx * cos - dy * sin
      const y = dev.y + dx * sin + dy * cos
      return this.proj.project(x, y, dev.z + dz)
    }
    const b = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]]
    const c = []
    for (const [dx, dy] of b) c.push(corner(dx, dy, 0))
    for (const [dx, dy] of b) c.push(corner(dx, dy, t.h))
    const n = (nx, ny, nz) => {
      const rx = nx * cos - ny * sin, ry = nx * sin + ny * cos
      return [rx, ry, nz]
    }
    return {
      corners: c,
      faces: [
        { idx: [4, 5, 6, 7], n: n(0, 0, 1), top: true },
        { idx: [1, 2, 6, 5], n: n(1, 0, 0) },
        { idx: [3, 0, 4, 7], n: n(-1, 0, 0) },
        { idx: [2, 3, 7, 6], n: n(0, 1, 0) },
        { idx: [0, 1, 5, 4], n: n(0, -1, 0) },
      ],
    }
  }

  faceVisible(n) {
    const v = this.proj.viewDir
    return n[0] * v[0] + n[1] * v[1] + n[2] * v[2] > 0.001
  }

  depthKey(d) {
    const t = store.deviceTypes[d.type] || { l: 1, w: 1 }
    return d.x - t.l / 2 + (d.y - t.w / 2) + d.z * 0.01
  }

  pickDevice(p) {
    const q = this.screenToProj(p)
    const sorted = [...store.devices].sort((a, b) => this.depthKey(b) - this.depthKey(a))
    for (const dev of sorted) {
      const { faces, corners: c } = this.deviceFaces(dev)
      for (const f of faces) {
        if (!this.faceVisible(f.n)) continue
        const pts = f.idx.map(i => c[i])
        if (pointInPoly(q.x, q.y, pts)) return dev
      }
    }
    return null
  }

  /* ================= 渲染 ================= */

  renderAll() {
    this.renderGround()
    this.renderBodies()
    this.renderOverlay()
    this.applyCam()
  }

  renderGround() {
    const g = this.groundLayer
    g.removeChildren().forEach(c => c.destroy())
    const proj = this.proj
    const lw = 1 / this.scale

    // 区域底色
    for (const r of store.regions) {
      const pts = [
        proj.project(r.x, r.y, -0.02), proj.project(r.x + r.w, r.y, -0.02),
        proj.project(r.x + r.w, r.y + r.h, -0.02), proj.project(r.x, r.y + r.h, -0.02),
      ].flat()
      const gr = new PIXI.Graphics()
      gr.beginFill(PIXI.utils.string2hex(r.color), 0.07).drawPolygon(pts).endFill()
      g.addChild(gr)
      const tp = proj.project(r.x + r.w / 2, r.y + r.h / 2, -0.02)
      const label = new PIXI.Text(r.name, { fontSize: 13, fill: 0x8b98b8, fontFamily: 'sans-serif' })
      label.anchor.set(0.5)
      label.scale.set(1 / this.scale * (14 / 13))
      label.position.set(tp[0], tp[1])
      g.addChild(label)
    }

    // 底图
    if (store.basemap) {
      const tex = PIXI.Texture.from(store.basemap.dataUrl)
      const sp = new PIXI.Sprite(tex)
      sp.alpha = 0.55
      const { w: iw, h: ih } = store.basemap
      if (store.view === 'iso') {
        const p1 = ISO.project(MAP.w, 0, 0), p2 = ISO.project(0, MAP.h, 0)
        sp.transform.setFromMatrix(new PIXI.Matrix(p1[0] / iw, p1[1] / iw, p2[0] / ih, p2[1] / ih, 0, 0))
      } else {
        sp.transform.setFromMatrix(new PIXI.Matrix(MAP.w / iw, 0, 0, MAP.h / ih, 0, 0))
      }
      g.addChild(sp)
    }

    // 网格(5m)
    const grid = new PIXI.Graphics()
    grid.lineStyle(lw, 0x2b3654, 0.6)
    for (let x = 0; x <= MAP.w; x += 5) {
      const a = proj.project(x, 0, 0), b = proj.project(x, MAP.h, 0)
      grid.moveTo(a[0], a[1]).lineTo(b[0], b[1])
    }
    for (let y = 0; y <= MAP.h; y += 5) {
      const a = proj.project(0, y, 0), b = proj.project(MAP.w, y, 0)
      grid.moveTo(a[0], a[1]).lineTo(b[0], b[1])
    }
    grid.lineStyle(lw * 2, 0x3d4a70, 1)
    const o = proj.project(0, 0, 0), e1 = proj.project(MAP.w, 0, 0), e2 = proj.project(MAP.w, MAP.h, 0), e3 = proj.project(0, MAP.h, 0)
    grid.moveTo(o[0], o[1]).lineTo(e1[0], e1[1]).lineTo(e2[0], e2[1]).lineTo(e3[0], e3[1]).closePath()
    g.addChild(grid)
  }

  drawBox(graphics, cx, cy, z, l, w, h, rotDeg, colorHex, opts = {}) {
    const proj = this.proj
    const rad = (rotDeg * Math.PI) / 180
    const cos = Math.cos(rad), sin = Math.sin(rad)
    const hx = l / 2, hy = w / 2
    const corner = (dx, dy, dz) => {
      const x = cx + dx * cos - dy * sin
      const y = cy + dx * sin + dy * cos
      return proj.project(x, y, z + dz)
    }
    const b = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]]
    const c = []
    for (const [dx, dy] of b) c.push(corner(dx, dy, 0))
    for (const [dx, dy] of b) c.push(corner(dx, dy, h))
    const n = (nx, ny, nz) => [nx * cos - ny * sin, nx * sin + ny * cos, nz]
    const faces = [
      { idx: [4, 5, 6, 7], n: n(0, 0, 1), shade: 1.0 },
      { idx: [1, 2, 6, 5], n: n(1, 0, 0), shade: 0.82 },
      { idx: [3, 0, 4, 7], n: n(-1, 0, 0), shade: 0.82 },
      { idx: [2, 3, 7, 6], n: n(0, 1, 0), shade: 0.62 },
      { idx: [0, 1, 5, 4], n: n(0, -1, 0), shade: 0.62 },
    ]
    const lw = (opts.lineWidth || 1.5) / this.scale
    for (const f of faces) {
      if (!this.faceVisible(f.n)) continue
      const pts = f.idx.map(i => c[i]).flat()
      graphics.lineStyle(lw, opts.outline ?? 0x101725, opts.outlineAlpha ?? 0.9)
      graphics.beginFill(opts.fill ?? shade(colorHex, f.shade), opts.alpha ?? 1)
      graphics.drawPolygon(pts)
      graphics.endFill()
    }
    return c
  }

  renderBodies() {
    const layer = this.bodyLayer
    layer.removeChildren().forEach(c => c.destroy({ children: true }))

    // 构筑物
    const structColors = { rack: '#54627f', wall: '#6e5a44', block: '#3a4358' }
    for (const s of store.structures) {
      const g = new PIXI.Graphics()
      this.drawBox(g, s.x + s.l / 2, s.y + s.w / 2, 0, s.l, s.w, s.h, 0, structColors[s.kind],
        { alpha: s.kind === 'block' ? 0.85 : 1, outline: 0x0c101c })
      g.zIndex = (s.x + s.y) * 100
      layer.addChild(g)
      // 标高标注
      if (s.kind !== 'block' || true) {
        const p = this.proj.project(s.x + s.l / 2, s.y + s.w / 2, s.h)
        const t = new PIXI.Text(`${s.name} +${s.h.toFixed(1)}m`, { fontSize: 11, fill: 0x9fb0d0, fontFamily: 'sans-serif' })
        t.anchor.set(0.5, 1.4)
        t.scale.set(1.4 / this.scale)
        t.position.set(p[0], p[1])
        t.zIndex = g.zIndex + 1
        layer.addChild(t)
      }
    }

    // 设备(按深度排序)
    const sorted = [...store.devices].sort((a, b) => this.depthKey(a) - this.depthKey(b))
    for (const d of sorted) {
      const t = store.deviceTypes[d.type]
      if (!t) continue
      const g = new PIXI.Graphics()
      const isSel = d.id === store.selectedId
      const isConflict = store.conflicts.includes(d.id)
      const isRejected = d.review?.result === 'rejected'
      const isApproved = d.review?.result === 'approved'
      let outline = 0x101725, outlineAlpha = 0.9, lineWidth = 1.5
      if (isConflict) { outline = 0xef5350; outlineAlpha = 1; lineWidth = 3 }
      else if (isRejected) { outline = 0xffb74d; outlineAlpha = 1; lineWidth = 3 }
      else if (isSel) { outline = 0x4fc3f7; outlineAlpha = 1; lineWidth = 3 }
      else if (isApproved) { outline = 0x7cb342; outlineAlpha = 1; lineWidth = 2 }
      if (d.invalid) { outline = 0xef5350; outlineAlpha = 1; lineWidth = 3 }
      this.drawBox(g, d.x, d.y, d.z, t.l, t.w, t.h, d.rot, t.color, { outline, outlineAlpha, lineWidth })
      g.zIndex = this.depthKey(d) * 100 + 0.5
      layer.addChild(g)

      // 俯视正交:名称标注 + 朝向线
      if (store.view === 'top') {
        const rad = (d.rot * Math.PI) / 180
        const dir = new PIXI.Graphics()
        dir.lineStyle(2 / this.scale, 0xffffff, 0.8)
        const p0 = this.proj.project(d.x, d.y, d.z)
        const p1 = this.proj.project(d.x + Math.cos(rad) * t.l, d.y + Math.sin(rad) * t.l, d.z)
        dir.moveTo(p0[0], p0[1]).lineTo(p1[0], p1[1])
        dir.zIndex = g.zIndex + 0.1
        layer.addChild(dir)
        const label = new PIXI.Text(d.name, { fontSize: 11, fill: 0xffffff, fontFamily: 'sans-serif' })
        label.anchor.set(0.5, 0)
        label.scale.set(1.4 / this.scale)
        label.position.set(p0[0], p0[1] + 0.6)
        label.zIndex = g.zIndex + 0.1
        layer.addChild(label)
      }
    }
  }

  /* ---------- 变换手柄 ---------- */

  gizmoAxes() {
    const d = store.devices.find(v => v.id === store.selectedId)
    if (!d) return null
    const t = store.deviceTypes[d.type]
    const origin = this.proj.project(d.x, d.y, d.z + t.h / 2)
    const len = Math.max(t.l, t.w, t.h) * 1.2 + 1.2
    const mk = (dx, dy, dz) => {
      const tip = this.proj.project(d.x + dx * len, d.y + dy * len, d.z + t.h / 2 + dz * len)
      return { o: origin, t: tip }
    }
    return { x: mk(1, 0, 0), y: mk(0, 1, 0), z: mk(0, 0, 1), dev: d }
  }

  hitGizmo(p) {
    const axes = this.gizmoAxes()
    if (!axes) return null
    const s = this.scale
    for (const k of ['x', 'y', 'z']) {
      const a = axes[k]
      const ox = a.o[0] * s + this.cam.x, oy = a.o[1] * s + this.cam.y
      const tx = a.t[0] * s + this.cam.x, ty = a.t[1] * s + this.cam.y
      if (distToSeg(p.x, p.y, ox, oy, tx, ty) < 10) return k
    }
    return null
  }

  renderOverlay() {
    const ov = this.overlayLayer
    ov.removeChildren().forEach(c => c.destroy({ children: true }))
    const d = store.devices.find(v => v.id === store.selectedId)
    if (!d || store.view !== 'iso') return
    const axes = this.gizmoAxes()
    if (!axes) return
    const colors = { x: 0xef5350, y: 0x7cb342, z: 0x42a5f5 }
    const lw = 3 / this.scale
    for (const k of ['x', 'y', 'z']) {
      const a = axes[k]
      const g = new PIXI.Graphics()
      g.lineStyle(lw, colors[k], 1)
      g.moveTo(a.o[0], a.o[1]).lineTo(a.t[0], a.t[1])
      // 箭头
      const dx = a.t[0] - a.o[0], dy = a.t[1] - a.o[1]
      const L = Math.hypot(dx, dy) || 1
      const ux = dx / L, uy = dy / L
      const hs = 0.45
      g.beginFill(colors[k], 1)
      g.drawPolygon([
        a.t[0], a.t[1],
        a.t[0] - ux * hs - uy * hs * 0.5, a.t[1] - uy * hs + ux * hs * 0.5,
        a.t[0] - ux * hs + uy * hs * 0.5, a.t[1] - uy * hs - ux * hs * 0.5,
      ])
      g.endFill()
      ov.addChild(g)
      const label = new PIXI.Text(k.toUpperCase(), { fontSize: 12, fill: colors[k], fontWeight: 'bold', fontFamily: 'sans-serif' })
      label.anchor.set(0.5)
      label.scale.set(1.5 / this.scale)
      label.position.set(a.t[0] + ux * 0.8, a.t[1] + uy * 0.8)
      ov.addChild(label)
    }
    // 中心点
    const dot = new PIXI.Graphics()
    dot.beginFill(0xffffff, 0.9).drawCircle(axes.x.o[0], axes.x.o[1], 3 / this.scale).endFill()
    ov.addChild(dot)
  }

  /* ---------- 定位闪烁 ---------- */

  locateDevice(id) {
    const d = store.devices.find(v => v.id === id)
    if (!d) return
    const p = this.proj.project(d.x, d.y, d.z)
    const w = this.container.clientWidth, h = this.container.clientHeight
    this.cam.x = w / 2 - p[0] * this.scale
    this.cam.y = h / 2 - p[1] * this.scale
    this.applyCam()
    this.flash = { id, until: performance.now() + 1800 }
  }

  tick() {
    if (!this.flash) return
    const now = performance.now()
    if (now > this.flash.until) { this.flash = null; this.renderAll(); return }
    const d = store.devices.find(v => v.id === this.flash.id)
    if (!d) { this.flash = null; return }
    const t = store.deviceTypes[d.type]
    const g = new PIXI.Graphics()
    const r = (Math.max(t.l, t.w) * 1.2 + 0.8) * (1 + 0.15 * Math.sin(now / 90))
    const p = this.proj.project(d.x, d.y, d.z)
    g.lineStyle(3 / this.scale, 0xffb74d, 0.9)
    g.drawCircle(p[0], p[1], r)
    // 复用 overlay:先重绘手柄再叠加闪烁
    this.renderOverlay()
    this.overlayLayer.addChild(g)
  }

  /* ---------- 外部调用 ---------- */

  dropDevice(typeKey, px, py) {
    const sp = this.surfacePick(typeKey, { x: px, y: py }) || this.screenToGround({ x: px, y: py })
    const d = actions.addDevice(typeKey, sp.x, sp.y, sp.z)
    if (d) showToast(`已放置「${d.name}」→ ${d.surface}(标高 ${d.z.toFixed(1)}m)`)
  }

  exportImage() {
    const prevView = store.view
    const prevSel = store.selectedId
    store.view = 'top'
    store.selectedId = null
    this.renderAll()
    // 让 PIXI 先画一帧
    this.app.renderer.render(this.app.stage)
    const canvas = this.app.renderer.extract.canvas(this.app.stage)
    canvas.toBlob((blob) => {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `布点图_${new Date().toISOString().slice(0, 10)}.png`
      a.click()
      URL.revokeObjectURL(a.href)
    })
    store.view = prevView
    store.selectedId = prevSel
    this.renderAll()
    showToast('布点图已导出(俯视正交视角)')
  }

  destroy() {
    this.app.destroy(true, { children: true, texture: true })
  }
}
