import {
  mat4Invert, mat4LookAt, mat4Mul, mat4Perspective, mat4TransformPoint,
  norm3, scale3, sub3, type Mat4, type Vec3,
} from '../math';
import type { MeshData } from '../voxel/mesher';

const MESH_WGSL = /* wgsl */`
struct Uniforms {
  mvp: mat4x4f,
  lightDir: vec4f,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VIn {
  @location(0) pos: vec3f,
  @location(1) nrm: vec3f,
  @location(2) col: vec3f,
};
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) nrm: vec3f,
  @location(1) col: vec3f,
};
@vertex fn vs(v: VIn) -> VOut {
  var o: VOut;
  o.pos = u.mvp * vec4f(v.pos, 1.0);
  o.nrm = v.nrm;
  o.col = v.col;
  return o;
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let n = normalize(v.nrm);
  let l = normalize(u.lightDir.xyz);
  let diff = max(dot(n, l), 0.0);
  let back = max(dot(n, -l), 0.0) * 0.25;
  let hemi = 0.5 + 0.5 * n.z;
  let light = 0.28 + diff * 0.62 + back + hemi * 0.12;
  return vec4f(v.col * light, 1.0);
}
`;

const FLAT_WGSL = /* wgsl */`
struct Uniforms {
  mvp: mat4x4f,
  lightDir: vec4f,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
struct VIn {
  @location(0) pos: vec3f,
  @location(1) col: vec4f,
};
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) col: vec4f,
};
@vertex fn vs(v: VIn) -> VOut {
  var o: VOut;
  o.pos = u.mvp * vec4f(v.pos, 1.0);
  o.col = v.col;
  return o;
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  return v.col;
}
`;

export interface OverlayBox {
  min: Vec3;
  max: Vec3;
  color: [number, number, number, number];
}

/** WebGPU 体素场景渲染器:实体网格 + 线框(网格地面/包围盒) + 半透明覆盖层(层面/选区/镜像面) */
export class VoxelRenderer {
  private canvas: HTMLCanvasElement;
  private device!: GPUDevice;
  private ctx!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private depthTex: GPUTexture | null = null;
  private meshPipe!: GPURenderPipeline;
  private linePipe!: GPURenderPipeline;
  private overlayPipe!: GPURenderPipeline;
  private uniformBuf!: GPUBuffer;
  private bindGroup!: GPUBindGroup;

  private meshVB: GPUBuffer | null = null;
  private meshIB: GPUBuffer | null = null;
  private meshIndexCount = 0;
  private lineVB: GPUBuffer | null = null;
  private lineVertCount = 0;
  private overlayVB: GPUBuffer | null = null;
  private overlayVertCount = 0;

