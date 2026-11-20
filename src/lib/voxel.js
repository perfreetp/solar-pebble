// 体素核心数据结构与纯逻辑(不依赖 Svelte / Babylon,方便测试与复用)

export const GRID_SIZE = 24; // 24 x 24 x 24 的体素网格
export const MIRROR_AXIS = 'x'; // X 轴镜像:落笔时同时写 (-x, y, z)

export const key = (x, y, z) => `${x},${y},${z}`;
export const parseKey = (k) => {
  const [x, y, z] = k.split(',').map(Number);
  return { x, y, z };
};

export function inBounds(x, y, z) {
  const m = GRID_SIZE;
  return x >= -m / 2 && x < m / 2 && y >= 0 && y < m && z >= -m / 2 && z < m / 2;
}

// 深拷贝一份体素 Map
export function cloneVoxels(voxels) {
  const next = new Map();
  for (const [k, v] of voxels) next.set(k, { ...v });
  return next;
}

export function voxelCount(voxels) {
  return voxels.size;
}

/**
 * 落笔(画笔)。返回本次实际发生变化的坐标列表(空数组表示无变化)。
 * 镜像开启时对称位置一并落笔。
 */
export function paintVoxel(voxels, x, y, z, color, { mirror = false, layerLock = null } = {}) {
  const changed = [];
  const targets = mirror ? dedupePositions([[x, y, z], [-x, y, z]]) : [[x, y, z]];
  for (const [tx, ty, tz] of targets) {
    if (!inBounds(tx, ty, tz)) continue;
    if (layerLock !== null && layerLock.enabled && layerLock.layer !== ty) continue;
    const k = key(tx, ty, tz);
    const old = voxels.get(k);
    if (old && old.c === color) continue;
    voxels.set(k, { x: tx, y: ty, z: tz, c: color });
    changed.push(k);
  }
  return changed;
}

/**
 * 橡皮擦。镜像开启时对称位置一并擦除。
 */
export function eraseVoxel(voxels, x, y, z, { mirror = false, layerLock = null } = {}) {
  const changed = [];
  const targets = mirror ? dedupePositions([[x, y, z], [-x, y, z]]) : [[x, y, z]];
  for (const [tx, ty, tz] of targets) {
    if (layerLock !== null && layerLock.enabled && layerLock.layer !== ty) continue;
    const k = key(tx, ty, tz);
    if (voxels.delete(k)) changed.push(k);
  }
  return changed;
}

/**
 * 油漆桶填充:从起点做泛洪。起点已有同色则填连通的同色区域边界,
 * 起点为空则填连通的空气区域。
 */
export function floodFill(voxels, x, y, z, color, { layerLock = null } = {}) {
  if (!inBounds(x, y, z)) return [];
  if (layerLock !== null && layerLock.enabled && layerLock.layer !== y) return [];
  const startKey = key(x, y, z);
  const targetColor = voxels.has(startKey) ? voxels.get(startKey).c : null;
  if (targetColor === color) return [];

  const changed = [];
  const queue = [[x, y, z]];
  const seen = new Set([startKey]);
  while (queue.length) {
    const [cx, cy, cz] = queue.shift();
    const ck = key(cx, cy, cz);
    const cur = voxels.get(ck);
    const curColor = cur ? cur.c : null;
    if (curColor === targetColor) {
      if (curColor === null) {
        if (!(layerLock && layerLock.enabled && layerLock.layer !== cy)) {
          voxels.set(ck, { x: cx, y: cy, z: cz, c: color });
          changed.push(ck);
        }
      } else {
        voxels.set(ck, { x: cx, y: cy, cz, c: color });
        changed.push(ck);
      }
      for (const [nx, ny, nz] of neighbors6(cx, cy, cz)) {
        if (!inBounds(nx, ny, nz)) continue;
        const nk = key(nx, ny, nz);
        if (seen.has(nk)) continue;
        seen.add(nk);
        queue.push([nx, ny, nz]);
      }
    }
  }
  return changed;
}

const DIRS6 = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1]
];

