/** 导出 SVG 文本与图层清单（JSON / 可下载） */
import type { Layer, Matrix, VecPath } from './types';
import { applyMatrix, flattenPath } from './geometry';

function matrixString(m: Matrix): string {
  return `matrix(${m.map((v) => +v.toFixed(3)).join(' ')})`;
}

function pointsAttr(pts: { x: number; y: number }[]): string {
  return pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
}

function colorWithAlpha(hex: string, opacity: number): string {
  if (opacity >= 1) return hex;
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

export function exportSVG(
  items: VecPath[],
  layers: Layer[],
  groupTx: (item: VecPath) => Matrix | null,
  size: { width: number; height: number },
): string {
  const layerMap = new Map(layers.map((l) => [l.id, l]));
  const byLayer = new Map<string, VecPath[]>();
  for (const it of items) {
    const layer = layerMap.get(it.layerId);
    if (layer && !layer.visible) continue;
    const arr = byLayer.get(it.layerId) ?? [];
    arr.push(it);
    byLayer.set(it.layerId, arr);
  }

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}">`,
  );
  parts.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);

  for (const layer of layers) {
    const arr = byLayer.get(layer.id);
    if (!arr?.length) continue;
    parts.push(
      `  <g id="layer-${layer.id}" data-name="${escapeXml(layer.name)}" opacity="${layer.visible ? 1 : 0}">`,
    );
    for (const item of arr) {
      const local = flattenPath(item);
      const m = groupTx(item);
      const pts = m ? local.map((p) => applyMatrix(m, p)) : local;
      const st = item.style;
      const common =
        `fill="${item.closed ? colorWithAlpha(st.fill, st.opacity) : 'none'}" ` +
        `stroke="${st.stroke}" stroke-width="${st.strokeWidth}" ` +
        (st.dash.length ? `stroke-dasharray="${st.dash.join(' ')}" ` : '') +
        `stroke-linejoin="round" stroke-linecap="round"`;
      const dataName = ` data-name="${escapeXml(item.name)}" data-type="${item.type}"${
        item.conflict ? ' data-conflict="true"' : ''
      }`;
      if (item.closed) {
        parts.push(
          `    <polygon${dataName} points="${pointsAttr(pts)}" ${common}${
            item.conflict ? ' stroke="#e53935" stroke-width="3"' : ''
          }/>`,
        );
      } else if (pts.length === 2) {
        parts.push(
          `    <line${dataName} x1="${pts[0].x.toFixed(2)}" y1="${pts[0].y.toFixed(2)}" x2="${pts[1].x.toFixed(2)}" y2="${pts[1].y.toFixed(2)}" ${common}/>`,
        );
      } else {
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
        parts.push(`    <path${dataName} d="${d}" ${common}/>`);
      }
    }
    parts.push(`  </g>`);
  }
  parts.push(`</svg>`);
  return parts.join('\n');
}

export interface LayerManifestEntry {
  layerId: string;
  layerName: string;
  locked: boolean;
  visible: boolean;
  items: {
    id: string;
    name: string;
    type: string;
    closed: boolean;
    vertexCount: number;
    conflict: boolean;
    stroke: string;
    fill: string;
    strokeWidth: number;
  }[];
}

export function buildLayerManifest(items: VecPath[], layers: Layer[]): LayerManifestEntry[] {
  return layers.map((layer) => ({
    layerId: layer.id,
    layerName: layer.name,
    locked: layer.locked,
    visible: layer.visible,
    items: items
      .filter((i) => i.layerId === layer.id)
      .map((i) => ({
        id: i.id,
        name: i.name,
        type: i.type,
        closed: i.closed,
        vertexCount: (i.segments.length || i.points.length),
        conflict: !!i.conflict,
        stroke: i.style.stroke,
        fill: i.style.fill,
        strokeWidth: i.style.strokeWidth,
      })),
  }));
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export { matrixString };
