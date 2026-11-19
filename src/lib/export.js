// Asset package builder. Produces a ZIP with, per released entry:
//   svg/  layered vector (shape / cells / veins / spots groups)
//   png/  raster at 2048px (whole plate) and per-wing
//   png/thumb
//   json/ full generation record: params, seed, fingerprint, overrides, QA
//   README.txt  human-readable manifest of the batch
//
// Rasterisation reuses the same scene triangles via a canvas, so the PNG
// matches the viewport exactly.

import JSZip from 'jszip';
import { specimenToSvg, wingToSvg } from './svgExport.js';
import { buildScene } from './scene.js';
import { hslCss } from './color.js';
import { ARTBOARD } from './generator.js';

function sceneToCanvas(scene, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const s = width / ARTBOARD.width;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.fillStyle = '#12140f';
  ctx.fillRect(0, 0, ARTBOARD.width, ARTBOARD.height);
  const order = ['fill', 'cells', 'band', 'veins', 'outline', 'spots', 'detail'];
  for (const key of order) {
    const layer = scene[key];
    if (!layer) continue;
    const pos = layer.positions;
    const col = layer.colors;
    let lastKey = '';
    ctx.beginPath();
    let any = false;
    for (let i = 0, ci = 0; i + 5 < pos.length; i += 6, ci += 12) {
      const a = Math.round(col[ci + 3] * 100);
      const r = Math.round(col[ci] * 255);
      const g = Math.round(col[ci + 1] * 255);
      const b = Math.round(col[ci + 2] * 255);
      const k = `${r},${g},${b},${a}`;
      if (k !== lastKey) {
        if (any) {
          ctx.fill();
          ctx.beginPath();
        }
        ctx.fillStyle = `rgba(${r},${g},${b},${(a / 100).toFixed(2)})`;
        lastKey = k;
        any = true;
      }
      ctx.moveTo(pos[i], pos[i + 1]);
      ctx.lineTo(pos[i + 2], pos[i + 3]);
      ctx.lineTo(pos[i + 4], pos[i + 5]);
      ctx.closePath();
    }
    if (any) ctx.fill();
  }
  return canvas;
}

