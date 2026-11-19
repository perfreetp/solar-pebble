// GLB（二进制 glTF 2.0）导出：POSITION / NORMAL / COLOR_0，单网格
import type { MeshGeometry } from './mesh';

export function buildGlb(geo: MeshGeometry, name: string): ArrayBuffer {
  const posBytes = geo.positions.byteLength;
  const nrmBytes = geo.normals.byteLength;
  const colBytes = geo.colors.byteLength;
  const idxBytes = geo.indices.byteLength;

  // ---- BIN chunk 布局（每个 bufferView 4 字节对齐） ----
  const views: { byteOffset: number; byteLength: number; target: number }[] = [];
  let offset = 0;
  const pushView = (len: number, target: number): number => {
    const byteOffset = align4(offset);
    views.push({ byteOffset, byteLength: len, target });
    offset = byteOffset + len;
    return byteOffset;
  };
  const posOff = pushView(posBytes, 34962);
  const nrmOff = pushView(nrmBytes, 34962);
  const colOff = pushView(colBytes, 34962);
  const idxOff = pushView(idxBytes, 34963);
  const binLength = align4(offset);
  const bin = new ArrayBuffer(binLength);
  new Float32Array(bin, posOff, geo.positions.length).set(geo.positions);
  new Float32Array(bin, nrmOff, geo.normals.length).set(geo.normals);
  new Float32Array(bin, colOff, geo.colors.length).set(geo.colors);
  new Uint32Array(bin, idxOff, geo.indices.length).set(geo.indices);

  // ---- 位置 accessor 的 min/max ----
  const minPos = [Infinity, Infinity, Infinity];
  const maxPos = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < geo.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      minPos[k] = Math.min(minPos[k], geo.positions[i + k]);
      maxPos[k] = Math.max(maxPos[k], geo.positions[i + k]);
    }
  }
  void minPos;

  const gltf = {
    asset: { version: '2.0', generator: 'rocket-voxel-workbench' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [
      {
        name,
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 },
            indices: 3,
            mode: 4,
            material: 0,
          },
        ],
      },
    ],
    materials: [
      {
        name: 'voxel-vertex-color',
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: 0.05,
          roughnessFactor: 0.85,
        },
      },
    ],
    accessors: [
      {
        bufferView: 0, componentType: 5126, count: geo.vertexCount,
        type: 'VEC3', min: minPos, max: maxPos,
      },
      { bufferView: 1, componentType: 5126, count: geo.vertexCount, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: geo.vertexCount, type: 'VEC3' },
      {
        bufferView: 3, componentType: 5125, count: geo.indices.length,
        type: 'SCALAR',
      },
    ],
    bufferViews: views.map((v) => ({
      buffer: 0,
      byteOffset: v.byteOffset,
      byteLength: v.byteLength,
      target: v.target,
    })),
    buffers: [{ byteLength: binLength }],
  };

  // ---- GLB 封包 ----
  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPadded = pad(jsonBytes, 0x20); // JSON chunk 用空格填充
  const binPaddedLength = align4(binLength);
  const total = 12 + 8 + jsonPadded.length + 8 + binPaddedLength;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true); // "glTF"
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonPadded.length, true);
  dv.setUint32(16, 0x4e4f534a, true); // "JSON"
  u8.set(jsonPadded, 20);
  const binChunkStart = 20 + jsonPadded.length;
  dv.setUint32(binChunkStart, binPaddedLength, true);
  dv.setUint32(binChunkStart + 4, 0x004e4942, true); // "BIN\0"
  u8.set(new Uint8Array(bin), binChunkStart + 8);
  return out;
}

export function downloadGlb(buffer: ArrayBuffer, filename: string): void {
  const blob = new Blob([buffer], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function align4(n: number): number {
  return (n + 3) & ~3;
}

function pad(bytes: Uint8Array, padChar: number): Uint8Array {
  const len = align4(bytes.length);
  const out = new Uint8Array(len);
  out.set(bytes);
  out.fill(padChar, bytes.length);
  return out;
}
