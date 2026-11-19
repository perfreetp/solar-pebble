// WebGPU renderer for the wing viewport.
//
// The scene from scene.js is a flat triangle list in artboard units. We draw it
// with one instanced "triangle" pipeline per paint group, batching each group
// into a single draw call. The view transform (zoom/pan) is a uniform.
//
// Rendering is MSAA 4x with a white-ish artboard card; the canvas is sized to
// the device pixel ratio (capped) so lines stay crisp while zooming.
//
// If WebGPU is unavailable the caller can fall back to canvas2d (see
// canvasFallback.js) — this module never throws during construction for that
// reason; it reports `available` instead.

import { ARTBOARD } from '../generator.js';

const SHADER = /* wgsl */ `
struct Uniforms {
  view: vec4f,    // scaleX, scaleY, offsetX, offsetY (artboard → clip)
  canvas: vec4f,  // width, height, dpr, time
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) color: vec4f,
};

@vertex
fn vs_main(
  @location(0) pos: vec2f,
  @location(1) color: vec4f,
  @builtin(instance_index) inst: u32,
) -> VSOut {
  // clip = artboard * viewScale + viewOffset
  let p = vec2f(pos.x * u.view.x + u.view.z, pos.y * u.view.y + u.view.w);
  var out: VSOut;
  out.pos = vec4f(p, 0.0, 1.0);
  out.color = color;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
  return in.color;
}
`;

const GROUP_KEYS = ['fill', 'cells', 'band', 'veins', 'outline', 'spots', 'detail', 'overlay'];
const ARTBOARD_VERT = [0, 0, 168, 0, 0, 122, 168, 0, 168, 122, 0, 122];
const ARTBOARD_COL = [0.106, 0.114, 0.102, 1, 0.106, 0.114, 0.102, 1, 0.106, 0.114, 0.102, 1, 0.106, 0.114, 0.102, 1, 0.106, 0.114, 0.102, 1, 0.106, 0.114, 0.102, 1];

