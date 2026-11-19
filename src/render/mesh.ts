/**
 * 潮沟几何 → WebGPU 顶点。
 *
 * 每段中心线生成一个"胶囊"四边形 (端点 + 半径)。片元着色器按点到线段的距离
 * 与插值半径做 SDF 裁切, 因此:
 *   - 段与段之间自动融合为圆角交汇 (圆角过渡);
 *   - 沟头/沟口得到半圆端帽 (沟头自然收尾);
 *   - 宽度沿程线性插值, 实现逐级宽度衰减;
 *   - 抗锯齿由 fwidth 完成, 与缩放无关。
 */

export const VERTEX_FLOATS = 14; // pos(2) a(2) b(2) radii(2) color(3) meta(3)

export interface ScreenParams {
  /** 世界 → 像素 */
  scale: number;
  width: number;
  height: number;
  /** 线宽下限 (像素) */
  minHalfWidthPx: number;
}

export interface CreekGeo {
  id: string;
  level: number;
  pts: Float64Array;
  widths: Float32Array;
  color: [number, number, number];
  selected: boolean;
  alpha: number;
}

export interface MeshData {
  vertices: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  indexCount: number;
}

const F = VERTEX_FLOATS;

export function buildMesh(creeks: CreekGeo[], screen: ScreenParams): MeshData {
  // 预估值, 避免反复扩容
  let segs = 0;
  for (const c of creeks) segs += Math.max(0, c.pts.length / 2 - 1);
  const verts = new Float32Array(Math.max(4, segs * 4 * F));
  const indices = new Uint32Array(Math.max(6, segs * 6));
  let v = 0;
  let ii = 0;
  let vi = 0; // 顶点序号

  const minR = screen.minHalfWidthPx / Math.max(1e-6, screen.scale);

  for (const c of creeks) {
    const n = c.pts.length / 2;
    if (n < 2 || c.alpha <= 0.001) {
      continue;
    }
    for (let i = 0; i < n - 1; i++) {
      const ax = c.pts[i * 2];
      const ay = c.pts[i * 2 + 1];
      const bx = c.pts[i * 2 + 2];
      const by = c.pts[i * 2 + 3];
      const ra = Math.max(minR, Math.max(c.widths[i], 0.12) * 0.5);
      const rb = Math.max(minR, Math.max(c.widths[i + 1], 0.12) * 0.5);
      let dx = bx - ax;
      let dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      dx /= len;
      dy /= len;
      const nx = -dy;
      const ny = dx;

      // 胶囊包围盒: 两端各外扩半径
      const corners: [number, number][] = [
        [ax - dx * ra + nx * ra, ay - dy * ra + ny * ra],
        [ax - dx * ra - nx * ra, ay - dy * ra - ny * ra],
        [bx + dx * rb + nx * rb, by + dy * rb + ny * rb],
        [bx + dx * rb - nx * rb, by + dy * rb - ny * rb],
      ];
      for (const [px, py] of corners) {
        verts[v++] = px;
        verts[v++] = py;
        verts[v++] = ax;
        verts[v++] = ay;
        verts[v++] = bx;
        verts[v++] = by;
        verts[v++] = ra;
        verts[v++] = rb;
        verts[v++] = c.color[0];
        verts[v++] = c.color[1];
        verts[v++] = c.color[2];
        verts[v++] = c.level;
        verts[v++] = c.alpha;
        verts[v++] = c.selected ? 1 : 0;
      }
      const base = vi;
      indices[ii++] = base;
      indices[ii++] = base + 1;
      indices[ii++] = base + 2;
      indices[ii++] = base + 1;
      indices[ii++] = base + 3;
      indices[ii++] = base + 2;
      vi += 4;
    }
  }

  return {
    vertices: verts.subarray(0, v),
    indices: indices.subarray(0, ii),
    vertexCount: vi,
    indexCount: ii,
  };
}
