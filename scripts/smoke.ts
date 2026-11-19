import { generateFeatures, deriveVersion } from '../src/data';
import { SpatialIndex } from '../src/lib/spatial-index';
import { diffVersions, buildVersion } from '../src/review';
import { lodForScale } from '../src/layers';

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) {
    failures++;
    console.error('✗', msg);
  } else {
    console.log('✓', msg);
  }
};

const v1 = generateFeatures(20261120);
console.log(`V1 要素总数: ${v1.length}`);
assert(v1.length >= 30000, `要素数 ≥ 30000（实际 ${v1.length}）`);

const byLayer: Record<string, number> = {};
for (const f of v1) byLayer[f.layerId] = (byLayer[f.layerId] ?? 0) + 1;
console.log('分层统计:', byLayer);
assert(Object.keys(byLayer).length === 7, '7 个图层齐全');

// 空间索引
const idx = SpatialIndex.build(v1);
const stats = idx.stats;
console.log('索引统计:', stats);
assert(stats.totalFeatures === v1.length, '索引覆盖全部要素');
const candidates = idx.queryPoint(700, 800, 30);
assert(candidates.length > 0 && candidates.length < 500, `点查询返回合理候选数 ${candidates.length}`);
const rect = idx.queryRect(0, 0, 500, 500);
assert(rect.length > 0, '矩形查询有结果');

// 版本差异
const derived = deriveVersion(v1, 99999);
const va = buildVersion('a', 'A', '', v1, []);
const vb = buildVersion('b', 'B', '', derived.features, []);
const diffs = diffVersions(va.features, vb.features);
const counts = { added: 0, removed: 0, modified: 0 };
for (const d of diffs) counts[d.kind]++;
console.log('差异统计:', counts);
assert(counts.added === 150, '新增 150 个');
assert(counts.removed === 120, '删除 120 个');
assert(counts.modified === 180, '修改 180 个');

// LOD 四级
const lods = new Set([0.3, 0.6, 1.5, 4].map(lodForScale));
console.log('各级比例尺 LOD:', [0.3, 0.6, 1.5, 4].map((s) => `${s}->${lodForScale(s)}`));
assert(lods.size === 4, '四种比例尺覆盖 4 个 LOD 级别');

console.log(failures === 0 ? '\n全部冒烟测试通过' : `\n${failures} 项失败`);
if (failures) process.exit(1);
