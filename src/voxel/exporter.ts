/** OBJ 导出 + 无压缩 ZIP 打包 + 文件下载 */

export function meshToOBJ(name: string, positions: Float32Array, indices: Uint32Array): string {
  const lines: string[] = [`o ${name}`];
  for (let i = 0; i < positions.length; i += 3) {
    lines.push(`v ${positions[i].toFixed(4)} ${positions[i + 1].toFixed(4)} ${positions[i + 2].toFixed(4)}`);
  }
  // 每三角形一个面法线
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    lines.push(`vn ${nx.toFixed(4)} ${ny.toFixed(4)} ${nz.toFixed(4)}`);
  }
  for (let i = 0; i < indices.length; i += 3) {
    const ni = i / 3 + 1;
    lines.push(`f ${indices[i] + 1}//${ni} ${indices[i + 1] + 1}//${ni} ${indices[i + 2] + 1}//${ni}`);
  }
  return lines.join('\n') + '\n';
}

/* ---------------- 最小 ZIP(stored,无压缩) ---------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipFile { name: string; content: string | Uint8Array; }

export function createZip(files: ZipFile[]): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (v: number) => new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
  const u32 = (v: number) => new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]);

  for (const f of files) {
    const data = typeof f.content === 'string' ? enc.encode(f.content) : f.content;
    const nameBytes = enc.encode(f.name);
    const crc = crc32(data);
    const local = [
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length),
      u16(nameBytes.length), u16(0), nameBytes, data,
    ];
    const cent = [
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length),
      u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(offset), nameBytes,
    ];
    for (const p of local) { parts.push(p as Uint8Array); offset += (p as Uint8Array).length; }
    central.push(...(cent as Uint8Array[]));
  }
  const centralStart = offset;
  for (const p of central) { parts.push(p); offset += p.length; }
  const centralSize = offset - centralStart;
  parts.push(
    u32(0x06054b50), u16(0), u16(0),
    u16(files.length), u16(files.length),
    u32(centralSize), u32(centralStart), u16(0),
  );
  return new Blob(parts as BlobPart[], { type: 'application/zip' });
}

export function download(filename: string, content: string | Blob): void {
  const blob = typeof content === 'string' ? new Blob([content], { type: 'text/plain;charset=utf-8' }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
