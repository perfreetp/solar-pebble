/**
 * 流程集成测试：接单 → 分派 → 建模 → 提交 → 打回 → 返工 → 通过 → 导出。
 * 起一个临时数据目录的服务实例，走真实 HTTP。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 8899;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'lavatube-test-'));

let proc;

const H = {
  clerk: { 'X-Member': 'u-clerk', 'Content-Type': 'application/json' },
  qc: { 'X-Member': 'u-qc', 'Content-Type': 'application/json' },
  admin: { 'X-Member': 'u-admin', 'Content-Type': 'application/json' },
  m1: { 'X-Member': 'u-m1', 'Content-Type': 'application/json' },
  m2: { 'X-Member': 'u-m2', 'Content-Type': 'application/json' },
};

async function api(method, url, body, headers = H.clerk) {
  const res = await fetch(`${BASE}/api${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ct = res.headers.get('content-type') || '';
  const payload = ct.includes('json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, payload, headers: res.headers };
}

before(async () => {
  proc = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js'), `--port=${PORT}`, `--data=${DATA}`], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server start timeout')), 12000);
    proc.stdout.on('data', (chunk) => {
      if (String(chunk).includes('已启动')) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.stderr.on('data', (c) => process.stderr.write(c));
    proc.on('exit', (code) => reject(new Error(`server exited early: ${code}`)));
  });
});

after(() => {
  proc?.kill();
  try {
    fs.rmSync(DATA, { recursive: true, force: true });
  } catch {
    /* 忽略清理失败 */
  }
});

let orderId;

test('bootstrap 返回成员、材质与订单', async () => {
  const { status, payload } = await api('GET', '/bootstrap');
  assert.equal(status, 200);
  assert.ok(payload.members.length >= 7);
  assert.equal(payload.materials.length, 16);
  assert.deepEqual(payload.groups.map((g) => g.key), ['cave', 'lining', 'habitat', 'utility']);
  assert.ok(payload.orders.length >= 7);
  for (const o of payload.orders) {
    assert.ok(o.statusMeta?.label, '每个订单应带状态标签');
    assert.ok(o.dueState?.label);
  }
});

test('前台接单：创建带需求与网格设定的订单', async () => {
  const { status, payload } = await api('POST', '/orders', {
    title: '集成测试 · 主舱段',
    client: '测试委托方',
    priority: 'high',
    requirements: [{ k: '主舱直径', v: '10 m' }],
    brief: '测试说明',
    grid: { sizeX: 64, sizeY: 64, sizeZ: 40, voxelSize: 0.5 },
  }, H.clerk);
  assert.equal(status, 201);
  assert.equal(payload.status, 'draft');
  assert.equal(payload.assignee, null);
  assert.equal(payload.grid.sizeX, 64);
  assert.ok(payload.title.includes('集成测试'));
  orderId = payload.id;
});

test('建模师傅不能接单（角色权限）', async () => {
  const { status } = await api('POST', '/orders', { title: '越权' }, H.m2);
  assert.equal(status, 403);
});

test('缺少标题时拒绝创建', async () => {
  const { status, payload } = await api('POST', '/orders', { title: '   ' }, H.clerk);
  assert.equal(status, 400);
  assert.match(payload.error, /标题/);
});

test('分派给建模师傅后进入待开工', async () => {
  const { status, payload } = await api('POST', `/orders/${orderId}/assign`, { assignee: 'u-m2' }, H.clerk);
  assert.equal(status, 200);
  assert.equal(payload.assignee, 'u-m2');
  assert.equal(payload.status, 'queued');
  assert.equal(payload.assigneeName, '许宁');
});

test('不能分派给非建模角色', async () => {
  const { status, payload } = await api('POST', `/orders/${orderId}/assign`, { assignee: 'u-qc' }, H.clerk);
  assert.equal(status, 400);
  assert.match(payload.error, /建模师傅/);
});

test('自动生成起始模型且可读取', async () => {
  const { status, payload } = await api('GET', `/orders/${orderId}/model`);
  assert.equal(status, 200);
  assert.equal(payload.grid.sizeX, 64);
  assert.ok(payload.data.cells.length > 0, '应生成非空模型');
  assert.ok(payload.cells > 1000);
});

