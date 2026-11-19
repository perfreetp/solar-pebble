import type { CheckIssue, IssueLevel, LayerId, MaterialItem } from '../types';

let issueSeq = 0;
function makeIssue(level: IssueLevel, rule: string, message: string): CheckIssue {
  issueSeq += 1;
  return {
    id: `iss_${Date.now().toString(36)}_${issueSeq}`,
    level,
    rule,
    message,
    status: 'open',
  };
}

/** 场馆放行白名单:纹理/模型/数据/文档 */
const ALLOWED_EXT = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'ktx2',
  'glb',
  'gltf',
  'obj',
  'fbx',
  'tif',
  'tiff',
  'csv',
  'json',
  'pdf',
]);

const TEXTURE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'ktx2', 'tif', 'tiff']);
const MODEL_EXT = new Set(['glb', 'gltf', 'obj', 'fbx']);
const DATA_EXT = new Set(['csv', 'json']);

const LAYER_BY_KEYWORD: Array<[RegExp, LayerId]> = [
  [/(topsoil|表土|土壤|soil)/i, 'topsoil'],
  [/(ejecta|溅射|抛射|spatter)/i, 'ejecta'],
  [/(bedrock|基岩|rock)/i, 'bedrock'],
];

/** 模拟校验和(演示环境无文件内容时用名称+大小派生) */
export function pseudoChecksum(name: string, size: number): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  const s = `${name}:${size}`;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  return `sha256:${hex}`;
}

export interface IncomingFile {
  name: string;
  sizeKb: number;
}

/** 对单个素材跑全部规则,返回问题清单(严重 / 提示两级) */
export function checkMaterialFile(
  file: IncomingFile,
  batchIndex: number,
  allFiles: IncomingFile[],
): Omit<MaterialItem, 'id' | 'status'> {
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  const issues: CheckIssue[] = [];
  const declaredLayer = inferLayer(file.name);

  // 规则 1:格式白名单(严重)
  if (!ALLOWED_EXT.has(ext)) {
    issues.push(
      makeIssue('severe', 'FORMAT', `不支持的文件格式 .${ext || '未知'},不在展馆素材白名单内`),
    );
  }

  // 规则 2:文件大小(严重:空文件;提示:超大文件)
  if (file.sizeKb <= 0) {
    issues.push(makeIssue('severe', 'EMPTY', '文件大小为 0,疑似损坏或上传中断'));
  } else if (TEXTURE_EXT.has(ext) && file.sizeKb > 20 * 1024) {
    issues.push(
      makeIssue('notice', 'TEXTURE_SIZE', `纹理体积 ${(file.sizeKb / 1024).toFixed(1)}MB 超出 20MB 建议值,考虑压缩为 KTX2`),
    );
  } else if (MODEL_EXT.has(ext) && file.sizeKb > 80 * 1024) {
    issues.push(
      makeIssue('notice', 'MODEL_SIZE', `模型体积 ${(file.sizeKb / 1024).toFixed(1)}MB 超出 80MB 建议值`),
    );
  }

  // 规则 3:命名规范(提示):层前缀_用途_序号
  if (!/^[A-Za-z一-龥]+_[A-Za-z0-9一-龥]+(_[0-9]+)?\.[A-Za-z0-9]+$/.test(file.name)) {
    issues.push(
      makeIssue('notice', 'NAMING', '文件名未遵循「层_用途_序号」规范,建议供应方重命名后重新提交'),
    );
  }

  // 规则 4:纹理分辨率约定(提示:名称应含分辨率标记)
  if (TEXTURE_EXT.has(ext) && !/(_\d+k|_\d{3,4}p|_\d{3,4}x\d{3,4})/i.test(file.name)) {
    issues.push(makeIssue('notice', 'RES_MARK', '纹理文件名缺少分辨率标记(如 _2k / _4096p)'));
  }

  // 规则 5:重复校验和(严重:同批次内重复文件)
  const checksum = pseudoChecksum(file.name, file.sizeKb);
  const dup = allFiles.some(
    (f, i) => i < batchIndex && pseudoChecksum(f.name, f.sizeKb) === checksum,
  );
  if (dup) {
    issues.push(makeIssue('severe', 'CHECKSUM_DUP', `校验和 ${checksum.slice(0, 18)}… 与批次内另一素材重复`));
  }

  // 规则 6:模型必须带配套贴图(提示:同批次无任何同名纹理)
  if (MODEL_EXT.has(ext)) {
    const stem = file.name.slice(0, dot);
    const hasTextureCompanion = allFiles.some(
      (f) => TEXTURE_EXT.has(f.name.split('.').pop()!.toLowerCase()) && f.name.startsWith(stem.split('_')[0]),
    );
    if (!hasTextureCompanion) {
      issues.push(makeIssue('notice', 'MISSING_TEXTURE', '模型未在同批次找到配套纹理文件,展陈渲染可能缺材质'));
    }
  }

  // 规则 7:数据文件编码/字段约定(提示)
  if (DATA_EXT.has(ext) && !/utf|csv|json|meta|data/i.test(file.name)) {
    issues.push(makeIssue('notice', 'DATA_SCHEMA', '数据文件命名未标注数据类型,复核时需人工确认字段字典'));
  }

  // 规则 8:层归属无法识别(严重:影响体素素材挂层)
  if (declaredLayer === 'unspecified' && (TEXTURE_EXT.has(ext) || MODEL_EXT.has(ext))) {
    issues.push(
      makeIssue('severe', 'LAYER_MAPPING', '无法从文件名识别表土/溅射层/基岩归属,素材无法挂接到编辑层'),
    );
  }

  return {
    name: file.name,
    ext: ext || 'none',
    sizeKb: Math.round(file.sizeKb),
    declaredLayer,
    checksum,
    issues,
  };
}

function inferLayer(name: string): LayerId | 'unspecified' {
  for (const [re, layer] of LAYER_BY_KEYWORD) {
    if (re.test(name)) return layer;
  }
  return 'unspecified';
}

export function summarizeIssues(items: MaterialItem[]): { severe: number; notice: number; open: number } {
  let severe = 0;
  let notice = 0;
  let open = 0;
  for (const item of items) {
    for (const iss of item.issues) {
      if (iss.level === 'severe') severe++;
      else notice++;
      if (iss.status === 'open') open++;
    }
  }
  return { severe, notice, open };
}

/** 整批是否达标:无未驳回严重项,且所有问题都已复核 */
export function batchIsReleasable(items: MaterialItem[]): boolean {
  for (const item of items) {
    if (item.status === 'rejected') return false;
    for (const iss of item.issues) {
      if (iss.status === 'open') return false;
      if (iss.level === 'severe' && iss.status === 'rejected') return false;
    }
  }
  return true;
}
