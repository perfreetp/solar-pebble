// 场景：组合引擎/相机/渲染器，负责帧循环与覆盖层构建
import { WebGPUEngine } from './engine';
import { OrbitCamera } from './camera';
import { VoxelRenderer, cameraBindGroupLayout } from './voxel-renderer';
import { OverlayRenderer, type OverlayFace, type OverlayLine } from './overlay-renderer';
import { GRID, MIRROR_PLANE, type Layer, type Vec3 } from '../core/types';
import { voxelToWorld } from '../core/voxel-model';
import type { Bounds } from '../core/ops';

const HALF = GRID / 2;

export interface HoverState {
  voxel: Vec3;
  normal: Vec3;
  /** 高亮模式：命中已有体素=面高亮；空白落点=幽灵预览 */
  kind: 'face' | 'ghost';
}

export class VoxelScene {
  engine: WebGPUEngine;
  camera = new OrbitCamera();
  private voxelRenderer: VoxelRenderer;
  private overlayRenderer: OverlayRenderer;
  private cameraBuffer: GPUBuffer;
  private cameraBindGroup: GPUBindGroup;
  private raf = 0;
  private running = false;
  private lastT = 0;
  private autoOrbit = false;

  // 当前覆盖层状态
  hover: HoverState | null = null;
  hoverColor: [number, number, number] = [0.2, 0.9, 1];
  showMirrorPlane = false;
  selectionBounds: Bounds | null = null;
  /** 粘贴幽灵：格坐标 + 颜色（世界坐标框） */
  pasteGhost: { min: Vec3; max: Vec3 } | null = null;
  private visibleVoxelCount = 0;

  onBeforeFrame?: (dt: number) => void;

  private constructor(engine: WebGPUEngine) {
    this.engine = engine;
    const device = engine.device;
    this.cameraBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.cameraBindGroup = device.createBindGroup({
      layout: cameraBindGroupLayout(device),
      entries: [{ binding: 0, resource: { buffer: this.cameraBuffer } }],
    });
    this.voxelRenderer = new VoxelRenderer(engine, this.cameraBindGroup);
    this.overlayRenderer = new OverlayRenderer(engine);
  }

  static async create(canvas: HTMLCanvasElement): Promise<VoxelScene> {
    const engine = await WebGPUEngine.create(canvas);
    const scene = new VoxelScene(engine);
    scene.camera.aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    return scene;
  }

  get voxelCount(): number {
    return this.visibleVoxelCount;
  }

  setOrtho(on: boolean): void {
    this.camera.ortho = on;
  }

  setAutoOrbit(on: boolean): void {
    this.autoOrbit = on;
  }

