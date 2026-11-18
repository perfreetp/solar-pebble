/** 体素网格:立方体网格,1=实心 0=空 */
export class VoxelGrid {
  readonly size: number;
  data: Uint8Array;

  constructor(size: number, data?: Uint8Array) {
    this.size = size;
    this.data = data && data.length === size * size * size ? data : new Uint8Array(size * size * size);
  }

  idx(x: number, y: number, z: number): number {
    return (z * this.size + y) * this.size + x;
  }
  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.size && y < this.size && z < this.size;
  }
  get(x: number, y: number, z: number): number {
    return this.inBounds(x, y, z) ? this.data[this.idx(x, y, z)] : 0;
  }
  set(x: number, y: number, z: number, v: number): void {
    if (this.inBounds(x, y, z)) this.data[this.idx(x, y, z)] = v;
  }

  count(): number {
    let n = 0;
    for (let i = 0; i < this.data.length; i++) n += this.data[i];
    return n;
  }
  countLayer(z: number): number {
    let n = 0;
    const s = this.size, off = z * s * s;
    for (let i = 0; i < s * s; i++) n += this.data[off + i];
    return n;
  }
  /** 包围盒(含端点),无体素时返回 null */
  bounds(): { min: [number, number, number]; max: [number, number, number] } | null {
    const s = this.size;
    let minX = s, minY = s, minZ = s, maxX = -1, maxY = -1, maxZ = -1;
    for (let z = 0; z < s; z++) for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      if (this.data[this.idx(x, y, z)]) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
    }
    if (maxX < 0) return null;
    return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
  }
  clone(): VoxelGrid {
    return new VoxelGrid(this.size, this.data.slice());
  }
}