  // 轨道相机
  yaw = -0.8; pitch = 0.55; dist = 120;
  target: Vec3 = [32, 32, 24];
  private vpInv: Mat4 = mat4Invert(mat4Perspective(0.9, 1, 0.1, 4000));
  private raf = 0;
  private destroyed = false;
  ready = false;
  error = '';

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async init(): Promise<boolean> {
    if (!navigator.gpu) {
      this.error = '当前浏览器不支持 WebGPU,请使用 Chrome / Edge 113+ 并启用 WebGPU。';
      return false;
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      this.error = '未找到可用的 WebGPU 适配器(GPU)。';
      return false;
    }
    this.device = await adapter.requestDevice();
    this.ctx = this.canvas.getContext('webgpu') as GPUCanvasContext;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });

    const uniformSize = 16 * 4 + 4 * 4;
    this.uniformBuf = this.device.createBuffer({ size: uniformSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const layout = this.device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    });
    this.bindGroup = this.device.createBindGroup({
      layout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuf } }],
    });
    const pipeLayout = this.device.createPipelineLayout({ bindGroupLayouts: [layout] });

    const meshMod = this.device.createShaderModule({ code: MESH_WGSL });
    this.meshPipe = this.device.createRenderPipeline({
      layout: pipeLayout,
      vertex: {
        module: meshMod, entryPoint: 'vs',
        buffers: [{
          arrayStride: 9 * 4,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32x3' },
          ],
        }],
      },
      fragment: { module: meshMod, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });

    const flatMod = this.device.createShaderModule({ code: FLAT_WGSL });
    const flatBuffer: GPUVertexBufferLayout = {
      arrayStride: 7 * 4,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x4' },
      ],
    };
    this.linePipe = this.device.createRenderPipeline({
      layout: pipeLayout,
      vertex: { module: flatMod, entryPoint: 'vs', buffers: [flatBuffer] },
      fragment: { module: flatMod, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'line-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    this.overlayPipe = this.device.createRenderPipeline({
      layout: pipeLayout,
      vertex: { module: flatMod, entryPoint: 'vs', buffers: [flatBuffer] },
      fragment: {
        module: flatMod, entryPoint: 'fs',
        targets: [{
          format: this.format,
          blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
    });

    this.ready = true;
    const loop = () => {
      if (this.destroyed) return;
      this.render();
      this.raf = requestAnimationFrame(loop);
    };
    loop();
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.meshVB?.destroy(); this.meshIB?.destroy();
    this.lineVB?.destroy(); this.overlayVB?.destroy();
    this.depthTex?.destroy();
    this.ctx?.unconfigure();
    this.device?.destroy();
  }

  setMesh(mesh: MeshData): void {
    if (!this.ready) return;
    this.meshVB?.destroy(); this.meshIB?.destroy();
    // 交错:pos3 nrm3 col3
    const n = mesh.positions.length / 3;
    const inter = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) {
      inter.set(mesh.positions.subarray(i * 3, i * 3 + 3), i * 9);
      inter.set(mesh.normals.subarray(i * 3, i * 3 + 3), i * 9 + 3);
      inter.set(mesh.colors.subarray(i * 3, i * 3 + 3), i * 9 + 6);
    }
    this.meshVB = this.device.createBuffer({ size: Math.max(4, inter.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.meshVB, 0, inter);
    this.meshIB = this.device.createBuffer({ size: Math.max(4, mesh.indices.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.meshIB, 0, mesh.indices);
    this.meshIndexCount = mesh.indices.length;
  }

  /** 线框:地面网格 + 外框 + 选区边框等 */
  setLines(segments: { a: Vec3; b: Vec3; color: [number, number, number, number] }[]): void {
    if (!this.ready) return;
    this.lineVB?.destroy();
    const data = new Float32Array(segments.length * 2 * 7);
    let o = 0;
    for (const s of segments) {
      data.set([...s.a, ...s.color], o); o += 7;
      data.set([...s.b, ...s.color], o); o += 7;
    }
    this.lineVertCount = segments.length * 2;
    this.lineVB = this.device.createBuffer({ size: Math.max(4, data.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.lineVB, 0, data);
  }

  /** 半透明覆盖层:Z 层高亮面、选区盒、镜像面 */
  setOverlays(boxes: OverlayBox[]): void {
    if (!this.ready) return;
    this.overlayVB?.destroy();
    const data: number[] = [];
    const quad = (p1: Vec3, p2: Vec3, p3: Vec3, p4: Vec3, c: number[]) => {
      data.push(...p1, ...c, ...p2, ...c, ...p3, ...c, ...p1, ...c, ...p3, ...c, ...p4, ...c);
    };
    for (const b of boxes) {
      const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max, c = b.color;
      quad([x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1], c);
      quad([x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[x1,y0,z0], c);
      quad([x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1], c);
      quad([x0,y1,z0],[x0,y1,z1],[x1,y1,z1],[x1,y1,z0], c);
      quad([x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0], c);
      quad([x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[x1,y0,z1], c);
    }
    const arr = new Float32Array(data);
    this.overlayVertCount = arr.length / 7;
    this.overlayVB = this.device.createBuffer({ size: Math.max(4, arr.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.overlayVB, 0, arr);
  }

  /** 鼠标位置 → 世界射线 */
  screenRay(clientX: number, clientY: number): { ro: Vec3; rd: Vec3 } {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((clientY - rect.top) / rect.height) * 2;
    const near = mat4TransformPoint(this.vpInv, [nx, ny, 0]);
    const far = mat4TransformPoint(this.vpInv, [nx, ny, 1]);
    return { ro: near, rd: norm3(sub3(far, near)) };
  }

  orbit(dx: number, dy: number): void {
    this.yaw += dx * 0.008;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + dy * 0.008));
  }
  pan(dx: number, dy: number): void {
    const s = this.dist * 0.0016;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    this.target[0] += (-dx * cy - dy * sy) * s;
    this.target[1] += (dx * sy - dy * cy) * s;
  }
  zoom(delta: number): void {
    this.dist = Math.max(5, Math.min(2000, this.dist * (delta > 0 ? 1.12 : 1 / 1.12)));
  }

  private render(): void {
    if (!this.ready || this.destroyed) return;
    const w = this.canvas.clientWidth | 0, hgt = this.canvas.clientHeight | 0;
    if (w === 0 || hgt === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.floor(w * dpr), ph = Math.floor(hgt * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw; this.canvas.height = ph;
      this.depthTex?.destroy();
      this.depthTex = this.device.createTexture({
        size: [pw, ph], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    if (!this.depthTex) return;

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const eye: Vec3 = [
      this.target[0] + this.dist * cp * cy,
      this.target[1] + this.dist * cp * sy,
      this.target[2] + this.dist * sp,
    ];
    const proj = mat4Perspective(0.9, pw / ph, Math.max(0.5, this.dist / 100), this.dist * 20 + 500);
    const view = mat4LookAt(eye, this.target, [0, 0, 1]);
    const vp = mat4Mul(proj, view);
    this.vpInv = mat4Invert(vp);

    const light = norm3(scale3([0.5, -0.7, 1], 1));
    const ubuf = new Float32Array(20);
    ubuf.set(vp, 0);
    ubuf.set([light[0], light[1], light[2], 0], 16);
    this.device.queue.writeBuffer(this.uniformBuf, 0, ubuf);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.ctx.getCurrentTexture().createView(),
        clearValue: { r: 0.035, g: 0.045, b: 0.065, a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTex.createView(),
        depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store',
      },
    });
    pass.setBindGroup(0, this.bindGroup);
    if (this.meshVB && this.meshIB && this.meshIndexCount > 0) {
      pass.setPipeline(this.meshPipe);
      pass.setVertexBuffer(0, this.meshVB);
      pass.setIndexBuffer(this.meshIB, 'uint32');
      pass.drawIndexed(this.meshIndexCount);
    }
    if (this.overlayVB && this.overlayVertCount > 0) {
      pass.setPipeline(this.overlayPipe);
      pass.setVertexBuffer(0, this.overlayVB);
      pass.draw(this.overlayVertCount);
    }
    if (this.lineVB && this.lineVertCount > 0) {
      pass.setPipeline(this.linePipe);
      pass.setVertexBuffer(0, this.lineVB);
      pass.draw(this.lineVertCount);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}
