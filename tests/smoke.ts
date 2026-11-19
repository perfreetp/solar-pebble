// 核心算法冒烟测试：DDA 拾取、贪心减面、镜像、径向阵列、glTF 封包、撤销
import { VoxelModel } from '../src/core/voxel-model';
import { buildMesh, meshStats } from '../src/core/mesh';
import { buildGlb } from '../src/core/gltf';
import { dda, pickEmptyCell } from '../src/render/picking';
import { radialArrayY, normalizeBounds, copyToClipboard, pasteClipboard } from '../src/core/ops';
import { GRID, MIRROR_PLANE, keyOf, mirrorX, packColor, parseKey, type Vec3 } from '../src/core/types';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error('断言失败: ' + msg);
  passed++;
  console.log('  ✓ ' + msg);
}

// 1. 镜像语义
console.log('[1] 镜像放置');
{
  const model = new VoxelModel();
  const layer = VoxelModel.createLayer('t', 'core');
  model.layers.push(layer);
  const placed = model.place(layer, 10, 5, 5, 0xff0000, true);
  assert(placed.length === 2, '普通格镜像后落 2 子');
  assert(layer.voxels.has(keyOf(mirrorX(10), 5, 5)), '对侧格存在');
  const onPlane = model.place(layer, MIRROR_PLANE, 8, 8, 0x00ff00, true);
  assert(onPlane.length === 1, '对称面上的体素只落一次');
  assert(layer.voxels.size === 3, '总计 3 个体素');
  const blocked = model.place(layer, 10, 5, 5, 0x0000ff, true);
  assert(blocked.length === 0, '与已有体素重叠时不落子');
}

// 2. 擦除镜像同步
console.log('[2] 镜像擦除');
{
  const model = new VoxelModel();
  const layer = VoxelModel.createLayer('t', 'core');
  model.layers.push(layer);
  model.place(layer, 20, 0, 0, 0xffffff, true);
  const removed = model.erase(20, 0, 0, true);
  assert(removed.length === 2, '擦除同步删除两侧');
  assert(layer.voxels.size === 0, '层已清空');
}

// 3. DDA 拾取
console.log('[3] DDA 射线拾取');
{
  const model = new VoxelModel();
  const layer = VoxelModel.createLayer('t', 'core');
  model.layers.push(layer);
  // 在 (70,64,64) 放一个体素，从 +X 方向沿 -X 射线打过去
  layer.voxels.set(keyOf(70, 64, 64), 0xffffff);
  const half = GRID / 2;
  const origin: Vec3 = [half - 1, 0.5, 0.5]; // 体素 70 的世界中心 x = 70-64+0.5 = 6.5
  const dir: Vec3 = [-1, 0, 0];
  const hit = dda(origin, dir, (x, y, z) => layer.voxels.has(keyOf(x, y, z)));
  assert(hit !== null, '射线命中体素');
  assert(hit!.voxel[0] === 70 && hit!.voxel[1] === 64 && hit!.voxel[2] === 64, '命中格坐标正确');
  assert(hit!.normal[0] === 1, '入射面法线为 +X（从 +X 来）');
  const miss = dda([half - 1, 10, 10], dir, () => false);
  assert(miss === null, '空格场景返回 null');
  const empty = pickEmptyCell(origin, dir, () => false);
  assert(empty !== null && empty.voxel[0] === 0, '空白场景落在网格入射面格 (x=0)');
  assert(empty!.normal[0] === -1, '空白落点法线指向入射方向 -X');

  // 盒外斜射线（多轴负方向，回归 slab 排序问题）
  {
    // 原点在盒外，方向指向盒内并贯穿
    const o: Vec3 = [100, 80, 100];
    const d: Vec3 = normalize3([-1, -0.6, -1]);
    const probe = dda(o, d, () => false);
    assert(probe === null, '空格斜射线仍返回 null');
    // 求穿盒区间，在内部取两格占用
    let t0 = -Infinity, t1 = Infinity;
    for (let a = 0; a < 3; a++) {
      const tn = (-half - o[a]) / d[a];
      const tf = (half - o[a]) / d[a];
      t0 = Math.max(t0, Math.min(tn, tf));
      t1 = Math.min(t1, Math.max(tn, tf));
    }
    const cells: Vec3[] = [];
    for (const tt of [t0 + 4, (t0 + t1) / 2]) {
      const p: Vec3 = [o[0] + d[0] * tt, o[1] + d[1] * tt, o[2] + d[2] * tt];
      cells.push([Math.floor(p[0] + half), Math.floor(p[1] + half), Math.floor(p[2] + half)]);
    }
    const set = new Set(cells.map((c) => keyOf(c[0], c[1], c[2])));
    const hit2 = dda(o, d, (x, y, z) => set.has(keyOf(x, y, z)));
    assert(hit2 !== null, '盒外斜射线命中路径上的体素（slab 回归）');
    assert(cells.some((c) => c[0] === hit2!.voxel[0] && c[1] === hit2!.voxel[1] && c[2] === hit2!.voxel[2]),
      '命中格属于路径占用集合');
    assert(hit2!.normal.some((n) => n !== 0), '命中带入射面法线');
  }

  // 盒内原点射线（相机进入网格盒时的拾取路径）
  {
    const o: Vec3 = [40, 40, 40]; // 对应格 (104,104,104)
    const d: Vec3 = normalize3([1, 1, 1]);
    const target: Vec3 = [110, 110, 110]; // 射线前方的格
    const hit = dda(o, d, (x, y, z) => x === target[0] && y === target[1] && z === target[2]);
    assert(hit !== null && hit!.voxel[0] === 110, '盒内射线 DDA 正常命中');
  }
}

