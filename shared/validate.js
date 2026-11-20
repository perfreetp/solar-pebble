/**
 * 合并前体检：悬空体素簇 + 薄壁检测。
 * 编辑器、服务端提交接口、导出前检查共用这一份逻辑。
 *
 * 悬空体 = 与主体不连通的体素簇（6 邻域），块数超过阈值才提示。
 * 薄壁   = 某一轴向的连续实体厚度小于阈值（默认 2 格）。
 */

import { AIR } from './voxel.js';
import { MATERIAL_BY_ID } from './materials.js';

const NEIGHBORS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/**
 * 6 邻域连通分量标记。返回按体素数降序排列的分量列表。
 * @param {import('./voxel.js').VoxelModel} model
 */
export function labelComponents(model) {
  const { sizeX, sizeY, sizeZ, bytes, strideY, strideZ } = model;
  const total = model.total;
  const labels = new Int32Array(total).fill(-1);
  const queue = new Int32Array(total);
  const components = [];

  for (let z = 0; z < sizeZ; z++) {
    for (let y = 0; y < sizeY; y++) {
      for (let x = 0; x < sizeX; x++) {
        const start = 1 + x + (y + 1) * strideY + (z + 1) * strideZ;
        if (bytes[start] === AIR || labels[start] !== -1) continue;
        const id = components.length;
        let head = 0;
        let tail = 0;
        queue[tail++] = start;
        labels[start] = id;
        let count = 0;
        let bx0 = Infinity, by0 = Infinity, bz0 = Infinity;
        let bx1 = -Infinity, by1 = -Infinity, bz1 = -Infinity;
        let touchesGround = false;
        const matCounts = new Map();
        while (head < tail) {
          const i = queue[head++];
          count++;
          const m = bytes[i];
          matCounts.set(m, (matCounts.get(m) || 0) + 1);
          const { x: cx, y: cy, z: cz } = coordsOfIndex(i, model);
          if (cx < bx0) bx0 = cx;
          if (cy < by0) by0 = cy;
          if (cz < bz0) bz0 = cz;
          if (cx > bx1) bx1 = cx;
          if (cy > by1) by1 = cy;
          if (cz > bz1) bz1 = cz;
          if (cz === 0) touchesGround = true;
          for (let d = 0; d < 6; d++) {
            const n = i + NEIGHBORS[d][0] + NEIGHBORS[d][1] * strideY + NEIGHBORS[d][2] * strideZ;
            if (bytes[n] !== AIR && labels[n] === -1) {
              labels[n] = id;
              queue[tail++] = n;
            }
          }
        }
        let dominant = 0;
        let best = -1;
        for (const [m, c] of matCounts) {
          if (c > best) {
            best = c;
            dominant = m;
          }
        }
        components.push({
          id,
          count,
          bbox: { x0: bx0, y0: by0, z0: bz0, x1: bx1, y1: by1, z1: bz1 },
          center: { x: (bx0 + bx1 + 1) / 2, y: (by0 + by1 + 1) / 2, z: (bz0 + bz1 + 1) / 2 },
          touchesGround,
          dominantMaterial: dominant,
          materials: Object.fromEntries(matCounts),
        });
      }
    }
  }
  components.sort((a, b) => b.count - a.count);
  return { components, labels };
}

function coordsOfIndex(i, model) {
  const x = (i % model.strideY) - 1;
  const y = (Math.floor(i / model.strideY) % model.py) - 1;
  const z = Math.floor(i / model.strideZ) - 1;
  return { x, y, z };
}

/**
 * 计算每个体素在 X/Y/Z 三个轴向上的连续实体长度与暴露面标记（cap 255）。
 * 返回 { rx, ry, rz, nx, ny, nz }，均为按扁平索引的 Uint8Array。
 */
