// 纯逻辑冒烟测试:node test/smoke.mjs
import assert from 'node:assert/strict';
import {
  key, paintVoxel, eraseVoxel, floodFill, connectedComponent,
  translateVoxels, copyVoxels, pasteVoxels, buildCulledMesh,
  diffVoxels, cloneVoxels, GRID_SIZE, inBounds
} from '../src/lib/voxel.js';
import { TEMPLATES } from '../src/lib/templates.js';

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log('  ✓', name); };

// 1. 落笔 + X 镜像
ok('paint with X mirror writes both sides', () => {
  const v = new Map();
  const changed = paintVoxel(v, 3, 1, 2, '#f00', { mirror: true });
  assert.equal(changed.length, 2);
  assert.ok(v.has(key(3, 1, 2)) && v.has(key(-3, 1, 2)));
});

// 2. 镜像面 x=0 去重
ok('mirror on plane x=0 dedupes', () => {
  const v = new Map();
  const changed = paintVoxel(v, 0, 1, 2, '#f00', { mirror: true });
  assert.equal(changed.length, 1);
});

// 3. 层锁定只改目标层
ok('layer lock blocks other layers', () => {
  const v = new Map();
  const changed = paintVoxel(v, 1, 5, 1, '#0f0', { layerLock: { enabled: true, layer: 2 } });
  assert.equal(changed.length, 0);
  const ok2 = paintVoxel(v, 1, 2, 1, '#0f0', { layerLock: { enabled: true, layer: 2 } });
  assert.equal(ok2.length, 1);
});

// 4. 擦除 + 镜像
ok('erase with mirror removes both', () => {
  const v = new Map();
  paintVoxel(v, 4, 0, 0, '#111', { mirror: true });
  const removed = eraseVoxel(v, 4, 0, 0, { mirror: true });
  assert.equal(removed.length, 2);
  assert.equal(v.size, 0);
});

// 5. 油漆桶填充空气腔
ok('flood fill fills enclosed air region', () => {
  const v = new Map();
  // 围一个 3x3 的墙(y=0 层),中心留空
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
    if (Math.abs(x) === 1 || Math.abs(z) === 1) v.set(key(x, 0, z), { x, y: 0, z, c: '#333' });
  }
  const changed = floodFill(v, 0, 0, 0, '#abc');
  assert.ok(changed.includes(key(0, 0, 0)));
  assert.equal(v.get(key(0, 0, 0)).c, '#abc');
});

// 6. 连通团:两个分离的块
ok('connected component selects one blob only', () => {
  const v = new Map();
  paintVoxel(v, 0, 0, 0, '#111');
  paintVoxel(v, 1, 0, 0, '#111');
  paintVoxel(v, 10, 10, 10, '#222');
  const comp = connectedComponent(v, key(0, 0, 0));
  assert.equal(comp.length, 2);
});

// 7. 平移 + 越界回退
ok('translate moves selection and rejects out-of-bounds', () => {
  const v = new Map();
  paintVoxel(v, 0, 0, 0, '#111');
  const r = translateVoxels(v, [key(0, 0, 0)], { x: 2, y: 0, z: 0 });
  assert.ok(r.voxels.has(key(2, 0, 0)));
  assert.equal(translateVoxels(v, [key(2, 0, 0)], { x: 999, y: 0, z: 0 }), null);
});

// 8. 复制粘贴
ok('copy/paste roundtrip', () => {
  const v = new Map();
  paintVoxel(v, 1, 1, 1, '#777');
  paintVoxel(v, 2, 1, 1, '#777');
  const clip = copyVoxels(v, [key(1, 1, 1), key(2, 1, 1)]);
  const placed = pasteVoxels(v, clip, { x: 5, y: 1, z: 1 });
  assert.equal(placed.length, 2);
  assert.ok(v.has(key(5, 1, 1)) && v.has(key(6, 1, 1)));
});

// 9. 面剔除网格:内部面被剔除
ok('culled mesh hides internal faces', () => {
  const v = new Map();
  for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) {
    v.set(key(x, y, z), { x, y, z, c: '#fff' });
  }
  const full = buildCulledMesh(v, null, 1);
  // 2x2x2 立方体只有 24 个外露四边形 => 48 三角面
  assert.equal(full.faceCount, 48);
});

// 10. 减面:共面合并后面数更少(用实心大块,顶面足以合并成大矩形)
ok('quality reduction merges coplanar faces', () => {
  const v = new Map();
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) for (let z = 0; z < 4; z++) {
    v.set(key(x, y, z), { x, y, z, c: '#ffffff' });
  }
  const full = buildCulledMesh(v, null, 1);
  const reduced = buildCulledMesh(v, null, 0.5);
  // 4x4x4:不减面 6*16*2=192 三角;合并后每个外侧面只剩 1 个四边形 => 12 三角
  assert.equal(full.faceCount, 192);
  assert.equal(reduced.faceCount, 12);
});

// 11. 只合并连通团
ok('build mesh scoped to selection', () => {
  const v = new Map();
  paintVoxel(v, 0, 0, 0, '#111');
  paintVoxel(v, 8, 8, 8, '#222');
  const scoped = buildCulledMesh(v, new Set([key(0, 0, 0)]), 1);
  // 单格立方体 6 面 12 三角
  assert.equal(scoped.faceCount, 12);
});

// 12. 版本差异
ok('diff detects added/removed/recolored', () => {
  const a = new Map();
  paintVoxel(a, 0, 0, 0, '#111');
  const b = cloneVoxels(a);
  b.delete(key(0, 0, 0));
  paintVoxel(b, 1, 0, 0, '#222');
  const d = diffVoxels(a, b);
  assert.deepEqual(d.removed, [key(0, 0, 0)]);
  assert.deepEqual(d.added, [key(1, 0, 0)]);
});

// 13. 模板生成 + 边界 + 基本体量
ok('all three templates build within grid bounds', () => {
  for (const tpl of TEMPLATES) {
    const v = tpl.build();
    assert.ok(v.size > 20, `${tpl.name} should have plenty of voxels, got ${v.size}`);
    for (const [, cell] of v) {
      assert.ok(inBounds(cell.x, cell.y, cell.z), `${tpl.name} out of bounds at ${cell.x},${cell.y},${cell.z}`);
    }
  }
});

// 14. 网格尺寸常量
ok('grid is 24 cubed', () => assert.equal(GRID_SIZE, 24));

console.log(`\n${passed} tests passed`);
