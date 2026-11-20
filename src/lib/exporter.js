// GLB 导出:面剔除合并 -> 按比例减面(共面合并 + Quadric 简化)-> GLB 二进制下载
import {
  Scene as BScene, Engine as BEngine, Mesh, VertexData, StandardMaterial,
  Color3
} from '@babylonjs/core';
import { GLTF2Export } from '@babylonjs/serializers/glTF';
import { buildCulledMesh } from './voxel.js';

function simplifyToMesh(mesh, quality) {
  return new Promise((resolve, reject) => {
    let settled = false;
    // 超时保护:个别环境(无头/软件渲染)简化器不回调,8 秒后回退
    const timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error('简化超时')); }
    }, 8000);
    mesh.simplify(
      { distance: 1, quality: Math.max(0.1, Math.min(0.95, quality)), optimizeMesh: true },
      (simplifiedMesh) => { if (!settled) { settled = true; clearTimeout(timer); resolve(simplifiedMesh); } },
      () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Quadric 简化未能生成 LOD,已退回共面合并结果')); } }
    );
  });
}

/**
 * @param {Map} voxels 全部体素
 * @param {Set<string>|null} onlyKeys 只导出选中连通团时传入
 * @param {number} quality 1=不减面;0.25~0.9 触发共面合并 + Quadric 简化
 * @param {string} fileName
 */
export async function exportGLB(voxels, onlyKeys, quality, fileName = 'voxel-bug.glb') {
  // 离屏引擎(不挂画布)
  const offscreen = document.createElement('canvas');
  offscreen.width = 16; offscreen.height = 16;
  const engine = new BEngine(offscreen, true);
  const scene = new BScene(engine);

  const culled = buildCulledMesh(voxels, onlyKeys, quality);
  const mesh = new Mesh('VoxelBug', scene);
  const vertexData = new VertexData();
  vertexData.positions = culled.positions;
  vertexData.indices = culled.indices;
  vertexData.colors = culled.colors;
  const normals = [];
  VertexData.ComputeNormals(culled.positions, culled.indices, normals);
  vertexData.normals = normals;
  vertexData.applyToMesh(mesh, true);

  const mat = new StandardMaterial('bugmat', scene);
  mat.specularColor = new Color3(0.1, 0.1, 0.1);
  mat.backFaceCulling = true;
  mesh.material = mat;
  mesh.useVertexColors = true; // 顶点色直接进 glTF 的 COLOR_0

  const baseName = fileName.replace(/\.glb$/, '');
  let beforeTris = culled.faceCount;
  let afterTris = beforeTris;
  let exportMesh = mesh;

  if (quality < 1 && mesh.getTotalIndices() > 64) {
    try {
      const lod = await simplifyToMesh(mesh, quality);
      lod.name = 'VoxelBug';
      lod.material = mat;
      lod.useVertexColors = true;
      // 导出时只保留简化 LOD,原网格排除
      lod.setEnabled(true);
      mesh.setEnabled(false);
      exportMesh = lod;
      afterTris = Math.round(lod.getTotalIndices() / 3);
    } catch (e) {
      console.warn(e.message, '— 退回共面合并结果');
    }
  }

  const glb = await GLTF2Export.GLBAsync(scene, baseName, {
    shouldExportNode: (n) => n === exportMesh
  });
  glb.downloadFiles();
  engine.dispose();
  return { beforeTris, afterTris, quality, downloaded: true };
}
