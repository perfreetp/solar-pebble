/**
 * 网格生成与导出。
 *
 * 两套用途：
 *  1) 渲染：按 32³ 区块贪心合并，编辑时只重建被改动的区块。
 *  2) 导出：整模一次贪心合并 → 可选降采样 → OBJ + MTL（含尺寸注释与 metadata）。
 *
 * 面片以四边形为单位，OBJ 输出四边形（n-gon 支持良好，面数即四边形数）。
 */

import { AIR, VoxelModel } from './voxel.js';
import { MATERIALS, MATERIAL_BY_ID as MAT_BY_ID, hexToSrgb } from './materials.js';

const AXES = [
  { n: 0, u: 1, v: 2 }, // X 面
  { n: 1, u: 2, v: 0 }, // Y 面
  { n: 2, u: 0, v: 1 }, // Z 面
];

const AO_LEVELS = [0.52, 0.72, 0.86, 1.0];

/**
 * 生成一个区块（或整模）的四边形集合。
 * 每个轴向分别处理 + / - 两个朝向，保证单格薄壁两侧都出面。
 * @param {VoxelModel} model
 * @param {{min?:number[], max?:number[], visible?:(z:number)=>boolean}} [opts]
 */
export function greedyQuads(model, opts = {}) {
  const min = opts.min || [0, 0, 0];
  const max = opts.max || [model.sizeX - 1, model.sizeY - 1, model.sizeZ - 1];
  const visible = opts.visible || (() => true);
  const quads = [];
  const dims = [model.sizeX, model.sizeY, model.sizeZ];
  const shown = (z) => z >= 0 && z < dims[2] && visible(z);

  for (let a = 0; a < 3; a++) {
    const { n, u, v } = AXES[a];
    const un = dims[u];
    const vn = dims[v];
    const nn = dims[n];

    const pos = [0, 0, 0];
    const nb = [0, 0, 0];

    for (let dir = -1; dir <= 1; dir += 2) {
      for (let slice = min[n]; slice <= Math.min(max[n], nn - 1); slice++) {
        pos[n] = slice;
        const mask = new Int32Array(un * vn);
        const off = [0, 0, 0];
        off[n] = dir;

        for (let vi = min[v]; vi <= Math.min(max[v], vn - 1); vi++) {
          for (let ui = min[u]; ui <= Math.min(max[u], un - 1); ui++) {
            pos[u] = ui;
            pos[v] = vi;
            const m = model.get(pos[0], pos[1], pos[2]);
            if (m === AIR || !shown(pos[2])) continue;
            nb[0] = pos[0] + off[0];
            nb[1] = pos[1] + off[1];
            nb[2] = pos[2] + off[2];
            const mn = model.get(nb[0], nb[1], nb[2]);
            // 邻居为空气，或邻居所在层被隐藏 → 该朝向需要出面
            if (mn === AIR || !shown(nb[2])) mask[vi * un + ui] = m;
          }
        }

        for (let vi = min[v]; vi <= Math.min(max[v], vn - 1); vi++) {
          for (let ui = min[u]; ui <= Math.min(max[u], un - 1); ui++) {
            const mat = mask[vi * un + ui];
            if (!mat) continue;
            let w = 1;
            while (ui + w <= Math.min(max[u], un - 1) && mask[vi * un + ui + w] === mat) w++;
            let h = 1;
            outer: while (vi + h <= Math.min(max[v], vn - 1)) {
              const row = (vi + h) * un;
              for (let k = 0; k < w; k++) {
                if (mask[row + ui + k] !== mat) break outer;
              }
              h++;
            }
            for (let dv = 0; dv < h; dv++) {
              const row = (vi + dv) * un + ui;
              for (let du = 0; du < w; du++) mask[row + du] = 0;
            }
            quads.push({
              axis: a,
              dir,
              plane: slice,
              u0: ui,
              v0: vi,
              u1: ui + w,
              v1: vi + h,
              mat,
            });
          }
        }
      }
    }
  }
  return quads;
}

