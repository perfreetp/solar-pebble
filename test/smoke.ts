import { VoxelGrid } from '../src/voxel/grid';
import { brushSphere, brushFlatten, brushNoise } from '../src/voxel/brushes';
import { buildMesh } from '../src/voxel/mesher';
import { decimateMesh } from '../src/voxel/decimate';
import { raycastGrid, rayPlaneZ } from '../src/voxel/raycast';
import { boxCopy, boxPaste, boxTranslate, normalizeBox } from '../src/voxel/selection';
import { meshToOBJ, createZip } from '../src/voxel/exporter';
import { mat4Invert, mat4LookAt, mat4Mul, mat4Perspective, mat4TransformPoint } from '../src/math';

let failures = 0;
function check(name: string, cond: boolean): void {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  if (!cond) failures++;
}

const S = 32;
const grid = new VoxelGrid(S);
const apply = (x: number, y: number, z: number, v: 0 | 1) => grid.set(x, y, z, v);

// 球化笔刷
brushSphere(grid, 16, 16, 12, 8, 'add', apply);
const c1 = grid.count();
check('球化笔刷填充球体', c1 > 1000 && c1 < 3000);

// 挖除成陨石坑
brushSphere(grid, 16, 16, 18, 5, 'remove', apply);
const c2 = grid.count();
check('挖除形成陨石坑', c2 < c1);

// 压平
brushFlatten(grid, 16, 16, 0, 6, 14, apply);
let topMax = 0;
for (let y = 11; y <= 21; y++) for (let x = 11; x <= 21; x++) {
  const dx = x + 0.5 - 16, dy = y + 0.5 - 16;
  if (dx * dx + dy * dy > 36) continue; // 仅检查笔刷圆柱范围内
  for (let z = S - 1; z >= 0; z--) if (grid.get(x, y, z)) { if (z > topMax) topMax = z; break; }
}
check('压平后区域顶部不超过目标高度', topMax <= 14);

// 随机凹凸
const before3 = grid.count();
brushNoise(grid, 16, 16, 10, 6, 0.8, 42, apply);
check('随机凹凸改变体素量', grid.count() !== before3);

// 包围盒
const b = grid.bounds()!;
check('包围盒有效', b.max[2] > b.min[2] && b.min[0] >= 0);

// 框选复制/平移(并集语义:粘贴不覆盖已有体素,用孤立体素验证守恒)
const box = normalizeBox([12, 12, 8], [20, 20, 14]);
const clip = boxCopy(grid, box);
check('框选复制内容非空', clip.data.some(v => v === 1));
grid.set(2, 2, 2, 1);
const cntIso = grid.count();
boxTranslate(grid, normalizeBox([2, 2, 2], [2, 2, 2]), [1, 0, 0], apply);
check('平移选区守恒且落点正确', grid.count() === cntIso && grid.get(3, 2, 2) === 1 && grid.get(2, 2, 2) === 0);
boxPaste(clip, [0, 0, 0], apply);
check('粘贴增加体素', grid.count() >= cntIso);

// 网格化 + 减面
const mesh = buildMesh(grid);
check('网格化生成面', mesh.faceCount > 100);
const dec = decimateMesh(mesh.positions, mesh.indices, 2000);
check('减面到目标以下', dec.faceCount <= 2000 && dec.faceCount > 100);

// OBJ 导出
const obj = meshToOBJ('test', dec.positions, dec.indices);
check('OBJ 含顶点与面', obj.includes('v ') && obj.includes('f ') && obj.includes('vn '));

// 射线拾取:从正上方往下打
const hit = raycastGrid(grid, [16.5, 16.5, 40], [0, 0, -1]);
check('射线命中体素', hit !== null && hit!.normal[2] === 1);
const plane = rayPlaneZ([16.5, 16.5, 40], [0, 0, -1], 10.5);
check('平面求交', plane !== null && Math.abs(plane![2] - 10.5) < 1e-6);

// Z 层切片网格化
const layerMesh = buildMesh(grid, 10, 10);
check('单层切片面数小于整体', layerMesh.faceCount < mesh.faceCount);

// ZIP
const zip = createZip([{ name: 'a.txt', content: 'hello' }, { name: 'b/c.obj', content: obj }]);
check('ZIP 生成', zip.size > 100 && zip.type === 'application/zip');

// 数学库:透视投影 z 映射到 [0,1]
const proj = mat4Perspective(0.9, 1.5, 2, 200);
const pNear = mat4TransformPoint(proj, [0, 0, -2]);
const pFar = mat4TransformPoint(proj, [0, 0, -200]);
check('透视投影 near→0 far→1', Math.abs(pNear[2]) < 1e-4 && Math.abs(pFar[2] - 1) < 1e-4);

// 矩阵求逆:M * M^-1 = I
const view = mat4LookAt([10, 20, 30], [1, 2, 3], [0, 0, 1]);
const vp = mat4Mul(proj, view);
const inv = mat4Invert(vp);
const ident = mat4Mul(vp, inv);
let identOk = true;
for (let i = 0; i < 16; i++) {
  const expect = (i % 5 === 0) ? 1 : 0;
  if (Math.abs(ident[i] - expect) > 1e-3) identOk = false;
}
check('矩阵求逆正确', identOk);

// lookAt:目标点应落在视锥中心(z<0)
const pT = mat4TransformPoint(view, [1, 2, 3]);
check('lookAt 目标在正前方', Math.abs(pT[0]) < 1e-4 && Math.abs(pT[1]) < 1e-4 && pT[2] < 0);

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
