import { Camera } from './camera';
import {
  creekShader,
  terrainShader,
  basemapShader,
  markerShader,
} from './shaders';
import { buildMesh, VERTEX_FLOATS, type CreekGeo } from './mesh';
import type { Network } from '../core/types';
import { Terrain } from '../core/terrain';
import { creekColor, type ColorMode } from './palette';

export interface RenderOptions {
  colorMode: ColorMode;
  levelAlpha: Record<1 | 2 | 3, number>;
  showContours: boolean;
  showGrid: boolean;
  highlightId: string | null;
  lockedIds: Set<string>;
  hoverId: string | null;
}

export interface BasemapImage {
  source: ImageBitmap | HTMLImageElement;
  world: { minX: number; minY: number; maxX: number; maxY: number };
  opacity: number;
  brightness: number;
  contrast: number;
  grayscale: boolean;
  flipY: boolean;
}

export interface OverlayMarker {
  x: number;
  y: number;
  size: number;
  color: [number, number, number, number];
  shape: number;
}

const TERRAIN_TEX = 512;

export class CreekRenderer {
  readonly canvas: HTMLCanvasElement;
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private format: GPUTextureFormat = 'bgra8unorm';
  private camera = new Camera();

  private camBuffer!: GPUBuffer;
  private terrainUBuffer!: GPUBuffer;
  private creekUBuffer!: GPUBuffer;
  private baseUBuffer!: GPUBuffer;
  private markerBuffer!: GPUBuffer;
  private markerCapacity = 0;

  private terrainPipeline!: GPURenderPipeline;
  private creekPipeline!: GPURenderPipeline;
  private basemapPipeline!: GPURenderPipeline;
  private markerPipeline!: GPURenderPipeline;

  private terrainTex!: GPUTexture;
  private terrainView!: GPUTextureView;
  private sampler!: GPUSampler;
  private basemapTex: GPUTexture | null = null;
  private basemapView: GPUTextureView | null = null;

  private vertexBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private vertexCapacity = 0;
  private indexCapacity = 0;

  private network: Network | null = null;
  /** 几何缓存: 只在网络/配色/选择变化时重建, 相机移动只更新 uniform */
  private meshKey = '';
  private meshData: ReturnType<typeof buildMesh> | null = null;
  private meshDirty = false;
  private terrain: Terrain | null = null;
  private basemap: BasemapImage | null = null;
  private markers: OverlayMarker[] = [];
  private options: RenderOptions = {
    colorMode: 'level',
    levelAlpha: { 1: 1, 2: 0.92, 3: 0.8 },
    showContours: true,
    showGrid: true,
    highlightId: null,
    lockedIds: new Set(),
    hoverId: null,
  };
  private dirty = true;
  private raf = 0;
  private dpr = 1;
  private disposed = false;

  /** 外部回调: 拖动相机后通知 */
  onCameraChange: (() => void) | null = null;
  /** 无 WebGPU 时的降级说明 */
  readonly fallbackReason: string | null = null;

  constructor(canvas: HTMLCanvasElement, fallbackReason: string | null) {
    this.canvas = canvas;
    this.fallbackReason = fallbackReason;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
  }