test('非承接人不能保存模型', async () => {
  const { payload: model } = await api('GET', `/orders/${orderId}/model`);
  const { status } = await api('PUT', `/orders/${orderId}/model`, { data: model.data }, H.m1);
  assert.equal(status, 403);
});

test('承接人保存模型后自动开工', async () => {
  const { payload: model } = await api('GET', `/orders/${orderId}/model`);
  const { status, payload } = await api('PUT', `/orders/${orderId}/model`, { data: model.data }, H.m2);
  assert.equal(status, 200);
  assert.equal(payload.ok, true);
  const { payload: order } = await api('GET', `/orders/${orderId}`);
  assert.equal(order.status, 'building');
});

test('体检接口能识别悬空体素簇', async () => {
  // 手工构造一个小模型：主体 + 远处一簇 8 格悬空
  const cells = [];
  for (let x = 10; x < 20; x++) for (let y = 10; y < 20; y++) for (let z = 0; z < 6; z++) cells.push(x, y, z, 1);
  for (let x = 40; x < 42; x++) for (let y = 40; y < 42; y++) for (let z = 30; z < 32; z++) cells.push(x, y, z, 7);
  const data = { v: 2, size: [64, 64, 40], voxelSize: 0.5, cells };
  const { status, payload } = await api('POST', `/orders/${orderId}/analyze`, { data }, H.m2);
  assert.equal(status, 200);
  assert.equal(payload.ok, false);
  const floating = payload.issues.find((i) => i.code === 'floating');
  assert.ok(floating);
  assert.equal(floating.count, 1);
  assert.equal(payload.floating[0].count, 8);
});

test('存在悬空体时提交质检被拒绝（422）', async () => {
  const cells = [];
  for (let x = 10; x < 20; x++) for (let y = 10; y < 20; y++) for (let z = 0; z < 6; z++) cells.push(x, y, z, 1);
  for (let x = 40; x < 42; x++) for (let y = 40; y < 42; y++) for (let z = 30; z < 32; z++) cells.push(x, y, z, 7);
  await api('PUT', `/orders/${orderId}/model`, {
    data: { v: 2, size: [64, 64, 40], voxelSize: 0.5, cells },
  }, H.m2);
  const { status, payload } = await api('POST', `/orders/${orderId}/status`, { status: 'submitted' }, H.m2);
  assert.equal(status, 422);
  assert.match(payload.error, /悬空/);
});

test('清理悬空后可提交质检', async () => {
  const cells = [];
  for (let x = 10; x < 20; x++) for (let y = 10; y < 20; y++) for (let z = 0; z < 6; z++) cells.push(x, y, z, 1);
  await api('PUT', `/orders/${orderId}/model`, {
    data: { v: 2, size: [64, 64, 40], voxelSize: 0.5, cells },
  }, H.m2);
  const { status, payload } = await api('POST', `/orders/${orderId}/status`, { status: 'submitted' }, H.m2);
  assert.equal(status, 200);
  assert.equal(payload.status, 'submitted');
});

test('质检打回必须写说明，且返工次数 +1', async () => {
  const noNote = await api('POST', `/orders/${orderId}/status`, { status: 'rejected' }, H.qc);
  assert.equal(noNote.status, 400);
  assert.match(noNote.payload.error, /问题说明/);

  const { status, payload } = await api(
    'POST',
    `/orders/${orderId}/status`,
    { status: 'rejected', note: '主舱壁厚不足 2 格' },
    H.qc
  );
  assert.equal(status, 200);
  assert.equal(payload.status, 'rejected');
  assert.equal(payload.reworkCount, 1);
  assert.equal(payload.qcNotes.at(-1).kind, 'reject');
  assert.match(payload.qcNotes.at(-1).text, /壁厚/);
});

test('建模师傅不能自己质检通过', async () => {
  await api('POST', `/orders/${orderId}/status`, { status: 'submitted' }, H.m2);
  const { status } = await api('POST', `/orders/${orderId}/status`, { status: 'approved' }, H.m2);
  assert.equal(status, 403);
});

test('二次提交后质检通过', async () => {
  // 上一步已提交到 submitted 状态，这里直接由质检判定
  const { status, payload } = await api(
    'POST',
    `/orders/${orderId}/status`,
    { status: 'approved', note: '复核通过' },
    H.qc
  );
  assert.equal(status, 200);
  assert.equal(payload.status, 'approved');
  assert.equal(payload.reworkCount, 1, '返工次数应保留');
});

