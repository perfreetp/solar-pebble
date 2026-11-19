/**
 * TerrainRenderer —— WebGPU 渲染器。
 * 负责：地形网格（实体/线框 barycentric 描边）、水面、区块锁定框、
 * 悬停区块高亮、拖框矩形、轨道相机（旋转/平移/缩放）与射线求交。
 * 数据全部来自 TerrainEngine，渲染器不持有业务状态。
 */
import { FIELD_SIZE, CHUNKS_PER_SIDE, CHUNK_SIZE, CELLS_PER_SIDE, CELL_STEP, VERTS_PER_SIDE } from '../terrain/config.js'
import { TERRAIN_VERT, TERRAIN_FRAG, LINE_VERT, LINE_FRAG } from './shaders.js'
import { clamp } from '../terrain/random.js'

const V = VERTS_PER_SIDE
const HALF = FIELD_SIZE / 2

export class TerrainRenderer {
  constructor(canvas, engine, device) {
    this.canvas = canvas
    this.engine = engine
    this.device = device
    this.context = canvas.getContext('webgpu')
    this.format = navigator.gpu.getPreferredCanvasFormat()
    this.context.configure({ device, format: this.format, alphaMode: 'opaque' })

    this.wireframe = false
    this.showSlope = false
    this.showWater = true
    this.hoverChunk = -1
    this.selectRect = null // {x0,z0,x1,z1,mode}

    // 轨道相机
    this.cam = { yaw: -Math.PI * 0.22, pitch: 0.78, dist: 52, target: [0, 0, 0] }
    this.drag = null

    this._createPipelines()
    this._createTerrainGeometry()
    this._createOverlayBuffers()
    this._bindInput()
  }

