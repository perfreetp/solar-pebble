import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateNetwork,
  computeFingerprint,
  capturesLock,
  captureLockFor,
  sampleAtU,
  shapeSignature,
  polylineLength,
  DEFAULT_PARAMS,
  levelProfiles,
  pickCreek,
  deformCreek,
  Terrain,
  toPayload,
  fromPayload,
  buildSurveyReport,
} from '../dist-test/core.mjs';

const base = (over = {}) => ({ ...DEFAULT_PARAMS, ...over });

/* ------------------------------------------------------------------ *
 * 1. 确定性
 * ------------------------------------------------------------------ */

test('同参数同种子 → 完全一致 (指纹与逐点坐标)', () => {
  const a = generateNetwork(base());
  const b = generateNetwork(base());
  assert.equal(a.fingerprint, b.fingerprint);
  assert.equal(a.creeks.length, b.creeks.length);
  for (let i = 0; i < a.creeks.length; i++) {
    const ca = a.creeks[i];
    const cb = b.creeks[i];
    assert.equal(ca.id, cb.id);
    assert.equal(ca.pts.length, cb.pts.length, `${ca.id} 点数不同`);
    for (let k = 0; k < ca.pts.length; k++) {
      assert.equal(ca.pts[k], cb.pts[k], `${ca.id} 第 ${k} 个坐标不同`);
    }
    for (let k = 0; k < ca.widths.length; k++) {
      assert.equal(ca.widths[k], cb.widths[k]);
    }
  }
});

test('换种子 → 网络变化', () => {
  const a = generateNetwork(base({ seed: 'ALPHA' }));
  const b = generateNetwork(base({ seed: 'BETA' }));
  assert.notEqual(a.fingerprint, b.fingerprint);
  // 主沟形态应不同
  const ca = a.creeks.find((c) => c.id === 'M1');
  const cb = b.creeks.find((c) => c.id === 'M1');
  let diff = 0;
  const n = Math.min(ca.pts.length, cb.pts.length) / 2;
  for (let i = 0; i < n; i++) {
    diff += Math.abs(ca.pts[i * 2] - cb.pts[i * 2]) + Math.abs(ca.pts[i * 2 + 1] - cb.pts[i * 2 + 1]);
  }
  assert.ok(diff > 1, `主沟应当随种子变化, 实际差异 ${diff}`);
});

test('参数微调都会改变指纹 (每个参数都真正参与生成)', () => {
  const baseFp = generateNetwork(base()).fingerprint;
  const variants = [
    { heading: 23 },
    { branchAngle: 40 },
    { density: 0.6 },
    { meander: 0.62 },
    { seed: 'OTHER' },
    { headLevel: 1.55 },
  ];
  const seen = new Set([baseFp]);
  for (const v of variants) {
    const fp = generateNetwork(base(v)).fingerprint;
    assert.ok(!seen.has(fp), `参数 ${JSON.stringify(v)} 未改变几何结果`);
    seen.add(fp);
  }
});

test('生成顺序无关: 多次生成指纹稳定', () => {
  const fps = new Set();
  for (let i = 0; i < 5; i++) {
    fps.add(generateNetwork(base({ seed: `RUN-${i % 2}` })).fingerprint);
  }
  assert.equal(fps.size, 2, '两枚种子应各得到唯一指纹');
});

test('指纹不依赖浮点末位 (量化后比对)', () => {
  const n = generateNetwork(base());
  const fp2 = computeFingerprint(n.params, n.creeks);
  assert.equal(fp2, n.fingerprint);
});

/* ------------------------------------------------------------------ *
 * 2. 三级结构
 * ------------------------------------------------------------------ */

test('网络包含主干 / 支沟 / 毛细沟三级', () => {
  const n = generateNetwork(base({ density: 0.8 }));
  for (const lvl of [1, 2, 3]) {
    const count = n.creeks.filter((c) => c.level === lvl).length;
    assert.ok(count > 0, `第 ${lvl} 级应有沟道`);
  }
  // 层级关系合法
  for (const c of n.creeks) {
    if (c.level === 1) assert.equal(c.parentId, null);
    if (c.level === 2) assert.equal(c.parentId, 'M1');
    if (c.level === 3) {
      const parent = n.creeks.find((p) => p.id === c.parentId);
      assert.ok(parent, `毛细沟 ${c.id} 的父沟应存在`);
      assert.equal(parent.level, 2);
    }
  }
});