export function neighbors6(x, y, z) {
  return DIRS6.map(([dx, dy, dz]) => [x + dx, y + dy, z + dz]);
}

function dedupePositions(list) {
  const seen = new Set();
  const out = [];
  for (const p of list) {
    const k = key(...p);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(p);
    }
  }
  return out;
}

/**
 * 求一个体素集合中包含 seedKey 的 6-连通团(用于"选中连通体素团")。
 */
export function connectedComponent(voxels, seedKey) {
  if (!voxels.has(seedKey)) return [];
  const seen = new Set([seedKey]);
  const queue = [seedKey];
  const out = [];
  while (queue.length) {
    const k = queue.shift();
    out.push(k);
    const { x, y, z } = parseKey(k);
    for (const [nx, ny, nz] of neighbors6(x, y, z)) {
      const nk = key(nx, ny, nz);
      if (seen.has(nk) || !voxels.has(nk)) continue;
      seen.add(nk);
      queue.push(nk);
    }
  }
  return out;
}

/**
 * 框选:给出两个角点(含边界),返回区域内所有体素 key(含空格子坐标,
 * 由 selectMode 决定是否只取已有体素)。
 */
export function boxKeys(min, max, { occupiedOnly = false, voxels = null } = {}) {
  const keys = [];
  for (let x = min.x; x <= max.x; x++) {
    for (let y = min.y; y <= max.y; y++) {
      for (let z = min.z; z <= max.z; z++) {
        const k = key(x, y, z);
        if (occupiedOnly && !(voxels && voxels.has(k))) continue;
        keys.push(k);
      }
    }
  }
  return keys;
}

export function boundsOf(keys) {
  let min = { x: Infinity, y: Infinity, z: Infinity };
  let max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const k of keys) {
    const p = parseKey(k);
    min = { x: Math.min(min.x, p.x), y: Math.min(min.y, p.y), z: Math.min(min.z, p.z) };
    max = { x: Math.max(max.x, p.x), y: Math.max(max.y, p.y), z: Math.max(max.z, p.z) };
  };
  return { min, max };
}

/**
 * 整体平移选中体素:delta 为整数向量。越界或与未选中体素冲突时返回 null(调用方提示)。
 */
export function translateVoxels(voxels, selectedKeys, delta) {
  const selected = new Set(selectedKeys);
  const next = new Map(voxels);
  // 先全部摘下
  const moving = [];
  for (const k of selectedKeys) {
    const v = next.get(k);
    if (!v) return null;
    moving.push(v);
    next.delete(k);
  }
  // 再放到新位置
  for (const v of moving) {
    const nx = v.x + delta.x, ny = v.y + delta.y, nz = v.z + delta.z;
    if (!inBounds(nx, ny, nz)) return null;
    const nk = key(nx, ny, nz);
    if (next.has(nk)) return null;
    next.set(nk, { x: nx, y: ny, z: nz, c: v.c });
  }
  const newKeys = moving.map(v => key(v.x + delta.x, v.y + delta.y, v.z + delta.z));
  return { voxels: next, newKeys };
}

/**
 * 复制:把选中体素相对化(减去包围盒最小角),返回可粘贴的剪贴板数据。
 */
export function copyVoxels(voxels, selectedKeys) {
  const cells = selectedKeys.map(k => voxels.get(k)).filter(Boolean);
  if (!cells.length) return null;
  const { min } = boundsOf(selectedKeys);
  return {
    cells: cells.map(v => ({ dx: v.x - min.x, dy: v.y - min.y, dz: v.z - min.z, c: v.c })),
    size: boundsOf(cells.map(v => key(v.x, v.y, v.z)))
  };
}

/**
 * 粘贴:把剪贴板放到 origin(最小角)。冲突时覆盖。返回新体素 key 列表。
 */
export function pasteVoxels(voxels, clipboard, origin) {
  const placed = [];
  for (const cell of clipboard.cells) {
    const x = origin.x + cell.dx, y = origin.y + cell.dy, z = origin.z + cell.dz;
    if (!inBounds(x, y, z)) continue;
    const k = key(x, y, z);
    voxels.set(k, { x, y, z, c: cell.c });
    placed.push(k);
  }
  return placed;
}

