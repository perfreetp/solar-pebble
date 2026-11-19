// Deterministic seeded randomness. Never falls back to Math.random:
// the same (seed, params, variant) must always reproduce the exact same wing.

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed) {
    this._next = mulberry32(hashString(String(seed)));
    this._spare = null;
    // warm up so neighbouring seeds diverge quickly
    for (let i = 0; i < 4; i++) this._next();
  }
  next() {
    return this._next();
  }
  range(a, b) {
    return a + (b - a) * this._next();
  }
  int(a, b) {
    // inclusive
    return a + Math.floor(this._next() * (b - a + 1));
  }
  pick(arr) {
    return arr[Math.floor(this._next() * arr.length) % arr.length];
  }
  chance(p) {
    return this._next() < p;
  }
  gauss() {
    if (this._spare != null) {
      const s = this._spare;
      this._spare = null;
      return s;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = this._next();
    while (v === 0) v = this._next();
    const m = Math.sqrt(-2 * Math.log(u));
    this._spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  }
  fork(tag) {
    return new Rng(String(this._next()) + '|' + tag);
  }
}

/** Stable 0..1 hash of a string, independent of draw order. */
export function hash01(str) {
  return hashString(String(str)) / 4294967296;
}

/** Stable 64-bit-ish fingerprint of any JSON-serialisable value. */
export function fingerprint(value) {
  const s = JSON.stringify(value);
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b ^ c, 2246822507);
    b = (b << 13) | (b >>> 19);
  }
  return ((a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0'));
}
