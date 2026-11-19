/**
 * 纯 JS 16bit 灰度 PNG 编码器（无第三方依赖）。
 * deflate 采用 zlib stored block（兼容性好，浏览器/仿真软件均可读）。
 * 高度按固定量程 [-1.2m, +3.0m] 归一化到 uint16，保证同数据导出字节一致。
 */
export const HEIGHT_MIN = -1.2
export const HEIGHT_MAX = 3.0

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function u32be(n) {
  return [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
}

function chunk(type, data) {
  const len = u32be(data.length)
  const typeBytes = [...type].map((c) => c.charCodeAt(0))
  const body = new Uint8Array(typeBytes.length + data.length)
  body.set(typeBytes, 0)
  body.set(data, typeBytes.length)
  const crc = u32be(crc32(body))
  return new Uint8Array([...len, ...body, ...crc])
}

/** zlib 包装 + stored deflate（每块最大 65535 字节） */
function zlibStored(src) {
  const blocks = Math.ceil(src.length / 65535)
  const out = new Uint8Array(2 + blocks * 5 + src.length + 4)
  let p = 0
  out[p++] = 0x78 // CMF
  out[p++] = 0x01 // FLG
  let offset = 0
  for (let b = 0; b < blocks; b++) {
    const n = Math.min(65535, src.length - offset)
    const last = b === blocks - 1
    out[p++] = last ? 1 : 0
    out[p++] = n & 0xff
    out[p++] = (n >>> 8) & 0xff
    out[p++] = (~n) & 0xff
    out[p++] = ((~n) >>> 8) & 0xff
    out.set(src.subarray(offset, offset + n), p)
    p += n
    offset += n
  }
  // adler32
  let a = 1
  let b = 0
  for (let i = 0; i < src.length; i++) {
    a = (a + src[i]) % 65521
    b = (b + a) % 65521
  }
  out[p++] = (b >>> 8) & 0xff
  out[p++] = b & 0xff
  out[p++] = (a >>> 8) & 0xff
  out[p++] = a & 0xff
  return out
}

/** 构造 zTXt 元数据块（keyword=terrain-meta，latin1 安全的 JSON） */
function ztxtChunk(meta) {
  const keyword = 'terrain-meta'
  const json = JSON.stringify(meta).replace(/[^\x20-\x7e]/g, '?')
  const payload = keyword + '\x00\x00' + json // \0 分隔 + compression method 0
  return new TextEncoder().encode(payload)
}

export function makePngMeta(heights, verts, params, seed) {
  let min = Infinity
  let max = -Infinity
  for (const h of heights) {
    if (h < min) min = h
    if (h > max) max = h
  }
  return {
    seed: String(seed),
    params,
    gridSize: verts,
    fieldSizeM: 40,
    encoderRange: [HEIGHT_MIN, HEIGHT_MAX],
    actualRange: [min, max],
    exportedAt: new Date().toISOString()
  }
}

export function encodeHeightPng(heights, verts, meta) {
  const span = HEIGHT_MAX - HEIGHT_MIN
  // 每像素 2 字节 + 每行 filter 前缀 1 字节
  const rowBytes = verts * 2
  const raw = new Uint8Array((rowBytes + 1) * verts)
  let p = 0
  for (let k = 0; k < verts; k++) {
    raw[p++] = 0 // filter: none
    for (let i = 0; i < verts; i++) {
      const h = heights[k * verts + i]
      const t = Math.min(1, Math.max(0, (h - HEIGHT_MIN) / span))
      const v = Math.round(t * 65535)
      raw[p++] = (v >>> 8) & 0xff
      raw[p++] = v & 0xff
    }
  }
  const ihdr = new Uint8Array([
    ...u32be(verts),
    ...u32be(verts),
    16, // bit depth
    0, // color type: grayscale
    0, 0, 0
  ])
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const parts = [
    signature,
    chunk('IHDR', ihdr),
    chunk('zTXt', ztxtChunk(meta)),
    chunk('IDAT', zlibStored(raw)),
    chunk('IEND', new Uint8Array(0))
  ]
  const total = parts.reduce((s, x) => s + x.length, 0)
  const png = new Uint8Array(total)
  let off = 0
  for (const part of parts) {
    png.set(part, off)
    off += part.length
  }
  return new Blob([png], { type: 'image/png' })
}