function transparentCanvas(scene, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const s = width / ARTBOARD.width;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  const order = ['fill', 'cells', 'band', 'veins', 'outline', 'spots', 'detail'];
  for (const key of order) {
    const layer = scene[key];
    if (!layer) continue;
    const pos = layer.positions;
    const col = layer.colors;
    let lastKey = '';
    ctx.beginPath();
    let any = false;
    for (let i = 0, ci = 0; i + 5 < pos.length; i += 6, ci += 12) {
      const a = Math.round(col[ci + 3] * 100);
      const r = Math.round(col[ci] * 255);
      const g = Math.round(col[ci + 1] * 255);
      const b = Math.round(col[ci + 2] * 255);
      const k = `${r},${g},${b},${a}`;
      if (k !== lastKey) {
        if (any) {
          ctx.fill();
          ctx.beginPath();
        }
        ctx.fillStyle = `rgba(${r},${g},${b},${(a / 100).toFixed(2)})`;
        lastKey = k;
        any = true;
      }
      ctx.moveTo(pos[i], pos[i + 1]);
      ctx.lineTo(pos[i + 2], pos[i + 3]);
      ctx.lineTo(pos[i + 4], pos[i + 5]);
      ctx.closePath();
    }
    if (any) ctx.fill();
  }
  return canvas;
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

function safeName(s) {
  return String(s).replace(/[^\w一-龥.-]+/g, '_');
}

function recordFor(entry) {
  const spec = entry.specimen;
  return {
    schema: 'winglab/specimen@1',
    exportedAt: new Date().toISOString(),
    entryId: entry.id,
    species: { id: spec.speciesId, name: spec.speciesName },
    seed: spec.seed,
    variant: spec.variant,
    fingerprint: spec.fingerprint,
    params: spec.params,
    overrides: entry.overrides,
    checks: entry.checks,
    review: entry.review,
    stats: {
      cells: spec.wings.reduce((n, w) => n + w.cells.length, 0),
      spots: spec.wings.reduce((n, w) => n + w.spots.length, 0),
      wings: spec.wings.map((w) => ({ key: w.key, cells: w.cells.length, spots: w.spots.length }))
    },
    reproduction: 'Use seed + variant + params with the same generator build to reproduce this artwork exactly.'
  };
}

/**
 * @param {object} app
 * @param {object} store
 * @param {(p:number)=>void} [onProgress]
 * @returns {Promise<Blob>}
 */
export async function buildAssetPack(app, store, onProgress = () => {}) {
  // Release gate lives here, not only on the button: an asset pack must never
  // be produced while the batch still holds blocking defects, a rejected entry
  // or an unreviewed item.
  const gate = app.batchSummary();
  if (!gate.canRelease) {
    const reasons = [];
    if (gate.blocking) reasons.push(`${gate.blocking} 个阻断项`);
    if (gate.rejected) reasons.push(`${gate.rejected} 个条目被驳回`);
    if (gate.pending) reasons.push(`${gate.pending} 个条目待复核`);
    if (gate.unreviewedChecks) reasons.push(`${gate.unreviewedChecks} 条检查未确认`);
    if (!gate.total) reasons.push('批次为空');
    throw new Error('批次未通过放行条件：' + reasons.join('、'));
  }

  const zip = new JSZip();
  const summary = gate;
  const entries = store.batch.entries.filter((e) => e.review.status === 'approved');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const root = zip.folder(`winglab-${store.batch.id}-${stamp}`);

  root.file('batch.json', JSON.stringify({ batch: store.batch.id, exportedAt: new Date().toISOString(), summary, entries: entries.map((e) => e.id) }, null, 2));

  const lines = [];
  lines.push('昆虫翅纹素材包 · 翅纹工坊 (Lepidoptera Wing Lab)');
  lines.push(`批次: ${store.batch.id}`);
  lines.push(`导出时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`);
  lines.push(`条目: ${entries.length}    阻断: ${summary.blocking}    警告: ${summary.warning}`);
  lines.push('');
  lines.push('每个条目包含:');
  lines.push('  svg/     分层矢量文件(翅形 / 翅室 / 翅脉 / 斑点,画笔可直接编辑)');
  lines.push('  png/     2048px 成品图、四片单翅图、透明底图');
  lines.push('  json/    完整生成记录(参数、种子、指纹、手工改动、检查结果)');
  lines.push('');
  lines.push('复现方式:用相同参数 + 种子 + 变体重新生成即可得到完全一致的翅纹;指纹可用于校验。');
  lines.push('');
  lines.push('清单');
  lines.push('----');

  let done = 0;
  for (const entry of entries) {
    const spec = entry.specimen;
    const base = `${spec.speciesName}-${safeName(spec.seed)}-V${spec.variant + 1}`;
    const dir = root.folder(base);

    const scene = buildScene(spec, { selection: false, showSecondary: true });
    const svg = specimenToSvg(spec, { background: null });
    dir.file('svg/butterfly.svg', svg);
    // per-wing vectors keep true wing-local geometry
    for (const wing of spec.wings) {
      const groups = wingToSvg(spec, wing, { layers: ['shape', 'cells', 'veins', 'spots'], coords: 'local' });
      dir.file(`svg/wing-${wing.key}.svg`, wrapWingSvg(wing, groups));
    }

    const full = transparentCanvas(scene, 2048, Math.round((2048 * ARTBOARD.height) / ARTBOARD.width));
    const blob = await canvasToBlob(full);
    dir.file('png/butterfly-2048.png', blob);

    const thumb = transparentCanvas(scene, 512, Math.round((512 * ARTBOARD.height) / ARTBOARD.width));
    dir.file('png/thumb-512.png', await canvasToBlob(thumb));

    dir.file('json/specimen.json', JSON.stringify(recordFor(entry), null, 2));

    lines.push(`  ${base}  ·  ${spec.wings.reduce((n, w) => n + w.cells.length, 0)} 室 / ${spec.wings.reduce((n, w) => n + w.spots.length, 0)} 斑 / 指纹 ${spec.fingerprint.slice(0, 8)}`);
    done++;
    onProgress(done / Math.max(1, entries.length));
  }

  lines.push('');
  lines.push('所有内容由程序化生成,可无限复现;若需修改请回到工作台调整参数或手工改动后重新导出。');
  root.file('README.txt', lines.join('\n'));

  const out = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }, (meta) => {
    onProgress(0.5 + meta.percent / 200);
  });
  return { blob: out, name: `winglab-${store.batch.id}-${stamp}.zip`, entries: entries.length };
}

function wrapWingSvg(wing, groups) {
  // groups carry wing-local coordinates; derive the viewBox from the outline
  const scale = Math.sqrt(Math.abs(wing.transform.a * wing.transform.d - wing.transform.b * wing.transform.c));
  const pts = wing.poly.map((p) => [p[0] * scale, p[1] * scale]);
  const minX = Math.min(...pts.map((p) => p[0])) - 2;
  const minY = Math.min(...pts.map((p) => p[1])) - 2;
  const maxX = Math.max(...pts.map((p) => p[0])) + 2;
  const maxY = Math.max(...pts.map((p) => p[1])) + 2;
  const w = maxX - minX;
  const h = maxY - minY;
  const body = groups.map(([name, markup]) => `<g id="${name}">${markup}</g>`).join(String.fromCharCode(10));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX.toFixed(3)} ${minY.toFixed(3)} ${w.toFixed(3)} ${h.toFixed(3)}" width="${Math.round(w * 10)}" height="${Math.round(h * 10)}">
<desc>${wing.key} · wing-local coordinates · 1 unit = wing length</desc>
${body}
</svg>`;
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