export class WingRenderer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = opts;
    this.available = false;
    this.device = null;
    this.context = null;
    this.pipelines = null;
    this.buffers = new Map();
    this.uniformBuffer = null;
    this.bindGroup = null;
    this.artboardBuffer = null;
    this.artboardBindGroup = null;
    this.dpr = Math.min(opts.dpr || (globalThis.devicePixelRatio || 1), 2.5);
    this.visibleLayers = opts.visibleLayers || GROUP_KEYS.filter((k) => k !== 'overlay');
    this.backgroundColor = opts.backgroundColor || [0.055, 0.06, 0.05, 1];
    this.view = { scale: 1, tx: 0, ty: 0 };
    this._scene = null;
    this._destroyed = false;
    this._initPromise = null;
  }

  async init() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      if (!globalThis.navigator?.gpu) return false;
      let adapter = null;
      try {
        adapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
      } catch {
        adapter = null;
      }
      if (!adapter) return false;
      let device = null;
      try {
        device = await adapter.requestDevice();
      } catch {
        return false;
      }
      this.device = device;
      device.lost.then(() => {
        if (!this._destroyed) this.onLost?.();
      });
      const ctx = this.canvas.getContext('webgpu');
      if (!ctx) return false;
      this.context = ctx;
      const format = navigator.gpu.getPreferredCanvasFormat();
      this.format = format;
      ctx.configure({ device, format, alphaMode: 'opaque' });

      const module = device.createShaderModule({ code: SHADER, label: 'wing-scene' });
      const pipeline = device.createRenderPipeline({
        label: 'wing-triangles',
        layout: 'auto',
        vertex: {
          module,
          entryPoint: 'vs_main',
          buffers: [
            {
              arrayStride: 8,
              attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }]
            },
            {
              arrayStride: 16,
              attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x4' }]
            }
          ]
        },
        fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
        multisample: { count: 4 }
      });
      this.pipeline = pipeline;

      // colour buffer needs blend for overlay alpha
      const blendPipeline = device.createRenderPipeline({
        label: 'wing-overlay',
        layout: 'auto',
        vertex: {
          module,
          entryPoint: 'vs_main',
          buffers: [
            { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
            { arrayStride: 16, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x4' }] }
          ]
        },
        fragment: {
          module,
          entryPoint: 'fs_main',
          targets: [
            {
              format,
              blend: {
                color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
              }
            }
          ]
        },
        primitive: { topology: 'triangle-list' },
        multisample: { count: 4 }
      });
      this.overlayPipeline = blendPipeline;

      this.uniformBuffer = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      this.bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }]
      });
      this.overlayBindGroup = device.createBindGroup({
        layout: blendPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }]
      });

      const artPos = device.createBuffer({
        size: 48,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      });
      device.queue.writeBuffer(artPos, 0, new Float32Array(ARTBOARD_VERT));
      const artCol = device.createBuffer({ size: 96, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(artCol, 0, new Float32Array(ARTBOARD_COL));
      this.artPos = artPos;
      this.artCol = artCol;

      this.available = true;
      this.resize();
      return true;
    })();
    return this._initPromise;
  }

  /** Set the scene (from buildScene) and upload changed layers. */
  setScene(scene) {
    if (!this.device) {
      this._scene = scene;
      return;
    }
    this._scene = scene;
    for (const key of GROUP_KEYS) {
      const layer = scene[key];
      const prev = this.buffers.get(key);
      if (!layer) {
        if (prev) {
          prev.pos.destroy();
          prev.col.destroy();
          this.buffers.delete(key);
        }
        continue;
      }
      if (prev && prev.positions === layer.positions && prev.colors === layer.colors) continue;
      if (prev) {
        prev.pos.destroy();
        prev.col.destroy();
      }
      const pos = this.device.createBuffer({
        size: Math.max(16, layer.positions.byteLength),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      });
      this.device.queue.writeBuffer(pos, 0, layer.positions);
      const col = this.device.createBuffer({
        size: Math.max(16, layer.colors.byteLength),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      });
      this.device.queue.writeBuffer(col, 0, layer.colors);
      this.buffers.set(key, {
        pos,
        col,
        count: layer.vertexCount,
        positions: layer.positions,
        colors: layer.colors
      });
    }
  }

  setVisibleLayers(layers) {
    this.visibleLayers = layers;
    this.requestDraw();
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * this.dpr));
    const h = Math.max(1, Math.round(rect.height * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.cssWidth = rect.width;
    this.cssHeight = rect.height;
    this.requestDraw();
  }

  /** view = {scale, tx, ty} in CSS pixels, artboard centre already folded in */
  setView(view) {
    this.view = view;
    this.requestDraw();
  }

  requestDraw() {
    if (!this.available) return;
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this.draw();
    });
  }

  draw() {
    if (!this.available || !this.device) return;
    const { device } = this;
    if (!this.canvas.width) this.resize();
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w < 2 || h < 2) return;

    // set up MSAA targets lazily
    if (!this.msaaTexture || this.msaaTexture.width !== w || this.msaaTexture.height !== h) {
      this.msaaTexture?.destroy();
      this.msaaTexture = device.createTexture({
        size: [w, h],
        sampleCount: 4,
        format: this.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT
      });
    }

    // artboard → clip-space: clipX = (x * scale + offset)/css * dpr → [-1,1]
    const cssW = this.cssWidth || this.canvas.clientWidth || w;
    const cssH = this.cssHeight || this.canvas.clientHeight || h;
    const scale = this.view.scale;
    const sx = (scale * 2) / cssW;
    const sy = (-scale * 2) / cssH;
    const cx = (this.view.tx * 2) / cssW - 1;
    const cy = 1 - (this.view.ty * 2) / cssH;
    device.queue.writeBuffer(this.uniformBuffer, 0, new Float32Array([sx, sy, cx, cy, cssW, cssH, this.dpr, 0]));

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.msaaTexture.createView(),
          resolveTarget: this.context.getCurrentTexture().createView(),
          clearValue: { r: this.backgroundColor[0], g: this.backgroundColor[1], b: this.backgroundColor[2], a: this.backgroundColor[3] },
          loadOp: 'clear',
          storeOp: 'store'
        }
      ]
    });

    // artboard card
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.artPos);
    pass.setVertexBuffer(1, this.artCol);
    pass.draw(6);

    for (const key of GROUP_KEYS) {
      if (key !== 'overlay' && !this.visibleLayers.includes(key)) continue;
      const buf = this.buffers.get(key);
      if (!buf || buf.count === 0) continue;
      pass.setPipeline(key === 'overlay' ? this.overlayPipeline : this.pipeline);
      pass.setBindGroup(0, key === 'overlay' ? this.overlayBindGroup : this.bindGroup);
      pass.setVertexBuffer(0, buf.pos);
      pass.setVertexBuffer(1, buf.col);
      pass.draw(buf.count);
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  destroy() {
    this._destroyed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    for (const buf of this.buffers.values()) {
      buf.pos.destroy();
      buf.col.destroy();
    }
    this.buffers.clear();
    this.msaaTexture?.destroy();
    this.artPos?.destroy();
    this.artCol?.destroy();
    this.uniformBuffer?.destroy();
    this.device?.destroy?.();
    this.available = false;
  }
}
