import polygonClipping, { type MultiPolygon, type Pair, type Polygon, type Ring } from 'polygon-clipping';
import type { Pt, PathData, BooleanOp } from '../types';
import { flattenPath, ringArea, uid } from './geometry';

/** PathData → polygon-clipping 的 Polygon(外环 + 已有镂空内环) */
function pathToGeom(p: PathData): Polygon | null {
  const outer: Ring = flattenPath(p, 18).map(q => [q.x, q.y] as Pair);
  if (outer.length < 3) return null;
  const geom: Polygon = [outer];
  p.holes.forEach(hole => {
    if (hole.length >= 3) geom.push(hole.map(q => [q.x, q.y] as Pair));
  });
  return geom;
}

function ringToPts(ring: Ring): Pt[] {
  // polygon-clipping 首尾点重复,去掉闭合点
  const pts = ring.map(([x, y]) => ({ x, y }));
  if (pts.length > 1) {
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) pts.pop();
  }
  return pts;
}

/** MultiPolygon 转 PathData(展平多边形路径, 无贝塞尔柄) */
function geomToPaths(geoms: MultiPolygon, kind: 'vein' | 'pattern', baseName: string, color: string): PathData[] {
  const out: PathData[] = [];
  geoms.forEach((poly, pi) => {
    poly.forEach((ring, ri) => {
      const pts = ringToPts(ring);
      if (pts.length < 3) return;
      if (ri > 0) {
        const host = out[out.length - 1];
        if (host) { host.holes.push(pts); return; }
      }
      out.push({
        id: uid('path'),
        name: `${baseName}${geoms.length > 1 ? `-${pi + 1}` : ''}`,
        kind,
        closed: true,
        nodes: pts,
        handlesIn: pts.map(() => null),
        handlesOut: pts.map(() => null),
        visible: true,
        locked: false,
        color,
        holes: [],
      });
    });
  });
  return out;
}

/**
 * 两条闭合路径布尔运算。
 * union/difference/intersection。difference = a - b。
 * 返回生成的新路径数组(可能多条),调用方负责替换原路径。
 */
export function booleanPaths(a: PathData, b: PathData, op: BooleanOp): PathData[] {
  const ga = pathToGeom(a);
  const gb = pathToGeom(b);
  if (!ga || !gb) return [];
  let result: MultiPolygon;
  if (op === 'union') {
    result = polygonClipping.union(ga, gb);
  } else if (op === 'intersection') {
    result = polygonClipping.intersection(ga, gb);
  } else {
    result = polygonClipping.difference(ga, gb);
  }
  if (!result.length) return [];
  const name = op === 'union' ? '并集' : op === 'intersection' ? '交集' : '差集';
  const color = a.kind === 'pattern' || b.kind === 'pattern' ? '#b5651d' : '#1a6b3c';
  return geomToPaths(result, a.kind, name, color);
}

/**
 * 斑纹块与翅脉相交 → 镂空。
 * 把所有翅脉路径展平后按宽度扩张为"切割条带"多边形,
 * 对斑纹做 difference,结果保留为带 holes 的斑纹路径。
 */
export function cutPatternWithVeins(pattern: PathData, veins: PathData[], veinWidth = 7): PathData[] {
  const gp = pathToGeom(pattern);
  if (!gp) return [pattern];
  const cutters: Polygon[] = [];
  veins.forEach(v => {
    const flat = flattenPath(v, 18);
    const band = polylineToBand(flat, veinWidth, v.closed);
    if (band.length >= 3) cutters.push([band.map(q => [q.x, q.y] as Pair)]);
  });
  if (!cutters.length) return [pattern];
  let result: MultiPolygon;
  try {
    result = polygonClipping.difference(gp, ...cutters);
  } catch {
    return [pattern];
  }
  if (!result.length) return [];
  return geomToPaths(result, 'pattern', pattern.name, pattern.color);
}

/** 折线(或闭合环)扩张为宽度 w 的条带多边形 */
function polylineToBand(pts: Pt[], w: number, closed = false): Pt[] {
  if (pts.length < 2) return [];
  const half = w / 2;
  const left: Pt[] = [];
  const right: Pt[] = [];
  const n = pts.length;
  const limit = closed ? n : n - 1;
  for (let i = 0; i < limit; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    const dx = q.x - p.x, dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    left.push({ x: p.x + nx * half, y: p.y + ny * half });
    right.push({ x: p.x - nx * half, y: p.y - ny * half });
  }
  if (!closed) {
    // 两端加半圆帽(4 段)
    const start = pts[0], end = pts[n - 1];
    const cap: Pt[] = [];
    const d0x = pts[1].x - start.x, d0y = pts[1].y - start.y;
    const a0 = Math.atan2(d0y, d0x);
    for (let k = 1; k <= 4; k++) {
      const a = a0 + Math.PI - (Math.PI * k) / 4;
      cap.push({ x: start.x + Math.cos(a) * half, y: start.y + Math.sin(a) * half });
    }
    const d1x = end.x - pts[n - 2].x, d1y = end.y - pts[n - 2].y;
    const a1 = Math.atan2(d1y, d1x);
    const capEnd: Pt[] = [];
    for (let k = 1; k <= 4; k++) {
      const a = a1 - (Math.PI * k) / 4;
      capEnd.push({ x: end.x + Math.cos(a) * half, y: end.y + Math.sin(a) * half });
    }
    return [...left, ...capEnd, ...right.reverse(), ...cap];
  }
  return [...left, ...right.reverse()];
}

/** 路径面积,供 UI 提示 */
export function pathArea(p: PathData): number {
  const flat = flattenPath(p);
  return Math.abs(ringArea(flat));
}
