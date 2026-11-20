import { test } from 'node:test';
import assert from 'node:assert/strict';

import { VoxelModel, AIR, mirrorIndexX } from '../shared/voxel.js';
import { greedyQuads, quadsToBuffers, buildObj, coarsenModel, estimateFaceCounts } from '../shared/mesh.js';
import { analyzeModel, labelComponents, thicknessMaps } from '../shared/validate.js';
import { MATERIALS, MAT, MATERIAL_BY_ID } from '../shared/materials.js';

function boxModel() {
  const m = new VoxelModel({ sizeX: 16, sizeY: 16, sizeZ: 16, voxelSize: 0.5 });
  m.fillBox({ x0: 4, y0: 4, z0: 0, x1: 11, y1: 11, z1: 7 }, MAT.basalt.id);
  return m;
}

test('填充与占用计数', () => {
  const m = boxModel();
  assert.equal(m.occupied, 8 * 8 * 8);
  assert.equal(m.get(4, 4, 0), MAT.basalt.id);
  assert.equal(m.get(3, 4, 0), AIR);
  m.set(3, 4, 0, MAT.hull.id);
  assert.equal(m.occupied, 8 * 8 * 8 + 1);
  m.set(3, 4, 0, AIR);
  assert.equal(m.occupied, 8 * 8 * 8);
});

test('单个体素生成六个面（无内部面残留）', () => {
  const m = new VoxelModel({ sizeX: 8, sizeY: 8, sizeZ: 8 });
  m.set(3, 3, 3, MAT.basalt.id);
  const quads = greedyQuads(m);
  assert.equal(quads.length, 6);
  const buf = quadsToBuffers(m, quads);
  assert.equal(buf.vertexCount, 24);
  assert.equal(buf.indices.length, 36);
});

test('相邻同类体素合并成一个面', () => {
  const m = new VoxelModel({ sizeX: 8, sizeY: 8, sizeZ: 8 });
  m.fillBox({ x0: 1, y0: 1, z0: 1, x1: 6, y1: 6, z1: 1 }, MAT.basalt.id);
  // 一层平板：上下两个大面 + 四周各一个面
  assert.equal(greedyQuads(m).length, 6);
});

test('不同材质不合并', () => {
  const m = new VoxelModel({ sizeX: 8, sizeY: 8, sizeZ: 8 });
  m.fillBox({ x0: 1, y0: 1, z0: 1, x1: 2, y1: 2, z1: 1 }, MAT.basalt.id);
  m.fillBox({ x0: 3, y0: 1, z0: 1, x1: 4, y1: 2, z1: 1 }, MAT.hull.id);
  const quads = greedyQuads(m);
  // 每个 2×2 平板各 6 个面（接缝处各自出面）
  assert.ok(quads.length >= 10, `面数应 >= 10，实际 ${quads.length}`);
  const mats = new Set(quads.map((q) => q.mat));
  assert.equal(mats.size, 2);
});

test('单格薄壁两侧都出面', () => {
  const m = new VoxelModel({ sizeX: 8, sizeY: 8, sizeZ: 8 });
  m.fillBox({ x0: 1, y0: 1, z0: 4, x1: 6, y1: 6, z1: 4 }, MAT.seal.id);
  // 平板：上面 + 下面 + 四侧 = 6
  assert.equal(greedyQuads(m).length, 6);
});

test('连通分量：主体 + 悬空簇', () => {
  const m = boxModel();
  m.fillBox({ x0: 2, y0: 2, z0: 12, x1: 3, y1: 3, z1: 12 }, MAT.hull.id); // 4 格
  m.fillBox({ x0: 8, y0: 2, z0: 12, x1: 9, y1: 3, z1: 13 }, MAT.hull.id); // 8 格
  const { components } = labelComponents(m);
  assert.equal(components.length, 3);
  assert.equal(components[0].count, 512);
  assert.deepEqual(components.slice(1).map((c) => c.count).sort((a, b) => a - b), [4, 8]);
});

test('悬空阈值：>5 格才报，零碎体只做提示', () => {
  const m = boxModel();
  m.fillBox({ x0: 2, y0: 2, z0: 12, x1: 3, y1: 3, z1: 12 }, MAT.hull.id); // 4 格 → 零碎
  m.fillBox({ x0: 8, y0: 2, z0: 12, x1: 9, y1: 3, z1: 13 }, MAT.hull.id); // 8 格 → 悬空
  const a = analyzeModel(m, { floatingMin: 5, minWall: 2 });
  assert.equal(a.ok, false);
  const floating = a.issues.find((i) => i.code === 'floating');
  assert.ok(floating, '应报告悬空');
  assert.equal(floating.count, 1, '4 格簇不应计入悬空');
  assert.equal(a.smallDebris, 1);
  assert.equal(a.floating[0].count, 8);
});

