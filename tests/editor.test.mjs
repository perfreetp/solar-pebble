/**
 * 编辑器交互端到端测试：直接用 EditorSession + 真实模型跑核心编辑行为。
 * （浏览器里的鼠标拖拽由 smoke.mjs 覆盖；这里验证行为正确性。）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// EditorSession 用 requestAnimationFrame 做渲染节流；Node 里给个同步替身。
if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = (cb) => {
    cb(0);
    return 0;
  };
  globalThis.cancelAnimationFrame = () => {};
}
import { EditorSession } from '../src/editor/EditorSession.js';
import { VoxelModel, AIR } from '../shared/voxel.js';
import { MAT } from '../shared/materials.js';

/**
 * 构造一个不依赖 WebGL 的 session：替换掉 renderer。
 * EditorSession 只在极少数地方调用 renderer（touchVoxel / requestRender / 统计），
 * 用一个空实现即可。
 */
function makeSession(opts = {}) {
  const model = new VoxelModel({
    sizeX: opts.sizeX || 32,
    sizeY: opts.sizeY || 32,
    sizeZ: opts.sizeZ || 16,
    voxelSize: 0.5,
  });
  const touches = [];
  const fakeRenderer = {
    model: null,
    opts: {},
    markers: [],
    selection: null,
    touchVoxel(x, y, z) {
      touches.push([x, y, z]);
    },
    requestRender() {},
    rebuildAll() {},
    frameAll() {},
    render() {},
    setModel(m) {
      this.model = m;
    },
  };
  const s = Object.create(EditorSession.prototype);
  // 手动执行构造里与渲染无关的部分
  s.renderer = fakeRenderer;
  s.model = { value: model };
  s.order = { value: null };
  s.tool = { value: 'build' };
  s.brushMat = { value: MAT.hull.id };
  s.secondaryMat = { value: MAT.regolith.id };
  s.mode = { value: 'place' };
  s.brushSize = { value: 1 };
  s.layerCount = { value: 16 };
  s.layerMin = { value: 1 };
  s.layerMax = { value: 16 };
  s.lockedLayers = { value: new Set() };
  s.soloLayers = { value: new Set() };
  s.activeLayer = { value: 1 };
  s.focusLayers = { value: false };
  s.mirror = { enabled: false, plane: 16, axis: 'x' };
  s.selection = { active: false, box: null, count: 0, mode: 'box' };
  s.clipboard = { value: null };
  s.clipboardInfo = { value: null };
  s.undoStack = [];
  s.redoStack = [];
  s.undoDepth = { value: 0 };
  s.redoDepth = { value: 0 };
  s.stats = { total: 0, byGroup: {}, byMaterial: {}, dirty: false };
  s.params = { floatingMin: 5, minWall: 2 };
  s.analysis = { value: null };
  s.markers = { value: [] };
  s.checking = { value: false };
  s.lastSavedAt = { value: null };
  s.dirty = { value: false };
  s.rafPending = false;
  s.hoverInfo = { value: null };
  s.cursor = { x: 0, y: 0, z: 1, valid: false };
  s.statusText = { value: '' };
  s._model = model;
  s._touches = touches;
  return s;
}

test('镜像开启：一次落子同时写入对称位置', () => {
  const s = makeSession();
  const m = s._model;
  s.mirror.enabled = true;
  s.mirror.plane = 16;
  const n = s.writeCells([{ x: 5, y: 5, z: 0, mat: MAT.hull.id }]);
  assert.equal(n, 2, '应同时写入原位置与镜像位置');
  assert.equal(m.get(5, 5, 0), MAT.hull.id);
  assert.equal(m.get(26, 5, 0), MAT.hull.id, 'x=5 的镜像应为 2*16-1-5=26');
});

