import type { Feature, FeatureProps, LayerId } from './types';
import { WORLD } from './layers';
import { Rng } from './lib/rng';

const OWNERS = ['发射场运行部', '地面设备站', '测控通信站', '安全环保处', '工程建设部'];
const STATUSES = ['已建成', '施工中', '待验收', '规划中'];
const SPECS: Record<LayerId, string[]> = {
  tower: ['固定勤务塔 87m', '脐带塔 72m', '避雷塔架 65m', '多功能发射塔'],
  diversion: ['双面导流槽 120m³/s', '单面导流槽 90m³/s', '埋入式导流槽'],
  fueling: ['常温加注区', '低温加注区', '煤油加注区', '气库区'],
  lightning: ['独立避雷针 25m', '构架避雷针 30m', '线网避雷塔 40m'],
  cordon: ['一级警戒线', '二级警戒线', '防爆警戒线'],
  firelane: ['主消防通道 6m', '环形消防车道', '应急疏散通道'],
  camera: ['光电跟踪经纬仪', '高速球机 4K', '红外热像仪', '固定监控枪机'],
};

let seq = 0;
function makeProps(layer: LayerId, rng: Rng, prefix: string, idx: number): FeatureProps {
  const spec = SPECS[layer];
  return {
    name: `${prefix}-${String(idx).padStart(4, '0')}`,
    code: `${layer.toUpperCase().slice(0, 3)}${String(idx).padStart(5, '0')}`,
    spec: rng.pick(spec),
    status: rng.pick(STATUSES),
    owner: rng.pick(OWNERS),
    updatedAt: `2026-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`,
  };
}

/** 在发射场若干工位中心周围做簇状布点，模拟真实场区分布 */
function siteCenters(): [number, number][] {
  return [
    [700, 800],
    [2100, 700],
    [3300, 1100],
    [1200, 2100],
    [2800, 2300],
  ];
}

function clusterPoint(rng: Rng, spread: number): [number, number] {
  const [cx, cy] = rng.pick(siteCenters());
  const angle = rng.range(0, Math.PI * 2);
  const r = rng.next() ** 0.5 * spread;
  return [
    Math.min(WORLD.width - 20, Math.max(20, cx + Math.cos(angle) * r)),
    Math.min(WORLD.height - 20, Math.max(20, cy + Math.sin(angle) * r)),
  ];
}

function ringAround(cx: number, cy: number, rw: number, rh: number, rng: Rng): [number, number][] {
  // 不规则四边形/五边形面
  const n = rng.int(4, 6);
  const ring: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.15, 0.15);
    const kx = rng.range(0.75, 1.15);
    const ky = rng.range(0.75, 1.15);
    ring.push([cx + Math.cos(a) * rw * kx, cy + Math.sin(a) * rh * ky]);
  }
  return ring;
}

/**
 * 生成全量模拟数据：合计约 3 万个要素。
 * @param seed 数据种子，不同种子产出不同版本
 */
