import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateNest, DEFAULT_PARAMS, normalizeParams, makeLockFromTunnel, samplePath } from '../src/lib/nest/generate.js';
import { encodeReproCode, decodeReproCode, normalizeSeed, rngFor } from '../src/lib/nest/seed.js';

test('same seed + params produces identical output', () => {
  const a = generateNest(DEFAULT_PARAMS, 'QK7M-2XPA');
  const b = generateNest({ ...DEFAULT_PARAMS }, 'QK7M-2XPA');
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('different seed produces different output', () => {
  const a = generateNest(DEFAULT_PARAMS, 'QK7M-2XPA');
  const b = generateNest(DEFAULT_PARAMS, 'TR4W-9QBN');
  assert.notEqual(JSON.stringify(a.tunnels), JSON.stringify(b.tunnels));
});

test('param sweep stays deterministic and finite', () => {
  const seeds = ['AAAA-1111', 'ZZZZ-9999', 'M3K8-QQ22'];
  for (const seed of seeds) {
    for (let ent = 1; ent <= 6; ent++) {
      for (let lv = 2; lv <= 6; lv++) {
        const params = { ...DEFAULT_PARAMS, entrances: ent, levels: lv, depth: 8 + lv * 3.5, branchAngle: 20 + lv * 9, tunnelDiameter: 0.25 + ent * 0.1 };
        const g = generateNest(params, seed);
        assert.ok(g.tunnels.length > 0);
        assert.ok(g.chambers.length > 0);
        const counts = g.counts.nursery + g.counts.granary + g.counts.fungus;
        assert.equal(counts, g.chambers.length);
        for (const c of g.chambers) {
          for (const v of [c.center.x, c.center.y, c.center.z, c.radii.x, c.radii.y, c.radii.z]) {
            assert.ok(Number.isFinite(v), `${c.id} non-finite`);
          }
          assert.ok(c.radii.x > 0 && c.radii.y > 0 && c.radii.z > 0);
        }
        // every chamber sits inside the soil block
        const halfX = g.soil.halfX;
        const halfZ = g.soil.halfZ;
        for (const c of g.chambers) {
          assert.ok(Math.abs(c.center.x) <= halfX, `${c.id} x outside soil`);
          assert.ok(Math.abs(c.center.z) <= halfZ, `${c.id} z outside soil`);
          assert.ok(c.center.y <= 0 && c.center.y >= -g.soil.depth, `${c.id} y outside soil`);
        }
        // determinism
        assert.equal(JSON.stringify(generateNest(params, seed)), JSON.stringify(g));
      }
    }
  }
});

test('all three chamber types appear for default params', () => {
  const g = generateNest(DEFAULT_PARAMS, 'QK7M-2XPA');
  assert.ok(g.counts.nursery > 0);
  assert.ok(g.counts.granary > 0);
  assert.ok(g.counts.fungus > 0);
});

test('largest chambers are nurseries, smallest are fungus farms', () => {
  const g = generateNest({ ...DEFAULT_PARAMS, entrances: 4, levels: 4 }, 'ABCD-1234');
  const byType = { nursery: [], granary: [], fungus: [] };
  for (const c of g.chambers) byType[c.type].push(c.volume);
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  assert.ok(avg(byType.nursery) > avg(byType.granary));
  assert.ok(avg(byType.granary) > avg(byType.fungus));
});

test('locked tunnel survives regeneration unchanged, rest is recomputed', () => {
  const seed = 'LOCK-0001';
  const base = generateNest(DEFAULT_PARAMS, seed);
  const target = base.tunnels.find((t) => t.kind === 'branch' && t.tier === 1);
  assert.ok(target);
  // simulate a designer dragging a control point
  const edited = target.points.map((p, i) => (i === 1 ? { x: p.x + 1.3, y: p.y + 0.6, z: p.z - 0.8 } : { ...p }));
  const locks = { [target.id]: makeLockFromTunnel({ ...target, points: edited }, null) };

  const withNewParams = { ...DEFAULT_PARAMS, entrances: 5, levels: 5, depth: 22, branchAngle: 60 };
  const regen = generateNest(withNewParams, seed, locks);
  const lockedOut = regen.tunnels.find((t) => t.id === target.id);
  assert.ok(lockedOut, 'locked tunnel kept');
  assert.equal(lockedOut.locked, true);
  assert.deepEqual(lockedOut.points, edited);
  assert.ok(lockedOut.radius > 0);
  // unrelated branch relies on new params and differs
  const other = regen.tunnels.find((t) => t.kind === 'branch' && t.id !== target.id);
  assert.ok(other);
  assert.notDeepEqual(other.points, target.points);
  // no un-locked status on other tunnels
  assert.equal(regen.tunnels.filter((t) => t.locked).length, 1);
});

test('locked chamber keeps type and position', () => {
  const seed = 'LOCK-0002';
  const base = generateNest(DEFAULT_PARAMS, seed);
  const target = base.tunnels.find((t) => t.kind === 'branch');
  const chamber = base.chambers.find((c) => c.tunnelId === target.id);
  const locks = { [target.id]: makeLockFromTunnel(target, chamber) };
  const regen = generateNest({ ...DEFAULT_PARAMS, levels: 6, depth: 26 }, seed, locks);
  const c2 = regen.chambers.find((c) => c.tunnelId === target.id);
  assert.deepEqual(c2.center, chamber.center);
  assert.deepEqual(c2.radii, chamber.radii);
  assert.equal(c2.type, chamber.type);
  assert.equal(c2.locked, true);
});

test('locks on tunnels that no longer exist stay as orphans', () => {
  const base = generateNest({ ...DEFAULT_PARAMS, entrances: 4, levels: 4 }, 'ORPH-0001');
  const target = base.tunnels.find((t) => t.id.startsWith('B4-'));
  assert.ok(target);
  const locks = { [target.id]: makeLockFromTunnel(target, base.chambers.find((c) => c.tunnelId === target.id)) };
  const regen = generateNest({ ...DEFAULT_PARAMS, entrances: 2, levels: 3 }, 'ORPH-0001', locks);
  const kept = regen.tunnels.find((t) => t.id === target.id);
  assert.ok(kept, 'orphan lock kept');
  assert.equal(kept.orphan, true);
  assert.deepEqual(kept.points, target.points);
});

test('unlocking restores deterministic baseline', () => {
  const base = generateNest(DEFAULT_PARAMS, 'UNLK-0001');
  const target = base.tunnels.find((t) => t.kind === 'branch');
  const locks = { [target.id]: makeLockFromTunnel(target, null) };
  const withLock = generateNest(DEFAULT_PARAMS, 'UNLK-0001', locks);
  assert.equal(withLock.tunnels.find((t) => t.id === target.id).locked, true);
  const unlocked = generateNest(DEFAULT_PARAMS, 'UNLK-0001', {});
  assert.equal(JSON.stringify(unlocked), JSON.stringify(base));
});

test('repro code round-trips seed and params', () => {
  const code = encodeReproCode({ seed: 'QK7M-2XPA', params: DEFAULT_PARAMS });
  assert.match(code, /^NEST1\./);
  const out = decodeReproCode(code);
  assert.equal(out.seed, 'QK7M-2XPA');
  assert.deepEqual(normalizeParams(out.params), normalizeParams(DEFAULT_PARAMS));
  const g1 = generateNest(DEFAULT_PARAMS, 'QK7M-2XPA');
  const g2 = generateNest(out.params, out.seed);
  assert.equal(JSON.stringify(g1), JSON.stringify(g2));
});

test('params clamp to their declared ranges', () => {
  const p = normalizeParams({ entrances: 99, depth: -3, branchAngle: 400, levels: 1, tunnelDiameter: 99 });
  assert.equal(p.entrances, 6);
  assert.equal(p.depth, 8);
  assert.equal(p.branchAngle, 75);
  assert.equal(p.levels, 2);
  assert.equal(p.tunnelDiameter, 1.1);
});

test('seed normalization is stable', () => {
  assert.equal(normalizeSeed(' qk7m-2xpa '), 'QK7M-2XPA');
  assert.equal(normalizeSeed('qk7m 2xpa!!'), 'QK7M2XPA');
});

test('rng stream is reproducible and uniform-ish', () => {
  const a = rngFor('SEED', 'salt');
  const b = rngFor('SEED', 'salt');
  let sum = 0;
  for (let i = 0; i < 2000; i++) {
    const v = a();
    assert.equal(v, b());
    sum += v;
  }
  const mean = sum / 2000;
  assert.ok(mean > 0.44 && mean < 0.56, `mean ${mean}`);
});

test('paths produce enough samples and non-zero length', () => {
  const g = generateNest(DEFAULT_PARAMS, 'PATH-0001');
  for (const t of g.tunnels) {
    const s = samplePath(t.points, 8);
    assert.ok(s.length >= t.points.length);
    const d = s.slice(1).reduce((acc, p, i) => acc + Math.hypot(p.x - s[i].x, p.y - s[i].y, p.z - s[i].z), 0);
    assert.ok(d > 0.5, `${t.id} length ${d}`);
  }
});

test('entrances do not overlap', () => {
  for (let n = 2; n <= 6; n++) {
    for (const seed of ['E1-AAAA', 'E2-BBBB', 'E3-CCCC']) {
      const g = generateNest({ ...DEFAULT_PARAMS, entrances: n }, seed);
      const pts = g.entrances;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const d = Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z);
          assert.ok(d > 1.2, `entrances ${i},${j} too close for n=${n} seed=${seed}: ${d}`);
        }
      }
    }
  }
});

test('entrance count matches param', () => {
  for (let n = 1; n <= 6; n++) {
    const g = generateNest({ ...DEFAULT_PARAMS, entrances: n }, 'CNT-1234');
    assert.equal(g.entrances.length, n);
    assert.equal(g.tunnels.filter((t) => t.kind === 'main').length, n);
  }
});
