/**
 * 本地 API 服务 —— 订单流程 + 模型存取 + 体检 + OBJ 导出。
 *
 * 说明：这是车间内网工具，身份用 “X-Member” 头声明当前操作人（没有密码）；
 * 角色权限在服务端校验，UI 只是按角色隐藏入口。
 */

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

import { Store, MEMBERS, MEMBER_BY_ID, STATUS, STATUS_META, PRIORITY, ROLE, now } from './store.js';
import { generateCaveSeed } from './seedModel.js';
import { VoxelModel, DEFAULT_SIZE } from '../shared/voxel.js';
import { analyzeModel, issueMarkers } from '../shared/validate.js';
import { greedyQuads, buildObj, coarsenModel } from '../shared/mesh.js';
import { MATERIALS, GROUPS, MATERIAL_BY_ID } from '../shared/materials.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};
const PORT = Number(argOf('port', process.env.PORT || 8788));
const SERVE_STATIC = args.includes('--serve');
const DATA_DIR = path.resolve(argOf('data', path.join(__dirname, '..', '.data')));
const MODEL_DIR = path.join(DATA_DIR, 'models');
fs.mkdirSync(MODEL_DIR, { recursive: true });

const store = new Store(path.join(DATA_DIR, 'db.json'));

// ---------------------------------------------------------------- 模型存取

function modelPath(orderId) {
  return path.join(MODEL_DIR, `${orderId}.json`);
}