test('支沟与毛细沟宽度小于父沟口宽', () => {
  const n = generateNetwork(base({ density: 0.7 }));
  const byId = new Map(n.creeks.map((c) => [c.id, c]));
  for (const c of n.creeks) {
    if (!c.parentId) continue;
    const p = byId.get(c.parentId);
    assert.ok(c.mouthWidth < p.mouthWidth + 1e-6, `${c.id} 口宽应小于父沟`);
  }
});

test('每级都有自己的宽度衰减: 同长度下高级别收窄更快', () => {
  const profiles = levelProfiles(base());
  const p1 = profiles[1];
  const p2 = profiles[2];
  const p3 = profiles[3];
  assert.ok(p1.widthDecay < p2.widthDecay, '支沟衰减应强于主干');
  assert.ok(p2.widthDecay < p3.widthDecay, '毛细沟衰减应最强');
  assert.ok(p3.meanderNoise > p2.meanderNoise, '毛细沟弯曲噪声应更强');
});

test('沟道宽度沿程单调收窄 (允许沟头收尾)', () => {
  const n = generateNetwork(base());
  const main = n.creeks.find((c) => c.id === 'M1');
  const w0 = main.widths[0];
  const wl = main.widths[main.widths.length - 1];
  assert.ok(wl < w0 * 0.6, `沟头宽度应显著小于沟口 (${w0} → ${wl})`);
  // 除最后 30% 的收尾区外不得增大
  const guard = Math.floor(main.widths.length * 0.7);
  for (let i = 1; i < guard; i++) {
    assert.ok(main.widths[i] <= main.widths[i - 1] + 1e-4, '中上游宽度不应增大');
  }
});

/* ------------------------------------------------------------------ *
 * 3. 沟头高程收尾
 * ------------------------------------------------------------------ */

test('沟头按高程自然收尾', () => {
  const p = base({ density: 0.42 });
  const n = generateNetwork(p);
  const main = n.creeks.find((c) => c.id === 'M1');
  assert.ok(Math.abs(main.headElevation - p.headLevel) < 0.08, `主干沟头应在终止高程, 实际 ${main.headElevation}`);

  // 因高程而收尾的沟道, 沟头必须落在自己的终止高程上 (而不是被长度上限截断)
  const elevStops = n.creeks.filter((c) => c.stopReason === 'elevation');
  assert.ok(elevStops.length / n.creeks.length > 0.35, `应有相当比例沟道由高程收尾, 实际 ${elevStops.length}/${n.creeks.length}`);
  for (const c of elevStops) {
    assert.ok(
      Math.abs(c.headElevation - c.headTarget) < 0.08,
      `${c.id} 高程收尾但沟头 ${c.headElevation.toFixed(2)} 偏离目标 ${c.headTarget.toFixed(2)}`,
    );
  }
  // 支沟 / 毛细沟止于更低的滩面 → 树枝状层次
  const meanHead = (lvl) => {
    const arr = n.creeks.filter((c) => c.level === lvl).map((c) => c.headElevation);
    return arr.reduce((s, v) => s + v, 0) / Math.max(1, arr.length);
  };
  assert.ok(meanHead(2) < meanHead(1), '支沟平均沟头高程应低于主干');
  assert.ok(meanHead(3) < meanHead(2), '毛细沟平均沟头高程应低于支沟');
  // 每条沟都记录了收尾原因
  for (const c of n.creeks) assert.ok(c.stopReason, `${c.id} 缺少收尾原因`);
});

test('提高终止高程 → 主沟不断延展 (沟头按高程收尾)', () => {
  const lengths = [1.35, 1.55, 1.75, 1.95].map((hl) => {
    const n = generateNetwork(base({ headLevel: hl }));
    return n.creeks.find((c) => c.id === 'M1').length;
  });
  for (let i = 1; i < lengths.length; i++) {
    assert.ok(lengths[i] > lengths[i - 1], `终止高程提高后主沟应更长: ${lengths.join(' < ')}`);
  }
});