test('未通过质检前不能标记交付', async () => {
  const { payload: list } = await api('GET', '/orders');
  const other = list.find((o) => o.status === 'draft');
  if (other) {
    const { status } = await api('POST', `/orders/${other.id}/status`, { status: 'delivered' }, H.clerk);
    assert.ok(status >= 400);
  }
});

test('导出预览给出四档减面', async () => {
  const { status, payload } = await api('GET', `/orders/${orderId}/export/preview`);
  assert.equal(status, 200);
  assert.equal(payload.levels.length, 4);
  for (let i = 1; i < payload.levels.length; i++) {
    assert.ok(payload.levels[i].quads <= payload.levels[i - 1].quads);
  }
  assert.ok(payload.source.cells > 0);
});

test('导出 zip 内含 obj / mtl / metadata / readme 且几何正确', async () => {
  const { status, payload } = await api('POST', `/orders/${orderId}/export`, { coarsen: 1 }, H.clerk);
  assert.equal(status, 200);
  const files = unzipSync(new Uint8Array(payload));
  const names = Object.keys(files);
  assert.ok(names.some((n) => n.endsWith('.obj')));
  assert.ok(names.some((n) => n.endsWith('.mtl')));
  assert.ok(names.some((n) => n.endsWith('.metadata.json')));
  assert.ok(names.some((n) => n.endsWith('.readme.txt')));

  const objName = names.find((n) => n.endsWith('.obj'));
  const obj = strFromU8(files[objName]);
  const mtl = strFromU8(files[names.find((n) => n.endsWith('.mtl'))]);
  const meta = JSON.parse(strFromU8(files[names.find((n) => n.endsWith('.metadata.json'))]));

  // 尺寸：64 × 64 × 40 格 × 0.5 m
  assert.equal(meta.dimensions.width, 32);
  assert.equal(meta.dimensions.depth, 32);
  assert.equal(meta.dimensions.height, 20);
  assert.equal(meta.unit, 'meter');
  assert.match(obj, /mtllib /);
  assert.match(obj, /^usemtl /m);
  assert.match(mtl, /^newmtl /m);
  assert.ok(meta.faces > 0);
  // 所有面引用的顶点都存在
  const vCount = obj.split('\n').filter((l) => l.startsWith('v ')).length;
  assert.equal(vCount, meta.vertices);
  for (const line of obj.split('\n').filter((l) => l.startsWith('f '))) {
    for (const tok of line.slice(2).trim().split(/\s+/)) {
      const idx = Number(tok.split('/')[0]);
      assert.ok(idx >= 1 && idx <= vCount);
    }
  }
});

test('按层导出只包含指定层', async () => {
  // 换成一根从底到顶的柱体，保证分层后有可见差异
  const cells = [];
  for (let z = 0; z < 30; z++) {
    cells.push(20, 20, z, 1);
    cells.push(21, 20, z, 1);
    cells.push(20, 21, z, 1);
    cells.push(21, 21, z, 1);
  }
  await api('PUT', `/orders/${orderId}/model`, {
    data: { v: 2, size: [64, 64, 40], voxelSize: 0.5, cells },
  }, H.m2);
  // 保存会把订单状态拉回 building，测试结束前重新提交并通过
  await api('POST', `/orders/${orderId}/status`, { status: 'submitted' }, H.m2);

  const all = await api('POST', `/orders/${orderId}/export`, { coarsen: 1 }, H.clerk);
  const allFiles = unzipSync(new Uint8Array(all.payload));
  const allMeta = JSON.parse(strFromU8(allFiles[Object.keys(allFiles).find((n) => n.endsWith('.metadata.json'))]));

  const part = await api('POST', `/orders/${orderId}/export`, { coarsen: 1, layers: [1, 2, 3] }, H.clerk);
  const partFiles = unzipSync(new Uint8Array(part.payload));
  const partMeta = JSON.parse(strFromU8(partFiles[Object.keys(partFiles).find((n) => n.endsWith('.metadata.json'))]));

  // 贪心合并后，直柱体的面数在分层与整体下可能相同；
  // 真正能区分的是几何高度：只导前 3 层，Z 向包围盒应只有 1.5 m。
  const objOf = (files) => strFromU8(files[Object.keys(files).find((n) => n.endsWith('.obj'))]);
  const zMax = (obj) => {
    let mx = -Infinity;
    for (const line of obj.split('\n')) {
      if (!line.startsWith('v ')) continue;
      const z = Number(line.trim().split(/\s+/)[3]);
      if (z > mx) mx = z;
    }
    return mx;
  };
  assert.ok(Math.abs(zMax(objOf(allFiles)) - 15) < 0.001, '整体导出高度应为 15 m');
  assert.ok(Math.abs(zMax(objOf(partFiles)) - 1.5) < 0.001, `分层导出高度应为 1.5 m，实际 ${zMax(objOf(partFiles))}`);
  assert.deepEqual(partMeta.order.layers, [1, 2, 3]);

  // 恢复成正常几何，避免影响后续质检/交付测试
  const cells2 = [];
  for (let x = 10; x < 20; x++) for (let y = 10; y < 20; y++) for (let z = 0; z < 6; z++) cells2.push(x, y, z, 1);
  await api('PUT', `/orders/${orderId}/model`, {
    data: { v: 2, size: [64, 64, 40], voxelSize: 0.5, cells: cells2 },
  }, H.m2);
  await api('POST', `/orders/${orderId}/status`, { status: 'submitted' }, H.m2);
});

