// 版本链重建保真：派生链与「按种子记录顺序重建」结果必须逐要素一致
import { generateFeatures, deriveVersion } from '../src/data';

const BASE_SEED = 20261120;
let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) { failures++; console.error('✗', msg); } else console.log('✓', msg);
};

// 模拟 store.submitNewVersion 的种子规则
const seedFor = (index: number) => BASE_SEED + index * 101 + 13;

// 原始提交链
const v1 = generateFeatures(BASE_SEED);
const v2Seed = BASE_SEED + 7;
const v2 = deriveVersion(v1, v2Seed).features;
const v3Seed = seedFor(2);
const v3 = deriveVersion(v2, v3Seed).features;

// 模拟刷新后的重建（与 buildInitialVersions 相同算法）
const records = [
  { id: 'v1', baseVersionId: null as string | null, seed: BASE_SEED },
  { id: 'v2', baseVersionId: 'v1', seed: v2Seed },
  { id: 'v3', baseVersionId: 'v2', seed: v3Seed },
];
const byId = new Map<string, ReturnType<typeof generateFeatures>>();
for (const rec of records) {
  const feats = rec.baseVersionId == null
    ? generateFeatures(rec.seed)
    : deriveVersion(byId.get(rec.baseVersionId)!, rec.seed).features;
  byId.set(rec.id, feats);
}

const sameSet = (a: ReturnType<typeof generateFeatures>, b: ReturnType<typeof generateFeatures>) => {
  if (a.length !== b.length) return `数量 ${a.length} != ${b.length}`;
  const ma = new Map(a.map((f) => [f.id, f]));
  let mismatch = 0;
  for (const fb of b) {
    const fa = ma.get(fb.id);
    if (!fa) return `缺少要素 ${fb.id}`;
    if (JSON.stringify(fa) !== JSON.stringify(fb)) mismatch++;
  }
  return mismatch === 0 ? '' : `${mismatch} 个要素内容不一致`;
};

assert(sameSet(v1, byId.get('v1')!) === '', 'V1 重建一致: ' + (sameSet(v1, byId.get('v1')!) || 'OK'));
assert(sameSet(v2, byId.get('v2')!) === '', 'V2 重建一致: ' + (sameSet(v2, byId.get('v2')!) || 'OK'));
assert(sameSet(v3, byId.get('v3')!) === '', 'V3 重建一致: ' + (sameSet(v3, byId.get('v3')!) || 'OK'));

// 差异在重建后仍可复现
const diffV1V3 = (() => {
  const a = new Map(v1.map((f) => [f.id, f]));
  const b = new Map(byId.get('v3')!.map((f) => [f.id, f]));
  let added = 0, removed = 0, modified = 0;
  for (const [id, fb] of b) { if (!a.has(id)) added++; else if (JSON.stringify(a.get(id)) !== JSON.stringify(fb)) modified++; }
  for (const id of a.keys()) if (!b.has(id)) removed++;
  return { added, removed, modified };
})();
console.log('V1→V3 累计差异:', diffV1V3);
assert(diffV1V3.added > 0 && diffV1V3.removed > 0 && diffV1V3.modified > 0, '多版本累计差异可计算');

console.log(failures === 0 ? '\n版本链保真测试通过' : `\n${failures} 项失败`);
if (failures) process.exit(1);