  updateVoxels(layers: Layer[]): void {
    this.visibleVoxelCount = this.voxelRenderer.update(layers);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (t: number): void => {
      if (!this.running) return;
      const dt = this.lastT ? Math.min(0.05, (t - this.lastT) / 1000) : 0;
      this.lastT = t;
      this.onBeforeFrame?.(dt);
      if (this.autoOrbit) this.camera.orbit(dt);
      this.renderFrame();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  replaceCanvas(canvas: HTMLCanvasElement): void {
    this.engine.replaceCanvas(canvas);
    this.camera.aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  }

  destroy(): void {
    this.stop();
    this.engine.destroy();
  }

  resize(): void {
    this.engine.resize();
    this.camera.aspect = this.engine.canvas.clientWidth / Math.max(1, this.engine.canvas.clientHeight);
  }

  private renderFrame(): void {
    this.resize();
    const vp = this.camera.viewProj();
    this.engine.device.queue.writeBuffer(this.cameraBuffer, 0, vp.buffer as ArrayBuffer, vp.byteOffset, vp.byteLength);

    const { lines, faces } = this.buildOverlays();
    this.overlayRenderer.update(lines, faces);

    this.engine.frame([0.055, 0.07, 0.095, 1], (pass) => {
      this.voxelRenderer.draw(pass, this.cameraBindGroup);
      this.overlayRenderer.draw(pass, this.cameraBindGroup);
    });
  }

  // ---------- 覆盖层 ----------

  private buildOverlays(): { lines: OverlayLine[]; faces: OverlayFace[] } {
    const lines: OverlayLine[] = [];
    const faces: OverlayFace[] = [];
    const gridColor: [number, number, number] = [0.28, 0.34, 0.42];
    const selColor: [number, number, number] = [1, 0.78, 0.25];
    const mirrorColor: [number, number, number] = [0.35, 0.85, 1];

    // 地面网格（y = -HALF 平面）
    for (let i = 0; i <= GRID; i += 8) {
      const p = -HALF + i;
      lines.push(
        { a: [p, -HALF, -HALF], b: [p, -HALF, HALF], color: gridColor, alpha: 0.35 },
        { a: [-HALF, -HALF, p], b: [HALF, -HALF, p], color: gridColor, alpha: 0.35 },
      );
    }
    // 网格边界盒
    this.pushBoxLines(lines, [-HALF, -HALF, -HALF], [HALF, HALF, HALF], gridColor, 0.5);

    if (this.showMirrorPlane) {
      const px = MIRROR_PLANE - HALF + 0.5;
      faces.push({
        corners: [
          [px, -HALF, -HALF], [px, HALF, -HALF],
          [px, HALF, HALF], [px, -HALF, HALF],
        ],
        color: mirrorColor,
        alpha: 0.08,
      });
      lines.push(
        { a: [px, -HALF, -HALF], b: [px, HALF, -HALF], color: mirrorColor, alpha: 0.6 },
        { a: [px, HALF, -HALF], b: [px, HALF, HALF], color: mirrorColor, alpha: 0.6 },
        { a: [px, HALF, HALF], b: [px, -HALF, HALF], color: mirrorColor, alpha: 0.6 },
        { a: [px, -HALF, HALF], b: [px, -HALF, -HALF], color: mirrorColor, alpha: 0.6 },
      );
    }

    if (this.hover) {
      const { voxel, normal } = this.hover;
      const center = voxelToWorld(voxel[0], voxel[1], voxel[2]);
      const corners = this.faceCorners(center, normal, 0.515);
      faces.push({ corners, color: this.hoverColor, alpha: this.hover.kind === 'ghost' ? 0.35 : 0.55 });
      for (let i = 0; i < 4; i++) {
        lines.push({ a: corners[i], b: corners[(i + 1) % 4], color: this.hoverColor, alpha: 0.95 });
      }
    }

    if (this.selectionBounds) {
      const b = this.selectionBounds;
      const mn: Vec3 = [b.min[0] - HALF, b.min[1] - HALF, b.min[2] - HALF];
      const mx: Vec3 = [b.max[0] - HALF + 1, b.max[1] - HALF + 1, b.max[2] - HALF + 1];
      this.pushBoxLines(lines, mn, mx, selColor, 0.95);
      faces.push({
        corners: [mn, [mx[0], mn[1], mn[2]], [mx[0], mx[1], mn[2]], [mn[0], mx[1], mn[2]]],
        color: selColor, alpha: 0.07,
      });
    }

    if (this.pasteGhost) {
      const { min, max } = this.pasteGhost;
      const mn: Vec3 = [min[0] - HALF, min[1] - HALF, min[2] - HALF];
      const mx: Vec3 = [max[0] - HALF + 1, max[1] - HALF + 1, max[2] - HALF + 1];
      this.pushBoxLines(lines, mn, mx, [0.45, 1, 0.6], 0.9);
    }
    return { lines, faces };
  }

  private faceCorners(center: Vec3, n: Vec3, half: number): [number, number, number][] {
    const [cx, cy, cz] = center;
    if (n[0] !== 0) {
      const x = cx + n[0] * half;
      return [[x, cy - half, cz - half], [x, cy + half, cz - half], [x, cy + half, cz + half], [x, cy - half, cz + half]];
    }
    if (n[1] !== 0) {
      const y = cy + n[1] * half;
      return [[cx - half, y, cz - half], [cx + half, y, cz - half], [cx + half, y, cz + half], [cx - half, y, cz + half]];
    }
    const z = cz + n[2] * half;
    return [[cx - half, cy - half, z], [cx + half, cy - half, z], [cx + half, cy + half, z], [cx - half, cy + half, z]];
  }

  private pushBoxLines(
    lines: OverlayLine[],
    mn: Vec3,
    mx: Vec3,
    color: [number, number, number],
    alpha: number,
  ): void {
    const [x0, y0, z0] = mn;
    const [x1, y1, z1] = mx;
    const pts: Vec3[] = [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    ];
    const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    for (const [a, b] of edges) {
      lines.push({ a: pts[a], b: pts[b], color, alpha });
    }
  }
}