// ---------------------------------------------------------------------------
// 面剔除网格构建:只生成暴露在空气(或选区外)的面,直接把体素堆"合并成一个网格"
// 同时按 quality 比例做减面 —— 高质量=全部四边面,低质量=相邻共面合并
// ---------------------------------------------------------------------------

// 六个面的四角(单位立方体,角点 0/1),顺序为外法线朝外
const FACES = [
  { n: [1, 0, 0], quad: [[1, 1, 0], [1, 1, 1], [1, 0, 1], [1, 0, 0]] },
  { n: [-1, 0, 0], quad: [[0, 1, 1], [0, 1, 0], [0, 0, 0], [0, 0, 1]] },
  { n: [0, 1, 0], quad: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], quad: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], quad: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { n: [0, 0, -1], quad: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] }
];

/**
 * 构建面剔除后的多边形网格数据。
 * @param {Map} voxels
 * @param {Set<string>} [onlyKeys] 只合并这些体素(连通团/选区);不传则合并全部
 * @param {number} [quality] 1 = 不减面(逐体面),0.25 = 最激进共面合并
 * @returns {{positions:number[], indices:number[], colors:number[], faceCount:number, merged:boolean}}
 */
export function buildCulledMesh(voxels, onlyKeys = null, quality = 1) {
  const scope = onlyKeys ? new Set(onlyKeys) : null;
  const included = (k) => !scope || scope.has(k);

  // 每个朝向收集暴露面:faceKey -> {四角世界坐标, 颜色}
  const exposed = [];
  for (const [k, v] of voxels) {
    if (!included(k)) continue;
    const { x, y, z } = v;
    for (const f of FACES) {
      const nb = key(x + f.n[0], y + f.n[1], z + f.n[2]);
      if (voxels.has(nb) && included(nb)) continue; // 被同侧同选区体素挡住,剔除
      exposed.push({ face: f, ox: x, oy: y, oz: z, c: v.c });
    }
  }

  // 减面:quality < 1 时,把同朝向、同色、共面且相邻的面合并成大矩形(greedy 风格)
  const mergedFaces = quality < 1
    ? greedyMerge(exposed, quality)
    : exposed.map((e) => ({
        c: e.c,
        corners: e.face.quad.map(([qx, qy, qz]) => [e.ox + qx, e.oy + qy, e.oz + qz])
      }));

  const positions = [];
  const indices = [];
  const colors = [];
  let vIdx = 0;
  for (const mf of mergedFaces) {
    const corners = mf.corners; // 4 个世界坐标角点
    const [r, g, b] = hexToRgb(mf.c);
    for (const corner of corners) {
      positions.push(corner[0], corner[1], corner[2]);
      colors.push(r / 255, g / 255, b / 255, 1);
    }
    indices.push(vIdx, vIdx + 1, vIdx + 2, vIdx, vIdx + 2, vIdx + 3);
    vIdx += 4;
  }
  return {
    positions,
    indices,
    colors,
    faceCount: indices.length / 3,
    merged: quality < 1
  };
}

/**
 * 贪心共面合并。quality 越低,允许合并的颜色相似度阈值越宽。
 * 对每个 (朝向, 层坐标) 建二维网格,先按同色合并成条带再扩成矩形。
 */