  static async create(canvas: HTMLCanvasElement): Promise<CreekRenderer> {
    let reason: string | null = null;
    const r = new CreekRenderer(canvas, null);
    try {
      if (!navigator.gpu) throw new Error('浏览器未提供 navigator.gpu (WebGPU 不可用)');
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) throw new Error('未取得 GPU 适配器 (可能被驱动/策略禁用)');
      const device = await adapter.requestDevice();
      r.device = device;
      r.attachDevice(adapter, device);
      device.lost.then((info) => {
        console.error('[gpu] 设备丢失', info.message);
        r.initFailed = true;
      });
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e);
      r.initFailed = true;
    }
    (r as { fallbackReason: string | null }).fallbackReason = reason;
    if (!reason) r.start();
    return r;
  }

  initFailed = false;

  get backend(): 'webgpu' | 'none' {
    return this.device ? 'webgpu' : 'none';
  }

  get gpuDevice(): GPUDevice | null {
    return this.device;
  }

  private attachDevice(_adapter: GPUAdapter, device: GPUDevice): void {
    const ctx = this.canvas.getContext('webgpu');
    if (!ctx) throw new Error('无法创建 WebGPU 画布上下文');
    this.context = ctx;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format: this.format, alphaMode: 'opaque' });

    this.camBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.terrainUBuffer = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.creekUBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    // BaseU: vec4(rect) + f32×4 + vec3 + pad → 按 16 字节对齐需要 64 字节
    this.baseUBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // 地形纹理
    this.terrainTex = device.createTexture({
      size: [TERRAIN_TEX, TERRAIN_TEX],
      format: 'r16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.terrainView = this.terrainTex.createView();

    const camLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    const terrainLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    const creekLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    const baseLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    const markerLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    const alphaBlend: GPUBlendState = {
      color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };

    const camPipe = device.createPipelineLayout({ bindGroupLayouts: [camLayout] });
    const terrainPipe = device.createPipelineLayout({ bindGroupLayouts: [terrainLayout] });
    const creekPipe = device.createPipelineLayout({ bindGroupLayouts: [creekLayout] });

    this.terrainPipeline = device.createRenderPipeline({
      layout: terrainPipe,
      vertex: { module: device.createShaderModule({ code: terrainShader }), entryPoint: 'vs' },
      fragment: {
        module: device.createShaderModule({ code: terrainShader }),
        entryPoint: 'fs',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list' },
    });
    this.creekPipeline = device.createRenderPipeline({
      layout: creekPipe,
      vertex: {
        module: device.createShaderModule({ code: creekShader }),
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: VERTEX_FLOATS * 4,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              { shaderLocation: 1, offset: 8, format: 'float32x2' },
              { shaderLocation: 2, offset: 16, format: 'float32x2' },
              { shaderLocation: 3, offset: 24, format: 'float32x2' },
              { shaderLocation: 4, offset: 32, format: 'float32x3' },
              { shaderLocation: 5, offset: 44, format: 'float32x3' },
            ],
          },
        ],
      },
      fragment: {
        module: device.createShaderModule({ code: creekShader }),
        entryPoint: 'fs',
        targets: [{ format: this.format, blend: alphaBlend }],
      },
      primitive: { topology: 'triangle-list' },
    });
    this.basemapPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [baseLayout] }),
      vertex: { module: device.createShaderModule({ code: basemapShader }), entryPoint: 'vs' },
      fragment: {
        module: device.createShaderModule({ code: basemapShader }),
        entryPoint: 'fs',
        targets: [{ format: this.format, blend: alphaBlend }],
      },
      primitive: { topology: 'triangle-list' },
    });
    this.markerPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [markerLayout] }),
      vertex: {
        module: device.createShaderModule({ code: markerShader }),
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: 40,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              { shaderLocation: 1, offset: 8, format: 'float32x2' },
              { shaderLocation: 2, offset: 16, format: 'float32' },
              { shaderLocation: 3, offset: 20, format: 'float32x4' },
              { shaderLocation: 4, offset: 36, format: 'float32' },
            ],
          },
        ],
      },
      fragment: {
        module: device.createShaderModule({ code: markerShader }),
        entryPoint: 'fs',
        targets: [{ format: this.format, blend: alphaBlend }],
      },
      primitive: { topology: 'triangle-list' },
    });
    void camPipe;
  }

  /* -------------------------- 数据接口 -------------------------- */

  setNetwork(network: Network | null): void {
    this.network = network;
    this.terrain = network ? new Terrain(network.params) : null;
    this.dirty = true;
    if (network) this.updateTerrainTexture(network);
  }

  fitToNetwork(padding = 56): void {
    if (!this.network) return;
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    this.camera.fit(this.network.bounds, w, h, padding);
    this.dirty = true;
    this.onCameraChange?.();
  }

  setOptions(patch: Partial<RenderOptions>): void {
    this.options = { ...this.options, ...patch };
    this.dirty = true;
  }

  getOptions(): RenderOptions {
    return this.options;
  }

  getCamera(): Camera {
    return this.camera;
  }

  setBasemap(img: BasemapImage | null): void {
    this.basemap = img;
    if (img && this.device) this.uploadBasemap(img);
    else {
      this.basemapTex?.destroy();
      this.basemapTex = null;
      this.basemapView = null;
    }
    this.dirty = true;
  }

  setMarkers(markers: OverlayMarker[]): void {
    this.markers = markers;
    this.dirty = true;
  }

  requestRender(): void {
    this.dirty = true;
  }

  /* -------------------------- 交互 -------------------------- */

  screenToWorld(px: number, py: number): { x: number; y: number } {
    return this.camera.screenToWorld(px, py, this.canvas.clientWidth, this.canvas.clientHeight);
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    return this.camera.worldToScreen(x, y, this.canvas.clientWidth, this.canvas.clientHeight);
  }

  pan(dx: number, dy: number): void {
    this.camera.pan(dx, dy);
    this.dirty = true;
    this.onCameraChange?.();
  }

  zoomAt(factor: number, px: number, py: number): void {
    this.camera.zoomAt(factor, px, py, this.canvas.clientWidth, this.canvas.clientHeight);
    this.dirty = true;
    this.onCameraChange?.();
  }

  /* -------------------------- 渲染 -------------------------- */

  private start(): void {
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      // 画布尺寸变化 (窗口缩放、布局完成) 不在 ResizeObserver 的时机内也能被发现
      const wantW = Math.max(1, Math.round(this.canvas.clientWidth * this.dpr));
      const wantH = Math.max(1, Math.round(this.canvas.clientHeight * this.dpr));
      if (this.canvas.width !== wantW || this.canvas.height !== wantH) this.dirty = true;
      if (this.dirty) {
        this.dirty = false;
        this.draw();
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.layoutCanvas();
    this.dirty = true;
  }

  private layoutCanvas(): void {
    const w = Math.max(1, Math.round(this.canvas.clientWidth * this.dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.dirty = true;
    }
  }

  private ensureMeshBuffers(vertexBytes: number, indexBytes: number): void {
    const device = this.device!;
    if (!this.vertexBuffer || this.vertexCapacity < vertexBytes) {
      this.vertexBuffer?.destroy();
      this.vertexCapacity = Math.max(4096, Math.ceil(vertexBytes * 1.5 / 4) * 4);
      this.vertexBuffer = device.createBuffer({
        size: this.vertexCapacity,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }
    if (!this.indexBuffer || this.indexCapacity < indexBytes) {
      this.indexBuffer?.destroy();
      this.indexCapacity = Math.max(4096, Math.ceil(indexBytes * 1.5 / 4) * 4);
      this.indexBuffer = device.createBuffer({
        size: this.indexCapacity,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      });
    }
  }

  private lastWriteError = '';
  private debugWrite(label: string, buf: GPUBuffer, data: Float32Array | Uint32Array): void {
    try {
      this.device!.queue.writeBuffer(buf, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
    } catch (e) {
      const msg = `${label}: ${(e as Error).message} (buffer ${buf.size} B, data ${data.byteLength} B)`;
      if (msg !== this.lastWriteError) {
        this.lastWriteError = msg;
        console.error('[gpu] writeBuffer 失败', msg);
      }
    }
  }

  private ensureMarkerBuffer(bytes: number): void {
    const device = this.device!;
    if (!this.markerBuffer || this.markerCapacity < bytes) {
      this.markerBuffer?.destroy();
      this.markerCapacity = Math.max(4096, bytes);
      this.markerBuffer = device.createBuffer({
        size: this.markerCapacity,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }
  }

  private updateTerrainTexture(network: Network): void {
    if (!this.device || !this.terrain) return;
    const terrain = this.terrain;
    // 地形纹理覆盖比网络大一圈的范围, 平移/缩小时不会露出黑色底
    const nb = network.bounds;
    const ex = (nb.maxX - nb.minX) * 0.45;
    const ey = (nb.maxY - nb.minY) * 0.45;
    const b = { minX: nb.minX - ex, minY: nb.minY - ey, maxX: nb.maxX + ex, maxY: nb.maxY + ey };
    const data = new Uint16Array(TERRAIN_TEX * TERRAIN_TEX);
    let min = Infinity;
    let max = -Infinity;
    for (let j = 0; j < TERRAIN_TEX; j++) {
      const y = b.minY + ((j + 0.5) / TERRAIN_TEX) * (b.maxY - b.minY);
      for (let i = 0; i < TERRAIN_TEX; i++) {
        const x = b.minX + ((i + 0.5) / TERRAIN_TEX) * (b.maxX - b.minX);
        const e = terrain.elevationAt(x, y);
        // 行 0 对应 maxY (北在上)
        data[(TERRAIN_TEX - 1 - j) * TERRAIN_TEX + i] = toHalf(e);
        if (e < min) min = e;
        if (e > max) max = e;
      }
    }
    const range = Math.max(1e-3, max - min);
    for (let k = 0; k < data.length; k++) {
      const raw = fromHalf(data[k]);
      data[k] = toHalf((raw - min) / range);
    }
    (this as { terrainRect?: typeof b }).terrainRect = { ...b };
    (this as { terrainElevRange?: [number, number] }).terrainElevRange = [min, max];
    this.device.queue.writeTexture(
      { texture: this.terrainTex },
      data,
      { bytesPerRow: TERRAIN_TEX * 2, rowsPerImage: TERRAIN_TEX },
      { width: TERRAIN_TEX, height: TERRAIN_TEX },
    );
  }

  private uploadBasemap(img: BasemapImage): void {
    const device = this.device!;
    const src = img.source as ImageBitmap | HTMLImageElement;
    const w = (src as ImageBitmap).width ?? (src as HTMLImageElement).naturalWidth;
    const h = (src as ImageBitmap).height ?? (src as HTMLImageElement).naturalHeight;
    this.basemapTex?.destroy();
    this.basemapTex = device.createTexture({
      size: [w, h],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
      { source: src },
      { texture: this.basemapTex },
      { width: w, height: h },
    );
    this.basemapView = this.basemapTex.createView();
  }

  private buildCreekGeos(): CreekGeo[] {
    const net = this.network;
    if (!net) return [];
    const o = this.options;
    const highlights = new Set<string>();
    if (o.highlightId) highlights.add(o.highlightId);
    if (o.hoverId) highlights.add(o.hoverId);
    const out: CreekGeo[] = [];
    for (const c of net.creeks) {
      const col = creekColor(c, { mode: o.colorMode });
      out.push({
        id: c.id,
        level: c.level,
        pts: c.pts,
        widths: c.widths,
        color: [col.r, col.g, col.b],
        selected: o.highlightId === c.id,
        alpha: 1,
      });
    }
    return out;
  }

  draw(): void {
    const device = this.device;
    const ctx = this.context;
    if (!device || !ctx) return;
    this.layoutCanvas();
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cssW = Math.max(1, this.canvas.clientWidth);
    const cssH = Math.max(1, this.canvas.clientHeight);

    // 相机 uniform: 采用设备像素比下的 scale
    const scalePx = this.camera.scale * this.dpr;
    const camData = new Float32Array(8);
    camData[0] = this.camera.centerX;
    camData[1] = this.camera.centerY;
    camData[2] = scalePx;
    camData[3] = performance.now() / 1000;
    camData[4] = w;
    camData[5] = h;
    device.queue.writeBuffer(this.camBuffer, 0, camData);

    // 地形 uniform
    const rect = (this as { terrainRect?: { minX: number; minY: number; maxX: number; maxY: number } }).terrainRect;
    const elevRange = (this as { terrainElevRange?: [number, number] }).terrainElevRange ?? [0, 2];
    const tData = new Float32Array(24);
    if (rect) {
      tData[0] = rect.minX;
      tData[1] = rect.minY;
      tData[2] = rect.maxX;
      tData[3] = rect.maxY;
    }
    tData[4] = elevRange[0];
    tData[5] = elevRange[1];
    tData[6] = 0.2; // 等深线间距 (m)
    tData[7] = 100; // 测量网格 (m)
    const heading = this.network ? this.network.params.heading : 0;
    const rad = ((90 - heading) * Math.PI) / 180;
    tData[8] = Math.cos(rad);
    tData[9] = Math.sin(rad);
    tData[10] = this.network?.params.datum ?? 0.2;
    tData[11] = this.network?.params.slope ?? 0.001;
    tData[12] = this.options.showContours ? 1 : 0;
    tData[13] = this.options.showGrid ? 1 : 0;
    tData[14] = 0;
    tData[15] = 0;
    device.queue.writeBuffer(this.terrainUBuffer, 0, tData);

    // 沟道 uniform
    const cData = new Float32Array(8);
    cData[0] = this.options.levelAlpha[1];
    cData[1] = this.options.levelAlpha[2];
    cData[2] = this.options.levelAlpha[3];
    cData[3] = 1;
    cData[4] = 0;
    cData[5] = 1.1; // 最小半宽 (设备像素)
    cData[6] = 7;
    cData[7] = 1;
    device.queue.writeBuffer(this.creekUBuffer, 0, cData);

    const bg = device.createCommandEncoder({ label: 'frame' });
    const view = ctx.getCurrentTexture().createView();
    const pass = bg.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: { r: 0.02, g: 0.035, b: 0.045, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    // 1) 地形
    const terrainBind = device.createBindGroup({      layout: this.terrainPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.camBuffer } },
        { binding: 1, resource: { buffer: this.terrainUBuffer } },
        { binding: 2, resource: this.terrainView },
        { binding: 3, resource: this.sampler },
      ],
    });
    pass.setPipeline(this.terrainPipeline);
    pass.setBindGroup(0, terrainBind);
    pass.draw(6, 1, 0, 0);

    // 2) 航拍底图
    if (this.basemap && this.basemapView) {
      const bData = new Float32Array(16);
      bData.set([this.basemap.world.minX, this.basemap.world.minY, this.basemap.world.maxX, this.basemap.world.maxY], 0);
      bData[4] = this.basemap.opacity;
      bData[5] = this.basemap.brightness;
      bData[6] = this.basemap.contrast;
      bData[7] = this.basemap.grayscale ? 1 : 0;
      bData[8] = this.basemap.flipY ? 1 : 0;
      device.queue.writeBuffer(this.baseUBuffer, 0, bData);
      const bBase = device.createBindGroup({
        layout: this.basemapPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.camBuffer } },
          { binding: 1, resource: { buffer: this.baseUBuffer } },
          { binding: 2, resource: this.basemapView },
          { binding: 3, resource: this.sampler },
        ],
      });
      pass.setPipeline(this.basemapPipeline);
      pass.setBindGroup(0, bBase);
      pass.draw(6, 1, 0, 0);
    }

    // 3) 沟道网络 (几何按需重建并缓存; 缩放只影响着色器里的 fwidth)
    const o = this.options;
    const key = [
      this.network?.fingerprint ?? '',
      this.network?.creeks.length ?? 0,
      o.colorMode,
      o.highlightId ?? '',
      o.hoverId ?? '',
      [...o.lockedIds].sort().join(','),
      this.network ? this.network.creeks.reduce((a, c) => a + c.pts.length, 0) : 0,
    ].join('|');
    if (key !== this.meshKey || !this.meshData) {
      this.meshKey = key;
      this.meshData = buildMesh(this.buildCreekGeos(), {
        scale: scalePx,
        width: w,
        height: h,
        minHalfWidthPx: 1.0,
      });
      this.meshDirty = true;
    }
    const mesh = this.meshData;
    if (mesh.indexCount > 0) {
      if (this.meshDirty) {
        this.meshDirty = false;
        this.ensureMeshBuffers(mesh.vertices.byteLength, mesh.indices.byteLength);
        this.debugWrite('vertices', this.vertexBuffer!, mesh.vertices);
        this.debugWrite('indices', this.indexBuffer!, mesh.indices);
      }
      const creekBind = device.createBindGroup({
        layout: this.creekPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.camBuffer } },
          { binding: 1, resource: { buffer: this.creekUBuffer } },
        ],
      });
      pass.setPipeline(this.creekPipeline);
      pass.setBindGroup(0, creekBind);
      pass.setVertexBuffer(0, this.vertexBuffer!);
      pass.setIndexBuffer(this.indexBuffer!, 'uint32');
      pass.drawIndexed(mesh.indexCount, 1, 0, 0, 0);
    }

    // 4) 标记
    if (this.markers.length > 0) {
      const floats = new Float32Array(this.markers.length * 4 * 10);
      this.ensureMarkerBuffer(floats.byteLength);
      const corners = [
        [-1, -1], [1, -1], [-1, 1], [1, 1],
      ];
      let p = 0;
      for (const m of this.markers) {
        for (const [cx, cy] of corners) {
          floats[p++] = m.x;
          floats[p++] = m.y;
          floats[p++] = cx;
          floats[p++] = cy;
          floats[p++] = m.size;
          floats[p++] = m.color[0];
          floats[p++] = m.color[1];
          floats[p++] = m.color[2];
          floats[p++] = m.color[3];
          floats[p++] = m.shape;
        }
      }
      this.debugWrite('markers', this.markerBuffer!, floats);
      const mBind = device.createBindGroup({
        layout: this.markerPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.camBuffer } }],
      });
      pass.setPipeline(this.markerPipeline);
      pass.setBindGroup(0, mBind);
      pass.setVertexBuffer(0, this.markerBuffer!);
      // 每个标记 2 个三角形
      for (let i = 0; i < this.markers.length; i++) pass.draw(4, 1, i * 4, 0);
    }

    pass.end();
    device.queue.submit([bg.finish()]);
    void cssW;
    void cssH;
    void h;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.vertexBuffer?.destroy();
    this.indexBuffer?.destroy();
    this.markerBuffer?.destroy();
    this.basemapTex?.destroy();
    this.device?.destroy();
  }
}

/* ---- 半精度浮点转换 (地形纹理用 r16float, 可被线性采样) ---- */
function toHalf(value: number): number {
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  f32[0] = value;
  const x = u32[0];
  const sign = (x >> 31) & 0x1;
  let exp = (x >> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp === 0xff) return (sign << 15) | 0x7c00 | (mant ? 0x200 : 0);
  let e = exp - 127 + 15;
  if (e >= 0x1f) return (sign << 15) | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign << 15;
    mant = (mant | 0x800000) >> (1 - e);
    return (sign << 15) | (mant >> 13);
  }
  return (sign << 15) | (e << 10) | (mant >> 13);
}

function fromHalf(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const mant = h & 0x3ff;
  if (exp === 0) return sign * Math.pow(2, -14) * (mant / 1024);
  if (exp === 0x1f) return mant ? NaN : sign * Infinity;
  return sign * Math.pow(2, exp - 15) * (1 + mant / 1024);
}