test('主沟指向: 走向参数改变主沟朝向', () => {
  const a = generateNetwork(base({ heading: 0, seed: 'DIR' }));
  const b = generateNetwork(base({ heading: 90, seed: 'DIR' }));
  const ma = a.creeks.find((c) => c.id === 'M1');
  const mb = b.creeks.find((c) => c.id === 'M1');
  const angA = Math.atan2(ma.pts[ma.pts.length - 1] - ma.pts[1], ma.pts[ma.pts.length - 2] - ma.pts[0]);
  const angB = Math.atan2(mb.pts[mb.pts.length - 1] - mb.pts[1], mb.pts[mb.pts.length - 2] - mb.pts[0]);
  const degA = ((90 - (angA * 180) / Math.PI) % 360 + 360) % 360;
  const degB = ((90 - (angB * 180) / Math.PI) % 360 + 360) % 360;
  // 走向 0 → 北 (+y), 走向 90 → 东 (+x)
  assert.ok(Math.abs(degA - 0) < 25 || Math.abs(degA - 360) < 25, `走向 0 的主沟应朝北, 实测 ${degA}`);
  assert.ok(Math.abs(degB - 90) < 25, `走向 90 的主沟应朝东, 实测 ${degB}`);
});

test('分叉角影响支沟与主干的夹角', () => {
  const measure = (branchAngle) => {
    const n = generateNetwork(base({ branchAngle, seed: 'ANG' }));
    const byId = new Map(n.creeks.map((c) => [c.id, c]));
    const vals = n.creeks
      .filter((c) => c.level === 2)
      .map((c) => {
        const parent = byId.get(c.parentId);
        const t = sampleAtU(parent, c.parentU).angle;
        const a = Math.atan2(c.pts[3] - c.pts[1], c.pts[2] - c.pts[0]);
        const d = Math.atan2(Math.sin(a - t), Math.cos(a - t));
        return Math.abs((d * 180) / Math.PI);
      });
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  };
  const narrow = measure(12);
  const mid = measure(38);
  const wide = measure(90);
  assert.ok(mid > narrow + 5, `分叉角 38° 的夹角应明显大于 12°: ${narrow} vs ${mid}`);
  assert.ok(wide > mid + 5, `分叉角 90° 的夹角应明显大于 38°: ${mid} vs ${wide}`);
});

test('曲流幅度越大曲折度越高', () => {
  const straight = generateNetwork(base({ meander: 0.05 }));
  const wiggly = generateNetwork(base({ meander: 0.95 }));
  assert.ok(wiggly.stats.meanSinuosity > straight.stats.meanSinuosity);
});

test('密度越大沟道越多', () => {
  const sparse = generateNetwork(base({ density: 0.15 }));
  const dense = generateNetwork(base({ density: 1 }));
  assert.ok(dense.creeks.length > sparse.creeks.length);
});

/* ------------------------------------------------------------------ *
 * 4. 锁定段
 * ------------------------------------------------------------------ */

test('锁定后改主沟走向: 锁定段形态不变, 且接到新网络上', () => {
  const p1 = base({ seed: 'LOCK', heading: 20 });
  const net1 = generateNetwork(p1);
  const branch = net1.creeks.find((c) => c.level === 2);
  assert.ok(branch, '应存在支沟可供锁定');
  const lock = captureLockFor(net1.creeks, branch, '2026-01-01T00:00:00Z');

  // 改走向 20° → 75° 重新生成, 带锁定
  const p2 = base({ seed: 'LOCK', heading: 75 });
  const net2 = generateNetwork(p2, { locks: [lock] });

  const rebuilt = net2.creeks.find((c) => c.id === lock.creekId);
  assert.ok(rebuilt, '锁定段应在重生成结果中保留');

  // 形态签名不变 (刚体不变)
  const sig = shapeSignature(rebuilt.pts, polylineLength(rebuilt.pts));
  assert.equal(sig, lock.shapeSignature, '锁定段形态应完全不变');
  assert.ok(Math.abs(rebuilt.length - lock.length) < 1e-6, '锁定段长度应不变');

  // 起点贴在新父沟上
  const parent = net2.creeks.find((c) => c.id === lock.parentId);
  assert.ok(parent);
  // 在父沟 polyline 上找最近点
  let best = Infinity;
  const n = parent.pts.length / 2;
  for (let i = 0; i < n - 1; i++) {
    const ax = parent.pts[i * 2], ay = parent.pts[i * 2 + 1];
    const bx = parent.pts[i * 2 + 2], by = parent.pts[i * 2 + 3];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let u = l2 > 0 ? ((rebuilt.pts[0] - ax) * dx + (rebuilt.pts[1] - ay) * dy) / l2 : 0;
    u = Math.max(0, Math.min(1, u));
    const d = Math.hypot(rebuilt.pts[0] - (ax + dx * u), rebuilt.pts[1] - (ay + dy * u));
    if (d < best) best = d;
  }
  assert.ok(best < 0.01, `锁定段起点应贴在父沟上, 距离 ${best}`);

  // 锁定报告
  const report = net2.lockReport.find((r) => r.creekId === lock.creekId);
  assert.ok(report);
  assert.equal(report.ok, true, `锁定校核应通过, 实际 ${JSON.stringify(report)}`);
});