test('镜像关闭：只写原位置', () => {
  const s = makeSession();
  s.mirror.enabled = false;
  s.writeCells([{ x: 5, y: 5, z: 0, mat: MAT.hull.id }]);
  assert.equal(s._model.get(5, 5, 0), MAT.hull.id);
  assert.equal(s._model.get(26, 5, 0), AIR);
});

test('镜像轴上落子不重复写同一个格子', () => {
  const s = makeSession();
  s.mirror.enabled = true;
  s.mirror.plane = 16;
  // x=15 镜像为 16，是两个不同格子
  assert.equal(s.writeCells([{ x: 15, y: 3, z: 0, mat: MAT.hull.id }]), 2);
  assert.equal(s._model.get(15, 3, 0), MAT.hull.id);
  assert.equal(s._model.get(16, 3, 0), MAT.hull.id);
});

test('镜像写入在撤销时一起回退', () => {
  const s = makeSession();
  s.mirror.enabled = true;
  s.mirror.plane = 16;
  s.writeCells([{ x: 5, y: 5, z: 0, mat: MAT.hull.id }]);
  assert.equal(s._model.occupied, 2);
  s.undo();
  assert.equal(s._model.occupied, 0, '撤销应同时清除镜像体素');
});

test('锁定图层挡住写入', () => {
  const s = makeSession();
  s.lockedLayers = { value: new Set([3]) };
  const n = s.writeCells([{ x: 5, y: 5, z: 2, mat: MAT.hull.id }]); // z=2 → 第 3 层
  assert.equal(n, 0);
  assert.equal(s._model.get(5, 5, 2), AIR);
  const ok = s.writeCells([{ x: 5, y: 5, z: 1, mat: MAT.hull.id }]);
  assert.equal(ok, 1);
});

test('层范围之外被挡住（可编辑层 3–6）', () => {
  const s = makeSession();
  s.layerMin = { value: 3 };
  s.layerMax = { value: 6 };
  assert.equal(s.writeCells([{ x: 2, y: 2, z: 0, mat: MAT.hull.id }]), 0, 'z=0（第 1 层）不可编辑');
  assert.equal(s.writeCells([{ x: 2, y: 2, z: 3, mat: MAT.hull.id }]), 1, 'z=3（第 4 层）可编辑');
});

test('一次拖拽合并成单个撤销步', () => {
  const s = makeSession();
  s.beginStroke();
  s.writeCells([{ x: 1, y: 1, z: 0, mat: MAT.hull.id }]);
  s.writeCells([{ x: 2, y: 1, z: 0, mat: MAT.hull.id }]);
  s.writeCells([{ x: 3, y: 1, z: 0, mat: MAT.hull.id }]);
  s.endStroke();
  assert.equal(s.undoDepth.value, 1, '整笔应只有一步撤销');
  assert.equal(s._model.occupied, 3);
  s.undo();
  assert.equal(s._model.occupied, 0, '一次撤销应删除整笔');
});

test('同一格在一笔中多次改动，撤销回最初状态', () => {
  const s = makeSession();
  s.beginStroke();
  s.writeCells([{ x: 1, y: 1, z: 0, mat: MAT.hull.id }]);
  s.writeCells([{ x: 1, y: 1, z: 0, mat: MAT.panel.id }]);
  s.writeCells([{ x: 1, y: 1, z: 0, mat: MAT.glazing.id }]);
  s.endStroke();
  assert.equal(s._model.get(1, 1, 0), MAT.glazing.id);
  s.undo();
  assert.equal(s._model.get(1, 1, 0), AIR, '应回退到这笔开始前的空气');
});

test('重做恢复整笔', () => {
  const s = makeSession();
  s.beginStroke();
  s.writeCells([{ x: 1, y: 1, z: 0, mat: MAT.hull.id }]);
  s.writeCells([{ x: 2, y: 1, z: 0, mat: MAT.hull.id }]);
  s.endStroke();
  s.undo();
  assert.equal(s._model.occupied, 0);
  s.redo();
  assert.equal(s._model.occupied, 2);
});

