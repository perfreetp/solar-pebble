/**
 * 布尔运算：并集 / 差集 / 交集 / 异或
 * 用 Paper.js 的路径代数做运算，再把结果转回我们自己的 VecPath（顶点可编辑）。
 * 开放路径（折线/管线）先按线宽转成描边带再参与面运算；
 * 运算结果统一抽稀成折线多边形，仍是普通可编辑图元。
 */
import paper from 'paper';
import type { BoolOp, ItemStyle, Pt, VecPath } from './types';
import { dist, simplify, worldSamples } from './geometry';

let scope: paper.PaperScope | null = null;

function getScope(): paper.PaperScope {
  if (scope) return scope;
  const s = new paper.PaperScope();
  s.setup({ width: 1024, height: 1024 });
  scope = s;
  return s;
}

function samplesOf(item: VecPath, groupTx: import('./types').Matrix | null): Pt[] {
  return worldSamples(item, groupTx);
}

/** 把图元变成 Paper 面：闭合图元直接用填充面，开放图元按线宽生成描边轮廓面 */
function toPaperShape(
  s: paper.PaperScope,
  item: VecPath,
  groupTx: import('./types').Matrix | null,
): paper.PathItem {
  const pts = samplesOf(item, groupTx);
  if (item.closed) {
    const p = new s.Path({ closed: true });
    pts.forEach((q) => p.add(new s.Point(q.x, q.y)));
    p.fillColor = new s.Color('#fff');
    return p;
  }
  const p = new s.Path({ closed: false });
  pts.forEach((q) => p.add(new s.Point(q.x, q.y)));
  p.strokeWidth = Math.max(2, item.style.strokeWidth * 2);
  p.strokeColor = new s.Color('#000');
  p.strokeJoin = 'round';
  p.strokeCap = 'round';
  // paper 0.12: Path 没有公开 expandStroke，用 createOutline 等价方案
  const outline = (p as unknown as {
    createOutline?: () => paper.Path;
  }).createOutline?.call(p);
  if (outline) {
    p.remove();
    outline.fillColor = new s.Color('#fff');
    return outline;
  }
  // 兜底：直接把开放路径闭合参与运算
  p.closed = true;
  p.fillColor = new s.Color('#fff');
  return p;
}

function paperToPoints(shape: paper.PathItem, tolerance = 1.5): Pt[][] {
  const rings: Pt[][] = [];
  const collect = (path: paper.Path) => {
    const pts: Pt[] = [];
    for (const seg of path.segments) {
      pts.push({ x: seg.point.x, y: seg.point.y });
    }
    if (pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < 0.5) pts.pop();
    const simp = simplify(pts, tolerance);
    if (simp.length >= 3) rings.push(simp);
  };
  if (shape.className === 'Path') {
    collect(shape as paper.Path);
  } else if (shape.className === 'CompoundPath') {
    (shape as paper.CompoundPath).children.forEach((c) => {
      if (c.className === 'Path') collect(c as paper.Path);
    });
  }
  return rings;
}

export interface BoolResult {
  rings: Pt[][];
  /** 结果是面还是线（开放路径互相运算且无接触时可能为空） */
  empty: boolean;
}

export function booleanOp(
  op: BoolOp,
  a: VecPath,
  b: VecPath,
  groupTxA: import('./types').Matrix | null,
  groupTxB: import('./types').Matrix | null,
): BoolResult {
  const s = getScope();
  s.project.clear();
  const pa = toPaperShape(s, a, groupTxA);
  const pb = toPaperShape(s, b, groupTxB);
  let result: paper.PathItem | null = null;
  try {
    switch (op) {
      case 'unite':
        result = pa.unite(pb, { insert: false }) as paper.PathItem;
        break;
      case 'subtract':
        result = pa.subtract(pb, { insert: false }) as paper.PathItem;
        break;
      case 'intersect':
        result = pa.intersect(pb, { insert: false }) as paper.PathItem;
        break;
      case 'xor':
        result = pa.exclude?.(pb, { insert: false }) as paper.PathItem;
        break;
    }
  } catch (e) {
    console.warn('布尔运算失败，返回空结果', e);
  }
  if (!result || result.isEmpty() || !result.bounds) {
    pa.remove();
    pb.remove();
    result?.remove();
    return { rings: [], empty: true };
  }
  const rings = paperToPoints(result);
  pa.remove();
  pb.remove();
  result.remove();
  return { rings, empty: rings.length === 0 };
}

/** 用布尔结果生成新的可编辑图元（外环 + 内环都保留为独立闭合路径） */
export function resultToItems(
  rings: Pt[][],
  base: Pick<VecPath, 'type' | 'layerId' | 'style'>,
  idFactory: () => string,
  namePrefix: string,
): VecPath[] {
  return rings.map((ring, i) => ({
    id: idFactory(),
    type: base.type,
    name: `${namePrefix}-${i + 1}`,
    layerId: base.layerId,
    closed: true,
    points: ring,
    segments: [],
    smooth: false,
    style: { ...base.style } as ItemStyle,
    transform: [1, 0, 0, 1, 0, 0],
    groupId: null,
  }));
}