  // ---------- 矩阵工具（列主序，适配 WGSL） ----------
  static perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2)
    const nf = 1 / (near - far)
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, far * nf, -1,
      0, 0, near * far * nf, 0
    ])
  }
  static lookAt(eye, target, up) {
    const z = norm3(sub3(eye, target))
    const x = norm3(cross3(up, z))
    const y = cross3(z, x)
    return new Float32Array([
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1
    ])
  }
  static mul(a, b) {
    const o = new Float32Array(16)
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] =
          a[0 * 4 + r] * b[c * 4 + 0] +
          a[1 * 4 + r] * b[c * 4 + 1] +
          a[2 * 4 + r] * b[c * 4 + 2] +
          a[3 * 4 + r] * b[c * 4 + 3]
      }
    }
    return o
  }

  _createPipelines() {
    const d = this.device
    this.cameraBuf = d.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.terrainUniformBuf = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })

    const terrainModule = d.createShaderModule({ code: TERRAIN_VERT + TERRAIN_FRAG })
    this.terrainPipeline = d.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: terrainModule,
        entryPoint: 'vs_main',
        buffers: [
          { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
          { arrayStride: 4, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32' }] },
          { arrayStride: 12, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x3' }] }
        ]
      },
      fragment: { module: terrainModule, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' }
    })
    this.terrainBind = d.createBindGroup({
      layout: this.terrainPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.cameraBuf } },
        { binding: 1, resource: { buffer: this.terrainUniformBuf } }
      ]
    })

    const lineModule = d.createShaderModule({ code: LINE_VERT + LINE_FRAG })
    this.linePipeline = d.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: lineModule,
        entryPoint: 'vs_main',
        buffers: [{ arrayStride: 28, attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x4' }
        ] }]
      },
      fragment: { module: lineModule, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'line-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' }
    })
    this.lineBind = d.createBindGroup({
      layout: this.linePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.cameraBuf } }]
    })

    // 水面（半透明蓝）
    this.waterPipeline = d.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: lineModule,
        entryPoint: 'vs_main',
        buffers: [{ arrayStride: 28, attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x4' }
        ] }]
      },
      fragment: { module: lineModule, entryPoint: 'fs_main', targets: [{
        format: this.format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
        }
      }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' }
    })
    this.waterBind = this.lineBind
  }

  /** 静态几何：xz 位置 + barycentric；高度每帧从 engine 写入独立 buffer */
  _createTerrainGeometry() {
    const d = this.device
    const xz = new Float32Array(V * V * 2)
    const bary = new Float32Array(V * V * 3)
    for (let k = 0; k < V; k++) {
      for (let i = 0; i < V; i++) {
        const n = k * V + i
        xz[n * 2] = -HALF + i * CELL_STEP
        xz[n * 2 + 1] = -HALF + k * CELL_STEP
        // barycentric：顶点按 (i+k)%3 循环赋 (1,0,0)/(0,1,0)/(0,0,1)。
        // 索引三角化中每个三角形的三个顶点余数恰为 r、r+1、r+2（模 3），
        // 因此每边都有一个坐标恒为 0 的顶点，描边连续且共享顶点取值一致。
        const r = (i + k) % 3
        bary[n * 3] = r === 0 ? 1 : 0
        bary[n * 3 + 1] = r === 1 ? 1 : 0
        bary[n * 3 + 2] = r === 2 ? 1 : 0
      }
    }
    const indices = new Uint32Array(CELLS_PER_SIDE * CELLS_PER_SIDE * 6)
    let p = 0
    for (let k = 0; k < CELLS_PER_SIDE; k++) {
      for (let i = 0; i < CELLS_PER_SIDE; i++) {
        const a = k * V + i
        const b = a + 1
        const c = a + V
        const dd = c + 1
        indices[p++] = a
        indices[p++] = b
        indices[p++] = c
        indices[p++] = b
        indices[p++] = dd
        indices[p++] = c
      }
    }
    this.vtxCount = indices.length
    this.xzBuf = d.createBuffer({ size: xz.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
    d.queue.writeBuffer(this.xzBuf, 0, xz)
    this.baryBuf = d.createBuffer({ size: bary.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
    d.queue.writeBuffer(this.baryBuf, 0, bary)
    this.heightBuf = d.createBuffer({
      size: this.engine.heights.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    })
    this.idxBuf = d.createBuffer({ size: indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST })
    d.queue.writeBuffer(this.idxBuf, 0, indices)
  }

  _createOverlayBuffers() {
    const d = this.device
    // 动态线缓冲：64 区块框 + 悬停 + 拖框，预留 4096 顶点
    this.lineCap = 4096
    this.lineBuf = d.createBuffer({
      size: this.lineCap * 28,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    })
    this.waterBuf = d.createBuffer({ size: 6 * 28, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
    this.lineData = []
  }

  /** 每帧把引擎最新高度上传 GPU */
  uploadHeights() {
    this.device.queue.writeBuffer(this.heightBuf, 0, this.engine.heights)
  }

  // ---------- 覆盖线 ----------
  _line(x1, y1, z1, x2, y2, z2, color) {
    this.lineData.push(x1, y1, z1, ...color, x2, y2, z2, ...color)
  }
  _rect(cx, cz, size, y, color) {
    const h = size / 2
    const x0 = cx - h
    const x1 = cx + h
    const z0 = cz - h
    const z1 = cz + h
    this._line(x0, y, z0, x1, y, z0, color)
    this._line(x1, y, z0, x1, y, z1, color)
    this._line(x1, y, z1, x0, y, z1, color)
    this._line(x0, y, z1, x0, y, z0, color)
  }

  _buildOverlay() {
    this.lineData = []
    const topY = 3.2
    const eng = this.engine
    for (const ch of eng.chunks) {
      const cx = -HALF + (ch.cx + 0.5) * CHUNK_SIZE
      const cz = -HALF + (ch.cz + 0.5) * CHUNK_SIZE
      if (ch.locked) {
        this._rect(cx, cz, CHUNK_SIZE, topY, [1.0, 0.62, 0.12, 0.95]) // 橙：锁定
      } else if (ch.edited) {
        this._rect(cx, cz, CHUNK_SIZE, topY, [0.95, 0.45, 0.85, 0.8]) // 粉：编辑过
      } else {
        this._rect(cx, cz, CHUNK_SIZE, topY, [0.75, 0.85, 1.0, 0.28]) // 淡蓝：常规网格
      }
    }
    if (this.hoverChunk >= 0) {
      const ch = eng.chunks[this.hoverChunk]
      const cx = -HALF + (ch.cx + 0.5) * CHUNK_SIZE
      const cz = -HALF + (ch.cz + 0.5) * CHUNK_SIZE
      this._rect(cx, cz, CHUNK_SIZE, topY + 0.05, [0.2, 0.9, 1.0, 1])
    }
    if (this.selectRect) {
      const r = this.selectRect
      const col = r.mode === 'lock' ? [1, 0.55, 0.1, 1] : [0.4, 0.9, 0.5, 1]
      this._line(r.x0, topY + 0.1, r.z0, r.x1, topY + 0.1, r.z0, col)
      this._line(r.x1, topY + 0.1, r.z0, r.x1, topY + 0.1, r.z1, col)
      this._line(r.x1, topY + 0.1, r.z1, r.x0, topY + 0.1, r.z1, col)
      this._line(r.x0, topY + 0.1, r.z1, r.x0, topY + 0.1, r.z0, col)
    }
    // 涉水池水面
    if (this.showWater && eng.params.waterDepth > 0) {
      const w = eng.layout.water
      this._buildWater(w, eng.params.waterDepth)
    }
    const maxFloats = this.lineCap * 7
    if (this.lineData.length > maxFloats) this.lineData.length = maxFloats
    const data = new Float32Array(this.lineData)
    this.device.queue.writeBuffer(this.lineBuf, 0, data)
    this.lineVerts = data.length / 7
  }

  _buildWater(w, depth) {
    const c = Math.cos(w.ang)
    const s = Math.sin(w.ang)
    const corners = [
      [-w.sx, -w.sz], [w.sx, -w.sz], [w.sx, w.sz], [-w.sx, w.sz]
    ].map(([lx, lz]) => [w.cx + lx * c - lz * s, -0.02, w.cz + lx * s + lz * c])
    const col = [0.18, 0.45, 0.85, 0.45]
    const tri = [corners[0], corners[1], corners[2], corners[0], corners[2], corners[3]]
    const data = new Float32Array(tri.length * 7)
    tri.forEach((v, i) => {
      data.set([...v, ...col], i * 7)
    })
    this.device.queue.writeBuffer(this.waterBuf, 0, data)
    this.waterVerts = tri.length
  }

  // ---------- 相机 ----------
  _eye() {
    const { yaw, pitch, dist, target } = this.cam
    return [
      target[0] + dist * Math.cos(pitch) * Math.sin(yaw),
      target[1] + dist * Math.sin(pitch),
      target[2] + dist * Math.cos(pitch) * Math.cos(yaw)
    ]
  }
  _updateCamera() {
    const aspect = this.canvas.clientWidth / this.canvas.clientHeight
    const eye = this._eye()
    const view = TerrainRenderer.lookAt(eye, this.cam.target, [0, 1, 0])
    const proj = TerrainRenderer.perspective((50 * Math.PI) / 180, aspect, 0.1, 300)
    const vp = TerrainRenderer.mul(proj, view)
    const buf = new Float32Array(20)
    buf.set(vp, 0)
    buf.set(eye, 16)
    this.device.queue.writeBuffer(this.cameraBuf, 0, buf)
    this._eyePos = eye
  }

  // ---------- 输入 ----------
  _bindInput() {
    const c = this.canvas
    c.addEventListener('pointerdown', (e) => this._onDown(e))
    c.addEventListener('pointermove', (e) => this._onMove(e))
    window.addEventListener('pointerup', (e) => this._onUp(e))
    c.addEventListener('wheel', (e) => {
      e.preventDefault()
      this.cam.dist = clamp(this.cam.dist * (1 + Math.sign(e.deltaY) * 0.08), 12, 140)
    }, { passive: false })
    c.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  /** 屏幕坐标 → 地面 y=0 射线交点（用于框选/笔刷定位） */
  screenToGround(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect()
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1
    const ndcY = 1 - ((clientY - rect.top) / rect.height) * 2
    const eye = this._eye()
    // 反投影近/远点构造射线
    const aspect = rect.width / rect.height
    const fov = (50 * Math.PI) / 180
    const tanF = Math.tan(fov / 2)
    const fwd = norm3(sub3(this.cam.target, eye))
    const right = norm3(cross3(fwd, [0, 1, 0]))
    const up = cross3(right, fwd)
    const rayDir = norm3(add3(
      add3(fwd, scale3(right, ndcX * tanF * aspect)),
      scale3(up, ndcY * tanF)
    ))
    if (Math.abs(rayDir[1]) < 1e-5) return null
    const t = -eye[1] / rayDir[1]
    if (t < 0) return null
    const pt = add3(eye, scale3(rayDir, t))
    return { x: clamp(pt[0], -HALF, HALF), z: clamp(pt[2], -HALF, HALF) }
  }

  _onDown(e) {
    try {
      this.canvas.setPointerCapture(e.pointerId)
    } catch {
      // 合成事件或指针已释放时 pointerId 可能无效，不影响后续坐标交互
    }
    const pt = this.screenToGround(e.clientX, e.clientY)
    if (e.button === 2 || e.shiftKey) {
      // 右键/shift：平移相机
      this.drag = { type: 'pan', x: e.clientX, y: e.clientY }
      return
    }
    this.drag = {
      type: e.button === 1 ? 'pan' : 'interact',
      x: e.clientX,
      y: e.clientY,
      start: pt,
      moved: false
    }
    this.pointerDown = { x: e.clientX, y: e.clientY, pt, button: e.button }
  }

  _onMove(e) {
    const pt = this.screenToGround(e.clientX, e.clientY)
    if (pt) {
      const ch = this.engine.chunkAtWorld(pt.x, pt.z)
      this.hoverChunk = ch ? ch.id : -1
      this.cursorPoint = pt
    }
    if (!this.drag) {
      this.emitHover?.(pt)
      return
    }    if (this.drag.type === 'pan') {
      const dx = e.clientX - this.drag.x
      const dy = e.clientY - this.drag.y
      this.drag.x = e.clientX
      this.drag.y = e.clientY
      const fwd = norm3(sub3(this.cam.target, this._eye()))
      const right = norm3(cross3(fwd, [0, 1, 0]))
      const k = this.cam.dist * 0.0016
      this.cam.target = add3(this.cam.target, add3(scale3(right, -dx * k), scale3([0, 1, 0], dy * k)))
      return
    }
    if (Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) > 4) this.drag.moved = true
    if (this.drag.moved && this.drag.start && pt) {
      const mode = this.lockMode || 'lock'
      this.selectRect = { x0: this.drag.start.x, z0: this.drag.start.z, x1: pt.x, z1: pt.z, mode }
    }
    this.emitHover?.(pt)
  }

  _onUp(e) {
    if (!this.drag) return
    const drag = this.drag
    this.drag = null
    if (drag.type === 'interact') {
      if (drag.moved && this.selectRect) {
        const r = this.selectRect
        this.onSelectRect?.(r)
        this.selectRect = null
      } else {
        const pt = this.screenToGround(e.clientX, e.clientY)
        if (pt) this.onClickGround?.(pt, e)
      }
    }
  }

  // ---------- 渲染 ----------
  frame() {
    this._updateCamera()
    this.uploadHeights()
    this._buildOverlay()
    this.device.queue.writeBuffer(this.terrainUniformBuf, 0, new Float32Array([
      -1.2, 3.0, this.wireframe ? 1 : 0, this.showSlope ? 1 : 0
    ]))

    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (!this._depth || this._depth.width !== w || this._depth.height !== h) {
      this._depth?.texture.destroy()
      const texture = this.device.createTexture({
        size: [w, h],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT
      })
      this._depth = { texture, view: texture.createView(), width: w, height: h }
    }

    const encoder = this.device.createCommandEncoder()
    const view = this.context.getCurrentTexture().createView()
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: { r: 0.07, g: 0.09, b: 0.12, a: 1 },
        loadOp: 'clear',
        storeOp: 'store'
      }],
      depthStencilAttachment: {
        view: this._depth.view,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard'
      }
    })
    pass.setPipeline(this.terrainPipeline)
    pass.setBindGroup(0, this.terrainBind)
    pass.setVertexBuffer(0, this.xzBuf)
    pass.setVertexBuffer(1, this.heightBuf)
    pass.setVertexBuffer(2, this.baryBuf)
    pass.setIndexBuffer(this.idxBuf, 'uint32')
    pass.drawIndexed(this.vtxCount)

    if (this.waterVerts) {
      pass.setPipeline(this.waterPipeline)
      pass.setBindGroup(0, this.waterBind)
      pass.setVertexBuffer(0, this.waterBuf)
      pass.draw(this.waterVerts)
    }

    pass.setPipeline(this.linePipeline)
    pass.setBindGroup(0, this.lineBind)
    pass.setVertexBuffer(0, this.lineBuf)
    pass.draw(this.lineVerts || 0)
    pass.end()
    this.device.queue.submit([encoder.finish()])
  }
}

// 向量小工具
function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function add3(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }
function scale3(a, k) { return [a[0] * k, a[1] * k, a[2] * k] }
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function norm3(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
