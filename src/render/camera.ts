/**
 * 视口相机: 世界坐标 (m, y 向北) ↔ 屏幕像素。
 */

export interface CameraState {
  centerX: number;
  centerY: number;
  /** 像素/米 */
  scale: number;
}

export interface BoundsLike {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export class Camera {
  centerX = 0;
  centerY = 0;
  scale = 0.5;

  clone(): CameraState {
    return { centerX: this.centerX, centerY: this.centerY, scale: this.scale };
  }

  set(s: CameraState): void {
    this.centerX = s.centerX;
    this.centerY = s.centerY;
    this.scale = s.scale;
  }

  fit(bounds: BoundsLike, width: number, height: number, padding = 48): void {
    const w = Math.max(1, bounds.maxX - bounds.minX);
    const h = Math.max(1, bounds.maxY - bounds.minY);
    const sx = (width - padding * 2) / w;
    const sy = (height - padding * 2) / h;
    this.scale = Math.max(0.02, Math.min(sx, sy));
    this.centerX = (bounds.minX + bounds.maxX) / 2;
    this.centerY = (bounds.minY + bounds.maxY) / 2;
  }

  worldToScreen(x: number, y: number, width: number, height: number): { x: number; y: number } {
    return {
      x: (x - this.centerX) * this.scale + width / 2,
      y: height / 2 - (y - this.centerY) * this.scale,
    };
  }

  screenToWorld(px: number, py: number, width: number, height: number): { x: number; y: number } {
    return {
      x: (px - width / 2) / this.scale + this.centerX,
      y: (height / 2 - py) / this.scale + this.centerY,
    };
  }

  /** 以屏幕某点为锚点缩放 */
  zoomAt(factor: number, px: number, py: number, width: number, height: number): void {
    const before = this.screenToWorld(px, py, width, height);
    this.scale = Math.max(0.005, Math.min(60, this.scale * factor));
    const after = this.screenToWorld(px, py, width, height);
    this.centerX += before.x - after.x;
    this.centerY += before.y - after.y;
  }

  pan(dxPx: number, dyPx: number): void {
    this.centerX -= dxPx / this.scale;
    this.centerY += dyPx / this.scale;
  }
}