/** 把四边形转成可上传的顶点缓冲（含顶点 AO）。 */
export function quadsToBuffers(model, quads, { bbox = null, offset = null } = {}) {
  const vcount = quads.length * 4;
  const positions = new Float32Array(vcount * 3);
  const normals = new Int8Array(vcount * 3);
  const colors = new Uint8Array(vcount * 3);
  const extras = new Uint8Array(vcount * 2); // ao, emissive
  const indices = new Uint32Array(quads.length * 6);

  const s = model.voxelSize;
  const ox = offset ? offset[0] : -(model.sizeX * s) / 2;
  const oy = offset ? offset[1] : -(model.sizeY * s) / 2;
  const oz = offset ? offset[2] : 0;

  // 颜色查表（sRGB 0..255）
  const colorTable = new Uint8Array(256 * 3);
  for (const m of MATERIALS) {
    const [r, g, b] = hexToSrgb(m.color);
    colorTable[m.id * 3] = Math.round(r * 255);
    colorTable[m.id * 3 + 1] = Math.round(g * 255);
    colorTable[m.id * 3 + 2] = Math.round(b * 255);
  }
  const emisTable = new Uint8Array(256);
  for (const m of MATERIALS) emisTable[m.id] = Math.round(m.emissive * 255);

  let vi = 0;
  let ii = 0;
  const corner = [0, 0, 0];
  const q = [0, 0, 0];

  for (const face of quads) {
    const { n, u, v } = AXES[face.axis];
    const base = vi;
    const faceOff = face.dir > 0 ? 1 : 0;
    const aoCorners = new Uint8Array(4);

    for (let c = 0; c < 4; c++) {
      const du = c === 0 || c === 3 ? 0 : 1;
      const dv = c < 2 ? 0 : 1;
      corner[n] = face.plane + faceOff;
      corner[u] = du ? face.u1 : face.u0;
      corner[v] = dv ? face.v1 : face.v0;

      positions[vi * 3] = ox + corner[0] * s;
      positions[vi * 3 + 1] = oy + corner[1] * s;
      positions[vi * 3 + 2] = oz + corner[2] * s;

      const nx = n === 0 ? face.dir : 0;
      const ny = n === 1 ? face.dir : 0;
      const nz = n === 2 ? face.dir : 0;
      normals[vi * 3] = nx * 127;
      normals[vi * 3 + 1] = ny * 127;
      normals[vi * 3 + 2] = nz * 127;

      colors[vi * 3] = colorTable[face.mat * 3];
      colors[vi * 3 + 1] = colorTable[face.mat * 3 + 1];
      colors[vi * 3 + 2] = colorTable[face.mat * 3 + 2];
      extras[vi * 2 + 1] = emisTable[face.mat];

      // 顶点 AO：朝向面外一格处的三个邻居
      q[0] = corner[0];
      q[1] = corner[1];
      q[2] = corner[2];
      const su = du ? 1 : -1;
      const sv = dv ? 1 : -1;
      // 从顶点向面外
      q[n] = face.plane + (face.dir > 0 ? 1 : -1);
      const s1 = solidAt(model, q, u, su);
      const s2 = solidAt(model, q, v, sv);
      const cc = solidAt(model, q, u, su, v, sv);
      let level;
      if (s1 && s2) level = 0;
      else level = 3 - (s1 + s2 + cc);
      aoCorners[c] = AO_LEVELS[level];
      extras[vi * 2] = Math.round(AO_LEVELS[level] * 255);
      vi++;
    }

    // 绕序：保证从 +法线方向看为逆时针
    if (face.dir > 0) {
      indices[ii++] = base;
      indices[ii++] = base + 1;
      indices[ii++] = base + 2;
      indices[ii++] = base;
      indices[ii++] = base + 2;
      indices[ii++] = base + 3;
    } else {
      indices[ii++] = base;
      indices[ii++] = base + 2;
      indices[ii++] = base + 1;
      indices[ii++] = base;
      indices[ii++] = base + 3;
      indices[ii++] = base + 2;
    }
  }

  return { positions, normals, colors, extras, indices, vertexCount: vcount, quadCount: quads.length };
}

function solidAt(model, cell, a1, s1, a2 = -1, s2 = 0) {
  const x = cell[0] + (a1 === 0 ? s1 : 0) + (a2 === 0 ? s2 : 0);
  const y = cell[1] + (a1 === 1 ? s1 : 0) + (a2 === 1 ? s2 : 0);
  const z = cell[2] + (a1 === 2 ? s1 : 0) + (a2 === 2 ? s2 : 0);
  return model.get(x, y, z) !== AIR ? 1 : 0;
}

