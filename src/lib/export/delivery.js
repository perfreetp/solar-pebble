// Build the delivery package for one order: manifest + per-shot JSON + previews.
import JSZip from 'jszip';
import { generateNest, normalizeParams } from '../nest/generate.js';
import { encodeReproCode } from '../nest/seed.js';

const SOIL_LABEL = { dry: '干土', damp: '湿土', gravel: '砂砾' };
const CAM_LABEL = { persp: '透视', top: '俯视', front: '剖切正视' };

function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const mime = /data:(.*?);/.exec(head)?.[1] || 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function buildOrderManifest(order, project, stats = {}) {
  const shots = order.shots.map((sh, i) => {
    const scene = sh.scene || null;
    const params = normalizeParams(scene?.params || sh.params || {});
    const seed = scene?.seed || sh.seed;
    const locks = scene?.locks || sh.locks || {};
    const repro = (() => {
      try {
        return encodeReproCode({ seed, params });
      } catch (e) {
        return null;
      }
    })();
    return {
      no: i + 1,
      id: sh.id,
      label: sh.label,
      note: sh.note,
      camera: scene?.camera?.label || CAM_LABEL[sh.camera] || '透视',
      status: sh.status,
      reworkCount: sh.reworkCount || 0,
      deadline: sh.deadline,
      seed,
      reproCode: repro,
      params,
      locks: Object.keys(locks),
      lockDetail: locks,
      soil: SOIL_LABEL[scene?.soil] || '干土',
      soilKey: scene?.soil || 'dry',
      cutaway: scene?.cut ? { enabled: !!scene.cut.enabled, depth: scene.cut.depth } : { enabled: false, depth: 0 },
      cameraState: scene?.camera?.state || null,
      hasPreview: !!sh.preview,
      previewFile: sh.preview ? `previews/${sh.id}.jpg` : null,
      timeline: (sh.history || []).map((h) => ({ at: h.at, action: h.action, by: h.by, text: h.text, seed: h.seed, tunnelIds: h.tunnelIds }))
    };
  });
  return {
    manifestVersion: 1,
    generator: '蚁筑 NESTWORKS · 地下蚁巢过程式场景平台',
    order: { id: order.id, title: order.title, projectId: order.projectId },
    project: project ? { id: project.id, name: project.name, client: project.client, episodes: project.episodes, brief: project.brief } : null,
    deliveredAt: new Date().toISOString(),
    summary: {
      shots: shots.length,
      reworkTotal: shots.reduce((n, s) => n + s.reworkCount, 0),
      seedReuse: [...new Set(shots.map((s) => s.seed))].length,
      ...stats
    },
    reproducibility: '每个镜头带 seed 与完整参数；用同一 seed + 同一组参数在平台内生成即为完全一致的结果。reproCode 可直接发给同事粘贴还原。',
    shots
  };
}

// Validate the generator can reproduce every delivered shot from its recorded data.
export function verifyShot(sh) {
  const scene = sh.scene || {};
  const params = normalizeParams(scene.params || sh.params || {});
  const seed = scene.seed || sh.seed;
  try {
    const a = generateNest(params, seed, scene.locks || sh.locks || {});
    const b = generateNest(params, seed, scene.locks || sh.locks || {});
    return { id: sh.id, ok: JSON.stringify(a) === JSON.stringify(b), tunnels: a.tunnels.length, chambers: a.chambers.length };
  } catch (e) {
    return { id: sh.id, ok: false, error: String(e?.message || e) };
  }
}

export async function buildOrderZip(order, project) {
  const zip = new JSZip();
  const checks = order.shots.map(verifyShot);
  const manifest = buildOrderManifest(order, project, {
    reproducible: checks.every((c) => c.ok)
  });

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file(
    'README.md',
    [
      `# ${project?.name || ''} · ${order.title}`,
      '',
      `订单：${order.id}`,
      `客户：${project?.client || ''}`,
      `交付时间：${manifest.deliveredAt}`,
      '',
      '## 内容',
      '',
      '- `manifest.json`：机器可读的完整交付清单，含每镜头的种子、参数、锁定甬道与时间线。',
      '- `shots/`：每个镜头一份镜头卡 JSON。',
      '- `previews/`：每个镜头的渲染预览图。',
      '',
      '## 复现',
      '',
      '同一随机种子 + 同一组参数，在平台内“场景制作”中生成，结果与交付版本完全一致。',
      '每个镜头的 `reproCode` 复制给同事粘贴即可还原参数与种子。',
      '',
      checks.map((c) => `- ${c.id}: ${c.ok ? `可复现（${c.tunnels} 甬道 / ${c.chambers} 分室）` : `复现校验失败 ${c.error || ''}`}`).join('\n')
    ].join('\n')
  );

  for (const [i, sh] of order.shots.entries()) {
    const s = manifest.shots[i];
    zip.file(`shots/${sh.id}.json`, JSON.stringify(s, null, 2));
    if (sh.preview) {
      const blob = dataUrlToBlob(sh.preview);
      zip.file(`previews/${sh.id}.jpg`, blob);
    }
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { blob, manifest, checks };
}
