import { generateFeatures } from '../src/data';
const feats = generateFeatures(20261120);
const points = feats.filter((f) => f.geom.kind === 'point');
// 同图层 + 完全相同坐标
const exact = new Map<string, number>();
for (const f of points) {
  const g = f.geom as { x: number; y: number };
  const k = `${f.layerId}:${g.x.toFixed(4)},${g.y.toFixed(4)}`;
  exact.set(k, (exact.get(k) ?? 0) + 1);
}
let dupKeys = 0;
let dupExtra = 0;
for (const n of exact.values()) if (n > 1) { dupKeys++; dupExtra += n - 1; }
console.log('点要素总数:', points.length);
console.log('唯一(图层+坐标)键数:', exact.size);
console.log('存在重合的键数:', dupKeys, '多余重合点数:', dupExtra);

// 屏幕距离很近（模拟 LOD3 放大到 scale≈3.5 时 12px 内）的点密度
const scale = 3.467;
const byLayer = new Map<string, { x: number; y: number }[]>();
for (const f of points) {
  const g = f.geom as { x: number; y: number };
  const arr = byLayer.get(f.layerId) ?? [];
  arr.push({ x: g.x * scale, y: g.y * scale });
  byLayer.set(f.layerId, arr);
}
for (const [layer, arr] of byLayer) {
  // 网格统计 12px 内邻居
  const cell = 12;
  const grid = new Map<string, number>();
  for (const p of arr) {
    const k = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
    grid.set(k, (grid.get(k) ?? 0) + 1);
  }
  let crowded = 0;
  for (const n of grid.values()) if (n > 1) crowded += n;
  console.log(`${layer}: ${arr.length} 点, 12px格内多点的格覆盖 ${crowded} 点`);
}
