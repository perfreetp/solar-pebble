import type { BOMData, SceneData, TopViewData } from '../../shared/types';
import { CATEGORY_LABEL } from '../../shared/types';

function csvEscape(v: string | number): string {
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Build a Chinese BOM CSV (Excel-friendly with BOM). */
export function bomToCSV(bom: BOMData, meta: { project: string; version: string }): string {
  const lines: string[] = [];
  lines.push(csvEscape(`项目,${meta.project}`));
  lines.push(csvEscape(`版本,${meta.version}`));
  lines.push(csvEscape(`生成时间,${new Date().toLocaleString('zh-CN')}`));
  lines.push('');
  lines.push(['序号', '零件号', '名称', '规格', '类别', '材质', '数量', '单重(kg)', '小计重量(kg)', '单件体积(m³)', '小计体积(m³)'].map(csvEscape).join(','));
  bom.rows.forEach((r, i) => {
    lines.push([
      i + 1,
      r.partNo,
      r.name,
      r.spec,
      CATEGORY_LABEL[r.category],
      r.material,
      r.qty,
      r.unitWeight.toFixed(3),
      r.totalWeight.toFixed(3),
      r.unitVolume.toFixed(5),
      r.totalVolume.toFixed(5),
    ].map(csvEscape).join(','));
  });
  lines.push('');
  lines.push(['合计', '', `${bom.totalTypes} 种`, '', '', '', bom.totalParts, '', bom.totalWeight.toFixed(3), '', bom.totalVolume.toFixed(5)].map(csvEscape).join(','));
  lines.push('');
  lines.push('分类小计,类别,件数,重量(kg)');
  for (const c of bom.byCategory) lines.push(['', c.label, c.qty, c.weight.toFixed(3)].map(csvEscape).join(','));
  return '﻿' + lines.join('\r\n');
}

/** Export a plain-text top-view layout summary (dimension + aisle report). */
export function topviewToText(top: TopViewData, meta: { project: string; version: string }): string {
  const narrow = top.aisles.filter((a) => a.narrow);
  const lines = [
    `俯视布置图 · ${meta.project}  ${meta.version}`,
    `生成时间 ${new Date().toLocaleString('zh-CN')}`,
    `外廓尺寸 ${Math.round(top.maxX - top.minX)} × ${Math.round(top.maxY - top.minY)} mm`,
    `图元数 ${top.rects.length}`,
    '',
    '通道校核：',
    ...top.aisles.map((a) => `  ${a.dir === 'v' ? '纵向' : '横向'}通道  ${Math.round(a.width)} mm  ${a.narrow ? '⚠ 不达标' : '✓'}`),
    '',
    narrow.length ? `存在 ${narrow.length} 处通道宽度不足，建议重排装箱区。` : '全部通道满足 ≥800mm 要求。',
  ];
  return lines.join('\n');
}

export function downloadText(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function sceneStats(scene: SceneData) {
  return { count: scene.entities.length };
}
