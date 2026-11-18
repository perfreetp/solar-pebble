/**
 * 顶点聚类减面:把顶点吸附到空间格子的代表点上,退化三角形丢弃。
 * 通过二分格子尺寸逼近目标面数。
 */
export interface DecimatedMesh {
  positions: Float32Array;
  indices: Uint32Array;
  faceCount: number;
}

function cluster(positions: Float32Array, indices: Uint32Array, cell: number): DecimatedMesh {
  const map = new Map<string, number>();
  const newPos: number[] = [];
  const remap = new Uint32Array(positions.length / 3);
  const sums = new Map<number, [number, number, number, number]>(); // idx → x,y,z,n

  for (let i = 0; i < positions.length; i += 3) {
    const kx = Math.floor(positions[i] / cell);
    const ky = Math.floor(positions[i + 1] / cell);
    const kz = Math.floor(positions[i + 2] / cell);
    const key = kx + ',' + ky + ',' + kz;
    let ni = map.get(key);
    if (ni === undefined) {
      ni = newPos.length / 3;
      map.set(key, ni);
      newPos.push(0, 0, 0);
      sums.set(ni, [0, 0, 0, 0]);
    }
    const acc = sums.get(ni)!;
    acc[0] += positions[i]; acc[1] += positions[i + 1]; acc[2] += positions[i + 2]; acc[3]++;
    remap[i / 3] = ni;
  }
  for (const [ni, acc] of sums) {
    newPos[ni * 3] = acc[0] / acc[3];
    newPos[ni * 3 + 1] = acc[1] / acc[3];
    newPos[ni * 3 + 2] = acc[2] / acc[3];
  }
  const newIdx: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = remap[indices[i]], b = remap[indices[i + 1]], c = remap[indices[i + 2]];
    if (a === b || b === c || a === c) continue;
    newIdx.push(a, b, c);
  }
  return {
    positions: new Float32Array(newPos),
    indices: new Uint32Array(newIdx),
    faceCount: newIdx.length / 3,
  };
}

export function decimateMesh(positions: Float32Array, indices: Uint32Array, targetFaces: number): DecimatedMesh {
  const faces = indices.length / 3;
  if (faces <= targetFaces || targetFaces <= 0) {
    return { positions, indices, faceCount: faces };
  }
  // 包围盒对角线作为格子尺寸量程
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  let lo = diag / 512, hi = diag; // 格子越大面越少
  let best: DecimatedMesh | null = null;
  for (let iter = 0; iter < 28; iter++) {
    const cell = (lo + hi) / 2;
    const r = cluster(positions, indices, cell);
    if (r.faceCount > targetFaces) {
      lo = cell;
    } else {
      hi = cell;
      if (!best || r.faceCount > best.faceCount) best = r; // 取不超目标下面数最多的
    }
  }
  return best ?? cluster(positions, indices, hi);
}