export function thicknessMaps(model) {
  const { sizeX, sizeY, sizeZ, bytes, strideY, strideZ, total } = model;
  const rx = new Uint8Array(total);
  const ry = new Uint8Array(total);
  const rz = new Uint8Array(total);
  const nx = new Uint8Array(total);
  const ny = new Uint8Array(total);
  const nz = new Uint8Array(total);

  // X 方向
  for (let z = 0; z < sizeZ; z++) {
    for (let y = 0; y < sizeY; y++) {
      const base = 1 + (y + 1) * strideY + (z + 1) * strideZ;
      let run = 0;
      for (let x = 0; x <= sizeX; x++) {
        const occ = x < sizeX && bytes[base + x] !== AIR;
        if (occ) run++;
        else if (run > 0) {
          // 行程贴到网格边界时无法判定真实壁厚，按“厚”处理，避免误报
          const v = x - run === 0 || x === sizeX ? 255 : Math.min(run, 255);
          for (let k = x - run; k < x; k++) rx[base + k] = v;
          run = 0;
        }
      }
    }
  }
  // Y 方向
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      const base = 1 + x + strideY + (z + 1) * strideZ;
      let run = 0;
      for (let y = 0; y <= sizeY; y++) {
        const i = base + y * strideY;
        const occ = y < sizeY && bytes[i] !== AIR;
        if (occ) run++;
        else if (run > 0) {
          const v = y - run === 0 || y === sizeY ? 255 : Math.min(run, 255);
          for (let k = y - run; k < y; k++) ry[base + k * strideY] = v;
          run = 0;
        }
      }
    }
  }
  // Z 方向
  for (let y = 0; y < sizeY; y++) {
    for (let x = 0; x < sizeX; x++) {
      const base = 1 + x + (y + 1) * strideY + strideZ;
      let run = 0;
      for (let z = 0; z <= sizeZ; z++) {
        const i = base + z * strideZ;
        const occ = z < sizeZ && bytes[i] !== AIR;
        if (occ) run++;
        else if (run > 0) {
          const v = z - run === 0 ? 255 : Math.min(run, 255);
          for (let k = z - run; k < z; k++) rz[base + k * strideZ] = v;
          run = 0;
        }
      }
    }
  }
  // 暴露面：沿该轴有一侧是空气
  for (let z = 0; z < sizeZ; z++) {
    for (let y = 0; y < sizeY; y++) {
      const base = 1 + (y + 1) * strideY + (z + 1) * strideZ;
      for (let x = 0; x < sizeX; x++) {
        if (bytes[base + x] === AIR) continue;
        if (bytes[base + x - 1] === AIR || bytes[base + x + 1] === AIR) nx[base + x] = 1;
      }
    }
  }
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      const base = 1 + x + strideY + (z + 1) * strideZ;
      for (let y = 0; y < sizeY; y++) {
        const i = base + y * strideY;
        if (bytes[i] === AIR) continue;
        if (bytes[i - strideY] === AIR || bytes[i + strideY] === AIR) ny[i] = 1;
      }
    }
  }
  for (let y = 0; y < sizeY; y++) {
    for (let x = 0; x < sizeX; x++) {
      const base = 1 + x + (y + 1) * strideY + strideZ;
      for (let z = 0; z < sizeZ; z++) {
        const i = base + z * strideZ;
        if (bytes[i] === AIR) continue;
        if (bytes[i - strideZ] === AIR || bytes[i + strideZ] === AIR) nz[i] = 1;
      }
    }
  }
  return { rx, ry, rz, nx, ny, nz };
}

/**
 * 法向壁厚：只在暴露面所在的轴向取连续实体长度。
 * 如果一个体素没有任何暴露轴（完全被包住），返回 255（视为厚）。
 */
export function wallThicknessOf(i, nx, ny, nz, rx, ry, rz) {
  let t = 255;
  if (nx[i] && rx[i] < t) t = rx[i];
  if (ny[i] && ry[i] < t) t = ry[i];
  if (nz[i] && rz[i] < t) t = rz[i];
  return t;
}

/**
 * 完整体检。
 * @param {import('./voxel.js').VoxelModel} model
 * @param {{floatingMin?:number, minWall?:number, maxAreas?:number}} [opts]
 */