test('锁定主干后改变走向 → 主干整体旋转但形态不变', () => {
  const p1 = base({ seed: 'MAINLOCK', heading: 30 });
  const net1 = generateNetwork(p1);
  const main = net1.creeks.find((c) => c.id === 'M1');
  const lock = capturesLock(main, 't0');

  const p2 = base({ seed: 'MAINLOCK', heading: 120 });
  const net2 = generateNetwork(p2, { locks: [lock] });
  const rebuilt = net2.creeks.find((c) => c.id === 'M1');
  assert.equal(shapeSignature(rebuilt.pts, polylineLength(rebuilt.pts)), lock.shapeSignature);
  assert.ok(Math.abs(rebuilt.length - main.length) < 1e-6);
});

test('关闭锁定重生成 → 恢复程序化结果并报告孤儿锁定', () => {
  const p1 = base({ seed: 'LOCKOFF' });
  const net1 = generateNetwork(p1);
  const main = net1.creeks.find((c) => c.id === 'M1');
  const lock = capturesLock(main, 't0');
  const plain = generateNetwork(p1);
  const net2 = generateNetwork(p1, { locks: [lock], reattachLocks: false });
  assert.equal(net2.fingerprint, plain.fingerprint, '关闭后应与无锁定结果一致');
  assert.equal(net2.orphans.length, 1);
});

test('锁定保存 / 恢复往返不丢形态', () => {
  const n = generateNetwork(base({ seed: 'ROUNDTRIP' }));
  const c = n.creeks.find((x) => x.level === 2);
  const lock = captureLockFor(n.creeks, c, 't0');
  const json = JSON.parse(JSON.stringify(lock));
  assert.deepEqual(json.localPts, lock.localPts);
  const net2 = generateNetwork(n.params, { locks: [json] });
  const rebuilt = net2.creeks.find((x) => x.id === lock.creekId);
  assert.equal(shapeSignature(rebuilt.pts, polylineLength(rebuilt.pts)), lock.shapeSignature);
});

/* ------------------------------------------------------------------ *
 * 5. 编辑 / 拾取
 * ------------------------------------------------------------------ */

test('手工编辑沟道后可拾取到该沟道', () => {
  const n = generateNetwork(base({ seed: 'EDIT' }));
  const target = n.creeks.find((c) => c.level === 1);
  const profile = levelProfiles(n.params)[1];
  const terrain = new Terrain(n.params);
  const edited = deformCreek(target, 0.5, 40, 60, terrain, profile);
  assert.equal(edited.id, target.id);
  assert.ok(Math.hypot(edited.pts[0] - target.pts[0], edited.pts[1] - target.pts[1]) < 1e-9, '起点不应移动');
  const mid = Math.floor(edited.pts.length / 4);
  const moved = Math.hypot(
    edited.pts[mid * 2] - target.pts[mid * 2],
    edited.pts[mid * 2 + 1] - target.pts[mid * 2 + 1],
  );
  assert.ok(moved > 5, `中部应被推移, 实际 ${moved} m`);

  const hit = pickCreek([edited], edited.pts[mid * 2], edited.pts[mid * 2 + 1], 5);
  assert.ok(hit, '应能拾取到编辑后的沟道');
});

