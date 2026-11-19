// 覆盖层渲染器：线段 + 半透明三角面（高亮面、选区框、镜像面、地面网格）
import type { WebGPUEngine } from './engine';
import { OVERLAY_WGSL } from './shaders';
import { cameraBindGroupLayout } from './voxel-renderer';

export interface OverlayLine {
  a: [number, number, number];
  b: [number, number, number];
  color: [number, number, number];
  alpha: number;
}

export interface OverlayFace {
  /** 4 个世界坐标角点 */
  corners: [number, number, number][];
  color: [number, number, number];
  alpha: number;
}

const FLOATS_PER_VERT = 7; // xyz + rgb + a
const INITIAL_VERTS = 8192;

export class OverlayRenderer {
  private engine: WebGPUEngine;
  private linePipeline: GPURenderPipeline;
  private triPipeline: GPURenderPipeline;
  private buffer: GPUBuffer;
  private capacity = INITIAL_VERTS;
  private vertexCount = 0;
  private triCount = 0;

  constructor(engine: WebGPUEngine) {
    this.engine = engine;
    const device = engine.device;
    const module = device.createShaderModule({ code: OVERLAY_WGSL });
    const layout = device.createPipelineLayout({
      bindGroupLayouts: [cameraBindGroupLayout(device)],
    });
    const target: GPUColorTargetState = {
      format: engine.format,
      blend: {
        color: {
          srcFactor: 'src-alpha',
          dstFactor: 'one-minus-src-alpha',
          operation: 'add',
        },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      },
    };
    const vertex: GPUVertexState = {
      module,
      entryPoint: 'vs_main',
      buffers: [
        {
          arrayStride: FLOATS_PER_VERT * 4,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32' },
          ],
        },
      ],
    };
    const depth: GPUDepthStencilState = {
      format: 'depth24plus',
      depthWriteEnabled: false,
      depthCompare: 'less',
    };
    this.linePipeline = device.createRenderPipeline({
      layout,
      vertex,
      fragment: { module, entryPoint: 'fs_main', targets: [target] },
      primitive: { topology: 'line-list' },
      depthStencil: depth,
      multisample: { count: 4 },
    });
    this.triPipeline = device.createRenderPipeline({
      layout,
      vertex,
      fragment: { module, entryPoint: 'fs_main', targets: [target] },
      primitive: { topology: 'triangle-list' },
      depthStencil: depth,
      multisample: { count: 4 },
    });
    this.buffer = device.createBuffer({
      size: this.capacity * FLOATS_PER_VERT * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  update(lines: OverlayLine[], faces: OverlayFace[]): void {
    const vertCount = lines.length * 2 + faces.length * 6;
    if (vertCount > this.capacity) {
      while (this.capacity < vertCount) this.capacity *= 2;
      this.buffer.destroy();
      this.buffer = this.engine.device.createBuffer({
        size: this.capacity * FLOATS_PER_VERT * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }
    const data = new Float32Array(Math.max(vertCount, 1) * FLOATS_PER_VERT);
    let i = 0;
    const push = (p: [number, number, number], c: [number, number, number], a: number): void => {
      data[i++] = p[0]; data[i++] = p[1]; data[i++] = p[2];
      data[i++] = c[0]; data[i++] = c[1]; data[i++] = c[2];
      data[i++] = a;
    };
    for (const l of lines) {
      push(l.a, l.color, l.alpha);
      push(l.b, l.color, l.alpha);
    }
    this.triCount = 0;
    for (const f of faces) {
      // 两个三角形：0,1,2 与 0,2,3
      push(f.corners[0], f.color, f.alpha);
      push(f.corners[1], f.color, f.alpha);
      push(f.corners[2], f.color, f.alpha);
      push(f.corners[0], f.color, f.alpha);
      push(f.corners[2], f.color, f.alpha);
      push(f.corners[3], f.color, f.alpha);
      this.triCount += 2;
    }
    this.vertexCount = vertCount;
    if (vertCount > 0) this.engine.device.queue.writeBuffer(this.buffer, 0, data);
  }

  draw(pass: GPURenderPassEncoder, cameraBindGroup: GPUBindGroup): void {
    if (this.vertexCount === 0) return;
    pass.setBindGroup(0, cameraBindGroup);
    pass.setVertexBuffer(0, this.buffer);
    // 线段顶点在前
    const lineVerts = this.vertexCount - this.triCount * 3;
    if (lineVerts > 0) {
      pass.setPipeline(this.linePipeline);
      pass.draw(lineVerts);
    }
    if (this.triCount > 0) {
      pass.setPipeline(this.triPipeline);
      pass.draw(this.triCount * 3, 1, lineVerts, 0);
    }
  }
}
