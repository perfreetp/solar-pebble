import type { Level, Network, NetworkParams } from './types';
import { LEVEL_LABEL } from '../render/palette';

/** 区域名 → 编号里的两位代号 (与档案编号规则一致) */
export const REGION_CODES: Record<string, string> = {
  江苏中部岸段: 'JS-C',
  江苏北部岸段: 'JS-N',
  江苏南部岸段: 'JS-S',
  盐城: 'YC',
  南通: 'NT',
  连云港: 'LYG',
  上海: 'SH',
  浙江: 'ZJ',
  福建: 'FJ',
  山东: 'SD',
  广东: 'GD',
  广西: 'GX',
  海南: 'HN',
  河北: 'HE',
  天津: 'TJ',
  辽宁: 'LN',
};

export function regionCode(region: string): string {
  const known = REGION_CODES[region];
  if (known) return known;
  const ascii = region.match(/[A-Za-z]{2,}/);
  if (ascii) return ascii[0].toUpperCase().slice(0, 3);
  const h = [...region].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 7);
  return `R${(h % 97).toString(36).toUpperCase().padStart(2, '0')}`;
}

export interface SurveyMeta {
  code: string;
  name: string;
  region: string;
  surveyor: string;
  observedAt: string;
  notes?: string;
  basemap?: string | null;
}

const LEVELS: Level[] = [1, 2, 3];

function fmt(v: number, digits = 2): string {
  if (!isFinite(v)) return '—';
  return v.toFixed(digits);
}