test('交付后状态为已交付，看板统计正确', async () => {
  const { payload: before } = await api('GET', `/orders/${orderId}`);
  if (before.status === 'submitted') {
    await api('POST', `/orders/${orderId}/status`, { status: 'approved', note: '复核通过' }, H.qc);
  }
  const { status, payload } = await api('POST', `/orders/${orderId}/status`, { status: 'delivered' }, H.clerk);
  assert.equal(status, 200);
  assert.equal(payload.status, 'delivered');

  const { payload: dash } = await api('GET', '/dashboard');
  assert.ok(dash.totals.orders >= 8);
  assert.ok(dash.totals.reworkTotal >= 1);
  assert.ok(dash.perModeler.length === 4);
  const m2 = dash.perModeler.find((m) => m.id === 'u-m2');
  assert.ok(m2, '看板应包含许宁');
  assert.ok(m2.reviewed >= 1);
  assert.ok(m2.reworkRate >= 0 && m2.reworkRate <= 1, '返工率必须在 0–1 之间');
  for (const m of dash.perModeler) {
    assert.ok(m.reworkRate >= 0 && m.reworkRate <= 1, `${m.name} 的返工率越界：${m.reworkRate}`);
    assert.ok(m.firstPassRate === null || (m.firstPassRate >= 0 && m.firstPassRate <= 1));
    // 各分段之和必须等于承接总数（否则工单会被重复计数或被漏掉）
    const parts = m.completed + m.inFlight + m.awaitingQc + m.reworking + m.drafting;
    assert.equal(parts, m.total, `${m.name} 的分段合计 ${parts} ≠ 承接总数 ${m.total}`);
  }
  // 四种状态互斥：同一单不能同时被算作在制与返工中
  const statuses = ['completed', 'inFlight', 'awaitingQc', 'reworking', 'drafting'];
  for (const m of dash.perModeler) {
    assert.ok(statuses.every((k) => m[k] >= 0), `${m.name} 有负的分段计数`);
  }
});

test('不存在订单返回 404', async () => {
  const a = await api('GET', '/orders/ORD-9999');
  assert.equal(a.status, 404);
  const b = await api('GET', '/orders/ORD-9999/model');
  assert.equal(b.status, 404);
});

test('订单动态记录完整', async () => {
  const { payload } = await api('GET', `/orders/${orderId}`);
  const kinds = payload.history.map((h) => h.kind);
  for (const k of ['create', 'assign', 'submit', 'reject', 'pass', 'deliver', 'save', 'start']) {
    assert.ok(kinds.includes(k), `动态里缺少 ${k}：${kinds.join(',')}`);
  }
});

test('搜索能按需求内容命中', async () => {
  const { payload } = await api('GET', `/orders?q=${encodeURIComponent('主舱直径')}`);
  assert.ok(payload.some((o) => o.id === orderId));
});