export function chunkBounds(model, cz) {
  const chunks = [];
  const C = cz;
  const nx = Math.ceil(model.sizeX / C);
  const ny = Math.ceil(model.sizeY / C);
  const nz = Math.ceil(model.sizeZ / C);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        chunks.push({
          key: `${x},${y},${z}`,
          min: [x * C, y * C, z * C],
          max: [Math.min((x + 1) * C - 1, model.sizeX - 1), Math.min((y + 1) * C - 1, model.sizeY - 1), Math.min((z + 1) * C - 1, model.sizeZ - 1)],
        });
      }
    }
  }
  return chunks;
}

/** 降采样（减面）：每 k³ 个体素合并为 1 个，取占多数的非空材质。 */
export function coarsenModel(model, k) {
  if (k <= 1) return model;
  const sizeX = Math.ceil(model.sizeX / k);
  const sizeY = Math.ceil(model.sizeY / k);
  const sizeZ = Math.ceil(model.sizeZ / k);
  const out = new VoxelModel({
    sizeX,
    sizeY,
    sizeZ,
    voxelSize: model.voxelSize * k,
  });
  const counts = new Uint16Array(256);
  for (let z = 0; z < sizeZ; z++) {
    for (let y = 0; y < sizeY; y++) {
      for (let x = 0; x < sizeX; x++) {
        counts.fill(0);
        let best = 0;
        let bestN = 0;
        for (let dz = 0; dz < k; dz++) {
          for (let dy = 0; dy < k; dy++) {
            for (let dx = 0; dx < k; dx++) {
              const m = model.get(x * k + dx, y * k + dy, z * k + dz);
              if (!m) continue;
              counts[m]++;
              if (counts[m] > bestN) {
                bestN = counts[m];
                best = m;
              }
            }
          }
        }
        if (best) out.set(x, y, z, best);
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ OBJ 导出

/**
 * 生成 OBJ 与 MTL 文本。
 * 顶点按整数角点焊接，每个面朝向导出一组法线。
 */
export function buildObj(quads, model, opts = {}) {
  const name = opts.name || 'lavatube-base';
  const s = model.voxelSize;
  const ox = -(model.sizeX * s) / 2;
  const oy = -(model.sizeY * s) / 2;
  const verts = new Map();
  const lines = [];
  const dims = model.dimensions();

  const used = new Set(quads.map((q) => q.mat));

  lines.push('# 月球熔岩管地下基地 — 体素概念模型');
  lines.push(`# 导出时间: ${new Date().toISOString()}`);
  lines.push(`# 体素尺寸: ${s} m  |  网格: ${model.sizeX} × ${model.sizeY} × ${model.sizeZ}`);
  lines.push(`# 外形尺寸: 宽 ${dims.width.toFixed(3)} m × 深 ${dims.depth.toFixed(3)} m × 高 ${dims.height.toFixed(3)} m`);
  lines.push(`# 面数(四边形): ${quads.length}  三角面: ${quads.length * 2}`);
  lines.push(`# 材质数: ${used.size}`);
  lines.push('# 单位: 米；X/Y 以模型中心为原点，Z 自基准面向上');
  lines.push(`mtllib ${name}.mtl`);
  lines.push('');

  // OBJ 按 v → vn → f 三段组织，并按材质分桶输出：
  // 交错写元素的 OBJ 在部分导入器里会出错，分段 + 每种材质一个 usemtl 段最稳。
  const vLines = [];
  const vnLines = [];
  const buckets = new Map();
  const normalsByAxis = new Map();
  let vIndex = 0;

  for (const face of quads) {
    const { n, u, v } = AXES[face.axis];
    const idxs = [];
    for (let c = 0; c < 4; c++) {
      const corner = [0, 0, 0];
      const du = c === 0 || c === 3 ? 0 : 1;
      const dv = c < 2 ? 0 : 1;
      corner[n] = face.plane + (face.dir > 0 ? 1 : 0);
      corner[u] = du ? face.u1 : face.u0;
      corner[v] = dv ? face.v1 : face.v0;
      const key = `${corner[0]},${corner[1]},${corner[2]}`;
      let id = verts.get(key);
      if (id === undefined) {
        vIndex++;
        id = vIndex;
        verts.set(key, id);
        vLines.push(`v ${fmt(ox + corner[0] * s)} ${fmt(oy + corner[1] * s)} ${fmt(corner[2] * s)}`);
      }
      idxs.push(id);
    }
    const vnKey = `${face.axis}:${face.dir}`;
    let vn = normalsByAxis.get(vnKey);
    if (!vn) {
      vn = normalsByAxis.size + 1;
      normalsByAxis.set(vnKey, vn);
      vnLines.push(`vn ${n === 0 ? face.dir : 0} ${n === 1 ? face.dir : 0} ${n === 2 ? face.dir : 0}`);
    }
    const order = face.dir > 0 ? [0, 1, 2, 3] : [0, 3, 2, 1];
    let bucket = buckets.get(face.mat);
    if (!bucket) {
      bucket = [];
      buckets.set(face.mat, bucket);
    }
    bucket.push(`f ${order.map((k) => `${idxs[k]}//${vn}`).join(' ')}`);
  }

  lines.push(...vLines);
  lines.push('');
  lines.push(...vnLines);
  lines.push('');
  for (const [matId, faceLines] of [...buckets].sort((a, b) => a[0] - b[0])) {
    const meta = MAT_BY_ID[matId];
    lines.push(`usemtl ${meta?.key || 'mat' + matId}`);
    lines.push(`g ${meta?.group || 'group'}_${meta?.key || matId}`);
    lines.push(...faceLines);
    lines.push('');
  }

  const obj = lines.join('\n');
  const mtl = buildMtl(used, opts);

  const metadata = {
    name,
    unit: 'meter',
    voxelSize: s,
    grid: { x: model.sizeX, y: model.sizeY, z: model.sizeZ },
    dimensions: dims,
    bounds: {
      x: [-dims.width / 2, dims.width / 2],
      y: [-dims.depth / 2, dims.depth / 2],
      z: [0, dims.height],
    },
    faces: quads.length,
    triangles: quads.length * 2,
    vertices: verts.size,
    materials: [...used].map((id) => {
      const m = MAT_BY_ID[id];
      return { id, key: m.key, name: m.name, group: m.group, color: m.color };
    }),
    generatedAt: new Date().toISOString(),
    generator: 'Lunar Lava Tube Voxel Studio',
  };

  return { obj, mtl, metadata };
}

function fmt(n) {
  const v = Math.round(n * 10000) / 10000;
  return Number.isInteger(v) ? String(v) : String(v);
}

export function buildMtl(usedIds, opts = {}) {
  const lines = [];
  lines.push('# 月球熔岩管地下基地 — 材质表');
  lines.push(`# 材质量: ${usedIds.size}  单位: 米`);
  const ids = [...usedIds].sort((a, b) => a - b);
  for (const id of ids) {
    const m = MAT_BY_ID[id];
    if (!m) continue;
    const [r, g, b] = hexToSrgb(m.color);
    const spec = Math.round((1 - m.rough) * 1000) / 1000;
    lines.push('');
    lines.push(`newmtl ${m.key}`);
    lines.push(`# ${m.name} / ${m.group}`);
    lines.push(`Ka 0.1 0.1 0.1`);
    lines.push(`Kd ${fmt(r)} ${fmt(g)} ${fmt(b)}`);
    lines.push(`Ks ${fmt(spec)} ${fmt(spec)} ${fmt(spec)}`);
    lines.push(`Ns ${Math.round((1 - m.rough) * 900 + 4)}`);
    lines.push('d 1.0');
    lines.push('illum 2');
    if (m.emissive > 0) {
      lines.push(`Ke ${fmt(r * m.emissive)} ${fmt(g * m.emissive)} ${fmt(b * m.emissive)}`);
    }
    // PBR 扩展（Blender / 3ds Max 可识别）
    lines.push(`Pr ${fmt(m.rough)}`);
    lines.push(`Pm ${fmt(m.metal)}`);
  }
  lines.push('');
  return lines.join('\n');
}

/** 估算减面效果：不同降采样等级的面数。 */
export function estimateFaceCounts(model, visible = null) {
  const out = [];
  for (const k of [1, 2, 3, 4]) {
    const m = coarsenModel(model, k);
    const quads = greedyQuads(m, visible ? { visible: (z) => visible(z, k) } : {});
    out.push({ coarsen: k, quads: quads.length, triangles: quads.length * 2, voxelSize: m.voxelSize, grid: [m.sizeX, m.sizeY, m.sizeZ] });
  }
  return out;
}

export { AXES };