test('框选后填充材质', () => {
  const s = makeSession();
  const m = s._model;
  m.fillBox({ x0: 2, y0: 2, z0: 0, x1: 5, y1: 5, z1: 2 }, MAT.basalt.id);
  s.selection.active = true;
  s.selection.box = { x0: 2, y0: 2, z0: 0, x1: 5, y1: 5, z1: 2 };
  s.updateSelectionCount();
  assert.equal(s.selection.count, 4 * 4 * 3);
  const n = s.fillSelection(MAT.seal.id);
  assert.equal(n, 48);
  assert.equal(m.get(3, 3, 1), MAT.seal.id);
  s.undo();
  assert.equal(m.get(3, 3, 1), MAT.basalt.id, '撤销应恢复原材质');
});

test('框选替换材质：指定 from → to', () => {
  const s = makeSession();
  const m = s._model;
  m.fillBox({ x0: 0, y0: 0, z0: 0, x1: 7, y1: 7, z1: 3 }, MAT.basalt.id);
  m.fillBox({ x0: 0, y0: 0, z0: 4, x1: 3, y1: 3, z1: 5 }, MAT.hull.id);
  s.selection.active = true;
  s.selection.box = { x0: 0, y0: 0, z0: 0, x1: 7, y1: 7, z1: 5 };
  s.updateSelectionCount();
  const n = s.replaceMaterial(MAT.basalt.id, MAT.breccia.id);
  assert.equal(n, 8 * 8 * 4, '只替换玄武岩');
  assert.equal(m.get(1, 1, 1), MAT.breccia.id);
  assert.equal(m.get(1, 1, 4), MAT.hull.id, '其他材质不受影响');
});

test('框选替换：any → 统一材质', () => {
  const s = makeSession();
  const m = s._model;
  m.fillBox({ x0: 0, y0: 0, z0: 0, x1: 3, y1: 3, z1: 1 }, MAT.basalt.id);
  m.fillBox({ x0: 0, y0: 0, z0: 2, x1: 3, y1: 3, z1: 3 }, MAT.hull.id);
  s.selection.active = true;
  s.selection.box = { x0: 0, y0: 0, z0: 0, x1: 3, y1: 3, z1: 3 };
  s.updateSelectionCount();
  const n = s.replaceMaterial('any', MAT.strut.id);
  assert.equal(n, 64);
  assert.equal(m.get(0, 0, 0), MAT.strut.id);
  assert.equal(m.get(0, 0, 3), MAT.strut.id);
});

test('按材质组替换：洞体组 → 舱体', () => {
  const s = makeSession();
  const m = s._model;
  m.fillBox({ x0: 0, y0: 0, z0: 0, x1: 3, y1: 3, z1: 1 }, MAT.basalt.id);
  m.fillBox({ x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 }, MAT.breccia.id);
  s.selection.active = true;
  s.selection.box = { x0: 0, y0: 0, z0: 0, x1: 3, y1: 3, z1: 1 };
  s.updateSelectionCount();
  const n = s.replaceGroup('cave', 'habitat', MATERIALS_FOR_TEST, GROUPS_FOR_TEST);
  assert.equal(n, 32, '16 玄武岩 + 4 角砾岩 = 20… 实际按选区全部洞体组计算');
  assert.equal(m.get(0, 0, 0), MAT.hull.id);
});

// 供上面用例使用的材质/分组表
import { MATERIALS as _MATERIALS, GROUPS as _GROUPS } from '../shared/materials.js';
const MATERIALS_FOR_TEST = _MATERIALS;
const GROUPS_FOR_TEST = _GROUPS;

