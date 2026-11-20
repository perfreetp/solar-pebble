/**
 * 体素模型内核 —— 前端编辑器与服务端校验共用同一份实现。
 *
 * 存储：带 1 格空气边框的稠密 Uint8 网格（材质 id，0 = 空气）。
 *   - 边框使邻居查询无需越界判断，网格外天然为空气。
 *   - 144×144×96 的典型基地约 2MB，可全量重建网格而无需分块管理。
 * 坐标：X / Y 水平，Z 垂直（分层编辑的层号）。
 */

import { MATERIAL_BY_ID } from './materials.js';

export const AIR = 0;
export const MAX_DIM = 256;
export const DEFAULT_SIZE = { sizeX: 144, sizeY: 144, sizeZ: 96, voxelSize: 0.5 };

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export class VoxelModel {
  /**
   * @param {{sizeX?:number,sizeY?:number,sizeZ?:number,voxelSize?:number}} [opts]
   */
  constructor(opts = {}) {
    const sizeX = Math.round(opts.sizeX ?? DEFAULT_SIZE.sizeX);
    const sizeY = Math.round(opts.sizeY ?? DEFAULT_SIZE.sizeY);
    const sizeZ = Math.round(opts.sizeZ ?? DEFAULT_SIZE.sizeZ);
    if (sizeX < 4 || sizeY < 4 || sizeZ < 2 || sizeX > MAX_DIM || sizeY > MAX_DIM || sizeZ > MAX_DIM) {
      throw new Error(`尺寸超出范围：${sizeX}×${sizeY}×${sizeZ}`);
    }
    this.sizeX = sizeX;
    this.sizeY = sizeY;
    this.sizeZ = sizeZ;
    this.voxelSize = opts.voxelSize ?? DEFAULT_SIZE.voxelSize;
    this.px = sizeX + 2;
    this.py = sizeY + 2;
    this.pz = sizeZ + 2;
    this.strideY = this.px;
    this.strideZ = this.px * this.py;
    this.total = this.px * this.py * this.pz;
    this.bytes = new Uint8Array(this.total);
    this.occupied = 0;
    this.revision = 0;
  }

  idx(x, y, z) {
    return x + 1 + (y + 1) * this.strideY + (z + 1) * this.strideZ;
  }

  inside(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sizeX && y < this.sizeY && z < this.sizeZ;
  }

  /** 越界或空气返回 0。 */
  get(x, y, z) {
    if (!this.inside(x, y, z)) return AIR;
    return this.bytes[this.idx(x, y, z)];
  }

  getAt(i) {
    return this.bytes[i];
  }

  coordsOf(i) {
    const x = (i % this.strideY) - 1;
    const y = (Math.floor(i / this.strideY) % this.py) - 1;
    const z = Math.floor(i / this.strideZ) - 1;
    return { x, y, z };
  }

  /** 写入一格；返回是否发生变化。 */
  set(x, y, z, mat) {
    if (!this.inside(x, y, z)) return false;
    const i = this.idx(x, y, z);
    const before = this.bytes[i];
    if (before === mat) return false;
    if (before === AIR && mat !== AIR) this.occupied++;
    else if (before !== AIR && mat === AIR) this.occupied--;
    this.bytes[i] = mat;
    this.revision++;
    return true;
  }

  /** 不维护计数与版本号的底层写入（批量操作内部使用）。 */
  setRaw(i, mat) {
    this.bytes[i] = mat;
  }

  applyRawChanges(changes) {
    for (const c of changes) {
      const i = this.idx(c.x, c.y, c.z);
      this.bytes[i] = c.a === undefined ? c.b : c.a;
    }
    this.recount();
  }

  recount() {
    let n = 0;
    const { bytes } = this;
    const strideY = this.strideY;
    const strideZ = this.strideZ;
    for (let z = 1; z <= this.sizeZ; z++) {
      const zo = z * strideZ;
      for (let y = 1; y <= this.sizeY; y++) {
        const yo = zo + y * strideY;
        for (let x = 1; x <= this.sizeX; x++) {
          if (bytes[x + yo] !== AIR) n++;
        }
      }
    }
    this.occupied = n;
    this.revision++;
    return n;
  }

  clear() {
    this.bytes.fill(AIR);
    this.occupied = 0;
    this.revision++;
  }

  clone() {
    const m = new VoxelModel(this);
    m.bytes.set(this.bytes);
    m.occupied = this.occupied;
    m.revision = this.revision;
    return m;
  }

  /** 遍历所有非空体素：cb(x,y,z,mat,index) */
  forEach(cb) {
    const { bytes, strideY, strideZ } = this;
    for (let z = 0; z < this.sizeZ; z++) {
      const zo = (z + 1) * strideZ;
      for (let y = 0; y < this.sizeY; y++) {
        const yo = zo + (y + 1) * strideY + 1;
        for (let x = 0; x < this.sizeX; x++) {
          const m = bytes[yo + x];
          if (m !== AIR) cb(x, y, z, m, yo + x);
        }
      }
    }
  }

  /** 世界尺寸（米），以包围盒形式给出。 */
  dimensions() {
    return {
      width: this.sizeX * this.voxelSize,
      depth: this.sizeY * this.voxelSize,
      height: this.sizeZ * this.voxelSize,
    };
  }

  /** 已占用体素的包围盒（单位：格）。空模型返回 null。 */
  occupancyBounds() {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity;
    let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    this.forEach((x, y, z) => {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (z < z0) z0 = z;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      if (z > z1) z1 = z;
    });
    if (x0 === Infinity) return null;
    return { x0, y0, z0, x1, y1, z1 };
  }

  // ---------------------------------------------------------------- 批量编辑

  /**
   * 在包围盒内填充材质。返回变更记录（供撤销）。
   * @param {{x0:number,y0:number,z0:number,x1:number,y1:number,z1:number}} box
   */
  fillBox(box, mat, { onlyAir = false } = {}) {
    const b = this.clampBox(box);
    const changes = [];
    if (!b) return changes;
    for (let z = b.z0; z <= b.z1; z++) {
      for (let y = b.y0; y <= b.y1; y++) {
        for (let x = b.x0; x <= b.x1; x++) {
          const i = this.idx(x, y, z);
          const before = this.bytes[i];
          if (onlyAir && before !== AIR) continue;
          if (before === mat) continue;
          changes.push({ x, y, z, b: before, a: mat });
          this.bytes[i] = mat;
          if (before === AIR) this.occupied++;
        }
      }
    }
    this.finishChanges(changes);
    return changes;
  }

  /** 清空包围盒内的所有体素。 */
  clearBox(box, filterMat = null) {
    const b = this.clampBox(box);
    const changes = [];
    if (!b) return changes;
    for (let z = b.z0; z <= b.z1; z++) {
      for (let y = b.y0; y <= b.y1; y++) {
        for (let x = b.x0; x <= b.x1; x++) {
          const i = this.idx(x, y, z);
          const before = this.bytes[i];
          if (before === AIR) continue;
          if (filterMat && before !== filterMat) continue;
          changes.push({ x, y, z, b: before, a: AIR });
          this.bytes[i] = AIR;
          this.occupied--;
        }
      }
    }
    this.finishChanges(changes);
    return changes;
  }

  /** 替换包围盒内（可选）指定材质。mapping: {fromId: toId} 或 (mat)=>mat|0 */
  replaceInBoxes(boxes, mapping, { from = null, to = null } = {}) {
    const map = typeof mapping === 'function' ? mapping : (m) => mapping[m] ?? m;
    const changes = [];
    const seen = new Set();
    for (const raw of boxes) {
      const b = this.clampBox(raw);
      if (!b) continue;
      for (let z = b.z0; z <= b.z1; z++) {
        for (let y = b.y0; y <= b.y1; y++) {
          for (let x = b.x0; x <= b.x1; x++) {
            const i = this.idx(x, y, z);
            if (seen.has(i)) continue;
            seen.add(i);
            const before = this.bytes[i];
            if (before === AIR) continue;
            if (from !== null && before !== from) continue;
            const next = to !== null ? to : map(before);
            if (!next || next === before) continue;
            changes.push({ x, y, z, b: before, a: next });
            this.bytes[i] = next;
          }
        }
      }
    }
    this.finishChanges(changes);
    return changes;
  }

  finishChanges(changes) {
    if (changes.length) {
      this.occupied = Math.max(0, this.occupied);
      this.revision++;
    }
  }

  clampBox(box) {
    if (!box) return null;
    const x0 = clamp(Math.min(box.x0, box.x1), 0, this.sizeX - 1);
    const y0 = clamp(Math.min(box.y0, box.y1), 0, this.sizeY - 1);
    const z0 = clamp(Math.min(box.z0, box.z1), 0, this.sizeZ - 1);
    const x1 = clamp(Math.max(box.x0, box.x1), 0, this.sizeX - 1);
    const y1 = clamp(Math.max(box.y0, box.y1), 0, this.sizeY - 1);
    const z1 = clamp(Math.max(box.z0, box.z1), 0, this.sizeZ - 1);
    return { x0, y0, z0, x1, y1, z1 };
  }

  // ---------------------------------------------------------------- 复制 / 粘贴

  /** 复制多个包围盒内的体素，返回相对最小角点归一化的内容。 */
  copyBoxes(boxes) {
    const cells = [];
    const seen = new Set();
    let x0 = Infinity, y0 = Infinity, z0 = Infinity;
    let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const raw of boxes) {
      const b = this.clampBox(raw);
      if (!b) continue;
      for (let z = b.z0; z <= b.z1; z++) {
        for (let y = b.y0; y <= b.y1; y++) {
          for (let x = b.x0; x <= b.x1; x++) {
            const i = this.idx(x, y, z);
            if (seen.has(i)) continue;
            seen.add(i);
            const m = this.bytes[i];
            if (m === AIR) continue;
            cells.push([x, y, z, m]);
            if (x < x0) x0 = x;
            if (y < y0) y0 = y;
            if (z < z0) z0 = z;
            if (x > x1) x1 = x;
            if (y > y1) y1 = y;
            if (z > z1) z1 = z;
          }
        }
      }
    }
    if (!cells.length) return null;
    return {
      cells,
      min: [x0, y0, z0],
      size: [x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1],
      count: cells.length,
    };
  }

  /**
   * 把剪贴板内容粘贴到锚点（最小角点）。
   * @param {{cells:number[][], min:number[]}} clip
   * @param {number[]} anchor
   */
  paste(clip, anchor, { onlyAir = false, skipLocked = null } = {}) {
    const changes = [];
    const [ax, ay, az] = anchor;
    const [mx, my, mz] = clip.min;
    for (const [cx, cy, cz, mat] of clip.cells) {
      const x = ax + (cx - mx);
      const y = ay + (cy - my);
      const z = az + (cz - mz);
      if (!this.inside(x, y, z)) continue;
      if (skipLocked && skipLocked(z)) continue;
      const i = this.idx(x, y, z);
      const before = this.bytes[i];
      if (onlyAir && before !== AIR) continue;
      if (before === mat) continue;
      changes.push({ x, y, z, b: before, a: mat });
      if (before === AIR) this.occupied++;
      else if (mat === AIR) this.occupied--;
      this.bytes[i] = mat;
    }
    this.finishChanges(changes);
    return changes;
  }

  /** 将变更记录写回（撤销/重做）。changes 里的 a 表示“之后”，b 表示“之前”。 */
  applyChanges(changes, direction = 1) {
    for (const c of changes) {
      const i = this.idx(c.x, c.y, c.z);
      const before = this.bytes[i];
      const next = direction > 0 ? c.a : c.b;
      if (before === next) continue;
      if (before === AIR && next !== AIR) this.occupied++;
      else if (before !== AIR && next === AIR) this.occupied--;
      this.bytes[i] = next;
    }
    this.revision++;
  }

  // ---------------------------------------------------------------- 序列化

  toJSON() {
    const cells = [];
    this.forEach((x, y, z, m) => cells.push(x, y, z, m));
    return {
      v: 2,
      size: [this.sizeX, this.sizeY, this.sizeZ],
      voxelSize: this.voxelSize,
      cells,
    };
  }

  static fromJSON(json) {
    if (!json || json.v === undefined) throw new Error('无效的模型数据');
    const size = json.size || [DEFAULT_SIZE.sizeX, DEFAULT_SIZE.sizeY, DEFAULT_SIZE.sizeZ];
    const model = new VoxelModel({
      sizeX: size[0],
      sizeY: size[1],
      sizeZ: size[2],
      voxelSize: json.voxelSize ?? DEFAULT_SIZE.voxelSize,
    });
    const cells = json.cells || [];
    let n = 0;
    for (let k = 0; k < cells.length; k += 4) {
      const x = cells[k], y = cells[k + 1], z = cells[k + 2], m = cells[k + 3];
      if (!m || !model.inside(x, y, z)) continue;
      model.bytes[model.idx(x, y, z)] = m;
      n++;
    }
    model.occupied = n;
    return model;
  }

  /** 按材质/材质组统计占用体素。 */
  stats() {
    const byMaterial = new Map();
    const byGroup = new Map();
    this.forEach((x, y, z, m) => {
      byMaterial.set(m, (byMaterial.get(m) || 0) + 1);
      const meta = MATERIAL_BY_ID[m];
      if (meta) byGroup.set(meta.group, (byGroup.get(meta.group) || 0) + 1);
    });
    return {
      total: this.occupied,
      byMaterial: Object.fromEntries(byMaterial),
      byGroup: Object.fromEntries(byGroup),
    };
  }
}

/** 顶点世界坐标（米）：X/Y 居中，Z 自底面向上。 */
export function worldOf(model, x, y, z) {
  const s = model.voxelSize;
  return [(x - model.sizeX / 2) * s, (y - model.sizeY / 2) * s, z * s];
}

export function mirrorIndexX(x, plane) {
  // plane 为整数格边界（1..sizeX-1），镜像后仍落在网格内的格子
  return 2 * plane - 1 - x;
}

export { MATERIAL_BY_ID };