function loadModel(orderId) {
  const p = modelPath(orderId);
  if (!fs.existsSync(p)) return null;
  try {
    return VoxelModel.fromJSON(JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch (err) {
    console.warn('[models] 读取失败', orderId, err.message);
    return null;
  }
}

function saveModel(orderId, model) {
  const p = modelPath(orderId);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(model.toJSON()));
  fs.renameSync(tmp, p);
  const order = store.order(orderId);
  if (order) {
    order.modelKey = orderId;
    order.modelUpdatedAt = now();
    order.modelCells = model.occupied;
    store.save();
  }
}

function ensureModel(order) {
  let model = loadModel(order.id);
  if (!model) {
    model = generateCaveSeed(order.grid || DEFAULT_SIZE, { seed: (order.id.charCodeAt(6) || 3) + 1.7 });
    saveModel(order.id, model);
  }
  return model;
}

function logAction(order, memberId, kind, text, extra = {}) {
  store.log(order, memberId, kind, text, extra);
}

function memberFromReq(req) {
  const id = req.get('x-member') || req.query.member;
  return MEMBER_BY_ID[id] || MEMBERS[0];
}

function requireRole(req, res, roles) {
  const m = memberFromReq(req);
  if (!roles.includes(m.role)) {
    res.status(403).json({ error: '当前角色无权执行此操作', role: m.role, need: roles });
    return null;
  }
  return m;
}

// ---------------------------------------------------------------- 派生数据

function orderView(order, { withChecks = false } = {}) {
  const model = withChecks ? loadModel(order.id) : null;
  const analysis = model ? analyzeModel(model, { floatingMin: 5, minWall: 2 }) : null;
  return {
    ...order,
    statusMeta: STATUS_META[order.status],
    assigneeName: order.assignee ? MEMBER_BY_ID[order.assignee]?.name || null : null,
    assigneeInfo: order.assignee ? MEMBER_BY_ID[order.assignee] || null : null,
    dueState: dueStateOf(order),
    analysis: analysis
      ? {
          ok: analysis.ok,
          issues: analysis.issues,
          thinTotal: analysis.thinTotal,
          floatingTotal: analysis.floatingTotal,
          cells: model.occupied,
        }
      : null,
    modelExists: fs.existsSync(modelPath(order.id)),
  };
}

function dueStateOf(order) {
  if (!order.dueAt) return { label: '未设期限', tone: 'neutral', hours: null };
  const diff = (new Date(order.dueAt).getTime() - Date.now()) / 3600_000;
  if (order.status === 'delivered' || order.status === 'approved') {
    return { label: '已交付', tone: 'success', hours: diff };
  }
  if (diff < 0) return { label: `超期 ${Math.abs(Math.round(diff))} 小时`, tone: 'danger', hours: diff };
  if (diff < 24) return { label: `剩 ${Math.max(1, Math.round(diff))} 小时`, tone: 'warn', hours: diff };
  return { label: `剩 ${Math.round(diff / 24)} 天`, tone: 'info', hours: diff };
}

const app = express();
app.use(express.json({ limit: '48mb' }));

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// ---------------------------------------------------------------- 基础信息

app.get('/api/bootstrap', (req, res) => {
  const me = memberFromReq(req);
  res.json({
    me,
    members: MEMBERS,
    groups: GROUPS,
    materials: MATERIALS,
    statuses: STATUS_META,
    priorities: PRIORITY,
    orders: store.orders.map((o) => orderView(o)),
    serverTime: now(),
  });
});

app.get('/api/members', (req, res) => {
  res.json(MEMBERS.map((m) => ({ ...m })));
});

// ---------------------------------------------------------------- 订单

app.get('/api/orders', (req, res) => {
  const q = (req.query.q || '').toString().trim().toLowerCase();
  let list = store.orders;
  if (q) {
    list = list.filter((o) =>
      [o.id, o.code, o.title, o.client, o.brief, ...(o.requirements || []).map((r) => `${r.k} ${r.v}`)]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }
  res.json(list.map((o) => orderView(o)));
});

app.get('/api/orders/:id', (req, res) => {
  const order = store.order(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  res.json(orderView(order, { withChecks: true }));
});

app.post('/api/orders', (req, res) => {
  const me = requireRole(req, res, [ROLE.CLERK, ROLE.ADMIN]);
  if (!me) return;
  const body = req.body || {};
  if (!body.title || !String(body.title).trim()) {
    return res.status(400).json({ error: '请填写订单标题' });
  }
  const id = store.nextId();
  const order = {
    id,
    code: body.code || id.replace('ORD-', 'LT-'),
    title: String(body.title).trim(),
    client: body.client || '未指定委托方',
    priority: body.priority || 'normal',
    dueAt: body.dueAt || null,
    createdAt: now(),
    createdBy: me.id,
    assignee: body.assignee || null,
    status: body.assignee ? STATUS.QUEUED : STATUS.DRAFT,
    stage: body.assignee ? 'queued' : 'brief',
    reworkCount: 0,
    qcNotes: [],
    requirements: Array.isArray(body.requirements) ? body.requirements.filter((r) => r && r.k && r.v) : [],
    brief: body.brief || '',
    grid: body.grid || { ...DEFAULT_SIZE },
    modelKey: null,
    history: [],
  };
  logAction(order, me.id, 'create', '接单并录入需求');
  if (body.assignee) {
    const a = MEMBER_BY_ID[body.assignee];
    logAction(order, me.id, 'assign', `分派给 ${a?.name || body.assignee}`);
  }
  store.orders.unshift(order);
  store.save();
  res.status(201).json(orderView(order));
});

app.patch('/api/orders/:id', (req, res) => {
  const me = requireRole(req, res, [ROLE.CLERK, ROLE.ADMIN]);
  if (!me) return;
  const order = store.order(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  const body = req.body || {};
  const editable = ['title', 'client', 'priority', 'dueAt', 'brief', 'requirements', 'code'];
  const changed = [];
  for (const k of editable) {
    if (body[k] !== undefined) {
      const before = order[k];
      order[k] = body[k];
      if (JSON.stringify(before) !== JSON.stringify(body[k])) changed.push(k);
    }
  }
  if (changed.length) {
    logAction(order, me.id, 'edit', `修改需求：${changed.join('、')}`);
  }
  store.save();
  res.json(orderView(order));
});

app.post('/api/orders/:id/assign', (req, res) => {
  const me = requireRole(req, res, [ROLE.CLERK, ROLE.ADMIN]);
  if (!me) return;
  const order = store.order(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  const { assignee, note } = req.body || {};
  if (assignee && !MEMBER_BY_ID[assignee]) return res.status(400).json({ error: '未知的建模师傅' });
  if (MEMBER_BY_ID[assignee] && MEMBER_BY_ID[assignee].role !== ROLE.MODELER) {
    return res.status(400).json({ error: '只能分派给建模师傅' });
  }
  const prev = order.assignee;
  order.assignee = assignee || null;
  if (assignee && order.status === STATUS.DRAFT) {
    order.status = STATUS.QUEUED;
    order.stage = 'queued';
  }
  if (!assignee && order.status === STATUS.QUEUED) {
    order.status = STATUS.DRAFT;
    order.stage = 'brief';
  }
  const name = assignee ? MEMBER_BY_ID[assignee].name : '（取消分派）';
  logAction(order, me.id, 'assign', prev && prev !== assignee ? `改派给 ${name}${note ? ' · ' + note : ''}` : `分派给 ${name}${note ? ' · ' + note : ''}`);
  store.save();
  res.json(orderView(order));
});

app.post('/api/orders/:id/status', (req, res) => {
  const me = memberFromReq(req);
  const order = store.order(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  const { status, note } = req.body || {};
  if (!STATUS_META[status]) return res.status(400).json({ error: '未知状态' });

  const isOwner = order.assignee === me.id;
  const can = {
    building: isOwner || me.role === ROLE.ADMIN,
    submit: isOwner,
    pass: me.role === ROLE.QC || me.role === ROLE.ADMIN,
    reject: me.role === ROLE.QC || me.role === ROLE.ADMIN,
    deliver: me.role === ROLE.ADMIN || me.role === ROLE.CLERK,
    queued: me.role === ROLE.CLERK || me.role === ROLE.ADMIN,
  };

  if (status === STATUS.BUILDING) {
    if (!can.building) return res.status(403).json({ error: '只有承接该单的师傅可以开工' });
    order.status = STATUS.BUILDING;
    order.stage = 'building';
    logAction(order, me.id, 'start', '开始建模');
  } else if (status === STATUS.SUBMITTED) {
    if (!can.submit) return res.status(403).json({ error: '只有承接该单的师傅可以提交' });
    const model = loadModel(order.id);
    if (!model || !model.occupied) return res.status(400).json({ error: '模型为空，无法提交质检' });
    if (order.status !== STATUS.BUILDING && order.status !== STATUS.REJECTED) {
      return res.status(400).json({ error: '当前状态不能提交质检' });
    }
    const analysis = analyzeModel(model, { floatingMin: 5, minWall: 2 });
    if (analysis.issues.some((i) => i.severity === 'error')) {
      return res.status(422).json({
        error: '体检未通过：存在悬空体素簇，请先处理后再提交',
        analysis: { issues: analysis.issues, floating: analysis.floating, thinAreas: analysis.thinAreas },
      });
    }
    order.status = STATUS.SUBMITTED;
    order.stage = 'submitted';
    order.submittedAt = now();
    logAction(order, me.id, 'submit', `提交质检${note ? ' · ' + note : ''}`);
  } else if (status === STATUS.REJECTED) {
    if (!can.reject) return res.status(403).json({ error: '只有质检可以打回' });
    if (order.status !== STATUS.SUBMITTED) return res.status(400).json({ error: '只有待质检的订单可以打回' });
    if (!note || !String(note).trim()) return res.status(400).json({ error: '打回必须填写问题说明' });
    order.status = STATUS.REJECTED;
    order.stage = 'rework';
    order.reworkCount = (order.reworkCount || 0) + 1;
    order.qcNotes.push({ at: now(), by: me.id, kind: 'reject', text: String(note).trim() });
    logAction(order, me.id, 'reject', `质检打回（第 ${order.reworkCount} 次返工）：${String(note).trim()}`);
  } else if (status === STATUS.APPROVED) {
    if (!can.pass) return res.status(403).json({ error: '只有质检可以判定通过' });
    if (order.status !== STATUS.SUBMITTED) return res.status(400).json({ error: '只有待质检的订单可以通过' });
    order.status = STATUS.APPROVED;
    order.stage = 'approved';
    order.approvedAt = now();
    order.qcNotes.push({ at: now(), by: me.id, kind: 'pass', text: String(note || '质检通过').trim() });
    logAction(order, me.id, 'pass', `质检通过${note ? ' · ' + note : ''}`);
  } else if (status === STATUS.DELIVERED) {
    if (!can.deliver) return res.status(403).json({ error: '只有前台或组长可以交付' });
    if (order.status !== STATUS.APPROVED) return res.status(400).json({ error: '质检通过后才能交付' });
    order.status = STATUS.DELIVERED;
    order.stage = 'delivered';
    order.deliveredAt = now();
    logAction(order, me.id, 'deliver', `交付${note ? ' · ' + note : ''}`);
  } else if (status === STATUS.QUEUED) {
    if (!can.queued) return res.status(403).json({ error: '无权退回待开工' });
    order.status = STATUS.QUEUED;
    order.stage = 'queued';
    logAction(order, me.id, 'status', '退回待开工');
  } else {
    return res.status(400).json({ error: '不支持的状态流转' });
  }

  store.save();
  res.json(orderView(order, { withChecks: true }));
});

// ---------------------------------------------------------------- 模型

app.get('/api/orders/:id/model', (req, res) => {
  const order = store.order(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  const model = ensureModel(order);
  const dims = model.dimensions();
  res.json({
    orderId: order.id,
    grid: { sizeX: model.sizeX, sizeY: model.sizeY, sizeZ: model.sizeZ, voxelSize: model.voxelSize },
    dimensions: dims,
    cells: model.occupied,
    data: model.toJSON(),
  });
});

app.put('/api/orders/:id/model', (req, res) => {
  const me = memberFromReq(req);
  const order = store.order(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  const isOwner = order.assignee === me.id;
  if (!isOwner && me.role !== ROLE.ADMIN) {
    return res.status(403).json({ error: '只有承接该单的师傅可以保存模型' });
  }
  const body = req.body || {};
  let model;
  try {
    model = VoxelModel.fromJSON(body.data || body);
  } catch (err) {
    return res.status(400).json({ error: `模型数据无效：${err.message}` });
  }
  saveModel(order.id, model);
  if (order.status === STATUS.QUEUED) {
    order.status = STATUS.BUILDING;
    order.stage = 'building';
    logAction(order, me.id, 'start', '开始建模');
  }
  logAction(order, me.id, 'save', `保存模型（${model.occupied.toLocaleString('zh-CN')} 格）`);
  store.save();
  res.json({ ok: true, cells: model.occupied, updatedAt: now() });
});

app.post('/api/orders/:id/analyze', (req, res) => {
  const order = store.order(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  const body = req.body || {};
  let model;
  if (body.data) {
    try {
      model = VoxelModel.fromJSON(body.data);
    } catch (e) {
      return res.status(400).json({ error: '模型数据无效' });
    }
  } else {
    model = loadModel(order.id);
    if (!model) return res.status(400).json({ error: '该订单还没有模型' });
  }
  const a = analyzeModel(model, {
    floatingMin: body.floatingMin ?? 5,
    minWall: body.minWall ?? 2,
  });
  res.json({
    ok: a.ok,
    issues: a.issues,
    floating: a.floating,
    thinAreas: a.thinAreas,
    markers: issueMarkers(a),
    stats: a.stats,
    cells: model.occupied,
  });
});

/** 导出：合并贪心面 → 可选降采样 → OBJ/MTL 打包 zip。 */
app.post('/api/orders/:id/export', (req, res) => {
  const me = memberFromReq(req);
  const order = store.order(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  const body = req.body || {};
  const coarsen = Math.max(1, Math.min(6, Number(body.coarsen) || 1));
  const includeLayers = Array.isArray(body.layers) && body.layers.length ? new Set(body.layers) : null;

  const source = body.data ? VoxelModel.fromJSON(body.data) : loadModel(order.id);
  if (!source) return res.status(400).json({ error: '该订单还没有模型' });

  const model = coarsen > 1 ? coarsenModel(source, coarsen) : source;
  const visible = includeLayers
    ? (z) => includeLayers.has(Math.floor(z / coarsen) + 1)
    : undefined;

  const quads = greedyQuads(model, visible ? { visible } : {});
  const baseName = `LT-${order.id.replace('ORD-', '')}-${coarsen > 1 ? `c${coarsen}x` : 'full'}`;
  const { obj, mtl, metadata } = buildObj(quads, model, { name: baseName });

  metadata.order = {
    id: order.id,
    code: order.code,
    title: order.title,
    client: order.client,
    requirements: order.requirements,
    assignee: order.assignee ? MEMBER_BY_ID[order.assignee]?.name : null,
    qc: order.qcNotes,
    reworkCount: order.reworkCount,
    exportedBy: me.name,
    coarsen,
    layers: includeLayers ? [...includeLayers] : 'all',
  };
  metadata.sourceCells = source.occupied;
  metadata.sourceGrid = { x: source.sizeX, y: source.sizeY, z: source.sizeZ, voxelSize: source.voxelSize };

  const files = {
    [`${baseName}.obj`]: strToU8(obj),
    [`${baseName}.mtl`]: strToU8(mtl),
    [`${baseName}.metadata.json`]: strToU8(JSON.stringify(metadata, null, 2)),
    [`${baseName}.readme.txt`]: strToU8(
      [
        `月球熔岩管地下基地概念模型 — ${order.title}`,
        `订单号：${order.id}（${order.code}）`,
        `委托方：${order.client}`,
        `承接：${metadata.order.assignee || '未分派'}   质检：${order.qcNotes.length ? '已检查 ' + order.qcNotes.length + ' 次' : '未检查'}`,
        '',
        `单位：米。体素尺寸 ${model.voxelSize} m（原始 ${source.voxelSize} m，降采样 ${coarsen}×）`,
        `外形尺寸：宽 ${metadata.dimensions.width.toFixed(2)} m × 深 ${metadata.dimensions.depth.toFixed(2)} m × 高 ${metadata.dimensions.height.toFixed(2)} m`,
        `网格：${model.sizeX} × ${model.sizeY} × ${model.sizeZ}`,
        `面数（四边形）：${quads.length.toLocaleString('en-US')}   三角面：${(quads.length * 2).toLocaleString('en-US')}`,
        `材质：${metadata.materials.length} 种 —— ${metadata.materials.map((m) => m.name).join('、')}`,
        '',
        '导入说明：',
        '  Blender：文件 → 导入 → Wavefront (.obj)，勾选 “Split by Group”，单位选米。',
        '  3ds Max：导入 → Wavefront OBJ，缩放单位设为米。',
        '  坐标：XY 以模型中心为原点，Z=0 为基准地面。',
        '',
        '导出参数：',
        `  降采样：${coarsen}×`,
        `  导出层：${includeLayers ? [...includeLayers].join(', ') : '全部'}`,
        `  原始体素：${source.occupied.toLocaleString('en-US')} 格`,
        `  导出时间：${new Date().toISOString()}`,
      ].join('\n')
    ),
  };

  store.log(order, me.id, 'export', `导出 obj（${coarsen}× 降采样，${quads.length.toLocaleString('zh-CN')} 面）`);
  if (order.status === STATUS.APPROVED) {
    store.log(order, me.id, 'deliver', '导出交付 obj');
  }
  store.save();

  const zipped = zipSync(files, { level: 0 });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(baseName)}.zip"`);
  res.send(Buffer.from(zipped));
});

app.get('/api/orders/:id/export/preview', (req, res) => {
  const order = store.order(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  const source = loadModel(order.id);
  if (!source) return res.status(400).json({ error: '该订单还没有模型' });
  const levels = [];
  for (const k of [1, 2, 3, 4]) {
    const m = k > 1 ? coarsenModel(source, k) : source;
    const quads = greedyQuads(m);
    levels.push({
      coarsen: k,
      quads: quads.length,
      triangles: quads.length * 2,
      voxelSize: m.voxelSize,
      grid: [m.sizeX, m.sizeY, m.sizeZ],
      dimensions: m.dimensions(),
      vertices: quads.length * 4,
    });
  }
  res.json({
    source: {
      cells: source.occupied,
      grid: [source.sizeX, source.sizeY, source.sizeZ],
      voxelSize: source.voxelSize,
      dimensions: source.dimensions(),
    },
    levels,
  });
});

/**
 * 结构核验：给质检提供可自动判定的客观项（尺寸、镜像对称、材质分组、分层）。
 * 这些项不替代人眼抽查，只是把“能算的”先算掉。
 */
app.post('/api/orders/:id/inspect', (req, res) => {
  const order = store.order(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  const body = req.body || {};
  const source = body.data ? VoxelModel.fromJSON(body.data) : loadModel(order.id);
  if (!source) return res.status(400).json({ error: '该订单还没有模型' });

  const s = source.voxelSize;
  const bounds = source.occupancyBounds() || { x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0 };
  const dims = {
    width: +((bounds.x1 - bounds.x0 + 1) * s).toFixed(3),
    depth: +((bounds.y1 - bounds.y0 + 1) * s).toFixed(3),
    height: +((bounds.z1 - bounds.z0 + 1) * s).toFixed(3),
  };

  // 镜像对称度：以模型自身最小/最大 X 的中线为轴对称比较
  const plane = Math.round((bounds.x0 + bounds.x1 + 1) / 2);
  let mirrorMatched = 0;
  let mirrorCompared = 0;
  const stats = source.stats();
  const groupIds = new Set();
  for (const [idStr, n] of Object.entries(stats.byMaterial)) {
    const meta = MATERIAL_BY_ID[Number(idStr)];
    if (meta && n > 0) groupIds.add(meta.group);
  }
  if (body.checkMirror !== false) {
    const seen = new Set();
    source.forEach((x, y, z, mat) => {
      const key = `${x},${y},${z}`;
      if (seen.has(key)) return;
      const mx = 2 * plane - 1 - x;
      if (!source.inside(mx, y, z)) return;
      const key2 = `${mx},${y},${z}`;
      if (seen.has(key2)) return;
      seen.add(key);
      seen.add(key2);
      mirrorCompared++;
      if (source.get(mx, y, z) === mat) mirrorMatched++;
    });
  }

  // 分层占位：每层占用体素
  const perLayer = [];
  const layerCounts = new Uint32Array(source.sizeZ);
  source.forEach((x, y, z) => {
    layerCounts[z]++;
  });
  for (let z = 0; z < source.sizeZ; z++) {
    if (layerCounts[z] > 0) perLayer.push({ layer: z + 1, cells: layerCounts[z] });
  }

  const list = [];
  const push = (key, label, value, detail) => list.push({ key, label, value, detail });

  push('dims', '外形尺寸', `${dims.width} × ${dims.depth} × ${dims.height} m`, `包围盒 ${bounds.x0}–${bounds.x1} / ${bounds.y0}–${bounds.y1} / ${bounds.z0}–${bounds.z1} 格`);
  push('grid', '体素网格', `${source.sizeX} × ${source.sizeY} × ${source.sizeZ}`, `体素边长 ${s} m`);
  push('cells', '占用体素', stats.total.toLocaleString('zh-CN'), `共 ${groupIds.size} 个材质组`);

  if (mirrorCompared > 0) {
    const rate = mirrorMatched / mirrorCompared;
    push(
      'mirror',
      '镜像对称度',
      `${(rate * 100).toFixed(1)}%`,
      `以 X=${plane} 为轴，比较 ${mirrorCompared.toLocaleString('zh-CN')} 对镜像格；${rate > 0.995 ? '基本完全对称' : '存在不对称结构，可能是刻意为之'}`
    );
  } else {
    push('mirror', '镜像对称度', '—', '模型过窄，无法判定');
  }

  const groupNames = [...groupIds].map((g) => GROUPS.find((x) => x.key === g)?.name || g);
  push('materials', '材质分组', groupNames.length ? groupNames.join(' / ') : '无', '洞体 / 内壁 / 舱体 / 设备四组的分层使用情况');
  push('layers', '有效层数', `${perLayer.length} / ${source.sizeZ}`, perLayer.length
    ? `最低 Z${perLayer[0].layer}，最高 Z${perLayer[perLayer.length - 1].layer}`
    : '模型为空');

  // 需求项对照：把尺寸类要求与实测值并排，交给人判断
  const reqCompare = (order.requirements || []).map((r) => ({ k: r.k, v: r.v }));

  res.json({ dims, bounds, mirror: mirrorCompared ? { plane, compared: mirrorCompared, matched: mirrorMatched, rate: mirrorMatched / mirrorCompared } : null, items: list, groups: [...groupIds], perLayer, requirements: reqCompare });
});

// ---------------------------------------------------------------- 看板

app.get('/api/dashboard', (req, res) => {
  const orders = store.orders;
  const modelers = MEMBERS.filter((m) => m.role === ROLE.MODELER);
  // 返工率口径：送检过的工单里，被至少打回过一次的比例（0–100%）。
  // 另给“均次”= 每条送检工单平均被打回几次，避免把次数和比例混在一起。
  const reviewedStatuses = ['submitted', 'rejected', 'approved', 'delivered'];
  const perModeler = modelers.map((m) => {
    const mine = orders.filter((o) => o.assignee === m.id);
    const delivered = mine.filter((o) => o.status === 'delivered' || o.status === 'approved');
    const submitted = mine.filter((o) => o.status === 'submitted');
    // 在制不含“被打回”——打回中的单单独一段，避免同一条被算两次
    const inFlight = mine.filter((o) => ['queued', 'building'].includes(o.status));
    const reworking = mine.filter((o) => o.status === 'rejected');
    const reviewed = mine.filter((o) => reviewedStatuses.includes(o.status));
    // 返工次数也只统计已送检的工单，否则“在制且被打回过”的单会污染均值
    const reworkTotal = reviewed.reduce((a, o) => a + (o.reworkCount || 0), 0);
    const reworkedOrders = reviewed.filter((o) => (o.reworkCount || 0) > 0).length;
    const firstPass = reviewed.filter((o) => (o.reworkCount || 0) === 0);
    return {
      id: m.id,
      name: m.name,
      avatar: m.avatar,
      hue: m.hue,
      title: m.title,
      specialty: m.specialty,
      total: mine.length,
      completed: delivered.length,
      inFlight: inFlight.length,
      reworking: reworking.length,
      awaitingQc: submitted.length,
      drafting: mine.filter((o) => o.status === 'draft').length,
      reworkTotal,
      reworkedOrders,
      reviewed: reviewed.length,
      reworkRate: reviewed.length ? reworkedOrders / reviewed.length : 0,
      avgRework: reviewed.length ? reworkTotal / reviewed.length : 0,
      firstPassRate: reviewed.length ? firstPass.length / reviewed.length : null,
      cells: mine.reduce((a, o) => a + (o.modelCells || 0), 0),
    };
  });

  const allReviewed = orders.filter((o) => reviewedStatuses.includes(o.status));
  const allRework = orders.reduce((a, o) => a + (o.reworkCount || 0), 0);
  const allReworkedOrders = allReviewed.filter((o) => (o.reworkCount || 0) > 0).length;
  const statusCounts = {};
  for (const key of Object.keys(STATUS_META)) statusCounts[key] = 0;
  for (const o of orders) statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;

  // 近 14 天的提交/打回节律
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000);
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, submitted: 0, rejected: 0, passed: 0 });
  }
  const byDay = new Map(days.map((d) => [d.date, d]));
  for (const o of orders) {
    for (const h of o.history || []) {
      const key = String(h.at).slice(0, 10);
      const d = byDay.get(key);
      if (!d) continue;
      if (h.kind === 'submit') d.submitted++;
      if (h.kind === 'reject') d.rejected++;
      if (h.kind === 'pass') d.passed++;
    }
  }

  res.json({
    totals: {
      orders: orders.length,
      active: orders.filter((o) => ['queued', 'building', 'rejected'].includes(o.status)).length,
      awaitingQc: orders.filter((o) => o.status === 'submitted').length,
      approved: orders.filter((o) => o.status === 'approved').length,
      delivered: orders.filter((o) => o.status === 'delivered').length,
      reworkTotal: allRework,
      reworkOrders: allReworkedOrders,
      reviewed: allReviewed.length,
      reworkRate: allReviewed.length ? allReworkedOrders / allReviewed.length : 0,
      avgRework: allReviewed.length ? allRework / allReviewed.length : 0,
      cells: orders.reduce((a, o) => a + (o.modelCells || 0), 0),
      overdue: orders.filter((o) => dueStateOf(o).tone === 'danger').length,
    },
    perModeler: perModeler.sort((a, b) => b.completed - a.completed || a.reworkRate - b.reworkRate),
    statusCounts,
    days,
    recent: orders
      .flatMap((o) => (o.history || []).map((h) => ({ ...h, orderId: o.id, orderTitle: o.title, code: o.code })))
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 30),
    qcQueue: orders
      .filter((o) => o.status === 'submitted')
      .map((o) => ({ ...orderView(o), submittedAt: o.submittedAt })),
  });
});

// ---------------------------------------------------------------- 静态站点

if (SERVE_STATIC) {
  const dist = path.join(__dirname, '..', 'dist');
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (req, res) => {
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error('[api]', err);
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`[api] 月球基地制单服务已启动  http://localhost:${PORT}  (数据: ${DATA_DIR})`);
});

export { app, store };
