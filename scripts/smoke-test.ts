// 核心逻辑冒烟测试(纯 Node 运行,不依赖 DOM)
import assert from 'node:assert';
import { flattenPath, bboxOf, movePath, ringArea } from '../src/lib/geometry';
import { booleanPaths, cutPatternWithVeins } from '../src/lib/boolean';
import { snapPoint } from '../src/lib/snap';
import { applyAlign } from '../src/lib/align';
import { exportLayeredSVG } from '../src/lib/svgExport';
import type { PathData } from '../src/types';
import { makePath } from '../src/lib/pathFactory';

let pass = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  pass++;
  console.log(`  ✓ ${name}`);
}

function square(cx: number, cy: number, r: number, kind: 'vein' | 'pattern' = 'vein', name = 'sq'): PathData {
  const p = makePath(kind, name);
  p.closed = true;
  p.nodes = [
    { x: cx - r, y: cy - r }, { x: cx + r, y: cy - r },
    { x: cx + r, y: cy + r }, { x: cx - r, y: cy + r },
  ];
  p.handlesIn = p.nodes.map(() => null);
  p.handlesOut = p.nodes.map(() => null);
  return p;
}

console.log('1) flattenPath: 正方形展平得到 4 个点');
const s = square(100, 100, 50);
const flat = flattenPath(s);
ok('展平后 4 点', flat.length === 4);
ok('面积 10000', Math.abs(Math.abs(ringArea(flat)) - 10000) < 1e-6);

console.log('2) 布尔并集:两个重叠正方形 → 面积大于单个');
const a = square(100, 100, 50);
const b = square(160, 100, 50);
const union = booleanPaths(a, b, 'union');
ok('并集至少 1 条路径', union.length >= 1);
const unionArea = Math.abs(ringArea(flattenPath(union[0])));
ok('并集面积 10000 < area < 20000: ' + unionArea.toFixed(1), unionArea > 10000 && unionArea < 20000);

console.log('3) 布尔差集:a - b 面积 = 10000 - 重叠区(40*100)');
const diff = booleanPaths(square(100, 100, 50), square(160, 100, 50), 'difference');
const diffArea = diff.reduce((sum, p) => sum + Math.abs(ringArea(flattenPath(p))), 0);
ok('差集面积约 6000: ' + diffArea.toFixed(1), Math.abs(diffArea - 6000) < 1);

console.log('4) 布尔交集:重叠区 40×100 = 4000');
const inter = booleanPaths(square(100, 100, 50), square(160, 100, 50), 'intersection');
const interArea = inter.reduce((sum, p) => sum + Math.abs(ringArea(flattenPath(p))), 0);
ok('交集面积约 4000: ' + interArea.toFixed(1), Math.abs(interArea - 4000) < 1);

console.log('5) 斑纹镂空:斑纹块被内部短翅脉切出 hole');
const pattern = square(200, 200, 80, 'pattern', '斑纹');
const vein = makePath('vein', '短脉');
vein.closed = false;
vein.nodes = [{ x: 150, y: 200 }, { x: 250, y: 200 }];
vein.handlesIn = [null, null];
vein.handlesOut = [null, null];
const cut = cutPatternWithVeins(pattern, [vein], 10);
ok('切割后仍有斑纹路径', cut.length >= 1);
ok('至少 1 个镂空环', cut.some(p => p.holes.length > 0));
const cutArea = cut.reduce((sum, p) => {
  const outer = Math.abs(ringArea(flattenPath(p)));
  const holes = p.holes.reduce((h, r) => h + Math.abs(ringArea(r)), 0);
  return sum + outer - holes;
}, 0);
ok('镂空后面积 < 原始 25600: ' + cutArea.toFixed(1), cutArea < 25600 && cutArea > 24000);