function fmtLen(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${m.toFixed(0)} m`;
}

/** 生成"调查说明"纯文本 (可直接打印 / 粘贴入报告) */
export function buildSurveyReport(network: Network, meta: SurveyMeta): string {
  const p = network.params;
  const s = network.stats;
  const lines: string[] = [];
  const rule = '='.repeat(64);

  lines.push(rule);
  lines.push('潮沟网络调查说明');
  lines.push(rule);
  lines.push('');
  lines.push('一、档案信息');
  lines.push(`  档案编号      ${meta.code}`);
  lines.push(`  成果名称      ${meta.name}`);
  lines.push(`  调查区域      ${meta.region}`);
  lines.push(`  调查单位      ${meta.surveyor}`);
  lines.push(`  观测日期      ${meta.observedAt}`);
  if (meta.basemap) lines.push(`  航拍底图      ${meta.basemap}`);
  lines.push(`  参数指纹      ${network.fingerprint}`);
  lines.push('');
  lines.push('二、生成参数');
  lines.push(`  主沟走向      ${fmt(p.heading, 1)}° (自正北顺时针)`);
  lines.push(`  分叉角度      ${fmt(p.branchAngle, 1)}°`);
  lines.push(`  支沟密度      ${(p.density * 100).toFixed(0)}%`);
  lines.push(`  曲流幅度      ${(p.meander * 100).toFixed(0)}%`);
  lines.push(`  随机种子      ${p.seed}`);
  lines.push(`  沟头终止高程  ${fmt(p.headLevel, 2)} m`);
  lines.push(`  滩面比降      ${fmt(p.slope * 1000, 3)}‰`);
  lines.push(`  口门基准高程  ${fmt(p.datum, 2)} m`);
  if (p.levelTuning) {
    for (const l of LEVELS) {
      const t = p.levelTuning[l];
      if (!t) continue;
      lines.push(
        `  ${LEVEL_LABEL[l]}参数   宽度衰减 ${(t.widthDecay * 100).toFixed(0)}%/100m · 曲流系数 ${fmt(t.meanderScale, 2)}`,
      );
    }
  }
  lines.push('');
  lines.push('三、网络结构');
  lines.push('  级别        条数      总长          平均口宽      平均长度');
  for (const l of LEVELS) {
    const n = s.counts[l];
    const total = s.lengths[l];
    const meanLen = n ? total / n : 0;
    lines.push(
      `  ${LEVEL_LABEL[l]}${' '.repeat(Math.max(0, 8 - LEVEL_LABEL[l].length))}${String(n).padStart(6)}    ${fmtLen(total).padStart(10)}    ${fmt(s.meanWidths[l], 1).padStart(8)} m    ${fmtLen(meanLen).padStart(9)}`,
    );
  }
  lines.push(`  合计         ${String(s.counts[1] + s.counts[2] + s.counts[3]).padStart(6)}    ${fmtLen(s.totalLength).padStart(10)}`);
  lines.push('');
  lines.push(`  汇流节点      ${s.junctionCount} 处`);
  lines.push(`  统计面积      ${fmt(s.areaKm2, 3)} km²`);
  lines.push(`  沟道密度      ${fmt(s.densityKmPerKm2, 2)} km/km²`);
  lines.push(`  平均曲折度    ${fmt(s.meanSinuosity, 3)}`);
  lines.push(`  沟头高程范围  ${fmt(s.headMin, 2)} ~ ${fmt(s.headMax, 2)} m (终止高程 ${fmt(p.headLevel, 2)} m)`);
  lines.push(
    `  平面范围      X ${fmt(s.bounds.minX, 0)} ~ ${fmt(s.bounds.maxX, 0)} m, Y ${fmt(s.bounds.minY, 0)} ~ ${fmt(s.bounds.maxY, 0)} m`,
  );
  lines.push('');
  lines.push('四、分级统计 (按沟长 / 局部密度 / 沟头高程, 各 5 级)');
  const cls = network.classes;
  lines.push(`  沟长分级      ${[cls.length.min, ...cls.length.breaks, cls.length.max].map((v) => fmt(v, 0)).join(' | ')} m`);
  lines.push(`  密度分级      ${[cls.density.min, ...cls.density.breaks, cls.density.max].map((v) => fmt(v, 4)).join(' | ')}`);
  lines.push(`  高程分级      ${[cls.elevation.min, ...cls.elevation.breaks, cls.elevation.max].map((v) => fmt(v, 2)).join(' | ')} m`);
  lines.push('');
  lines.push('五、野外校核要点');
  const tips: string[] = [];
  tips.push(`沿主沟走向 ${fmt(p.heading, 0)}° 设 3~5 条垂直断面, 校核主干沟宽与沟深。`);
  tips.push(`在支沟汇入主干的节点处选取 ${Math.min(4, Math.max(1, s.counts[2]))} 处, 量测交汇口宽度与圆角过渡范围。`);
  if (s.counts[3] > 0) tips.push(`毛细沟发育区选择 ${Math.min(3, s.counts[3])} 处样方 (1 m × 1 m), 核对沟头位置与终止高程。`);
  tips.push(`沟头高程接近 ${fmt(p.headLevel, 2)} m 的位置需与实测滩面高程比对, 偏差超过 0.1 m 时应调整终止高程参数。`);
  tips.push(`曲流幅度较大的段落 (曲流参数 ${(p.meander * 100).toFixed(0)}%) 需注意岸壁坍塌, 记录凹岸位置。`);
  for (const t of tips) lines.push(`  · ${t}`);
  lines.push('');
  if (meta.notes) {
    lines.push('六、备注');
    lines.push(...meta.notes.split(/\r?\n/).map((l) => `  ${l}`));
    lines.push('');
  }
  lines.push(rule);
  lines.push(`本说明由潮沟网络工作台自动生成 · 指纹 ${network.fingerprint}`);
  lines.push(`同一组参数与同一种子必须复现完全一致的结果; 若指纹不同请检查参数与种子。`);
  lines.push(rule);
  return lines.join('\n');
}

/** 参数摘要 (用于版本卡片) */
export function summarizeParams(p: NetworkParams): string {
  return `走向 ${p.heading.toFixed(0)}° · 分叉 ${p.branchAngle.toFixed(0)}° · 密度 ${(p.density * 100).toFixed(0)}% · 曲流 ${(p.meander * 100).toFixed(0)}%`;
}

/** 导出 CSV (供 GIS 导入) */
export function buildCreekCsv(network: Network): string {
  const rows: string[] = [
    'creek_id,level,parent_id,parent_u,length_m,mouth_width_m,head_width_m,sinuosity,head_elevation_m,points',
  ];
  for (const c of network.creeks) {
    rows.push(
      [
        c.id,
        c.level,
        c.parentId ?? '',
        c.parentU.toFixed(4),
        c.length.toFixed(2),
        c.mouthWidth.toFixed(2),
        c.headWidth.toFixed(2),
        c.sinuosity.toFixed(4),
        c.headElevation.toFixed(3),
        c.pts.length / 2,
      ].join(','),
    );
  }
  return rows.join('\n');
}

/** 导出 GeoJSON (中心线, 带宽度属性) */
export function buildCreekGeoJson(network: Network): string {
  const features = network.creeks.map((c) => {
    const coords: number[][] = [];
    for (let i = 0; i < c.pts.length / 2; i++) coords.push([c.pts[i * 2], c.pts[i * 2 + 1]]);
    return {
      type: 'Feature',
      properties: {
        id: c.id,
        level: c.level,
        parent: c.parentId,
        length_m: +c.length.toFixed(2),
        mouth_width_m: +c.mouthWidth.toFixed(2),
        head_elevation_m: +c.headElevation.toFixed(3),
        sinuosity: +c.sinuosity.toFixed(4),
      },
      geometry: { type: 'LineString', coordinates: coords },
    };
  });
  return JSON.stringify(
    {
      type: 'FeatureCollection',
      name: 'tidal-creek-network',
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::0' } },
      properties: { fingerprint: network.fingerprint, params: network.params },
      features,
    },
    null,
    1,
  );
}
