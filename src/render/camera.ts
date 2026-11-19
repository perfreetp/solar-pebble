// 轨道相机：透视 / 正交切换，屏幕坐标转世界射线
import {
  invert, multiply, normalize, ortho, perspective, lookAt,
  sub, transformPoint, type Mat4,
} from '../core/math';
import type { Vec3 } from '../core/types';

const FOV = (50 * Math.PI) / 180;
const MIN_R = 30;
const MAX_R = 180;

export class OrbitCamera {
  target: Vec3 = [0, 0, 0];
  yaw = 0.7;
  pitch = 0.42;
  radius = 105;
  ortho = false;
  aspect = 1;

  get eye(): Vec3 {
    const cp = Math.cos(this.pitch);
    return [
      this.target[0] + this.radius * cp * Math.sin(this.yaw),
      this.target[1] + this.radius * Math.sin(this.pitch),
      this.target[2] + this.radius * cp * Math.cos(this.yaw),
    ];
  }

  get forward(): Vec3 {
    return normalize(sub(this.target, this.eye));
  }

  get right(): Vec3 {
    const f = this.forward;
    const up: Vec3 = [0, 1, 0];
    return normalize([
      f[2] * up[1] - f[1] * up[2],
      f[0] * up[2] - f[2] * up[0],
      f[1] * up[0] - f[0] * up[1],
    ]);
  }

  rotate(dx: number, dy: number): void {
    this.yaw -= dx * 0.008;
    this.pitch = Math.min(Math.PI / 2 - 0.05, Math.max(-Math.PI / 2 + 0.05, this.pitch + dy * 0.008));
  }

  zoom(delta: number): void {
    this.radius = Math.min(MAX_R, Math.max(MIN_R, this.radius * Math.exp(delta * 0.0012)));
  }

  /** 自动绕飞（预览页用） */
  orbit(dt: number, speed = 0.35): void {
    this.yaw += dt * speed;
    this.pitch = Math.max(0.12, Math.min(1.1, this.pitch + Math.sin(this.yaw * 0.5) * dt * 0.02));
  }

  viewMatrix(): Mat4 {
    return lookAt(this.eye, this.target, [0, 1, 0]);
  }

  projMatrix(): Mat4 {
    if (this.ortho) {
      const half = this.radius * Math.tan(FOV / 2);
      const h = half;
      const w = half * this.aspect;
      return ortho(-w, w, -h, h, 0.1, 1000);
    }
    return perspective(FOV, this.aspect, 0.1, 1000);
  }

  viewProj(): Mat4 {
    return multiply(this.projMatrix(), this.viewMatrix());
  }

  /**
   * NDC 坐标（x,y ∈ [-1,1]）转射线。
   * 透视：从眼睛出发的方向；正交：与视线平行、过偏移视点。
   */
  screenToRay(ndcX: number, ndcY: number): { origin: Vec3; dir: Vec3 } {
    if (!this.ortho) {
      const inv = invert(this.viewProj());
      const near = transformPoint(inv, [ndcX, ndcY, 0]);
      const far = transformPoint(inv, [ndcX, ndcY, 1]);
      return { origin: this.eye, dir: normalize(sub(far, near)) };
    }
    const half = this.radius * Math.tan(FOV / 2);
    const right = this.right;
    const f = this.forward;
    const up: Vec3 = [
      f[1] * right[2] - f[2] * right[1],
      f[2] * right[0] - f[0] * right[2],
      f[0] * right[1] - f[1] * right[0],
    ];
    const origin: Vec3 = [
      this.eye[0] + right[0] * ndcX * half * this.aspect + up[0] * ndcY * half,
      this.eye[1] + right[1] * ndcX * half * this.aspect + up[1] * ndcY * half,
      this.eye[2] + right[2] * ndcX * half * this.aspect + up[2] * ndcY * half,
    ];
    return { origin, dir: f };
  }
}