test('复制粘贴到偏移位置', () => {
  const s = makeSession();
  const m = s._model;
  m.fillBox({ x0: 1, y0: 1, z0: 0, x1: 4, y1: 4, z1: 2 }, MAT.panel.id);
  s.selection.active = true;
  s.selection.box = { x0: 1, y0: 1, z0: 0, x1: 4, y1: 4, z1: 2 };
  s.updateSelectionCount();
  assert.equal(s.copySelection(), true);
  assert.equal(s.clipboard.value.count, 4 * 4 * 3);
  const n = s.paste({ x: 10, y: 10, z: 0 });
  assert.equal(n, 48);
  assert.equal(m.get(10, 10, 0), MAT.panel.id);
  assert.equal(m.get(13, 13, 2), MAT.panel.id);
  assert.equal(m.get(14, 14, 2), AIR);
  s.undo();
  assert.equal(m.get(10, 10, 0), AIR, '粘贴可整步撤销');
});

test('阵列复制沿 X 生成 N 份', () => {
  const s = makeSession();
  const m = s._model;
  m.fillBox({ x0: 1, y0: 1, z0: 0, x1: 3, y1: 3, z1: 1 }, MAT.hull.id);
  s.selection.active = true;
  s.selection.box = { x0: 1, y0: 1, z0: 0, x1: 3, y1: 3, z1: 1 };
  s.updateSelectionCount();
  const res = s.arrayCopy({ source: 'selection', axis: 'x', count: 3, spacing: 3 });
  assert.ok(res.added > 0);
  assert.equal(res.count, 3);
  // 原块 x 1..3，第二份 x 4..6，第三份 x 7..9，第四份 x 10..12
  assert.equal(m.get(5, 2, 0), MAT.hull.id, '第二份应落在 x=5');
  assert.equal(m.get(8, 2, 1), MAT.hull.id, '第三份应落在 x=8');
  assert.equal(m.get(11, 2, 0), MAT.hull.id, '第四份应落在 x=11');
});

test('阵列复制沿 Z 逐层堆叠', () => {
  const s = makeSession();
  const m = s._model;
  m.fillBox({ x0: 1, y0: 1, z0: 0, x1: 2, y1: 2, z1: 0 }, MAT.deck.id);
  s.selection.active = true;
  s.selection.box = { x0: 1, y0: 1, z0: 0, x1: 2, y1: 2, z1: 0 };
  s.updateSelectionCount();
  s.arrayCopy({ source: 'selection', axis: 'z', count: 3, spacing: 1 });
  assert.equal(m.get(1, 1, 1), MAT.deck.id);
  assert.equal(m.get(1, 1, 2), MAT.deck.id);
  assert.equal(m.get(1, 1, 3), MAT.deck.id);
  assert.equal(m.get(1, 1, 4), AIR);
});

test('阵列复制超出网格的部分被裁掉', () => {
  const s = makeSession({ sizeX: 16, sizeY: 16, sizeZ: 8 });
  const m = s._model;
  m.fillBox({ x0: 10, y0: 1, z0: 0, x1: 14, y1: 3, z1: 1 }, MAT.hull.id);
  s.selection.active = true;
  s.selection.box = { x0: 10, y0: 1, z0: 0, x1: 14, y1: 3, z1: 1 };
  s.updateSelectionCount();
  const res = s.arrayCopy({ source: 'selection', axis: 'x', count: 5, spacing: 5 });
  assert.ok(res.added >= 0);
  // 不应抛错，且网格内体素仍在
  assert.equal(m.get(10, 1, 0), MAT.hull.id);
});

test('笔刷大小 3 在层上刷出 3×3', () => {
  const s = makeSession();
  s.brushSize = { value: 3 };
  s.brushMat = { value: MAT.light.id };
  const n = s.paintAt({ x: 10, y: 10, z: 4 });
  assert.equal(n, 9);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      assert.equal(s._model.get(10 + dx, 10 + dy, 4), MAT.light.id);
    }
  }
});

test('笔刷只在当前层生效（不跨层溢出）', () => {
  const s = makeSession();
  s.brushSize = { value: 3 };
  s.paintAt({ x: 5, y: 5, z: 3 });
  assert.equal(s._model.get(5, 5, 2), AIR);
  assert.equal(s._model.get(5, 5, 4), AIR);
});