export function generateFeatures(seed: number): Feature[] {
  const rng = new Rng(seed);
  seq = 0;
  const out: Feature[] = [];
  const push = (f: Feature) => out.push(f);

  const counts: Record<LayerId, number> = {
    camera: 18000,
    lightning: 6000,
    firelane: 3200,
    cordon: 2400,
    tower: 420,
    diversion: 220,
    fueling: 160,
  };

  // ---- 点要素：摄像点位 / 避雷塔 / 塔架 ----
  const pointLayers: LayerId[] = ['camera', 'lightning', 'tower'];
  for (const layer of pointLayers) {
    for (let i = 0; i < counts[layer]; i++) {
      const [x, y] = clusterPoint(rng, layer === 'camera' ? 1500 : 900);
      push({
        id: `${layer}-${seq++}`,
        layerId: layer,
        geom: { kind: 'point', x, y },
        props: makeProps(layer, rng, layer === 'camera' ? 'CAM' : layer === 'lightning' ? 'LGT' : 'TWR', i),
      });
    }
  }

  // ---- 线要素：消防通道（沿路网格）/ 警戒线（绕工位环） ----
  for (let i = 0; i < counts.firelane; i++) {
    const [x, y] = clusterPoint(rng, 1200);
    const horizontal = rng.next() > 0.5;
    const len = rng.range(80, 420);
    const segs = rng.int(3, 7);
    const coords: [number, number][] = [];
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const jitter = rng.range(-18, 18);
      coords.push([
        Math.min(WORLD.width - 10, Math.max(10, horizontal ? x + len * t : x + jitter)),
        Math.min(WORLD.height - 10, Math.max(10, horizontal ? y + jitter : y + len * t)),
      ]);
    }
    push({
      id: `firelane-${seq++}`,
      layerId: 'firelane',
      geom: { kind: 'line', coords },
      props: makeProps('firelane', rng, 'FL', i),
    });
  }

  for (let i = 0; i < counts.cordon; i++) {
    const [cx, cy] = clusterPoint(rng, 700);
    const radius = rng.range(30, 160);
    const n = rng.int(5, 9);
    const coords: [number, number][] = [];
    for (let s = 0; s <= n; s++) {
      const a = (s / n) * Math.PI * 2;
      const r = radius * rng.range(0.85, 1.15);
      coords.push([
        Math.min(WORLD.width - 10, Math.max(10, cx + Math.cos(a) * r)),
        Math.min(WORLD.height - 10, Math.max(10, cy + Math.sin(a) * r)),
      ]);
    }
    push({
      id: `cordon-${seq++}`,
      layerId: 'cordon',
      geom: { kind: 'line', coords },
      props: makeProps('cordon', rng, 'CD', i),
    });
  }

  // ---- 面要素：导流槽 / 加注区 ----
  for (let i = 0; i < counts.diversion; i++) {
    const [cx, cy] = clusterPoint(rng, 800);
    push({
      id: `diversion-${seq++}`,
      layerId: 'diversion',
      geom: { kind: 'polygon', ring: ringAround(cx, cy, rng.range(25, 70), rng.range(12, 30), rng) },
      props: makeProps('diversion', rng, 'DV', i),
    });
  }
  for (let i = 0; i < counts.fueling; i++) {
    const [cx, cy] = clusterPoint(rng, 1000);
    push({
      id: `fueling-${seq++}`,
      layerId: 'fueling',
      geom: { kind: 'polygon', ring: ringAround(cx, cy, rng.range(40, 110), rng.range(30, 80), rng) },
      props: makeProps('fueling', rng, 'FU', i),
    });
  }

  return out;
}

/** 深拷贝：数据均为纯 JSON 结构，且需兼容 Solid store 代理（structuredClone 无法克隆代理） */
function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * 在某版本基础上派生新版本：新增/删除/修改一批要素，
 * 供并排对比的绿/红/黄差异使用。返回新数组与变更清单。
 */
export function deriveVersion(base: Feature[], seed: number): {
  features: Feature[];
  added: string[];
  removed: string[];
  modified: string[];
} {
  const rng = new Rng(seed);
  const next = base.map((f) => deepClone(f));
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  // 删除 120 个
  for (let i = 0; i < 120; i++) {
    const idx = rng.int(0, next.length);
    const [f] = next.splice(idx, 1);
    if (f) removed.push(f.id);
  }

  // 修改 180 个（几何位移 + 属性状态变化）
  for (let i = 0; i < 180; i++) {
    const f = rng.pick(next);
    modified.push(f.id);
    if (f.geom.kind === 'point') {
      f.geom.x += rng.range(-60, 60);
      f.geom.y += rng.range(-60, 60);
    } else if (f.geom.kind === 'line') {
      f.geom.coords = f.geom.coords.map(([x, y]) => [x + rng.range(-25, 25), y + rng.range(-25, 25)]);
    } else {
      f.geom.ring = f.geom.ring.map(([x, y]) => [x + rng.range(-20, 20), y + rng.range(-20, 20)]);
    }
    f.props = { ...f.props, status: rng.pick(STATUSES), updatedAt: '2026-11-18' };
  }

  // 新增 150 个（复用生成器后截取，保证 id 不与存量冲突）
  const fresh = generateFeatures(seed ^ 0x9e3779b9);
  for (let i = 0; i < 150; i++) {
    const template = fresh[rng.int(0, fresh.length)]!;
    const nf: Feature = deepClone(template);
    nf.id = `${nf.layerId}-new-${seed}-${i}`;
    nf.props = { ...nf.props, name: `${nf.props.name}(新增)`, status: '规划中', updatedAt: '2026-11-19' };
    next.push(nf);
    added.push(nf.id);
  }

  return { features: next, added, removed, modified };
}
