// WebGPU 引擎：设备、上下文、深度/MSAA 纹理与统一帧通道
export class WebGPUEngine {
  device!: GPUDevice;
  context!: GPUCanvasContext;
  format!: GPUTextureFormat;
  canvas: HTMLCanvasElement;
  depthTexture!: GPUTexture;
  msaaTexture!: GPUTexture;
  private _size = { w: 1, h: 1 };

  private constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  static async create(canvas: HTMLCanvasElement): Promise<WebGPUEngine> {
    if (!navigator.gpu) throw new Error('当前浏览器不支持 WebGPU，请使用最新版 Chrome / Edge');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('未找到可用的 GPU 适配器');
    const engine = new WebGPUEngine(canvas);
    engine.device = await adapter.requestDevice();
    engine.device.addEventListener('uncapturederror', ((e: GPUUncapturedErrorEvent) => {
      const w = window as unknown as { __gpuErrors?: string[] };
      (w.__gpuErrors ??= []).push(e.error.message);
      console.error('[WebGPU]', e.error.message);
    }) as EventListener);
    engine.format = navigator.gpu.getPreferredCanvasFormat();
    engine.context = canvas.getContext('webgpu')!;
    engine.context.configure({
      device: engine.device,
      format: engine.format,
      alphaMode: 'opaque',
    });
    engine.resize();
    return engine;
  }

  get width(): number {
    return this._size.w;
  }

  get height(): number {
    return this._size.h;
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (w === this._size.w && h === this._size.h) return;
    this._size = { w, h };
    this.canvas.width = w;
    this.canvas.height = h;
    this.depthTexture?.destroy();
    this.msaaTexture?.destroy();
    this.depthTexture = this.device.createTexture({
      size: [w, h],
      sampleCount: 4,
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.msaaTexture = this.device.createTexture({
      size: [w, h],
      sampleCount: 4,
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  /** 切换到新的 canvas 元素（组件 innerHTML 重绘后调用） */
  replaceCanvas(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.context.unconfigure();
    this.context = canvas.getContext('webgpu')!;
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'opaque',
    });
    this._size = { w: 0, h: 0 };
    this.resize();
  }

  destroy(): void {
    this.depthTexture?.destroy();
    this.msaaTexture?.destroy();
    this.context.unconfigure();
  }

  /** 执行一帧：回调拿到 render pass，先画不透明体素、再画半透明覆盖层 */
  frame(
    bg: [number, number, number, number],
    draw: (pass: GPURenderPassEncoder) => void,
  ): void {
    // canvas 可能刚被 innerHTML 重绘替换、尚未重新挂接，跳过这一帧
    if (!this.canvas.isConnected) return;
    this.resize();
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.msaaTexture.createView(),
          resolveTarget: this.context.getCurrentTexture().createView(),
          clearValue: bg,
          loadOp: 'clear',
          storeOp: 'discard',
        },
      ],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
    });
    draw(pass);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}