function greedyMerge(exposed, quality) {
  const colorTolerance = (1 - quality) * 48; // 0~48 的 RGB 分量容差
  const groups = new Map(); // 朝向|面所在层 -> 该面上的 2D 格子表
  for (const e of exposed) {
    const dirIdx = FACES.indexOf(e.face);
    const n = e.face.n;
    const layer = e.ox * n[0] + e.oy * n[1] + e.oz * n[2] + 1; // 面所在层(外侧面坐标)
    const gk = `${dirIdx}|${layer}`;
    if (!groups.has(gk)) groups.set(gk, { dirIdx, layer, cells: new Map() });
    // 面上两个切向轴,格子坐标即它在该面上的 u/w 位置
    const tan = tangentialAxes(n);
    const u = e.ox * tan.u[0] + e.oy * tan.u[1] + e.oz * tan.u[2];
    const w = e.ox * tan.v[0] + e.oy * tan.v[1] + e.oz * tan.v[2];
    groups.get(gk).cells.set(`${u},${w}`, { u, w, c: e.c });
  }

  const out = [];
  for (const group of groups.values()) {
    const face = FACES[group.dirIdx];
    const n = face.n;
    const tan = tangentialAxes(n);
    const remaining = new Map(group.cells);
    const cells = [...remaining.values()];
    const uVals = [...new Set(cells.map(c => c.u))].sort((a, b) => a - b);
    const wVals = [...new Set(cells.map(c => c.w))].sort((a, b) => a - b);
    const uMin = uVals[0], uMax = uVals.at(-1);
    const wMin = wVals[0], wMax = wVals.at(-1);

    for (let u0 = uMin; u0 <= uMax; u0++) {
      for (let w0 = wMin; w0 <= wMax; w0++) {
        const start = remaining.get(`${u0},${w0}`);
        if (!start) continue;
        // 沿 w 方向扩条带
        let w1 = w0;
        while (w1 + 1 <= wMax) {
          const next = remaining.get(`${u0},${w1 + 1}`);
          if (next && colorClose(next.c, start.c, colorTolerance)) w1++;
          else break;
        }
        // 沿 u 方向扩矩形(要求整列同宽可合并)
        let u1 = u0;
        outer: while (u1 + 1 <= uMax) {
          const nu = u1 + 1;
          for (let w = w0; w <= w1; w++) {
            const next = remaining.get(`${nu},${w}`);
            if (!next || !colorClose(next.c, start.c, colorTolerance)) break outer;
          }
          u1 = nu;
        }
        // 摘掉已合并格子
        for (let u = u0; u <= u1; u++) {
          for (let w = w0; w <= w1; w++) remaining.delete(`${u},${w}`);
        }
        out.push({
          c: start.c,
          corners: rectCorners(n, tan, group.layer, u0, u1 + 1, w0, w1 + 1)
        });
      }
    }
  }
  return out;
}

function tangentialAxes(n) {
  // 法线为某主轴时,返回另外两个主轴
  if (n[0] !== 0) return { u: [0, 1, 0], v: [0, 0, 1] };
  if (n[1] !== 0) return { u: [1, 0, 0], v: [0, 0, 1] };
  return { u: [1, 0, 0], v: [0, 1, 0] };
}

function rectCorners(n, tan, layer, u0, u1, w0, w1) {
  const corner = (u, w) => [
    n[0] * layer + tan.u[0] * u + tan.v[0] * w,
    n[1] * layer + tan.u[1] * u + tan.v[1] * w,
    n[2] * layer + tan.u[2] * u + tan.v[2] * w
  ];
  const c0 = corner(u0, w0), c1 = corner(u1, w0), c2 = corner(u1, w1), c3 = corner(u0, w1);
  // 保证绕序外法线与面法线 n 同向;切向叉积反向时翻转绕序
  const cross = [
    tan.u[1] * tan.v[2] - tan.u[2] * tan.v[1],
    tan.u[2] * tan.v[0] - tan.u[0] * tan.v[2],
    tan.u[0] * tan.v[1] - tan.u[1] * tan.v[0]
  ];
  const handed = cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2];
  return handed >= 0 ? [c0, c1, c2, c3] : [c0, c3, c2, c1];
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function colorClose(a, b, tol) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.abs(r1 - r2) <= tol && Math.abs(g1 - g2) <= tol && Math.abs(b1 - b2) <= tol;
}

/**
 * 对比两份体素:返回 added / removed 的 key 集合(按坐标)。
 */
export function diffVoxels(oldVoxels, newVoxels) {
  const added = [], removed = [];
  for (const k of newVoxels.keys()) if (!oldVoxels.has(k)) added.push(k);
  for (const k of oldVoxels.keys()) {
    if (!newVoxels.has(k)) removed.push(k);
    else if (oldVoxels.get(k).c !== newVoxels.get(k).c) removed.push(k), added.push(k);
  }
  return { added, removed };
}
