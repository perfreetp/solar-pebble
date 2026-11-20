/**
 * 数据存储层 —— 单个 JSON 文件 + 原子写入。
 * 数据量很小（若干订单 + 若干模型），无需数据库；写入时先写临时文件再 rename。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const now = () => new Date().toISOString();

export const ROLE = {
  CLERK: 'clerk', // 前台：接单、录要求、分派
  MODELER: 'modeler', // 建模师傅
  QC: 'qc', // 质检
  ADMIN: 'admin', // 统筹 / 看板
};

export const MEMBERS = [
  { id: 'u-clerk', name: '周岚', role: ROLE.CLERK, title: '前台接单', avatar: 'ZL', hue: 28 },
  { id: 'u-qc', name: '沈铎', role: ROLE.QC, title: '质检抽查', avatar: 'SD', hue: 200 },
  { id: 'u-admin', name: '林澈', role: ROLE.ADMIN, title: '概念设计组长', avatar: 'LC', hue: 268 },
  { id: 'u-m1', name: '陈砚', role: ROLE.MODELER, title: '建模师傅 · 洞体', avatar: 'CY', hue: 168, specialty: 'cave' },
  { id: 'u-m2', name: '许宁', role: ROLE.MODELER, title: '建模师傅 · 舱段', avatar: 'XN', hue: 320, specialty: 'habitat' },
  { id: 'u-m3', name: '罗青', role: ROLE.MODELER, title: '建模师傅 · 内壁', avatar: 'LQ', hue: 96, specialty: 'lining' },
  { id: 'u-m4', name: '何一鸣', role: ROLE.MODELER, title: '建模师傅 · 设备', avatar: 'HY', hue: 44, specialty: 'utility' },
];

export const MEMBER_BY_ID = Object.fromEntries(MEMBERS.map((m) => [m.id, m]));

export const STATUS = {
  DRAFT: 'draft', // 前台已接单，需求待完善
  QUEUED: 'queued', // 已分派，待开工
  BUILDING: 'building', // 建模中
  SUBMITTED: 'submitted', // 已提交，待质检
  REJECTED: 'rejected', // 质检打回，返工中
  APPROVED: 'approved', // 质检通过
  DELIVERED: 'delivered', // 已导出交付
};

export const STATUS_META = {
  draft: { label: '待完善', tone: 'neutral' },
  queued: { label: '待开工', tone: 'info' },
  building: { label: '建模中', tone: 'active' },
  submitted: { label: '待质检', tone: 'review' },
  rejected: { label: '已打回', tone: 'danger' },
  approved: { label: '质检通过', tone: 'success' },
  delivered: { label: '已交付', tone: 'delivered' },
};

export const PRIORITY = { urgent: '加急', high: '高', normal: '常规', low: '低' };

function seed() {
  const t0 = Date.now();
  const iso = (h) => new Date(t0 - h * 3600_000).toISOString();
  return {
    schema: 1,
    seq: 8,
    members: MEMBERS,
    orders: [
      {
        id: 'ORD-2608',
        code: 'LT-2608',
        title: '静海 3 号坑·主舱段与竖井接口',
        client: '深空栖息地总体组',
        priority: 'high',
        dueAt: iso(-72),
        createdAt: iso(60),
        createdBy: 'u-clerk',
        assignee: 'u-m2',
        status: STATUS.BUILDING,
        stage: 'layout',
        reworkCount: 1,
        qcNotes: [
          { at: iso(30), by: 'u-qc', kind: 'reject', text: 'B 区连廊与主舱法兰错位 2 格，气闸框不闭合。' },
        ],
        requirements: [
          { k: '洞段长度', v: '≥ 180 m（体素 360）' },
          { k: '主舱直径', v: '12 m，分 3 层' },
          { k: '可容纳人数', v: '24 人 · 90 天' },
          { k: '重点', v: '气闸必须与竖井对齐，舱壁留舷窗带' },
        ],
        brief:
          '按 2607 号洞体模型接主舱段。要求主舱三段串联，气闸框正对竖井中心线，观测舷窗沿熔岩管轴线布置。内壁衬里做到与舱壁不穿模。',
        grid: { sizeX: 144, sizeY: 144, sizeZ: 96, voxelSize: 0.5 },
        modelKey: null,
        history: [
          { at: iso(60), by: 'u-clerk', kind: 'create', text: '接单并录入需求' },
          { at: iso(58), by: 'u-clerk', kind: 'assign', text: '分派给 许宁' },
          { at: iso(30), by: 'u-qc', kind: 'reject', text: '质检打回（第 1 次返工）' },
        ],
      },
      {
        id: 'ORD-2607',
        code: 'LT-2607',
        title: '静海 3 号坑·熔岩管洞体开挖量',
        client: '深空栖息地总体组',
        priority: 'normal',
        dueAt: iso(-140),
        createdAt: iso(120),
        createdBy: 'u-clerk',
        assignee: 'u-m1',
        status: STATUS.SUBMITTED,
        stage: 'detail',
        reworkCount: 0,
        qcNotes: [],
        requirements: [
          { k: '洞体跨度', v: '22–26 m' },
          { k: '长度', v: '约 200 m' },
          { k: '地面', v: '需要平整出 3 段平台' },
        ],
        brief: '先出洞体毛坯，管顶保留 3 格以上覆盖层，地面按三段平台找平。不需要做内壁。',
        grid: { sizeX: 144, sizeY: 144, sizeZ: 96, voxelSize: 0.5 },
        modelKey: null,
        history: [
          { at: iso(120), by: 'u-clerk', kind: 'create', text: '接单并录入需求' },
          { at: iso(116), by: 'u-clerk', kind: 'assign', text: '分派给 陈砚' },
          { at: iso(6), by: 'u-m1', kind: 'submit', text: '提交质检' },
        ],
      },
      {
        id: 'ORD-2606',
        code: 'LT-2606',
        title: '阿里斯塔克斯坑·设备舱与散热阵列',
        client: '能源与热控分系统',
        priority: 'urgent',
        dueAt: iso(-6),
        createdAt: iso(200),
        createdBy: 'u-clerk',
        assignee: 'u-m4',
        status: STATUS.REJECTED,
        stage: 'massing',
        reworkCount: 2,
        qcNotes: [
          { at: iso(90), by: 'u-qc', kind: 'reject', text: '散热板悬空且未连桁架。' },
          { at: iso(20), by: 'u-qc', kind: 'reject', text: '返工后仍有 7 处 1 格薄壁，桁架与舱体接触面不完整。' },
        ],
        requirements: [
          { k: '设备舱', v: '18 × 9 × 6 m' },
          { k: '散热阵列', v: '外挂 6 片，单片 30 m²' },
          { k: '桁架', v: '与舱壁六点联接' },
        ],
        brief: '设备舱挂在洞体内北侧，散热板外挂并全部通过桁架落到舱体上，禁止悬空。注意桁架与舱壁的接触面要做满。',
        grid: { sizeX: 120, sizeY: 120, sizeZ: 80, voxelSize: 0.5 },
        modelKey: null,
        history: [
          { at: iso(200), by: 'u-clerk', kind: 'create', text: '接单并录入需求' },
          { at: iso(196), by: 'u-clerk', kind: 'assign', text: '分派给 何一鸣' },
          { at: iso(90), by: 'u-qc', kind: 'reject', text: '质检打回（第 1 次返工）' },
          { at: iso(20), by: 'u-qc', kind: 'reject', text: '质检打回（第 2 次返工）' },
        ],
      },
      {
        id: 'ORD-2605',
        code: 'LT-2605',
        title: '静海 3 号坑·内壁衬里与照明带',
        client: '深空栖息地总体组',
        priority: 'normal',
        dueAt: iso(-220),
        createdAt: iso(280),
        createdBy: 'u-clerk',
        assignee: 'u-m3',
        status: STATUS.APPROVED,
        stage: 'detail',
        reworkCount: 1,
        qcNotes: [
          { at: iso(180), by: 'u-qc', kind: 'reject', text: '照明带与衬里重叠，材质替换不干净。' },
          { at: iso(60), by: 'u-qc', kind: 'pass', text: '返工后通过，衬里贴合，照明带连续。' },
        ],
        requirements: [
          { k: '衬里范围', v: '洞体内壁 0–4 格' },
          { k: '照明带', v: '每 12 m 一道，连续' },
          { k: '材质', v: '密封衬里 + 钢衬板过渡' },
        ],
        brief: '把洞体内壁 4 格范围铺密封衬里，管顶每 12 m 加一道照明带，过渡段换钢衬板。',
        grid: { sizeX: 144, sizeY: 144, sizeZ: 96, voxelSize: 0.5 },
        modelKey: null,
        history: [
          { at: iso(280), by: 'u-clerk', kind: 'create', text: '接单并录入需求' },
          { at: iso(276), by: 'u-clerk', kind: 'assign', text: '分派给 罗青' },
          { at: iso(180), by: 'u-qc', kind: 'reject', text: '质检打回（第 1 次返工）' },
          { at: iso(60), by: 'u-qc', kind: 'pass', text: '质检通过' },
        ],
      },
      {
        id: 'ORD-2604',
        code: 'LT-2604',
        title: '阿里斯塔克斯坑·竖井与加压廊道',
        client: '深空栖息地总体组',
        priority: 'low',
        dueAt: iso(-300),
        createdAt: iso(380),
        createdBy: 'u-clerk',
        assignee: 'u-m2',
        status: STATUS.DELIVERED,
        stage: 'delivered',
        reworkCount: 0,
        qcNotes: [{ at: iso(120), by: 'u-qc', kind: 'pass', text: '一次通过。' }],
        requirements: [
          { k: '竖井', v: '净径 6 m，深 40 m' },
          { k: '廊道', v: '宽 4 m 双管' },
        ],
        brief: '竖井从坑底贯通到熔岩管顶，两侧接加压廊道。导出按 2 倍降采样。',
        grid: { sizeX: 96, sizeY: 96, sizeZ: 96, voxelSize: 0.5 },
        modelKey: null,
        history: [
          { at: iso(380), by: 'u-clerk', kind: 'create', text: '接单并录入需求' },
          { at: iso(370), by: 'u-clerk', kind: 'assign', text: '分派给 许宁' },
          { at: iso(120), by: 'u-qc', kind: 'pass', text: '质检通过' },
          { at: iso(100), by: 'u-admin', kind: 'deliver', text: '导出交付 obj' },
        ],
      },
      {
        id: 'ORD-2609',
        code: 'LT-2609',
        title: '开普勒坑·温室舱穹顶（新建）',
        client: '生物再生生命保障组',
        priority: 'high',
        dueAt: iso(-12),
        createdAt: iso(9),
        createdBy: 'u-clerk',
        assignee: null,
        status: STATUS.DRAFT,
        stage: 'brief',
        reworkCount: 0,
        qcNotes: [],
        requirements: [
          { k: '穹顶直径', v: '30 m' },
          { k: '覆土', v: '≥ 1.5 m 等效月壤' },
          { k: '待补', v: '光照方案、作物架布局' },
        ],
        brief: '温室舱穹顶，需要能覆盖 30 m 直径同时顶部覆土做辐射屏蔽。等待生命保障组补光照与作物架资料。',
        grid: { sizeX: 128, sizeY: 128, sizeZ: 80, voxelSize: 0.5 },
        modelKey: null,
        history: [
          { at: iso(9), by: 'u-clerk', kind: 'create', text: '接单，需求待补全' },
        ],
      },
      {
        id: 'ORD-2603',
        code: 'LT-2603',
        title: '静海 3 号坑·洞体毛坯（已交付）',
        client: '深空栖息地总体组',
        priority: 'normal',
        dueAt: iso(-420),
        createdAt: iso(500),
        createdBy: 'u-clerk',
        assignee: 'u-m1',
        status: STATUS.DELIVERED,
        stage: 'delivered',
        reworkCount: 1,
        qcNotes: [
          { at: iso(400), by: 'u-qc', kind: 'reject', text: '地面平台高差超过 2 格。' },
          { at: iso(300), by: 'u-qc', kind: 'pass', text: '通过。' },
        ],
        requirements: [
          { k: '洞体跨度', v: '22 m' },
          { k: '长度', v: '120 m' },
        ],
        brief: '早期洞体毛坯，供主舱段摆放推演。',
        grid: { sizeX: 128, sizeY: 128, sizeZ: 96, voxelSize: 0.5 },
        modelKey: null,
        history: [
          { at: iso(500), by: 'u-clerk', kind: 'create', text: '接单并录入需求' },
          { at: iso(490), by: 'u-clerk', kind: 'assign', text: '分派给 陈砚' },
          { at: iso(300), by: 'u-qc', kind: 'pass', text: '质检通过' },
          { at: iso(280), by: 'u-admin', kind: 'deliver', text: '导出交付 obj' },
        ],
      },
    ],
  };
}

export class Store {
  constructor(file) {
    this.file = file;
    this.data = null;
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      this.data = JSON.parse(raw);
      if (!this.data || !Array.isArray(this.data.orders)) throw new Error('bad shape');
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('[store] 重新生成种子数据：', err.message);
      this.data = seed();
      this.save();
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get orders() {
    return this.data.orders;
  }

  order(id) {
    return this.data.orders.find((o) => o.id === id) || null;
  }

  nextId() {
    this.data.seq = (this.data.seq || 2600) + 1;
    const id = `ORD-${this.data.seq}`;
    return id;
  }

  /** 记录一条订单动态。 */
  log(order, by, kind, text, extra = {}) {
    order.history.push({ at: now(), by, kind, text, ...extra });
  }
}

export { seed, now };