test('恰好 5 格的簇不报悬空（阈值是“超过 5”）', () => {
  const m = new VoxelModel({ sizeX: 12, sizeY: 12, sizeZ: 12 });
  m.fillBox({ x0: 1, y0: 1, z0: 0, x1: 4, y1: 4, z1: 3 }, MAT.basalt.id);
  m.fillBox({ x0: 8, y0: 8, z0: 8, x1: 8, y1: 8, z1: 12 }, MAT.hull.id); // 5 格
  const a = analyzeModel(m, { floatingMin: 5 });
  assert.equal(a.floatingTotal, 0);
  assert.equal(a.smallDebris, 1);
  assert.equal(a.ok, true);
});

test('薄壁：1 格厚板被检出，4 格厚体块不被检出', () => {
  const m = new VoxelModel({ sizeX: 20, sizeY: 20, sizeZ: 20 });
  m.fillBox({ x0: 2, y0: 2, z0: 2, x1: 12, y1: 12, z1: 5 }, MAT.basalt.id); // 4 格厚块
  m.fillBox({ x0: 15, y0: 2, z0: 2, x1: 15, y1: 12, z1: 8 }, MAT.seal.id); // 1 格薄板
  const a = analyzeModel(m, { minWall: 2 });
  assert.ok(a.thinAreas.length >= 1);
  const minT = Math.min(...a.thinAreas.map((t) => t.minThickness));
  assert.equal(minT, 1);
  assert.ok(a.thinAreas.every((t) => t.minThickness < 2));
  // 4 格厚块不应被标记
  const thick = m.get(6, 6, 3);
  const { rx, ry, rz, nx, ny, nz } = thicknessMaps(m);
  const i = m.idx(6, 6, 3);
  const exposed = [];
  if (nx[i]) exposed.push(rx[i]);
  if (ny[i]) exposed.push(ry[i]);
  if (nz[i]) exposed.push(rz[i]);
  assert.ok(Math.min(...exposed) >= 4, '4 格厚体块的壁厚应 >= 4');
  assert.equal(thick, MAT.basalt.id);
});

test('圆柱壳切线方向不误判为薄壁', () => {
  const m = new VoxelModel({ sizeX: 40, sizeY: 40, sizeZ: 40 });
  // 画一个 3 格厚的圆筒
  const cx = 20, cy = 20, R = 12;
  for (let y = 0; y < 40; y++) {
    for (let z = 0; z < 40; z++) {
      const d = Math.hypot(y - cy, z - cy);
      if (d <= R && d >= R - 3) m.set(20, y, z, MAT.hull.id);
      if (d <= R && d >= R - 3) m.set(19, y, z, MAT.hull.id);
      if (d <= R && d >= R - 3) m.set(21, y, z, MAT.hull.id);
    }
  }
  const a = analyzeModel(m, { minWall: 2 });
  // 体素化圆筒的台阶面会天然产生少量 1 格台阶，但不能整圈都报
  assert.ok(a.thinCells < m.occupied * 0.12, `薄壁格数 ${a.thinCells} 不应超过 12%`);
});

test('镜像索引：轴线两侧正确互补', () => {
  assert.equal(mirrorIndexX(71, 72), 72);
  assert.equal(mirrorIndexX(72, 72), 71);
  assert.equal(mirrorIndexX(70, 72), 73);
  assert.equal(mirrorIndexX(0, 72), 143);
  assert.equal(mirrorIndexX(mirrorIndexX(5, 72), 72), 5);
});

test('复制 / 粘贴偏移正确', () => {
  const m = new VoxelModel({ sizeX: 24, sizeY: 24, sizeZ: 24 });
  m.fillBox({ x0: 2, y0: 2, z0: 2, x1: 4, y1: 4, z1: 4 }, MAT.panel.id);
  const clip = m.copyBoxes([{ x0: 2, y0: 2, z0: 2, x1: 4, y1: 4, z1: 4 }]);
  assert.ok(clip);
  assert.equal(clip.count, 27);
  assert.deepEqual(clip.size, [3, 3, 3]);
  const before = m.occupied;
  m.paste(clip, [10, 10, 10]);
  assert.equal(m.occupied, before + 27);
  assert.equal(m.get(10, 10, 10), MAT.panel.id);
  assert.equal(m.get(12, 12, 12), MAT.panel.id);
  assert.equal(m.get(13, 13, 13), AIR);
});

test('复制时空体素不进入剪贴板', () => {
  const m = new VoxelModel({ sizeX: 12, sizeY: 12, sizeZ: 12 });
  m.set(1, 1, 1, MAT.hull.id);
  m.set(3, 3, 3, MAT.hull.id);
  const clip = m.copyBoxes([{ x0: 0, y0: 0, z0: 0, x1: 5, y1: 5, z1: 5 }]);
  assert.equal(clip.count, 2);
  assert.deepEqual(clip.size, [3, 3, 3]);
});

test('撤销记录可精确回滚', () => {
  const m = boxModel();
  const before = m.occupied;
  const changes = m.fillBox({ x0: 0, y0: 0, z0: 10, x1: 3, y1: 3, z1: 10 }, MAT.light.id);
  assert.equal(changes.length, 16);
  assert.equal(m.occupied, before + 16);
  m.applyChanges(changes, -1);
  assert.equal(m.occupied, before);
  m.applyChanges(changes, 1);
  assert.equal(m.occupied, before + 16);
});