test('编辑后的网络快照可原样恢复 (含 edited 标记)', () => {
  const n = generateNetwork(base({ seed: 'SNAP' }));
  const payload = toPayload(n);
  const restored = fromPayload(payload);
  assert.equal(restored.creeks.length, n.creeks.length);
  const a = n.creeks[0];
  const b = restored.creeks[0];
  for (let i = 0; i < a.pts.length; i++) assert.equal(a.pts[i], b.pts[i]);
});

/* ------------------------------------------------------------------ *
 * 6. 编码与说明
 * ------------------------------------------------------------------ */

test('调查说明包含关键参数与统计', () => {
  const n = generateNetwork(base({ seed: 'DOC', density: 0.66 }));
  const text = buildSurveyReport(n, {
    code: 'TC-2026-JS-001',
    name: '江苏中部岸段潮沟网络调查',
    region: '江苏中部',
    surveyor: '海岸带调查一队',
    observedAt: '2026-11-20',
  });
  assert.match(text, /TC-2026-JS-001/);
  assert.match(text, /主沟走向/);
  assert.match(text, /随机种子\s+DOC/);
  assert.match(text, /主干沟/);
  assert.match(text, /沟道密度/);
  assert.ok(text.includes(n.fingerprint), '说明中应含参数指纹');
});

test('种子含特殊字符仍可用', () => {
  const n = generateNetwork(base({ seed: '潮沟-2026/华东 #7 🌊' }));
  const n2 = generateNetwork(base({ seed: '潮沟-2026/华东 #7 🌊' }));
  assert.equal(n.fingerprint, n2.fingerprint);
});

test('极端参数不崩溃', () => {
  const extremes = [
    { density: 0, meander: 0 },
    { density: 1, meander: 1 },
    { branchAngle: 0 },
    { branchAngle: 180 },
    { headLevel: 0.2 },
    { headLevel: 3 },
  ];
  for (const e of extremes) {
    const n = generateNetwork(base(e));
    assert.ok(n.creeks.length >= 1);
    assert.ok(isFinite(n.stats.totalLength));
  }
});

/* ------------------------------------------------------------------ *
 * 7. 极端与持久性
 * ------------------------------------------------------------------ */

test('缓比降 + 高终止高程: 网络被调查范围截断而非无限延展', () => {
  const n = generateNetwork(base({ headLevel: 2.6, slope: 0.0002 }));
  let maxR = 0;
  for (const c of n.creeks) {
    for (let i = 0; i < c.pts.length; i += 2) {
      maxR = Math.max(maxR, Math.abs(c.pts[i]), Math.abs(c.pts[i + 1]));
    }
  }
  assert.ok(maxR <= 3400 + 1e-6, `坐标不应超出调查范围, 实际 ${maxR}`);
  assert.ok(n.creeks.filter((c) => c.stopReason === 'extent').length > 0, '应有沟道被范围截断');
});

test('锁定段跨多次整体重生成保持稳定', () => {
  const p = base({ seed: 'PERSIST' });
  const n1 = generateNetwork(p);
  const branch = n1.creeks.find((c) => c.level === 2);
  const lock = captureLockFor(n1.creeks, branch, 't0');

  const n2 = generateNetwork({ ...p, heading: 80 }, { locks: [lock] });
  const kept = n2.creeks.find((c) => c.id === lock.creekId);
  assert.ok(n2.lockReport[0].ok);
  const len1 = kept.length;

  // 第二次重生成, 锁定段重新捕获后仍然稳定
  const lock2 = captureLockFor(n2.creeks, kept, 't1');
  const n3 = generateNetwork({ ...p, heading: 200 }, { locks: [lock2] });
  const kept2 = n3.creeks.find((c) => c.id === lock.creekId);
  assert.ok(n3.lockReport[0].ok);
  assert.ok(Math.abs(kept2.length - len1) < 1e-6, `两次重生成长度应一致: ${len1} vs ${kept2.length}`);
  assert.equal(shapeSignature(kept2.pts, kept2.length), lock2.shapeSignature);
});

