import type { ExportPreset, PathData } from '../types';
import { DOC_H, DOC_W } from '../types';
import { flattenPath } from './geometry';

/** 把贝塞尔路径转为 SVG path 的 d 属性(保留三次贝塞尔 C 命令) */
function pathToD(p: PathData): string {
  if (!p.nodes.length) return '';
  const n = p.nodes.length;
  const cmds: string[] = [`M ${fmt(p.nodes[0].x)} ${fmt(p.nodes[0].y)}`];
  const segs = p.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const cur = p.nodes[i];
    const next = p.nodes[(i + 1) % n];
    const hOut = p.handlesOut[i];
    const hIn = p.handlesIn[(i + 1) % n];
    if (hOut || hIn) {
      const p1 = hOut ? { x: cur.x + hOut.x, y: cur.y + hOut.y } : cur;
      const p2 = hIn ? { x: next.x + hIn.x, y: next.y + hIn.y } : next;
      cmds.push(`C ${fmt(p1.x)} ${fmt(p1.y)} ${fmt(p2.x)} ${fmt(p2.y)} ${fmt(next.x)} ${fmt(next.y)}`);
    } else {
      cmds.push(`L ${fmt(next.x)} ${fmt(next.y)}`);
    }
  }
  // 镂空环(展平多边形)用子路径附加,fill-rule="evenodd" 自动挖空
  p.holes.forEach(ring => {
    if (!ring.length) return;
    cmds.push(`M ${fmt(ring[0].x)} ${fmt(ring[0].y)}`);
    ring.slice(1).forEach(q => cmds.push(`L ${fmt(q.x)} ${fmt(q.y)}`));
    cmds.push('Z');
  });
  if (p.closed) cmds.push('Z');
  return cmds.join(' ');
}

const fmt = (v: number) => Math.round(v * 100) / 100;

function xmlEscape(s: string) {
  return s.replace(/[<>&'"]/g, ch => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  }[ch] as string));
}

/** 导出分层 SVG:底图层 / 斑纹层 / 翅脉层(可按预设拆分每个路径一层) */
export function exportLayeredSVG(
  paths: PathData[],
  preset: ExportPreset,
  meta: { specimenCode: string; species: string },
  bgDataUrl?: string,
): string {
  const visible = paths.filter(p => p.visible);
  const veins = visible.filter(p => p.kind === 'vein');
  const patterns = visible.filter(p => p.kind === 'pattern');
  const lines: string[] = [];

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${DOC_W}" height="${DOC_H}" viewBox="0 0 ${DOC_W} ${DOC_H}">`);
  lines.push(`  <title>${xmlEscape(meta.species)} · ${xmlEscape(meta.specimenCode)}</title>`);
  lines.push(`  <desc>昆虫图鉴翅脉矢量图 · 由翅脉描图台导出 · ${new Date().toISOString()}</desc>`);

  // 底图层
  if (preset.includeBg && bgDataUrl) {
    lines.push(`  <g id="layer-background" inkscape:groupmode="layer" inkscape:label="标本底图">`);
    lines.push(`    <image x="0" y="0" width="${DOC_W}" height="${DOC_H}" href="${bgDataUrl}" opacity="${preset.patternOpacity}"/>`);
    lines.push(`  </g>`);
  }

  // 斑纹层
  if (patterns.length) {
    lines.push(`  <g id="layer-pattern" inkscape:groupmode="layer" inkscape:label="斑纹">`);
    patterns.forEach(p => {
      const d = pathToD(p);
      if (preset.splitLayers) {
        lines.push(`    <g id="path-${xmlEscape(p.id)}" inkscape:groupmode="layer" inkscape:label="${xmlEscape(p.name)}">`);
      }
      lines.push(`      <path d="${d}" fill="${preset.patternFill}" fill-opacity="${preset.patternOpacity}" fill-rule="evenodd" stroke="${preset.patternFill}" stroke-width="${preset.strokeWidth}" stroke-linejoin="round"/>`);
      if (preset.splitLayers) lines.push(`    </g>`);
    });
    lines.push(`  </g>`);
  }

  // 翅脉层
  if (veins.length) {
    lines.push(`  <g id="layer-vein" inkscape:groupmode="layer" inkscape:label="翅脉">`);
    veins.forEach(p => {
      const d = pathToD(p);
      if (preset.splitLayers) {
        lines.push(`    <g id="path-${xmlEscape(p.id)}" inkscape:groupmode="layer" inkscape:label="${xmlEscape(p.name)}">`);
      }
      lines.push(`      <path d="${d}" fill="none" stroke="${preset.veinColor}" stroke-width="${preset.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`);
      if (preset.splitLayers) lines.push(`    </g>`);
    });
    lines.push(`  </g>`);
  }

  lines.push(`</svg>`);
  return lines.join('\n');
}

/** 展平版 SVG(布尔结果路径没有贝塞尔柄时用折线也完全等价) */
export function exportFlatSVG(paths: PathData[], preset: ExportPreset, meta: { specimenCode: string; species: string }): string {
  const flat = paths.map(p => ({ ...p, nodes: flattenPath(p, 12), handlesIn: p.nodes.map(() => null), handlesOut: p.nodes.map(() => null) }));
  return exportLayeredSVG(flat, preset, meta);
}

export function downloadSVG(svg: string, filename: string) {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