test('降采样减面：复杂曲面面数明显下降', () => {
  // 起伏的“岩壳”面：贪心合并后仍然有大量四边形，降采样应该明显减面
  const m = new VoxelModel({ sizeX: 48, sizeY: 48, sizeZ: 48 });
  for (let x = 2; x < 46; x++) {
    for (let y = 2; y < 46; y++) {
      const top = 24 + Math.round(6 * Math.sin(x * 0.42) * Math.cos(y * 0.37));
      for (let z = 0; z <= top; z++) {
        m.set(x, y, z, MAT.basalt.id);
      }
    }
  }
  const q1 = greedyQuads(m).length;
  const coarse = coarsenModel(m, 2);
  const q2 = greedyQuads(coarse).length;
  assert.ok(q2 < q1 * 0.8, `降采样后面数应明显下降：${q1} → ${q2}`);
  assert.equal(coarse.voxelSize, m.voxelSize * 2);
});

test('降采样保持凸体形态：立方体仍是 6 个面', () => {
  const m = boxModel();
  const coarse = coarsenModel(m, 2);
  assert.equal(greedyQuads(coarse).length, 6);
  assert.equal(coarse.occupied, m.occupied / 8);
});

test('降采样保留多数材质', () => {
  const m = new VoxelModel({ sizeX: 8, sizeY: 8, sizeZ: 8 });
  m.fillBox({ x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 }, MAT.basalt.id); // 8 格基体
  m.set(0, 0, 0, MAT.hull.id); // 1 格覆盖
  const coarse = coarsenModel(m, 2);
  assert.equal(coarse.get(0, 0, 0), MAT.basalt.id);
});

test('OBJ 导出含尺寸注释、mtl 引用与材质分组', () => {
  const m = boxModel();
  const quads = greedyQuads(m);
  const out = buildObj(quads, m, { name: 'test-model' });
  assert.match(out.obj, /# 外形尺寸: 宽 8\.000 m × 深 8\.000 m × 高 8\.000 m/);
  assert.match(out.obj, /mtllib test-model\.mtl/);
  assert.match(out.obj, /usemtl basalt/);
  // x0=4 → 世界坐标 -4 + 4*0.5 = -2
  assert.match(out.obj, /^v -2 -2 0$/m);
  assert.equal(out.metadata.faces, quads.length);
  assert.equal(out.metadata.triangles, quads.length * 2);
  assert.equal(out.metadata.unit, 'meter');
  assert.equal(out.metadata.dimensions.width, 8);
  // 所有 v 行必须在 f 行之前
  const lines = out.obj.split('\n');
  const firstFace = lines.findIndex((l) => l.startsWith('f '));
  const lastVert = lines.map((l, i) => (l.startsWith('v ') ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  assert.ok(firstFace > lastVert, 'v 行必须全部出现在 f 行之前');
  // mtl 中每种材质都有 newmtl
  for (const mat of out.metadata.materials) {
    assert.match(out.mtl, new RegExp(`newmtl ${mat.key}`));
  }
});

test('模型序列化往返一致', () => {
  const m = boxModel();
  m.set(0, 0, 0, MAT.light.id);
  const json = m.toJSON();
  const back = VoxelModel.fromJSON(JSON.parse(JSON.stringify(json)));
  assert.equal(back.occupied, m.occupied);
  assert.equal(back.sizeX, m.sizeX);
  assert.equal(back.voxelSize, m.voxelSize);
  let same = true;
  m.forEach((x, y, z, mat) => {
    if (back.get(x, y, z) !== mat) same = false;
  });
  assert.ok(same);
});

test('越界写入被忽略而不是抛错', () => {
  const m = boxModel();
  assert.equal(m.set(-1, 0, 0, MAT.hull.id), false);
  assert.equal(m.set(999, 0, 0, MAT.hull.id), false);
  assert.equal(m.get(-5, -5, -5), AIR);
  assert.equal(m.set(0, 0, 0, MAT.hull.id), true);
});

test('空模型体检是安全的', () => {
  const m = new VoxelModel({ sizeX: 8, sizeY: 8, sizeZ: 8 });
  const a = analyzeModel(m);
  assert.equal(a.ok, true);
  assert.equal(a.mainComponent, null);
  assert.equal(a.issues.length, 0);
  assert.equal(greedyQuads(m).length, 0);
});

test('材质字典 id 唯一且分组合法', () => {
  const ids = MATERIALS.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length);
  const groups = new Set(['cave', 'lining', 'habitat', 'utility']);
  for (const mat of MATERIALS) {
    assert.ok(groups.has(mat.group), `${mat.key} 的分组 ${mat.group} 非法`);
    assert.match(mat.color, /^#[0-9a-f]{6}$/i);
    assert.ok(MATERIAL_BY_ID[mat.id] === mat);
  }
});

test('面数估算给出四档且逐档递减', () => {
  const m = boxModel();
  const est = estimateFaceCounts(m);
  assert.equal(est.length, 4);
  for (let i = 1; i < est.length; i++) {
    assert.ok(est[i].quads <= est[i - 1].quads, '面数应逐档递减');
    assert.ok(est[i].voxelSize >= est[i - 1].voxelSize);
  }
});