function normalize3(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

// 4. 贪心减面：实心 2x2x2 立方体应只剩 6 个矩形面、12 个三角形
console.log('[4] 相邻面剔除 + 贪心减面');
{
  const layer = VoxelModel.createLayer('t', 'core');
  for (let x = 0; x < 2; x++)
    for (let y = 0; y < 2; y++)
      for (let z = 0; z < 2; z++) layer.voxels.set(keyOf(x, y, z), 0xffffff);
  const stats = meshStats([layer]);
  assert(stats.voxelCount === 8, '8 个体素');
  assert(stats.culledFaceCount === 24, '剔除相邻面后 24 个四边面（6 面 × 4）');
  assert(stats.mergedFaceCount === 6, '贪心合并为 6 个大矩形');
  assert(stats.triangleCount === 12, '三角面数 12');
  assert(stats.vertexCount === 24, '顶点数 24');
}

// 5. 不同色不合并
console.log('[5] 颜色边界不合并');
{
  const layer = VoxelModel.createLayer('t', 'core');
  layer.voxels.set(keyOf(0, 0, 0), 0xff0000);
  layer.voxels.set(keyOf(1, 0, 0), 0x00ff00);
  const geo = buildMesh([layer]);
  assert(geo.mergedFaceCount > 6, '异色相邻体面数多于单色（未跨色合并）');
}

// 6. 径向阵列：1 枚 → 4 枚
console.log('[6] 助推器绕 Y 轴四阵列');
{
  const layer = VoxelModel.createLayer('booster', 'booster');
  layer.voxels.set(keyOf(77, 10, 63), 0xffffff); // 中心 (63,*,63)，dx=14
  const { added, blocked } = radialArrayY(layer, 4);
  assert(added === 3, '新增 3 枚（共 4 枚）');
  assert(blocked === 0, '无重叠');
  const expected = [
    [77, 63], [63, 77], [49, 63], [63, 49],
  ];
  for (const [x, z] of expected) assert(layer.voxels.has(keyOf(x, 10, z)), `阵列位 (${x},${z}) 存在`);
}

// 7. 框选 + 复制粘贴 + 防重叠
console.log('[7] 框选/剪贴板');
{
  const layer = VoxelModel.createLayer('t', 'core');
  layer.voxels.set(keyOf(0, 0, 0), 0x112233);
  layer.voxels.set(keyOf(1, 0, 0), 0x445566);
  const bounds = normalizeBounds([0, 0, 0], [1, 0, 0]);
  const clip = copyToClipboard([layer], bounds);
  assert(clip.layers.get(layer.id)!.size === 2, '复制 2 个体素');
  const occupied = new Set(layer.voxels.keys());
  const r1 = pasteClipboard([layer], clip, [5, 5, 5], occupied);
  assert(r1.result.placed === 2 && r1.result.blocked === 0, '粘贴到空位全部落位');
  const r2 = pasteClipboard([layer], clip, [5, 5, 5], new Set(layer.voxels.keys()));
  assert(r2.result.placed === 0 && r2.result.blocked === 2, '原位再贴全部被遮挡');
}

// 8. glTF/GLB 封包合法性
console.log('[8] GLB 导出');
{
  const layer = VoxelModel.createLayer('t', 'core');
  layer.voxels.set(keyOf(0, 0, 0), packColor(10, 20, 30));
  const geo = buildMesh([layer]);
  const glb = buildGlb(geo, 'TEST');
  const dv = new DataView(glb);
  assert(dv.getUint32(0, true) === 0x46546c67, 'GLB 魔数 glTF 正确');
  assert(dv.getUint32(4, true) === 2, '版本号 2');
  assert(dv.getUint32(8, true) === glb.byteLength, '总长度字段自洽');
  assert(dv.getUint32(16, true) === 0x4e4f534a, '首 chunk 类型 JSON');
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLen)));
  assert(json.asset.version === '2.0', 'glTF 2.0');
  assert(json.meshes[0].primitives[0].attributes.COLOR_0 === 2, '顶点色属性存在');
  assert(json.accessors[3].componentType === 5125, '索引为 UNSIGNED_INT');
}

console.log(`\n全部通过：${passed} 项断言`);
void parseKey;
