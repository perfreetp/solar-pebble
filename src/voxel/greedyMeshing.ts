import * as THREE from 'three';
import type { LayerId } from '../types';
import { LAYERS, VOXEL_SIZE, keyOf, parseKey } from './constants';
import { voxelStore } from './voxelStore';

// 六个面方向:d 轴为法线,另外两个轴为面内 u/v
interface FaceDef {
  dir: [number, number, number];
  uAxis: 0 | 1 | 2;
  vAxis: 0 | 1 | 2;
}

const FACES: FaceDef[] = [
  { dir: [1, 0, 0], uAxis: 2, vAxis: 1 }, // +x
  { dir: [-1, 0, 0], uAxis: 2, vAxis: 1 }, // -x
  { dir: [0, 1, 0], uAxis: 0, vAxis: 2 }, // +y
  { dir: [0, -1, 0], uAxis: 0, vAxis: 2 }, // -y
  { dir: [0, 0, 1], uAxis: 0, vAxis: 1 }, // +z
  { dir: [0, 0, -1], uAxis: 0, vAxis: 1 }, // -z
];

interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

function computeBounds(keys: Iterable<string>): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const k of keys) {
    const c = parseKey(k);
    min[0] = Math.min(min[0], c.x);
    min[1] = Math.min(min[1], c.y);
    min[2] = Math.min(min[2], c.z);
    max[0] = Math.max(max[0], c.x);
    max[1] = Math.max(max[1], c.y);
    max[2] = Math.max(max[2], c.z);
  }
  return { min, max };
}

/**
 * 贪婪网格化(greedy meshing):
 * 对每个面方向、沿法线逐层扫描,把同层相邻且同属一个编辑层的暴露面
 * 合并成尽可能大的四边形。体素硬边地形因此先在拓扑层面大幅降面,
 * 再交给 meshopt 减面时就能逼近目标比例。
 *
 * 每层返回一个带索引、带法线的 BufferGeometry(世界坐标,单位米)。
 */