test('编辑后的沟道锁定后仍保持编辑过的形态', () => {
  const p = base({ seed: 'EDITLOCK' });
  const n1 = generateNetwork(p);
  const branch = n1.creeks.find((c) => c.level === 2);
  const edited = deformCreek(branch, 0.5, 35, 50, new Terrain(p), levelProfiles(p)[2]);
  assert.notEqual(shapeSignature(edited.pts, edited.length), shapeSignature(branch.pts, branch.length));

  const lock = captureLockFor([...n1.creeks.filter((c) => c.id !== edited.id), edited], edited, 't');
  const n2 = generateNetwork({ ...p, heading: 95 }, { locks: [lock] });
  const kept = n2.creeks.find((c) => c.id === lock.creekId);
  assert.ok(n2.lockReport[0].ok);
  assert.equal(shapeSignature(kept.pts, kept.length), lock.shapeSignature, '编辑后的形态应被锁定保留');
});

test('减缓比降 → 网络总长增加 (沟头更远)', () => {
  const steep = generateNetwork(base({ slope: 0.003 }));
  const gentle = generateNetwork(base({ slope: 0.0004 }));
  assert.ok(gentle.stats.totalLength > steep.stats.totalLength);
});

test('三级网络的沟宽严格递减 (主干 > 支沟 > 毛细沟)', () => {
  const n = generateNetwork(base({ density: 0.75 }));
  const meanByLevel = [1, 2, 3].map((l) => {
    const arr = n.creeks.filter((c) => c.level === l);
    return arr.reduce((s, c) => s + c.mouthWidth, 0) / Math.max(1, arr.length);
  });
  assert.ok(meanByLevel[0] > meanByLevel[1], `主干平均口宽应大于支沟: ${meanByLevel.map((v) => v.toFixed(1))}`);
  assert.ok(meanByLevel[1] > meanByLevel[2], `支沟平均口宽应大于毛细沟: ${meanByLevel.map((v) => v.toFixed(1))}`);
});

test('分级表始终覆盖 5 级的取值范围', () => {
  const n = generateNetwork(base({ density: 0.7 }));
  for (const key of ['length', 'density', 'elevation']) {
    const t = n.classes[key];
    assert.ok(t.min <= t.max, `${key} 分级范围异常`);
    assert.ok(t.breaks.every((b, i) => i === 0 || b > t.breaks[i - 1]), `${key} 分级断点应递增`);
  }
  for (const c of n.creeks) {
    assert.ok(c.classIdx.length >= 0 && c.classIdx.length <= 4);
    assert.ok(c.classIdx.density >= 0 && c.classIdx.density <= 4);
    assert.ok(c.classIdx.elevation >= 0 && c.classIdx.elevation <= 4);
  }
});

test('锁定支沟随父沟旋转: 保持与父沟的分叉角 (相对转角)', () => {
  const p = base({ seed: 'ROT' });
  const n1 = generateNetwork(p);
  const branch = n1.creeks.find((c) => c.level === 2);
  const parent1 = n1.creeks.find((c) => c.id === branch.parentId);
  const parentAngle1 = sampleAtU(parent1, branch.parentU).angle;
  const startAngle1 = Math.atan2(branch.pts[3] - branch.pts[1], branch.pts[2] - branch.pts[0]);
  const relBefore = Math.atan2(Math.sin(startAngle1 - parentAngle1), Math.cos(startAngle1 - parentAngle1));

  const lock = captureLockFor(n1.creeks, branch, 't0');
  assert.ok(Math.abs(lock.relativeAngle - relBefore) < 1e-9, '锁定应记录相对转角');

  const n2 = generateNetwork({ ...p, heading: p.heading + 90 }, { locks: [lock] });
  const kept = n2.creeks.find((c) => c.id === lock.creekId);
  const parent2 = n2.creeks.find((c) => c.id === branch.parentId);
  const parentAngle2 = sampleAtU(parent2, lock.parentU).angle;
  const startAngle2 = Math.atan2(kept.pts[3] - kept.pts[1], kept.pts[2] - kept.pts[0]);
  const relAfter = Math.atan2(Math.sin(startAngle2 - parentAngle2), Math.cos(startAngle2 - parentAngle2));

  assert.ok(Math.abs(relAfter - relBefore) < 1e-6, `分叉角应保持: ${relBefore} → ${relAfter}`);
  // 绝对朝向确实随父沟改变
  assert.ok(Math.abs(Math.atan2(Math.sin(startAngle2 - startAngle1), Math.cos(startAngle2 - startAngle1))) > 0.3,
    '锁定段整体朝向应随父沟旋转');
});