export function analyzeModel(model, opts = {}) {
  const floatingMin = Math.max(1, opts.floatingMin ?? 5);
  const minWall = Math.max(2, opts.minWall ?? 2);
  const maxAreas = opts.maxAreas ?? 40;

  const { components, labels } = labelComponents(model);
  const main = components[0] || null;

  const floating = components
    .filter((c) => c !== main && c.count > floatingMin)
    .map((c) => ({
      id: c.id,
      count: c.count,
      bbox: c.bbox,
      center: c.center,
      material: MATERIAL_BY_ID[c.dominantMaterial]?.name || '未知',
      touchesGround: c.touchesGround,
    }));

  const smallDebris = components.filter((c) => c !== main && c.count <= floatingMin).length;

  // ---- 薄壁
  // 壁厚取“法向壁厚”：只有某个轴向为该体素的暴露面（该侧是空气）时，
  // 这一轴的连续实体长度才算作壁厚。圆柱壳切线方向的短行程因此不会被误判。
  const { rx, ry, rz, nx, ny, nz } = thicknessMaps(model);
  const thinFlags = new Uint8Array(model.total);
  const thinThick = new Uint8Array(model.total);
  let thinCount = 0;
  model.forEach((x, y, z, m, i) => {
    const t = wallThicknessOf(i, nx, ny, nz, rx, ry, rz);
    thinThick[i] = Math.min(t, 255);
    if (t < minWall) {
      thinFlags[i] = 1;
      thinCount++;
    }
  });
  // 薄壁连通区域
  const thinAreas = [];
  if (thinCount) {
    const visited = new Uint8Array(model.total);
    const stack = [];
    const { sizeX, sizeY, sizeZ, bytes, strideY, strideZ } = model;
    for (let z = 0; z < sizeZ; z++) {
      for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
          const start = 1 + x + (y + 1) * strideY + (z + 1) * strideZ;
          if (!thinFlags[start] || visited[start]) continue;
          let count = 0;
          let bx0 = Infinity, by0 = Infinity, bz0 = Infinity;
          let bx1 = -Infinity, by1 = -Infinity, bz1 = -Infinity;
          let minT = 255;
          const mats = new Map();
          stack.push(start);
          visited[start] = 1;
          while (stack.length) {
            const i = stack.pop();
            count++;
            const t = thinThick[i];
            if (t < minT) minT = t;
            const mm = bytes[i];
            mats.set(mm, (mats.get(mm) || 0) + 1);
            const c = coordsOfIndex(i, model);
            if (c.x < bx0) bx0 = c.x;
            if (c.y < by0) by0 = c.y;
            if (c.z < bz0) bz0 = c.z;
            if (c.x > bx1) bx1 = c.x;
            if (c.y > by1) by1 = c.y;
            if (c.z > bz1) bz1 = c.z;
            for (let d = 0; d < 6; d++) {
              const n = i + NEIGHBORS[d][0] + NEIGHBORS[d][1] * strideY + NEIGHBORS[d][2] * strideZ;
              if (thinFlags[n] && !visited[n]) {
                visited[n] = 1;
                stack.push(n);
              }
            }
          }
          let dominant = 0;
          let best = -1;
          for (const [mm, cc] of mats) {
            if (cc > best) {
              best = cc;
              dominant = mm;
            }
          }
          thinAreas.push({
            count,
            minThickness: minT,
            materials: Object.fromEntries(mats),
            dominantMaterial: dominant,
            bbox: { x0: bx0, y0: by0, z0: bz0, x1: bx1, y1: by1, z1: bz1 },
            center: { x: (bx0 + bx1 + 1) / 2, y: (by0 + by1 + 1) / 2, z: (bz0 + bz1 + 1) / 2 },
          });
        }
      }
    }
    thinAreas.sort((a, b) => b.count - a.count);
  }

  const issues = [];
  if (floating.length) {
    const total = floating.reduce((a, f) => a + f.count, 0);
    issues.push({
      code: 'floating',
      severity: 'error',
      title: '悬空体素簇',
      detail: `${floating.length} 个簇与主体不连通，共 ${total} 格（阈值 >${floatingMin} 格）`,
      count: floating.length,
      cells: total,
    });
  }
  if (main && !main.touchesGround) {
    issues.push({
      code: 'unlanded',
      severity: 'warn',
      title: '主体未接触基准面',
      detail: '整个模型没有落在 Z=0 基准层，合并后可能整体悬浮',
      count: 1,
      cells: main.count,
    });
  }
  if (thinAreas.length) {
    const total = thinAreas.reduce((a, f) => a + f.count, 0);
    issues.push({
      code: 'thinWall',
      severity: 'warn',
      title: '薄壁区域',
      detail: `${thinAreas.length} 处壁厚 < ${minWall} 格，共 ${total} 格，最薄 ${Math.min(...thinAreas.map((t) => t.minThickness))} 格`,
      count: thinAreas.length,
      cells: total,
    });
  }
  if (smallDebris) {
    issues.push({
      code: 'debris',
      severity: 'info',
      title: '零碎体素',
      detail: `${smallDebris} 个不超过 ${floatingMin} 格的零散簇（不阻塞合并，建议清理）`,
      count: smallDebris,
      cells: components.filter((c) => c !== main && c.count <= floatingMin).reduce((a, c) => a + c.count, 0),
    });
  }

  return {
    ok: !issues.some((i) => i.severity === 'error'),
    issues,
    components: components.length,
    mainComponent: main
      ? { id: main.id, count: main.count, bbox: main.bbox, touchesGround: main.touchesGround }
      : null,
    floating: floating.slice(0, maxAreas),
    floatingTotal: floating.length,
    thinAreas: thinAreas.slice(0, maxAreas),
    thinTotal: thinAreas.length,
    thinCells: thinCount,
    smallDebris,
    floatingMin,
    minWall,
    stats: model.stats(),
  };
}

/**
 * 把体检区域转成可点击定位的“问题标记”列表。
 */
export function issueMarkers(analysis) {
  const markers = [];
  for (const f of analysis.floating) {
    markers.push({
      kind: 'floating',
      label: `悬空簇 ${f.count} 格`,
      bbox: f.bbox,
      center: f.center,
      severity: 'error',
    });
  }
  for (const t of analysis.thinAreas) {
    markers.push({
      kind: 'thin',
      label: `薄壁 ${t.count} 格 · 最薄 ${t.minThickness}`,
      bbox: t.bbox,
      center: t.center,
      severity: 'warn',
    });
  }
  return markers;
}