console.log('5b) 全宽翅脉切割:斑纹被切成两块(几何上正确的分裂)');
const fullVein = makePath('vein', '全宽脉');
fullVein.closed = false;
fullVein.nodes = [{ x: 100, y: 200 }, { x: 300, y: 200 }];
fullVein.handlesIn = [null, null];
fullVein.handlesOut = [null, null];
const split = cutPatternWithVeins(square(200, 200, 80, 'pattern', '斑纹2'), [fullVein], 10);
const splitArea = split.reduce((sum, p) => sum + Math.abs(ringArea(flattenPath(p))), 0);
ok('分裂为 2 个多边形', split.length === 2);
ok('两块总面积小于原面积: ' + splitArea.toFixed(1), splitArea < 25600);

console.log('6) 吸附:节点接近另一节点时吸附');
const p1 = square(0, 0, 30);
const p2 = square(100, 100, 30);
const snap = snapPoint({ x: 31, y: 31 }, [p1, p2], [], { pathId: p2.id, index: 0 }, 1);
ok('吸附到 (30,30) 节点', snap.point.x === 30 && snap.point.y === 30 && snap.target?.type === 'node');

console.log('7) 吸附:垂直参考线吸附');
const snapG = snapPoint({ x: 50.5, y: 200 }, [], [{ id: 'g1', orientation: 'v', pos: 50 }], { pathId: 'x', index: 0 }, 1);
ok('x 被吸附到 50', snapG.point.x === 50 && snapG.target?.type === 'vguide');

console.log('8) 对齐:左对齐后所有路径左边界相同');
const al = [square(100, 100, 20, 'vein', 'a'), square(300, 200, 20, 'vein', 'b'), square(500, 50, 20, 'vein', 'c')];
applyAlign('left', al);
const xs = al.map(p => bboxOf(p.nodes).x);
ok('左边界全部相等', xs.every(x => Math.abs(x - xs[0]) < 1e-9));

console.log('9) 等间距分布:横向间隙相等');
const dist = [square(0, 0, 10, 'vein', 'a'), square(120, 0, 10, 'vein', 'b'), square(300, 0, 10, 'vein', 'c')];
applyAlign('distX', dist);
const boxes = dist.map(p => bboxOf(p.nodes)).sort((x, y) => x.x - y.x);
const gap1 = boxes[1].x - (boxes[0].x + boxes[0].w);
const gap2 = boxes[2].x - (boxes[1].x + boxes[1].w);
ok('两个间隙相等: ' + gap1.toFixed(2) + ' / ' + gap2.toFixed(2), Math.abs(gap1 - gap2) < 1e-9);

console.log('10) SVG 导出:分层结构 + evenodd + 贝塞尔 C 命令');
const bez = makePath('vein', '曲脉');
bez.closed = false;
bez.nodes = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
bez.handlesIn = [null, { x: -30, y: 0 }];
bez.handlesOut = [{ x: 30, y: 20 }, null];
const svg = exportLayeredSVG([bez, square(200, 200, 40, 'pattern', '斑')], {
  id: 't', name: '测试', veinColor: '#000', patternFill: '#f00', patternOpacity: 0.8,
  strokeWidth: 2, splitLayers: true, includeBg: false,
}, { specimenCode: 'SP-1', species: '测试种' });
ok('含翅脉图层', svg.includes('id="layer-vein"'));
ok('含斑纹图层', svg.includes('id="layer-pattern"'));
ok('含贝塞尔 C 命令', svg.includes(' C '));
ok('镂空规则 evenodd', svg.includes('fill-rule="evenodd"'));
ok('是合法 XML 头', svg.startsWith('<?xml'));

console.log('11) movePath 同步移动 holes');
const hp = square(0, 0, 50, 'pattern');
hp.holes.push([{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 }]);
movePath(hp, 100, 200);
ok('节点平移', hp.nodes[0].x === 50 && hp.nodes[0].y === 150);
ok('hole 同步平移', hp.holes[0][0].x === 110 && hp.holes[0][0].y === 210);

console.log(`\n全部 ${pass} 项断言通过 ✅`);
