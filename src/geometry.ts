import * as THREE from 'three';
import type { SceneComponent, Vec3Tuple } from './types';

export interface Box {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

export function v3(p: Vec3Tuple): THREE.Vector3 {
  return new THREE.Vector3(p.x, p.y, p.z);
}

export function tuple(p: THREE.Vector3): Vec3Tuple {
  return { x: p.x, y: p.y, z: p.z };
}

/** 考虑缩放后的实际尺寸（旋转不改变 AABB 计算方式，这里用世界包围盒） */
export function worldBox(c: SceneComponent): Box {
  const center = v3(c.position);
  const h = new THREE.Vector3(
    (c.size.x * c.scale.x) / 2,
    (c.size.y * c.scale.y) / 2,
    (c.size.z * c.scale.z) / 2
  );
  // 旋转后的包围盒：对 8 个角点做变换
  const rot = new THREE.Euler(c.rotation.x, c.rotation.y, c.rotation.z);
  const corners = [
    new THREE.Vector3(-h.x, -h.y, -h.z),
    new THREE.Vector3(h.x, -h.y, -h.z),
    new THREE.Vector3(-h.x, h.y, -h.z),
    new THREE.Vector3(h.x, h.y, -h.z),
    new THREE.Vector3(-h.x, -h.y, h.z),
    new THREE.Vector3(h.x, -h.y, h.z),
    new THREE.Vector3(-h.x, h.y, h.z),
    new THREE.Vector3(h.x, h.y, h.z)
  ];
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const cnr of corners) {
    cnr.applyEuler(rot).add(center);
    min.min(cnr);
    max.max(cnr);
  }
  return { min, max };
}

export function boxesOverlap(a: Box, b: Box, eps = 1e-4): boolean {
  return (
    a.max.x > b.min.x + eps && a.min.x < b.max.x - eps &&
    a.max.y > b.min.y + eps && a.min.y < b.max.y - eps &&
    a.max.z > b.min.z + eps && a.min.z < b.max.z - eps
  );
}

/** 与同箱内其他构件（排除自身和所属展箱）是否碰撞；同时检查是否超出展箱范围 */
export function findCollisions(
  target: SceneComponent,
  all: SceneComponent[]
): SceneComponent[] {
  const tb = worldBox(target);
  const hits: SceneComponent[] = [];
  for (const other of all) {
    if (other.id === target.id) continue;
    if (other.kind === 'tank') continue; // 展箱是容器，不做阻挡判定
    if (other.tankId !== target.tankId) continue;
    if (boxesOverlap(tb, worldBox(other))) hits.push(other);
  }
  return hits;
}

/** 是否在所属展箱内部（含容差）。没有展箱时只要求台面 y>=0 */
export function insideTank(c: SceneComponent, all: SceneComponent[]): boolean {
  const tb = worldBox(c);
  if (tb.min.y < -1e-4) return false;
  if (!c.tankId) return true;
  const tank = all.find((t) => t.id === c.tankId);
  if (!tank) return true;
  const b = worldBox(tank);
  const eps = 0.01;
  return (
    tb.min.x >= b.min.x - eps && tb.max.x <= b.max.x + eps &&
    tb.min.z >= b.min.z - eps && tb.max.z <= b.max.z + eps &&
    tb.max.y <= b.max.y + eps
  );
}

/** 步长吸附 */
export function snap(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

export function snapPosition(p: THREE.Vector3, step: number): THREE.Vector3 {
  return new THREE.Vector3(snap(p.x, step), snap(p.y, step), snap(p.z, step));
}

/** 角度吸附（度） */
export function snapAngle(rad: number, deg: number): number {
  if (deg <= 0) return rad;
  const step = (deg * Math.PI) / 180;
  return Math.round(rad / step) * step;
}

/**
 * 自动贴面对齐：松手时找落点。
 * 规则：在当前 (x,z) 位置，候选支撑面 = 台面 y=0，以及同箱内位于下方的构件顶面；
 * 取“不发生穿插”的最高支撑面，把构件底面贴到该面上。
 * 返回新的位置（仅修改 y）。
 */
export function surfaceAlign(
  target: SceneComponent,
  all: SceneComponent[]
): THREE.Vector3 {
  const pos = v3(target.position);
  const halfH = (target.size.y * target.scale.y) / 2;
  const tb = worldBox(target);
  // 水平投影（用旋转后包围盒）
  const supportX = (tb.min.x + tb.max.x) / 2;
  const supportZ = (tb.min.z + tb.max.z) / 2;
  const hx = (tb.max.x - tb.min.x) / 2;
  const hz = (tb.max.z - tb.min.z) / 2;

  const candidates: number[] = [0]; // 台面
  for (const other of all) {
    if (other.id === target.id || other.tankId !== target.tankId) continue;
    if (other.kind === 'tank') continue;
    const ob = worldBox(other);
    // 水平投影有重叠才可能作为支撑
    const overlapX = supportX + hx > ob.min.x && supportX - hx < ob.max.x;
    const overlapZ = supportZ + hz > ob.min.z && supportZ - hz < ob.max.z;
    const below = ob.max.y <= pos.y + halfH + 0.05;
    if (overlapX && overlapZ && below) candidates.push(ob.max.y);
  }
  // 取最高的、且放上去后不会与该支撑物碰撞的候选面
  candidates.sort((a, b) => b - a);
  for (const topY of candidates) {
    const trial = targetWithY(target, topY + halfH);
    const collision = findCollisions(trial, all).length > 0;
    if (!collision) return new THREE.Vector3(pos.x, topY + halfH, pos.z);
  }
  // 全部冲突则回落到台面
  return new THREE.Vector3(pos.x, halfH, pos.z);
}

function targetWithY(c: SceneComponent, y: number): SceneComponent {
  return { ...c, position: { ...c.position, y } };
}

/** 批量左对齐（沿世界 X 取最小面），等距排布（沿 X 等间距） */
export function alignLeft(items: SceneComponent[]): SceneComponent[] {
  if (items.length === 0) return [];
  const boxes = items.map(worldBox);
  const minX = Math.min(...boxes.map((b) => b.min.x));
  return items.map((c, i) => ({
    ...c,
    position: { ...c.position, x: c.position.x + (minX - boxes[i].min.x) }
  }));
}

/** 等距排布：保持首尾不动，中间构件沿 X 等间距；间距按包围盒外缘 */
export function distributeEvenly(items: SceneComponent[]): SceneComponent[] {
  if (items.length < 3) return items;
  const indexed = items
    .map((c) => ({ c, b: worldBox(c) }))
    .sort((a, b) => a.b.min.x - b.b.min.x);
  const first = indexed[0];
  const last = indexed[indexed.length - 1];
  const span = last.b.min.x - first.b.max.x; // 首尾之间的可用空隙
  const gap = span / (indexed.length - 1);
  let cursor = first.b.max.x;
  const result: SceneComponent[] = [{ ...first.c }, { ...last.c }];
  for (let i = 1; i < indexed.length - 1; i++) {
    const item = indexed[i];
    const width = item.b.max.x - item.b.min.x;
    const newMinX = cursor + gap;
    const dx = newMinX - item.b.min.x;
    result.push({
      ...item.c,
      position: { ...item.c.position, x: item.c.position.x + dx }
    });
    cursor = newMinX + width;
  }
  return result;
}
