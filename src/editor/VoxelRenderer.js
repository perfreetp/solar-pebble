/**
 * WebGL2 体素渲染器。
 *
 * 渲染管线：
 *   1) 区块化贪心网格（32³），编辑后只重建脏区块；
 *   2) 主着色：半球光 + 方向主光 + 相机补光 + 顶点 AO + 层高亮；
 *   3) 叠加线框：地面网格、选区框、悬停体素、体检标记。
 *
 * 所有颜色走 sRGB→linear，最终一次 ACES 近似 tonemap 输出。
 */

import { greedyQuads, quadsToBuffers } from '../../shared/mesh.js';

const CHUNK = 32;

export class VoxelRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: true,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2，无法启动三维视图');
    this.gl = gl;
    this.models = new Map(); // chunkKey -> VaoBundle
    this.model = null;
    this.revisionSeen = -1;
    this.dirty = new Set();
    this.camera = {
      // 轨道相机：以模型中心为焦点
      yaw: -0.62,
      pitch: 0.42,
      distance: 62,
      target: [0, 0, 6],
      fov: 42,
    };
    this.opts = {
      layerMin: 1,
      layerMax: 999,
      focusLayers: null, // Set<number> | null
      hiddenLayers: new Set(),
      mirrorPlane: null,
      showGrid: true,
      showGhost: true,
      ghostBelow: false,
      shading: 'material',
      exposure: 1.12,
      showMarkers: true,
      sectionZ: null,
    };
    this.markers = [];
    this.hover = null;
    this.selection = null;
    this.initGl();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement || canvas);
    this.resize();
  }

  // ------------------------------------------------------------- 着色器

  initGl() {
    const gl = this.gl;
    this.progBody = this.createProgram(BODY_VS, BODY_FS);
    this.progLines = this.createProgram(LINE_VS, LINE_FS);

    this.uniformsBody = this.uniformNames(this.progBody, [
      'uViewProj', 'uCamPos', 'uExposure', 'uLayerMin', 'uLayerMax', 'uFocusMode', 'uMirrorPlane',
      'uShading', 'uGhost', 'uVoxel', 'uOrigin', 'uHighlight', 'uHover', 'uLayerFade',
    ]);
    this.uniformsLines = this.uniformNames(this.progLines, ['uViewProj', 'uColor', 'uAlpha', 'uWidth']);

    // 线段批缓冲（网格地面、选中框、标记）
    this.lineBuf = gl.createBuffer();
    this.lineVao = gl.createVertexArray();
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0.043, 0.05, 0.063, 1);
  }

  createProgram(vsSrc, fsSrc) {
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        throw new Error(`着色器编译失败：${log}\n${src.slice(0, 400)}`);
      }
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`着色器链接失败：${gl.getProgramInfoLog(p)}`);
    }
    return p;
  }

  uniformNames(prog, names) {
    const out = {};
    for (const n of names) out[n] = this.gl.getUniformLocation(prog, n);
    return out;
  }

  // ------------------------------------------------------------- 模型装载

  setModel(model) {
    if (this.model === model) {
      this.syncDirty();
      return;
    }
    this.clearChunks();
    this.model = model;
    this.rebuildAll();
  }

  clearChunks() {
    const gl = this.gl;
    for (const c of this.models.values()) {
      gl.deleteVertexArray(c.vao);
      gl.deleteBuffer(c.pos);
      gl.deleteBuffer(c.nrm);
      gl.deleteBuffer(c.col);
      gl.deleteBuffer(c.ext);
      gl.deleteBuffer(c.ibo);
    }
    this.models.clear();
  }

  chunkKey(x, y, z) {
    return `${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)},${Math.floor(z / CHUNK)}`;
  }

  touchVoxel(x, y, z) {
    if (!this.model) return;
    const { sizeX, sizeY, sizeZ } = this.model;
    for (let dz = -1; dz <= 1; dz += 2) {
      for (let dy = -1; dy <= 1; dy += 2) {
        for (let dx = -1; dx <= 1; dx += 2) {
          const nx = Math.min(sizeX - 1, Math.max(0, x + dx));
          const ny = Math.min(sizeY - 1, Math.max(0, y + dy));
          const nz = Math.min(sizeZ - 1, Math.max(0, z + dz));
          this.dirty.add(this.chunkKey(nx, ny, nz));
        }
      }
    }
    this.dirty.add(this.chunkKey(x, y, z));
  }

  rebuildAll() {
    const m = this.model;
    if (!m) return;
    this.clearChunks();
    const nx = Math.ceil(m.sizeX / CHUNK);
    const ny = Math.ceil(m.sizeY / CHUNK);
    const nz = Math.ceil(m.sizeZ / CHUNK);
    for (let cz = 0; cz < nz; cz++) {
      for (let cy = 0; cy < ny; cy++) {
        for (let cx = 0; cx < nx; cx++) {
          const key = `${cx},${cy},${cz}`;
          this.buildChunk(key, [cx * CHUNK, cy * CHUNK, cz * CHUNK]);
        }
      }
    }
    this.dirty.clear();
    this.revisionSeen = m.revision;
  }

  syncDirty() {
    if (!this.model) return;
    if (this.dirty.size) {
      for (const key of this.dirty) {
        const parts = key.split(',').map(Number);
        this.buildChunk(key, [parts[0] * CHUNK, parts[1] * CHUNK, parts[2] * CHUNK]);
      }
      this.dirty.clear();
    }
  }

  buildChunk(key, origin) {
    const gl = this.gl;
    const m = this.model;
    const min = origin;
    const max = [
      Math.min(origin[0] + CHUNK - 1, m.sizeX - 1),
      Math.min(origin[1] + CHUNK - 1, m.sizeY - 1),
      Math.min(origin[2] + CHUNK - 1, m.sizeZ - 1),
    ];
    // 隐藏层不生成面；邻居查询由 quadsToBuffers 的手工 AO 负责，仍基于真实数据
    const quads = greedyQuads(m, {
      min,
      max,
      visible: (z) => !this.opts.hiddenLayers.has(z + 1),
    });
    const existing = this.models.get(key);
    if (!quads.length) {
      if (existing) this.deleteChunk(key);
      return;
    }
    const buf = quadsToBuffers(m, quads);
    if (existing) this.deleteChunk(key);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const mk = (data, size, target, type) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return b;
    };
    const pos = mk(buf.positions);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    const nrm = mk(buf.normals);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.BYTE, true, 3, 0);
    const col = mk(buf.colors);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.UNSIGNED_BYTE, true, 3, 0);
    const ext = mk(buf.extras);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 2, gl.UNSIGNED_BYTE, true, 2, 0);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, buf.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.models.set(key, {
      vao, pos, nrm, col, ext, ibo,
      count: buf.indices.length,
      quads: buf.quadCount,
      origin,
    });
  }

  deleteChunk(key) {
    const gl = this.gl;
    const c = this.models.get(key);
    if (!c) return;
    gl.deleteVertexArray(c.vao);
    gl.deleteBuffer(c.pos);
    gl.deleteBuffer(c.nrm);
    gl.deleteBuffer(c.col);
    gl.deleteBuffer(c.ext);
    gl.deleteBuffer(c.ibo);
    this.models.delete(key);
  }

  // ------------------------------------------------------------- 相机

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
    }
    this.width = w;
    this.height = h;
    this.dpr = dpr;
  }

  get viewProj() {
    const c = this.camera;
    const aspect = this.width / Math.max(1, this.height);
    const cp = Math.cos(c.pitch);
    const eye = [
      c.target[0] + c.distance * Math.cos(c.yaw) * cp,
      c.target[1] + c.distance * Math.sin(c.yaw) * cp,
      c.target[2] + c.distance * Math.sin(c.pitch),
    ];
    this.eye = eye;
    const view = lookAt(eye, c.target, [0, 0, 1]);
    const proj = perspective((c.fov * Math.PI) / 180, aspect, 0.3, 1200);
    return { m: mul(proj, view), view, proj, eye };
  }

  /** 屏幕坐标（CSS 像素）→ 世界射线 */
  screenRay(px, py) {
    const { m, eye } = this.viewProj;
    const ndcX = (px / this.width) * 2 - 1;
    const ndcY = 1 - (py / this.height) * 2;
    const inv = invert(m);
    if (!inv) return null;
    const p0 = unproject(inv, [ndcX, ndcY, -1]);
    const p1 = unproject(inv, [ndcX, ndcY, 1]);
    const dir = norm(sub(p1, p0));
    return { origin: eye, dir };
  }

  /** 射线与模型网格做 DDA 体素穿越，返回命中的体素与进入面。 */
  pickVoxel(px, py) {
    const m = this.model;
    if (!m) return null;
    const ray = this.screenRay(px, py);
    if (!ray) return null;
    const s = m.voxelSize;
    const ox = -(m.sizeX * s) / 2;
    const oy = -(m.sizeY * s) / 2;
    // 转到体素空间
    const p = [(ray.origin[0] - ox) / s, (ray.origin[1] - oy) / s, ray.origin[2] / s];
    const d = [ray.dir[0] / s, ray.dir[1] / s, ray.dir[2] / s];
    const maxT = 1200;

    const bounds = [0, 0, 0, m.sizeX, m.sizeY, m.sizeZ];
    const enter = intersectAabb(p, d, bounds);
    if (!enter) return null;

    const nudge = 1e-4;
    const t0 = Math.max(0, enter.tmin) + nudge;
    let x = Math.floor(p[0] + d[0] * t0);
    let y = Math.floor(p[1] + d[1] * t0);
    let z = Math.floor(p[2] + d[2] * t0);

    const stepX = d[0] > 0 ? 1 : -1;
    const stepY = d[1] > 0 ? 1 : -1;
    const stepZ = d[2] > 0 ? 1 : -1;
    const tDeltaX = Math.abs(1 / (d[0] || 1e-12));
    const tDeltaY = Math.abs(1 / (d[1] || 1e-12));
    const tDeltaZ = Math.abs(1 / (d[2] || 1e-12));
    const boundary = (i, dir) => (dir > 0 ? i + 1 : i);
    let tMaxX = Math.abs((boundary(x, d[0]) - p[0]) / (d[0] || 1e-12));
    let tMaxY = Math.abs((boundary(y, d[1]) - p[1]) / (d[1] || 1e-12));
    let tMaxZ = Math.abs((boundary(z, d[2]) - p[2]) / (d[2] || 1e-12));
    let t = t0;
    let face = [0, 0, 1];
    let guard = 0;

    const inside = () => x >= 0 && y >= 0 && z >= 0 && x < m.sizeX && y < m.sizeY && z < m.sizeZ;

    while (guard++ < 3000) {
      if (!inside()) return null;
      if (!this.opts.hiddenLayers.has(z + 1)) {
        const mat = m.get(x, y, z);
        if (mat !== 0) return { x, y, z, mat, face, distance: t };
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
        face = [-stepX, 0, 0];
      } else if (tMaxY < tMaxZ) {
        y += stepY;
        t = tMaxY;
        tMaxY += tDeltaY;
        face = [0, -stepY, 0];
      } else {
        z += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        face = [0, 0, -stepZ];
      }
      if (t > maxT) return null;
    }
    return null;
  }

  /** 射线与某一 Z 层平面求交，用于“在空白处落点”。 */
  pickLayerPlane(px, py, zLevel) {
    const m = this.model;
    if (!m) return null;
    const ray = this.screenRay(px, py);
    if (!ray) return null;
    const s = m.voxelSize;
    const zWorld = zLevel * s;
    if (Math.abs(ray.dir[2]) < 1e-6) return null;
    const t = (zWorld - ray.origin[2]) / ray.dir[2];
    if (t <= 0) return null;
    const wx = ray.origin[0] + ray.dir[0] * t;
    const wy = ray.origin[1] + ray.dir[1] * t;
    const ox = -(m.sizeX * s) / 2;
    const oy = -(m.sizeY * s) / 2;
    const x = Math.floor((wx - ox) / s);
    const y = Math.floor((wy - oy) / s);
    if (x < 0 || y < 0 || x >= m.sizeX || y >= m.sizeY) return null;
    return { x, y, z: zLevel, mat: 0, face: [0, 0, 1], distance: t };
  }

  // ------------------------------------------------------------- 渲染

  render(interactive = true) {
    const gl = this.gl;
    if (!this.model) return;
    this.syncDirty();
    this.resize();
    const { m: viewProj, eye } = this.viewProj;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // 主着色
    const p = this.progBody;
    gl.useProgram(p);
    const u = this.uniformsBody;
    gl.uniformMatrix4fv(u.uViewProj, false, viewProj);
    gl.uniform3fv(u.uCamPos, eye);
    gl.uniform1f(u.uExposure, this.opts.exposure);
    gl.uniform1f(u.uLayerMin, this.opts.layerMin);
    gl.uniform1f(u.uLayerMax, this.opts.layerMax);
    gl.uniform1f(u.uFocusMode, this.opts.focusLayers ? 1 : 0);
    gl.uniform1f(u.uMirrorPlane, this.opts.mirrorPlane ? this.opts.mirrorPlane * this.model.voxelSize - (this.model.sizeX * this.model.voxelSize) / 2 : -9999);
    gl.uniform1f(u.uShading, this.opts.shading === 'normals' ? 1 : this.opts.shading === 'layers' ? 2 : 0);
    gl.uniform1i(u.uGhost, this.opts.showGhost ? 1 : 0);
    gl.uniform1f(u.uVoxel, this.model.voxelSize);
    gl.uniform3f(u.uOrigin, -(this.model.sizeX * this.model.voxelSize) / 2, -(this.model.sizeY * this.model.voxelSize) / 2, 0);
    gl.uniform1f(u.uLayerFade, this.opts.focusLayers ? 1 : 0);

    for (const chunk of this.models.values()) {
      if (!chunk.count) continue;
      gl.bindVertexArray(chunk.vao);
      gl.drawElements(gl.TRIANGLES, chunk.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);

    // 网格与标记线
    if (this.opts.showGrid) this.drawGrid(viewProj);
    this.drawLines(viewProj, eye);
  }

  drawGrid(viewProj) {
    const gl = this.gl;
    const m = this.model;
    if (!m) return;
    const s = m.voxelSize;
    const ex = (m.sizeX * s) / 2;
    const ey = (m.sizeY * s) / 2;
    const verts = [];
    const step = s * 8;
    for (let x = -ex; x <= ex + 1e-6; x += step) {
      verts.push(x, -ey, 0, 0.13, 0.155, 0.19, x, ey, 0, 0.13, 0.155, 0.19);
    }
    for (let y = -ey; y <= ey + 1e-6; y += step) {
      verts.push(-ex, y, 0, 0.13, 0.155, 0.19, ex, y, 0, 0.13, 0.155, 0.19);
    }
    // 边界
    const edge = [0.26, 0.3, 0.36];
    const corners = [
      [-ex, -ey], [ex, -ey], [ex, ey], [-ex, ey],
    ];
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      verts.push(a[0], a[1], 0, ...edge, b[0], b[1], 0, ...edge);
    }
    // 中轴线（镜像轴高亮）
    const mirrorX = this.opts.mirrorPlane ? this.opts.mirrorPlane * s - ex : 0;
    if (this.opts.mirrorPlane) {
      verts.push(mirrorX, -ey, 0, 0.24, 0.62, 0.54, mirrorX, ey, 0, 0.24, 0.62, 0.54);
    }
    this.drawLineArray(verts, viewProj, 1.0);
  }

  drawLineArray(verts, viewProj, alpha = 1) {
    const gl = this.gl;
    if (!verts.length) return;
    const data = new Float32Array(verts);
    gl.useProgram(this.progLines);
    const u = this.uniformsLines;
    gl.uniformMatrix4fv(u.uViewProj, false, viewProj);
    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform1f(u.uWidth, 1.0);
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawArrays(gl.LINES, 0, data.length / 6);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  drawLines(viewProj, eye) {
    const m = this.model;
    if (!m) return;
    const s = m.voxelSize;
    const ox = -(m.sizeX * s) / 2;
    const oy = -(m.sizeY * s) / 2;
    const verts = [];

    const pushBox = (bx, color, inflate = 0) => {
      const x0 = ox + bx.x0 * s - inflate;
      const y0 = oy + bx.y0 * s - inflate;
      const z0 = bx.z0 * s - inflate;
      const x1 = ox + (bx.x1 + 1) * s + inflate;
      const y1 = oy + (bx.y1 + 1) * s + inflate;
      const z1 = (bx.z1 + 1) * s + inflate;
      const c = color;
      const pts = [
        [x0, y0, z0, x1, y0, z0], [x1, y0, z0, x1, y1, z0], [x1, y1, z0, x0, y1, z0], [x0, y1, z0, x0, y0, z0],
        [x0, y0, z1, x1, y0, z1], [x1, y0, z1, x1, y1, z1], [x1, y1, z1, x0, y1, z1], [x0, y1, z1, x0, y0, z1],
        [x0, y0, z0, x0, y0, z1], [x1, y0, z0, x1, y0, z1], [x1, y1, z0, x1, y1, z1], [x0, y1, z0, x0, y1, z1],
      ];
      for (const seg of pts) verts.push(seg[0], seg[1], seg[2], ...c, seg[3], seg[4], seg[5], ...c);
    };

    // 选中框
    if (this.selection && this.selection.box && this.opts.showMarkers) {
      pushBox(this.selection.box, [0.45, 0.95, 0.85], 0.02);
    }
    // 悬停体素
    if (this.hover && this.opts.showMarkers) {
      pushBox({ x0: this.hover.x, y0: this.hover.y, z0: this.hover.z, x1: this.hover.x, y1: this.hover.y, z1: this.hover.z }, [1, 1, 1], 0.015);
    }
    // 体检标记
    if (this.opts.showMarkers) {
      for (const mk of this.markers) {
        if (!mk.bbox) continue;
        const color = mk.severity === 'error' ? [1, 0.36, 0.38] : [1, 0.72, 0.32];
        pushBox(mk.bbox, color, 0.05);
      }
    }
    // 当前编辑层平面
    if (this.opts.sectionZ !== null && this.opts.showMarkers) {
      const z = this.opts.sectionZ * s;
      const ex = (m.sizeX * s) / 2;
      const ey = (m.sizeY * s) / 2;
      const c = [0.4, 0.9, 0.8];
      verts.push(-ex, -ey, z, ...c, ex, -ey, z, ...c, ex, -ey, z, ...c, ex, ey, z, ...c);
      verts.push(ex, ey, z, ...c, -ex, ey, z, ...c, -ex, ey, z, ...c, -ex, -ey, z, ...c);
    }

    this.drawLineArray(verts, viewProj, 0.95);
  }

  // ------------------------------------------------------------- 交互

  orbit(dx, dy) {
    const c = this.camera;
    c.yaw -= dx * 0.008;
    c.pitch = Math.max(-1.4, Math.min(1.45, c.pitch + dy * 0.008));
  }

  pan(dx, dy) {
    const c = this.camera;
    const scale = (c.distance * 0.0016);
    const right = [Math.sin(c.yaw), -Math.cos(c.yaw), 0];
    const upv = [-Math.sin(c.pitch) * Math.cos(c.yaw), -Math.sin(c.pitch) * Math.sin(c.yaw), Math.cos(c.pitch)];
    const k = 0.8;
    for (let i = 0; i < 3; i++) {
      c.target[i] += (-right[i] * dx + upv[i] * dy) * scale * k;
    }
  }

  zoom(delta) {
    const c = this.camera;
    c.distance = Math.max(6, Math.min(320, c.distance * Math.exp(delta * 0.0015)));
  }

  /** 把包围盒放到画面里：按包围球 + 竖直 FOV 求距离，留 12% 边距。 */
  fitBounds(box, margin = 1.12) {
    if (!box || !this.model) return;
    const s = this.model.voxelSize;
    const ox = -(this.model.sizeX * s) / 2;
    const oy = -(this.model.sizeY * s) / 2;
    const w = (box.x1 - box.x0 + 1) * s;
    const d = (box.y1 - box.y0 + 1) * s;
    const h = (box.z1 - box.z0 + 1) * s;
    this.camera.target = [
      ox + ((box.x0 + box.x1 + 1) / 2) * s,
      oy + ((box.y0 + box.y1 + 1) / 2) * s,
      ((box.z0 + box.z1 + 1) / 2) * s,
    ];
    // 精确取景：把包围盒 8 个角投到相机基上，求恰好装下它们的最小距离。
    // （用包围球会让扁平模型显得很远，这里按实际投影算。）
    const c = this.camera;
    const cp = Math.cos(c.pitch);
    const dir = [
      Math.cos(c.yaw) * cp,
      Math.sin(c.yaw) * cp,
      Math.sin(c.pitch),
    ];
    const right = [Math.sin(c.yaw), -Math.cos(c.yaw), 0];
    const up = cross(dir, right);
    const fovV = (c.fov * Math.PI) / 180;
    const aspect = Math.max(0.2, this.width / Math.max(1, this.height));
    const tanV = Math.tan(fovV / 2);
    const tanH = tanV * aspect;

    const x0 = ox + box.x0 * s;
    const x1 = ox + (box.x1 + 1) * s;
    const y0 = oy + box.y0 * s;
    const y1 = oy + (box.y1 + 1) * s;
    const z0 = box.z0 * s;
    const z1 = (box.z1 + 1) * s;

    let need = 6;
    for (let i = 0; i < 8; i++) {
      const px = i & 1 ? x1 : x0;
      const py = i & 2 ? y1 : y0;
      const pz = i & 4 ? z1 : z0;
      const qx = px - this.camera.target[0];
      const qy = py - this.camera.target[1];
      const qz = pz - this.camera.target[2];
      const along = qx * dir[0] + qy * dir[1] + qz * dir[2];
      const sx = Math.abs(qx * right[0] + qy * right[1] + qz * right[2]);
      const sy = Math.abs(qx * up[0] + qy * up[1] + qz * up[2]);
      need = Math.max(need, along + (sx / tanH) * margin, along + (sy / tanV) * margin);
    }
    c.distance = Math.max(6, Math.min(400, need));
  }

  focusBox(box) {
    this.fitBounds(box, 1.35);
  }

  frameAll() {
    if (!this.model) return;
    // 取景依赖画布尺寸，先同步一次，否则首次进入会用旧的宽高比
    this.resize();
    const b = this.model.occupancyBounds() || {
      x0: 0, y0: 0, z0: 0, x1: this.model.sizeX - 1, y1: this.model.sizeY - 1, z1: this.model.sizeZ - 1,
    };
    this.fitBounds(b, 1.04);
  }

  setTopView() {
    const c = this.camera;
    c.pitch = 1.35;
    c.yaw = -Math.PI / 2;
  }

  setSideView() {
    const c = this.camera;
    c.pitch = 0.12;
    c.yaw = -Math.PI / 2;
  }

  setIsoView() {
    const c = this.camera;
    c.pitch = 0.48;
    c.yaw = -0.62;
  }

  dispose() {
    this.resizeObserver.disconnect();
    this.clearChunks();
  }
}