export function buildGreedyGeometries(): Map<LayerId, THREE.BufferGeometry> {
  const data = voxelStore.snapshot();
  const layerOf = new Map<string, LayerId>();
  const occupied = new Set<string>();
  for (const { coord, layer } of data) {
    const k = keyOf(coord.x, coord.y, coord.z);
    occupied.add(k);
    layerOf.set(k, layer);
  }
  const bounds = computeBounds(occupied);
  const result = new Map<LayerId, { positions: number[]; normals: number[]; indices: number[] }>();

  for (const meta of LAYERS) {
    result.set(meta.id, { positions: [], normals: [], indices: [] });
  }

  const axes: [0, 1, 2] = [0, 1, 2];

  for (const face of FACES) {
    const dAxis = axes.find((a) => face.dir[a] !== 0)!;
    const uAxis = face.uAxis;
    const vAxis = face.vAxis;
    const dSign = face.dir[dAxis];

    // 沿法线方向扫描每一层切片
    for (let d = bounds.min[dAxis]; d <= bounds.max[dAxis] + 1; d++) {
      // mask: 当前 d 层每个 (u,v) 格子是否存在一个朝该方向的暴露面
      const uSize = bounds.max[uAxis] - bounds.min[uAxis] + 1;
      const vSize = bounds.max[vAxis] - bounds.min[vAxis] + 1;
      const mask = new Array<LayerId | null>(uSize * vSize).fill(null);

      for (let v = 0; v < vSize; v++) {
        for (let u = 0; u < uSize; u++) {
          const cur: [number, number, number] = [0, 0, 0];
          cur[dAxis] = d - (dSign > 0 ? 0 : 1);
          cur[uAxis] = bounds.min[uAxis] + u;
          cur[vAxis] = bounds.min[vAxis] + v;
          const curKey = keyOf(cur[0], cur[1], cur[2]);
          const layer = layerOf.get(curKey);
          if (!layer) continue;
          const nbr: [number, number, number] = [cur[0], cur[1], cur[2]];
          nbr[dAxis] = cur[dAxis] + dSign;
          // 相邻同层体素的面被遮挡;相邻是别的层也视为遮挡(层间保留边界)
          if (occupied.has(keyOf(nbr[0], nbr[1], nbr[2]))) continue;
          mask[v * uSize + u] = layer;
        }
      }

      // 在 mask 上做矩形合并
      let v = 0;
      while (v < vSize) {
        let u = 0;
        while (u < uSize) {
          const layer = mask[v * uSize + u];
          if (!layer) {
            u++;
            continue;
          }
          // 计算横向最大宽度
          let w = 1;
          while (u + w < uSize && mask[v * uSize + u + w] === layer) w++;
          // 向下扩展高度:整行同宽且同层
          let h = 1;
          outer: while (v + h < vSize) {
            for (let du = 0; du < w; du++) {
              if (mask[(v + h) * uSize + u + du] !== layer) break outer;
            }
            h++;
          }
          // 清除已合并区域
          for (let dv = 0; dv < h; dv++) {
            for (let du = 0; du < w; du++) {
              mask[(v + dv) * uSize + u + du] = null;
            }
          }

          // 四边形四个角的体素坐标(世界坐标用体素边长换算)
          const base: [number, number, number] = [0, 0, 0];
          base[dAxis] = d;
          base[uAxis] = bounds.min[uAxis] + u;
          base[vAxis] = bounds.min[vAxis] + v;
          const du: [number, number, number] = [0, 0, 0];
          du[uAxis] = w;
          const dv: [number, number, number] = [0, 0, 0];
          dv[vAxis] = h;

          emitQuad(result.get(layer)!, face.dir, base, du, dv);
          u += w;
        }
        v++;
      }
    }
  }

  const geometries = new Map<LayerId, THREE.BufferGeometry>();
  for (const meta of LAYERS) {
    const buf = result.get(meta.id)!;
    if (buf.indices.length === 0) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.normals, 3));
    geo.setIndex(buf.indices);
    geo.computeBoundingSphere();
    geometries.set(meta.id, geo);
  }
  return geometries;
}

/**
 * 输出一个世界空间四边形(两个三角形)。
 * 角顺序按 n = u × v 的右手系构造,保证三角形绕序与面法线一致(正面朝外)。
 */
function emitQuad(
  out: { positions: number[]; normals: number[]; indices: number[] },
  dir: [number, number, number],
  base: [number, number, number],
  du: [number, number, number],
  dv: [number, number, number],
) {
  const p0 = base;
  const p1: [number, number, number] = [
    base[0] + du[0],
    base[1] + du[1],
    base[2] + du[2],
  ];
  const p2: [number, number, number] = [
    base[0] + du[0] + dv[0],
    base[1] + du[1] + dv[1],
    base[2] + du[2] + dv[2],
  ];
  const p3: [number, number, number] = [
    base[0] + dv[0],
    base[1] + dv[1],
    base[2] + dv[2],
  ];
  const corners = [p0, p1, p2, p3];
  const start = out.positions.length / 3;
  for (const c of corners) {
    out.positions.push(c[0] * VOXEL_SIZE, c[1] * VOXEL_SIZE, c[2] * VOXEL_SIZE);
    out.normals.push(dir[0], dir[1], dir[2]);
  }
  // 验证 (p1-p0) × (p3-p0) 是否朝向法线;反向则翻转绕序
  const cx = du[1] * dv[2] - du[2] * dv[1];
  const cy = du[2] * dv[0] - du[0] * dv[2];
  const cz = du[0] * dv[1] - du[1] * dv[0];
  const dot = cx * dir[0] + cy * dir[1] + cz * dir[2];
  if (dot > 0) {
    // u × v 与法线同向:标准绕序
    out.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  } else {
    // 反向:翻转三角形绕序,保证正面朝外
    out.indices.push(start, start + 2, start + 1, start, start + 3, start + 2);
  }
}
