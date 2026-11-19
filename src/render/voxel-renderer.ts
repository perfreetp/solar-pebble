// 体素实例化渲染器：每个体素一个立方体实例，按可见层重建实例缓冲
import type { WebGPUEngine } from './engine';
import { VOXEL_WGSL } from './shaders';
import { unpackColor, type Layer } from '../core/types';
import { voxelToWorld } from '../core/voxel-model';

// 24 个立方体顶点（每面 4 个，带该面法线），position.xyz + normal.xyz
const CUBE_VERTS = new Float32Array([
  // +X
  0.5, -0.5, -0.5, 1, 0, 0,
  0.5, 0.5, -0.5, 1, 0, 0,
  0.5, 0.5, 0.5, 1, 0, 0,
  0.5, -0.5, 0.5, 1, 0, 0,
  // -X
  -0.5, -0.5, 0.5, -1, 0, 0,
  -0.5, 0.5, 0.5, -1, 0, 0,
  -0.5, 0.5, -0.5, -1, 0, 0,
  -0.5, -0.5, -0.5, -1, 0, 0,
  // +Y
  -0.5, 0.5, -0.5, 0, 1, 0,
  -0.5, 0.5, 0.5, 0, 1, 0,
  0.5, 0.5, 0.5, 0, 1, 0,
  0.5, 0.5, -0.5, 0, 1, 0,
  // -Y
  -0.5, -0.5, 0.5, 0, -1, 0,
  -0.5, -0.5, -0.5, 0, -1, 0,
  0.5, -0.5, -0.5, 0, -1, 0,
  0.5, -0.5, 0.5, 0, -1, 0,
  // +Z
  -0.5, -0.5, 0.5, 0, 0, 1,
  -0.5, 0.5, 0.5, 0, 0, 1,
  0.5, 0.5, 0.5, 0, 0, 1,
  0.5, -0.5, 0.5, 0, 0, 1,
  // -Z
  0.5, -0.5, -0.5, 0, 0, -1,
  0.5, 0.5, -0.5, 0, 0, -1,
  -0.5, 0.5, -0.5, 0, 0, -1,
  -0.5, -0.5, -0.5, 0, 0, -1,
]);

const CUBE_INDICES = new Uint32Array([
  0, 1, 2, 0, 2, 3,
  4, 5, 6, 4, 6, 7,
  8, 9, 10, 8, 10, 11,
  12, 13, 14, 12, 14, 15,
  16, 17, 18, 16, 18, 19,
  20, 21, 22, 20, 22, 23,
]);

const INSTANCE_FLOATS = 6; // offset.xyz + color.rgb
const INSTANCE_BYTES = INSTANCE_FLOATS * 4;
const INITIAL_CAP = 65536;

export class VoxelRenderer {
  private engine: WebGPUEngine;
  private pipeline: GPURenderPipeline;
  private vertexBuffer: GPUBuffer;
  private indexBuffer: GPUBuffer;
  private dummyBuffer: GPUBuffer;
  private instanceBuffer: GPUBuffer;
  private capacity = INITIAL_CAP;
  private instanceCount = 0;
  private bindGroup: GPUBindGroup;

  constructor(engine: WebGPUEngine, cameraBindGroup: GPUBindGroup) {
    this.engine = engine;
    const device = engine.device;
    const module = device.createShaderModule({ code: VOXEL_WGSL });

    this.vertexBuffer = device.createBuffer({
      size: CUBE_VERTS.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.vertexBuffer, 0, CUBE_VERTS);

    this.indexBuffer = device.createBuffer({
      size: CUBE_INDICES.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.indexBuffer, 0, CUBE_INDICES);

    this.dummyBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM });
    // 至少容纳 1 个实例，避免空场景下 storage 缓冲绑定大小为 0
    this.instanceBuffer = device.createBuffer({
      size: Math.max(this.capacity, 1) * INSTANCE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup = device.createBindGroup({
      layout: device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        ],
      }),
      entries: [
        { binding: 0, resource: { buffer: this.dummyBuffer } },
        { binding: 1, resource: { buffer: this.instanceBuffer } },
      ],
    });

    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [cameraBindGroupLayout(device), this.bindGroupLayout()],
      }),
      vertex: {
        module,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 24,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [{ format: engine.format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
      multisample: { count: 4 },
    });
    // cameraBindGroup 参数仅用于保持构造签名一致，实际布局由 cameraBindGroupLayout 统一
    void cameraBindGroup;
  }

  private bindGroupLayout(): GPUBindGroupLayout {
    return this.engine.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });
  }

  /** 依据可见层重建实例数据；返回实例数（即当前可见体素数） */
  update(layers: Layer[]): number {
    let total = 0;
    for (const l of layers) if (l.visible) total += l.voxels.size;
    if (total > this.capacity) {
      while (this.capacity < total) this.capacity *= 2;
      this.instanceBuffer.destroy();
      this.instanceBuffer = this.engine.device.createBuffer({
        size: this.capacity * INSTANCE_BYTES,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.bindGroup = this.engine.device.createBindGroup({
        layout: this.bindGroupLayout(),
        entries: [
          { binding: 0, resource: { buffer: this.dummyBuffer } },
          { binding: 1, resource: { buffer: this.instanceBuffer } },
        ],
      });
    }
    const data = new Float32Array(Math.max(total, 1) * INSTANCE_FLOATS);
    let i = 0;
    for (const layer of layers) {
      if (!layer.visible) continue;
      for (const [key, color] of layer.voxels) {
        const p = key.split(',');
        const w = voxelToWorld(Number(p[0]), Number(p[1]), Number(p[2]));
        const c = unpackColor(color);
        data[i * 6] = w[0];
        data[i * 6 + 1] = w[1];
        data[i * 6 + 2] = w[2];
        data[i * 6 + 3] = c.r / 255;
        data[i * 6 + 4] = c.g / 255;
        data[i * 6 + 5] = c.b / 255;
        i++;
      }
    }
    if (total > 0) this.engine.device.queue.writeBuffer(this.instanceBuffer, 0, data);
    this.instanceCount = total;
    return total;
  }

  draw(pass: GPURenderPassEncoder, cameraBindGroup: GPUBindGroup): void {
    if (this.instanceCount === 0) return;
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, cameraBindGroup);
    pass.setBindGroup(1, this.bindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setIndexBuffer(this.indexBuffer, 'uint32');
    pass.drawIndexed(CUBE_INDICES.length, this.instanceCount, 0, 0, 0);
  }
}

export function cameraBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ],
  });
}
