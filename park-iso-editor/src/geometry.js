import { TYPES } from './model';

// 90° 步进旋转后的有效占地尺寸
export function effDims(obj) {
  const t = TYPES[obj.type];
  const swap = ((obj.rot % 180) + 180) % 180 !== 0;
  return { w: swap ? t.d : t.w, d: swap ? t.w : t.d, h: t.h };
}

// 轴对齐包围盒(物体位置为底座中心)
export function aabbOf(obj) {
  const { w, d } = effDims(obj);
  return {
    minX: obj.x - w / 2, maxX: obj.x + w / 2,
    minY: obj.y - d / 2, maxY: obj.y + d / 2,
  };
}

export function aabbOverlap(a, b) {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

export function inSite(bb, site) {
  return bb.minX >= -site.w / 2 - 1e-6 && bb.maxX <= site.w / 2 + 1e-6 &&
         bb.minY >= -site.d / 2 - 1e-6 && bb.maxY <= site.d / 2 + 1e-6;
}

/**
 * 校验一组候选位置 {id:{x,y,z,rot}} 是否合法:
 * 1) 全部在场地内; 2) 不与未参与移动的物体重叠。
 * movingIds 之外的物体取自 objects。
 */
export function validatePositions(candidates, objects, movingIds, site) {
  const moving = new Set(movingIds);
  for (const id of movingIds) {
    const c = candidates[id];
    if (!c) return false;
    const bb = aabbOf(c);
    if (!inSite(bb, site)) return false;
    for (const o of objects) {
      if (moving.has(o.id)) continue;
      if (aabbOverlap(bb, aabbOf(o))) return false;
    }
  }
  return true;
}

// 点位覆盖判定:存在同类型物体与点位水平距离 <= radius
export function computeCoverage(objects, points) {
  const covered = [];
  const missed = [];
  for (const p of points) {
    const hit = objects.some(
      (o) => o.type === p.type && Math.hypot(o.x - p.x, o.y - p.y) <= p.radius
    );
    (hit ? covered : missed).push(p.id);
  }
  const total = points.length;
  const score = total === 0 ? 0 : Math.round((covered.length / total) * 100);
  return { covered, missed, total, score };
}

// 物料清单与占地面积
export function computeBOM(objects, site) {
  const rows = [];
  let totalFoot = 0;
  for (const key of Object.keys(TYPES)) {
    const list = objects.filter((o) => o.type === key);
    if (!list.length) continue;
    const t = TYPES[key];
    const foot = t.w * t.d;
    totalFoot += foot * list.length;
    rows.push({ type: key, name: t.name, count: list.length, unitFoot: foot, foot: foot * list.length, params: t.params });
  }
  const siteArea = site.w * site.d;
  return { rows, totalFoot, siteArea, usage: siteArea ? (totalFoot / siteArea) * 100 : 0 };
}

export function downloadCSV(filename, rows) {
  const text = '﻿' + rows
    .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