test('擦除笔刷清空体素', () => {
  const s = makeSession();
  const m = s._model;
  m.fillBox({ x0: 4, y0: 4, z0: 2, x1: 6, y1: 6, z1: 2 }, MAT.hull.id);
  s.eraseAt({ x: 5, y: 5, z: 2 });
  assert.equal(m.get(5, 5, 2), AIR);
  assert.equal(m.get(4, 4, 2), MAT.hull.id, '只擦除命中格');
});

test('吸取材质切换当前笔刷材质', () => {
  const s = makeSession();
  s._model.set(1, 1, 0, MAT.glazing.id);
  s.pickAt({ x: 1, y: 1, z: 0, mat: MAT.glazing.id });
  assert.equal(s.brushMat.value, MAT.glazing.id);
});

test('体检能定位到悬空簇并给出去向', () => {
  const s = makeSession({ sizeZ: 24 });
  const m = s._model;
  m.fillBox({ x0: 2, y0: 2, z0: 0, x1: 8, y1: 8, z1: 4 }, MAT.basalt.id);
  m.fillBox({ x0: 20, y0: 20, z0: 16, x1: 22, y1: 21, z1: 17 }, MAT.hull.id); // 3×2×2 = 12 格
  const a = s.runCheck();
  assert.equal(a.ok, false);
  assert.equal(a.floatingTotal, 1);
  assert.equal(a.floating[0].count, 12);
  assert.ok(s.markers.value.length >= 1);
  assert.equal(s.renderer.markers.length, s.markers.value.length);
});

test('删除选区', () => {
  const s = makeSession();
  const m = s._model;
  m.fillBox({ x0: 2, y0: 2, z0: 0, x1: 5, y1: 5, z1: 2 }, MAT.basalt.id);
  s.selection.active = true;
  s.selection.box = { x0: 2, y0: 2, z0: 0, x1: 3, y1: 3, z1: 2 };
  s.updateSelectionCount();
  const n = s.deleteSelection();
  assert.equal(n, 2 * 2 * 3);
  assert.equal(m.get(2, 2, 0), AIR);
  assert.equal(m.get(4, 4, 0), MAT.basalt.id);
});

test('只填空气：保留已有形体', () => {
  const s = makeSession();
  const m = s._model;
  m.fillBox({ x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 }, MAT.hull.id);
  s.selection.active = true;
  s.selection.box = { x0: 0, y0: 0, z0: 0, x1: 2, y1: 2, z1: 2 };
  s.updateSelectionCount();
  const n = s.fillSelectionAir(MAT.regolith.id);
  assert.equal(n, 27 - 8, '27 格中 8 格已有体素');
  assert.equal(m.get(0, 0, 0), MAT.hull.id, '原有舱壁不被覆盖');
  assert.equal(m.get(2, 2, 2), MAT.regolith.id);
});

test('单层单独显示（solo）', () => {
  const s = makeSession();
  s.toggleSolo(4);
  const hidden = s.renderer.opts.hiddenLayers;
  assert.ok(hidden, '应设置 hiddenLayers');
  assert.equal(hidden.has(4), false, 'solo 层可见');
  assert.equal(hidden.has(3), true, '其他层隐藏');
  s.clearSolo();
  assert.equal(s.renderer.opts.hiddenLayers.has(3), false);
});

test('修改模型后体检结果被标记为过期', () => {
  const s = makeSession();
  s._model.fillBox({ x0: 1, y0: 1, z0: 0, x1: 4, y1: 4, z1: 2 }, MAT.basalt.id);
  s.runCheck();
  assert.equal(s.analysis.value.stale, undefined);
  s.writeCells([{ x: 10, y: 10, z: 0, mat: MAT.hull.id }]);
  assert.equal(s.analysis.value.stale, true);
});
