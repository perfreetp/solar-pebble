import * as THREE from 'three';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { LayerId } from '../types';
import { LAYERS, keyOf } from './constants';
import { voxelStore } from './voxelStore';
import { buildGreedyGeometries } from './greedyMeshing';

export interface ReductionInfo {
  /** 逐体素独立成面时的原始三角面数 */
  before: number;
  /** 贪婪合并 + 减面后的三角面数 */
  after: number;
  /** after / before,口径对齐「减到原来的两成」 */
  ratio: number;
  /** 贪婪合并后、减面前的面数(中间过程) */
  greedy: number;
  /** 是否触发了 meshopt 二次塌缩(贪婪结果已达标时为 false) */
  collapsed: boolean;
}

/** 一个几何的三角面数(优先索引几何,兜底非索引) */
function triCount(geo: THREE.BufferGeometry): number {
  return geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
}

/** 统计逐体素独立暴露面的原始三角面数(每个暴露面 2 个三角形) */
function countRawExposedTris(): number {  const data = voxelStore.snapshot();
  const occupied = new Set(data.map((d) => keyOf(d.coord.x, d.coord.y, d.coord.z)));
  const dirs: Array<[number, number, number]> = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  let faces = 0;
  for (const { coord } of data) {
    for (const [dx, dy, dz] of dirs) {
      if (!occupied.has(keyOf(coord.x + dx, coord.y + dy, coord.z + dz))) faces++;
    }
  }
  return faces * 2;
}

/**
 * 多体素块先经贪婪网格化合并为每层一个大四边形网格。
 * 贪婪合并通常已把面数压到原始体素模型的两成以内且保持地形连通;
 * 仅当用户给出的总预算比贪婪结果更激进时,才用 meshopt 进一步塌缩。
 * targetRatio 相对于「逐体素原始面数」,0.2 即最终不超过原始两成。
 * three r180+ 的 SimplifyModifier 内部为异步(WASM)。
 */
export async function buildSimplifiedMesh(
  targetRatio: number,
): Promise<{ mesh: THREE.Group; info: ReductionInfo }> {
  const rawTris = countRawExposedTris();
  const totalBudget = Math.max(1, Math.floor(rawTris * targetRatio));
  const geometries = buildGreedyGeometries();
  const group = new THREE.Group();
  group.name = 'crater-terrain';
  let greedyTris = 0;
  let afterTris = 0;

  for (const meta of LAYERS) {
    const geo = geometries.get(meta.id);
    if (!geo) continue;
    greedyTris += triCount(geo);
  }

  // 贪婪结果已在预算内 → 直接采用连通的贪婪网格,不做破坏性减面
  const needCollapse = greedyTris > totalBudget;
  const modifier = needCollapse ? new SimplifyModifier() : null;
  // 本层在贪婪网格基础上需要达到的等效保留比例
  const perLayerRatio = needCollapse
    ? Math.min(1, totalBudget / Math.max(1, greedyTris))
    : 1;

  for (const meta of LAYERS) {
    const geo = geometries.get(meta.id);
    if (!geo) continue;
    const initial = triCount(geo);
    let working = geo;

    if (needCollapse) {
      const layerTarget = Math.max(1, Math.floor(initial * perLayerRatio));
      // 多轮迭代逼近层目标
      for (let round = 0; round < 10; round++) {
        const current = triCount(working);
        if (current <= layerTarget) break;
        const next = await modifier!.modify(working, Math.max(0, current - layerTarget));
        if (working !== geo) working.dispose();
        const nextCount = triCount(next);
        working = next;
        if (nextCount >= current - 1) break;
      }
    }

    afterTris += triCount(working);
    const material = new THREE.MeshStandardMaterial({
      color: meta.color,
      roughness: 0.92,
      metalness: 0.04,
    });
    const mesh = new THREE.Mesh(working, material);
    mesh.name = meta.id;
    group.add(mesh);
  }

  return {
    mesh: group,
    info: {
      before: Math.round(rawTris),
      after: Math.round(afterTris),
      ratio: rawTris === 0 ? 0 : afterTris / rawTris,
      greedy: Math.round(greedyTris),
      collapsed: needCollapse,
    },
  };
}

/** 未减面的贪婪合并网格(导出兜底、对照用) */
export function buildFullMesh(): THREE.Group {
  const geometries = buildGreedyGeometries();
  const group = new THREE.Group();
  group.name = 'crater-terrain';
  for (const meta of LAYERS) {
    const geo = geometries.get(meta.id);
    if (!geo) continue;
    const material = new THREE.MeshStandardMaterial({
      color: meta.color,
      roughness: 0.92,
      metalness: 0.04,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = meta.id;
    group.add(mesh);
  }
  return group;
}

/** 导出 GLB 二进制 */
export function exportGLB(root: THREE.Object3D): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      root,
      (result) => {
        if (result instanceof ArrayBuffer) resolve(result);
        else reject(new Error('GLTFExporter 未返回二进制结果'));
      },
      (err) => reject(err),
      { binary: true },
    );
  });
}

export function downloadArrayBuffer(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