// ------------------------------------------------------------------ 行内矩阵工具

function mul(a, b) {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
      o[i * 4 + j] = s;
    }
  }
  return o;
}

function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function lookAt(eye, center, up) {
  const z = norm(sub(eye, center));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

function invert(m) {
  const o = new Float32Array(16);
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1 / det;
  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return o;
}

function unproject(inv, ndc) {
  const out = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    out[i] = inv[i] * ndc[0] + inv[4 + i] * ndc[1] + inv[8 + i] * ndc[2] + inv[12 + i];
  }
  const w = out[3] || 1;
  return [out[0] / w, out[1] / w, out[2] / w];
}

function intersectAabb(p, d, b) {
  let tmin = -Infinity;
  let tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    const lo = b[i];
    const hi = b[i + 3];
    if (Math.abs(d[i]) < 1e-9) {
      if (p[i] < lo || p[i] > hi) return null;
    } else {
      let t1 = (lo - p[i]) / d[i];
      let t2 = (hi - p[i]) / d[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return { tmin, tmax };
}

// ------------------------------------------------------------------ 着色器源码

const BODY_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
layout(location=3) in vec2 aExtra;

uniform mat4 uViewProj;
uniform float uVoxel;

out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;
out float vAO;
out float vEmissive;
out float vLayer;

void main() {
  vWorld = aPos;
  vNormal = normalize(aNormal);
  vColor = aColor;
  vAO = aExtra.x;
  vEmissive = aExtra.y;
  vLayer = floor(aPos.z / uVoxel + 0.0001) + 1.0;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const BODY_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
in float vAO;
in float vEmissive;
in float vLayer;

uniform vec3 uCamPos;
uniform float uExposure;
uniform float uLayerMin;
uniform float uLayerMax;
uniform float uFocusMode;
uniform float uMirrorPlane;
uniform float uShading;
uniform vec3 uOrigin;
uniform float uVoxel;

out vec4 fragColor;

// 月面照明：上方是冷色天光，下方是暖色月壤反射，主光是低角度的暖白“太阳”。
const vec3 SKY = vec3(0.26, 0.34, 0.50);
const vec3 GROUND = vec3(0.26, 0.19, 0.13);
const vec3 KEY = vec3(1.0, 0.88, 0.72);
const vec3 RIM = vec3(0.40, 0.66, 1.0);

vec3 srgbToLinear(vec3 c) { return pow(c, vec3(2.2)); }

void main() {
  // 深色玄武岩的线性亮度只有 0.08 左右，直接照会糊成一团。
  // 这里给反照率一个温和的提亮（只影响观感，不写进 mtl），让材质层次读得出来。
  vec3 albedo = srgbToLinear(vColor) * 1.22;
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);
  vec3 L = normalize(vec3(0.45, 0.62, 0.75));

  float ndl = max(dot(N, L), 0.0);
  vec3 hemi = mix(GROUND, SKY, clamp(N.z * 0.5 + 0.5, 0.0, 1.0));

  // 相机方向的弱补光：只把背光面从死黑托起来，不改变体积感
  vec3 Vd = normalize(vWorld - uCamPos);
  float fill = max(dot(N, -Vd), 0.0);
  vec3 fillColor = vec3(0.46, 0.56, 0.74) * fill * 0.30;

  // 屏幕方向边缘光，让体素轮廓在暗背景上更清晰
  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.5);
  vec3 rimColor = RIM * rim * 0.16;

  float ao = clamp(vAO, 0.0, 1.0);
  // 向上的面吃天光、向下的面吃月壤反射，砖缝里由 AO 压暗
  vec3 lit = albedo * (hemi * 0.62 * ao + KEY * ndl * 0.95 + fillColor * ao) + rimColor * ao;
  lit += albedo * vEmissive * 1.5;

  // 层高亮：聚焦层之外压暗
  float band = step(uLayerMin - 0.5, vLayer) * step(vLayer, uLayerMax + 0.5);
  float dim = mix(1.0, 0.26, (1.0 - band) * uFocusMode);
  lit *= dim;
  // 当前层边界亮描边
  float edgeGlow = (1.0 - band) * uFocusMode * 0.0;

  // 镜像轴附近轻微高亮
  float mirrorProx = 1.0 - smoothstep(0.0, uVoxel * 2.2, abs(vWorld.x - uMirrorPlane));
  lit += vec3(0.10, 0.36, 0.30) * mirrorProx * 0.6;

  // 调试着色
  if (uShading > 1.5) {
    vec3 hp = vWorld / (uVoxel * 12.0);
    vec3 checker = mix(vec3(0.12,0.18,0.26), vec3(0.20,0.30,0.42), mod(floor(hp.x)+floor(hp.y)+floor(hp.z), 2.0));
    lit = checker * (0.6 + 0.4 * band) * ao;
  } else if (uShading > 0.5) {
    lit = N * 0.5 + 0.5;
  }

  // 简易 ACES 近似
  vec3 x = lit * uExposure;
  vec3 mapped = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  mapped = clamp(mapped, 0.0, 1.0);
  mapped = pow(mapped, vec3(1.0 / 2.2));
  fragColor = vec4(mapped, 1.0);
}`;

const LINE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aColor;
uniform mat4 uViewProj;
out vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const LINE_FS = `#version 300 es
precision highp float;
in vec3 vColor;
uniform float uAlpha;
out vec4 fragColor;
void main() { fragColor = vec4(vColor, uAlpha); }`;
