// Pure deterministic nest generation. No Babylon, no DOM, no Date/Math.random.
// Everything is derived from (seed, params, locks) only.

import { rngFor } from './seed.js';

export const PARAM_DEFS = [
  { key: 'entrances', label: '入口数量', min: 1, max: 6, step: 1, unit: '个' },
  { key: 'depth', label: '巢深', min: 8, max: 30, step: 0.5, unit: 'm' },
  { key: 'branchAngle', label: '主道分支角', min: 20, max: 75, step: 1, unit: '°' },
  { key: 'levels', label: '分室层数', min: 2, max: 6, step: 1, unit: '层' },
  { key: 'tunnelDiameter', label: '通道管径', min: 0.25, max: 1.1, step: 0.05, unit: 'm' }
];

export const DEFAULT_PARAMS = {
  entrances: 3,
  depth: 16,
  branchAngle: 48,
  levels: 4,
  tunnelDiameter: 0.55
};

export const CHAMBER_TYPES = {
  nursery: { key: 'nursery', label: '育幼室', short: '育幼', color: '#f08a6b' },
  granary: { key: 'granary', label: '储粮室', short: '储粮', color: '#e8b84b' },
  fungus: { key: 'fungus', label: '菌圃室', short: '菌圃', color: '#68c39a' }
};

export const TYPE_ORDER = ['nursery', 'granary', 'fungus'];

export const SOIL_BOUNDS = { halfX: 13.2, halfZ: 10.6 };
const INNER = { x: 9.8, z: 7.6 };

function fitCenter(p, radii, yMin, yMax) {
  const rx = radii?.x ?? 0;
  const ry = radii?.y ?? 0;
  const rz = radii?.z ?? 0;
  return {
    x: round3(clamp(p.x, -INNER.x + rx * 0.4, INNER.x - rx * 0.4)),
    y: round3(clamp(p.y, yMin + ry * 0.55, yMax - ry * 0.55)),
    z: round3(clamp(p.z, -INNER.z + rz * 0.4, INNER.z - rz * 0.4))
  };
}

export function normalizeParams(raw = {}) {
  const out = {};
  for (const def of PARAM_DEFS) {
    let v = Number(raw[def.key]);
    if (!Number.isFinite(v)) v = DEFAULT_PARAMS[def.key];
    v = Math.min(def.max, Math.max(def.min, v));
    if (def.step === 1) v = Math.round(v);
    else v = Math.round(v / def.step) * def.step;
    out[def.key] = Number(v.toFixed(2));
  }
  return out;
}

export function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

// ---------- spline helpers ----------

function cr(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
    z: 0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3)
  };
}

export function samplePath(points, perSeg = 8) {
  if (!points || points.length === 0) return [];
  if (points.length === 1) return [{ ...points[0] }];
  const out = [];
  const n = points.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(n - 1, i + 2)];
    const steps = Math.max(2, perSeg);
    const last = i === n - 2;
    for (let s = 0; s < steps; s++) {
      out.push(cr(p0, p1, p2, p3, s / steps));
    }
    if (last) out.push({ ...p2 });
  }
  return out;
}

export function pathLength(points) {
  let d = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    d += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return d;
}

function clonePoints(points) {
  return points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

export function roundPoint(p) {
  return { x: round3(p.x), y: round3(p.y), z: round3(p.z) };
}

// ---------- generation ----------

export function generateNest(rawParams, seed, locks = {}) {
  const params = normalizeParams(rawParams);
  const depth = params.depth;
  const topY = -2.4;
  const bottomY = -depth + 1.0;
  const tierYs = [];
  const tierTop = topY - 1.0;
  const tierBottom = bottomY + 0.9;
  for (let k = 0; k < params.levels; k++) {
    const t = params.levels === 1 ? 0 : k / (params.levels - 1);
    tierYs.push(tierTop + (tierBottom - tierTop) * t);
  }

  const entrances = [];
  const n = params.entrances;
  const entRng = rngFor(seed, 'entrance-layout');
  const baseAngle = entRng() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    let x;
    let z;
    if (n === 1) {
      x = (entRng() - 0.5) * 1.6;
      z = (entRng() - 0.5) * 1.6;
    } else {
      const a = baseAngle + (i / n) * Math.PI * 2 + (entRng() - 0.5) * 0.28;
      const r = 4.2 + n * 0.82 + entRng() * 0.5;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r * 0.82;
    }
    entrances.push({ id: `E${i + 1}`, index: i, x: round3(clamp(x, -7.5, 7.5)), z: round3(clamp(z, -5.8, 5.8)) });
  }

  const tunnels = [];
  const chambers = [];
  const mains = [];

  for (let i = 0; i < entrances.length; i++) {
    const e = entrances[i];
    const id = `M${i + 1}`;
    const r = rngFor(seed, `main:${id}`);
    // each shaft gets its own deep anchor so shafts don't stack on one another
    const anchorAngle = (i / entrances.length) * Math.PI * 2 + r() * 0.7;
    const anchorR = entrances.length === 1 ? 0 : 2.1 + r() * 1.1;
    const ax = Math.cos(anchorAngle) * anchorR;
    const az = Math.sin(anchorAngle) * anchorR;
    const count = 8;
    const pts = [];
    for (let s = 0; s < count; s++) {
      const t = s / (count - 1);
      const y = 0 + (bottomY + 1.1 - 0) * Math.pow(t, 0.94);
      const pull = Math.pow(t, 1.25);
      const wob = (r() - 0.5) * (s === 0 || s === count - 1 ? 0.15 : 0.85);
      const swirl = Math.sin(t * Math.PI * 1.7 + i) * 0.55 * Math.sin(t * Math.PI);
      const x = e.x * (1 - pull) + ax * pull + swirl + wob * 0.6;
      const z = e.z * (1 - pull) + az * pull + swirl * 0.7 + (r() - 0.5) * 0.7 * Math.sin(t * Math.PI);
      pts.push(roundPoint({ x: clamp(x, -INNER.x * 0.8, INNER.x * 0.8), y, z: clamp(z, -INNER.z * 0.72, INNER.z * 0.72) }));
    }
    pts[0] = { x: e.x, y: 0, z: e.z };
    pts[pts.length - 1].y = bottomY + 1.0;

    const lock = locks[id];
    const points = lock?.points?.length >= 2 ? clonePoints(lock.points) : pts;
    const radius = lock ? Number(lock.radius) || params.tunnelDiameter / 2 : params.tunnelDiameter / 2;

    const t = {
      id,
      kind: 'main',
      entrance: i + 1,
      tier: null,
      points,
      radius: round3(radius),
      parentId: null,
      locked: !!lock
    };
    tunnels.push(t);
    mains.push({ ...t, entranceRef: e, samples: samplePath(points, 10), lock });
  }

  // branches
  for (let i = 0; i < mains.length; i++) {
    const main = mains[i];
    const e = entrances[i];
    const outward = Math.atan2(e.z, e.x) || 0;
    const mainLock = main.lock;
    for (let k = 0; k < params.levels; k++) {
      const levelKey = `${main.id}-L${k}`;
      const lr = rngFor(seed, `level:${levelKey}`);
      let perLevel;
      if (n === 1) perLevel = 2 + Math.floor(lr() * 2) + (k > 0 ? 1 : 0);
      else perLevel = 1 + (lr() < 0.62 ? 1 : 0) + (k >= params.levels - 2 ? 1 : 0);
      perLevel = Math.min(perLevel, 4);

      // junction: sample point on main path nearest to tier depth
      const targetY = tierYs[k];
      let best = 0;
      let bestD = Infinity;
      for (let s = 0; s < main.samples.length; s++) {
        const d = Math.abs(main.samples[s].y - targetY);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      const junction = main.samples[best];
      const next = main.samples[Math.min(main.samples.length - 1, best + 1)];
      const tangent = { x: next.x - junction.x, y: next.y - junction.y, z: next.z - junction.z };
      const tl = Math.hypot(tangent.x, tangent.y, tangent.z) || 1;
      tangent.x /= tl;
      tangent.y /= tl;
      tangent.z /= tl;

      for (let j = 0; j < perLevel; j++) {
        const bid = `B${i + 1}-${k + 1}-${j + 1}`;
        const br = rngFor(seed, `branch:${bid}`);
        const theta = (params.branchAngle * Math.PI) / 180;
        let azimuth;
        if (n === 1) {
          azimuth = (j / perLevel) * Math.PI * 2 + k * 0.7 + (br() - 0.5) * 0.6;
        } else {
          azimuth = outward + (j - (perLevel - 1) / 2) * 0.72 + (br() - 0.5) * 0.55;
        }
        const sinT = Math.sin(theta);
        const dir = {
          x: sinT * Math.cos(azimuth) * 0.96 + tangent.x * Math.cos(theta) * 0.3,
          y: -Math.cos(theta) * 0.34 - 0.05,
          z: sinT * Math.sin(azimuth) * 0.96 + tangent.z * Math.cos(theta) * 0.3
        };
        const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
        dir.x /= dl;
        dir.y /= dl;
        dir.z /= dl;

        let len = (n === 1 ? 4.4 : 3.1) + br() * (n === 1 ? 3.0 : 3.4);
        // keep within the soil interior
        const roomX = (INNER.x - Math.abs(junction.x)) / Math.max(0.2, Math.abs(dir.x));
        const roomZ = (INNER.z - Math.abs(junction.z)) / Math.max(0.2, Math.abs(dir.z));
        const roomY = (junction.y - (bottomY + 0.7)) / Math.max(0.2, -dir.y);
        len = Math.min(len, roomX, roomZ, roomY);
        len = Math.max(1.5, len);

        const curl = (br() - 0.5) * 0.7;
        const perp = { x: -dir.z, z: dir.x };
        const ctrl = [{ x: junction.x, y: junction.y, z: junction.z }];
        const segs = 3;
        for (let s = 1; s <= segs; s++) {
          const t = s / segs;
          const bend = Math.sin(t * Math.PI) * curl * len * 0.12;
          const dip = -Math.sin(t * Math.PI * 0.5) * 0.12 * len * Math.cos(theta) * 0.2;
          ctrl.push(
            roundPoint({
              x: clamp(junction.x + dir.x * len * t + perp.x * bend, -INNER.x, INNER.x),
              y: Math.max(bottomY + 0.6, junction.y + dir.y * len * t + dip),
              z: clamp(junction.z + dir.z * len * t + perp.z * bend, -INNER.z, INNER.z)
            })
          );
        }
        const lock = locks[bid];
        const rawPts = lock?.points?.length >= 2 ? clonePoints(lock.points) : ctrl;
        const pts2 = lock ? rawPts : rawPts.map((p) => fitCenter(p, { x: 0.2, z: 0.2 }, bottomY + 0.5, topY - 0.4));
        // keep the junction attached to the main tunnel even when clamped
        pts2[0] = { ...rawPts[0] };
        tunnels.push({
          id: bid,
          kind: 'branch',
          entrance: i + 1,
          tier: k + 1,
          points: pts2,
          radius: lock ? round3(Number(lock.radius) || params.tunnelDiameter / 2) : round3(params.tunnelDiameter / 2),
          parentId: main.id,
          locked: !!lock
        });
      }
    }

    // terminal chamber at the bottom of each main tunnel
    const end = main.points[main.points.length - 1];
    const cid = `C${i + 1}-T`;
    const cr2 = rngFor(seed, `chamber:${cid}`);
    const size = 1.15 + cr2() * 0.45;
    chambers.push({
      id: cid,
      tunnelId: main.id,
      kind: 'terminal',
      entrance: i + 1,
      tier: params.levels,
      center: { x: round3(clamp(end.x, -INNER.x + 0.5, INNER.x - 0.5)), y: round3(clamp(end.y - 0.4, bottomY + 0.2, topY - 1)), z: round3(clamp(end.z, -INNER.z + 0.5, INNER.z - 0.5)) },
      size,
      rot: cr2() * Math.PI,
      locked: !!mainLock
    });
  }

  // branch terminal chambers
  for (const t of tunnels) {
    if (t.kind !== 'branch') continue;
    const cid = `C${t.id.slice(1)}`;
    const cr2 = rngFor(seed, `chamber:${cid}`);
    const end = t.points[t.points.length - 1];
    const prev = t.points[t.points.length - 2] || end;
    const dx = end.x - prev.x;
    const dy = end.y - prev.y;
    const dz = end.z - prev.z;
    const dl = Math.hypot(dx, dy, dz) || 1;
    const size = 0.72 + cr2() * 0.82;
    chambers.push({
      id: cid,
      tunnelId: t.id,
      kind: 'branch',
      entrance: t.entrance,
      tier: t.tier,
      center: {
        x: round3(clamp(end.x + (dx / dl) * 0.5, -INNER.x + 0.4, INNER.x - 0.4)),
        y: round3(clamp(end.y + (dy / dl) * 0.4, bottomY + 0.2, topY - 0.6)),
        z: round3(clamp(end.z + (dz / dl) * 0.5, -INNER.z + 0.4, INNER.z - 0.4))
      },
      size,
      rot: cr2() * Math.PI,
      locked: !!t.locked
    });
  }

  // resolve chamber types by volume rank (largest → nursery, mid → granary, small → fungus)
  const sorted = [...chambers].sort((a, b) => b.size - a.size || (a.id < b.id ? -1 : 1));
  const N = sorted.length;
  sorted.forEach((c, idx) => {
    const p = N <= 1 ? 0 : idx / (N - 1);
    if (p < 0.3) c.type = 'nursery';
    else if (p < 0.74) c.type = 'granary';
    else c.type = 'fungus';
  });

  // apply per-type shapes + spacing relaxation
  for (const c of chambers) {
    const lock = locks[c.tunnelId];
    if (lock?.chamber) {
      c.center = { ...lock.chamber.center };
      c.radii = { ...lock.chamber.radii };
      c.type = lock.chamber.type || c.type;
      c.size = lock.chamber.size ?? c.size;
      c.rot = lock.chamber.rot ?? c.rot;
      c.locked = true;
      c.volume = round3((4 / 3) * Math.PI * c.radii.x * c.radii.y * c.radii.z);
      continue;
    }
    const s = c.size;
    let rx;
    let ry;
    let rz;
    if (c.type === 'nursery') {
      const b = 0.94 + s * 0.4;
      rx = b * 1.16;
      ry = b * 0.96;
      rz = b * 1.1;
    } else if (c.type === 'granary') {
      const b = 0.88 + s * 0.34;
      rx = b * 1.48;
      ry = b * 0.55;
      rz = b * 1.24;
    } else {
      const b = 0.8 + s * 0.3;
      rx = b * 0.98;
      ry = b * 0.9;
      rz = b;
    }
    c.radii = { x: round3(rx), y: round3(ry), z: round3(rz) };
    c.volume = round3((4 / 3) * Math.PI * rx * ry * rz);
    if (!c.locked) c.center = fitCenter(c.center, c.radii, bottomY + 0.2, topY - 0.3);
  }

  // deterministic relaxation to avoid intersecting chambers and soil walls
  const byTier = new Map();
  for (const c of chambers) {
    if (!byTier.has(c.tier)) byTier.set(c.tier, []);
    byTier.get(c.tier).push(c);
  }
  for (const list of byTier.values()) {
    for (let iter = 0; iter < 26; iter++) {
      let moved = false;
      for (let a = 0; a < list.length; a++) {
        for (let b = a + 1; b < list.length; b++) {
          const A = list[a];
          const B = list[b];
          if (A.locked && B.locked) continue;
          const dx = B.center.x - A.center.x;
          const dy = B.center.y - A.center.y;
          const dz = B.center.z - A.center.z;
          const d = Math.hypot(dx, dy, dz) || 0.001;
          const minD = Math.min(A.radii.x, A.radii.z) + Math.min(B.radii.x, B.radii.z);
          if (d < minD) {
            moved = true;
            const push = (minD - d) * 0.5;
            const ux = dx / d;
            const uy = dy / d;
            const uz = dz / d;
            const aW = A.locked ? 0 : B.locked ? 2 : 1;
            const bW = B.locked ? 0 : A.locked ? 2 : 1;
            A.center.x = round3(clamp(A.center.x - ux * push * aW, -INNER.x + 0.4, INNER.x - 0.4));
            A.center.z = round3(clamp(A.center.z - uz * push * aW, -INNER.z + 0.4, INNER.z - 0.4));
            B.center.x = round3(clamp(B.center.x + ux * push * bW, -INNER.x + 0.4, INNER.x - 0.4));
            B.center.z = round3(clamp(B.center.z + uz * push * bW, -INNER.z + 0.4, INNER.z - 0.4));
            A.center.y = round3(clamp(A.center.y - uy * push * 0.2 * aW, bottomY + 0.2, topY - 0.6));
            B.center.y = round3(clamp(B.center.y + uy * push * 0.2 * bW, bottomY + 0.2, topY - 0.6));
          }
        }
      }
      if (!moved) break;
    }
  }

  // keep chamber necks decent after relaxation: nothing else to do, branch reaches the blob

  // orphan locked tunnels survive parameter changes
  const knownTunnelIds = new Set(tunnels.map((t) => t.id));
  const knownChamberIds = new Set(chambers.map((c) => c.id));
  for (const [id, lock] of Object.entries(locks)) {
    if (knownTunnelIds.has(id) || !lock?.points?.length) continue;
    const kind = id.startsWith('M') ? 'main' : 'branch';
    const mid = id.match(/^[MB](\d+)/);
    tunnels.push({
      id,
      kind,
      entrance: mid ? Number(mid[1]) : 0,
      tier: null,
      points: clonePoints(lock.points),
      radius: round3(Number(lock.radius) || params.tunnelDiameter / 2),
      parentId: null,
      locked: true,
      orphan: true
    });
    knownTunnelIds.add(id);
    const cid = kind === 'main' ? `C${id.slice(1)}-T` : `C${id.slice(1)}`;
    const lc = lock.chamber;
    if (lc && !knownChamberIds.has(cid)) {
      chambers.push({
        id: cid,
        tunnelId: id,
        kind: 'orphan',
        entrance: mid ? Number(mid[1]) : 0,
        tier: null,
        center: lc.center,
        radii: lc.radii,
        size: lc.size ?? 1,
        rot: lc.rot ?? 0,
        type: lc.type || 'fungus',
        volume: round3((4 / 3) * Math.PI * (lc.radii?.x || 1) * (lc.radii?.y || 1) * (lc.radii?.z || 1)),
        locked: true,
        orphan: true
      });
      knownChamberIds.add(cid);
    }
  }

  // stable ordering
  tunnels.sort((a, b) => cmpId(a.id, b.id));
  chambers.sort((a, b) => cmpId(a.id, b.id));

  const counts = { nursery: 0, granary: 0, fungus: 0 };
  for (const c of chambers) counts[c.type]++;

  const allPts = [...tunnels.flatMap((t) => t.points), ...chambers.map((c) => c.center)];
  const bounds = {
    min: {
      x: Math.min(...allPts.map((p) => p.x)) - 1,
      y: Math.min(...allPts.map((p) => p.y)) - 1,
      z: Math.min(...allPts.map((p) => p.z)) - 1
    },
    max: {
      x: Math.max(...allPts.map((p) => p.x)) + 1,
      y: Math.max(...allPts.map((p) => p.y)) + 1,
      z: Math.max(...allPts.map((p) => p.z)) + 1
    }
  };

  return {
    seed,
    params,
    entrances,
    tunnels,
    chambers,
    tierYs: tierYs.map(round3),
    counts,
    stats: {
      tunnels: tunnels.length,
      chambers: chambers.length,
      locked: tunnels.filter((t) => t.locked).length,
      volume: Math.round(chambers.reduce((s, c) => s + c.volume, 0))
    },
    bounds,
    soil: {
      halfX: SOIL_BOUNDS.halfX,
      halfZ: SOIL_BOUNDS.halfZ,
      depth
    }
  };
}

function cmpId(a, b) {
  const pa = String(a).match(/^([A-Z])(\d+)(?:-(.*))?$/);
  const pb = String(b).match(/^([A-Z])(\d+)(?:-(.*))?$/);
  if (!pa || !pb) return String(a).localeCompare(String(b));
  if (pa[1] !== pb[1]) return pa[1].localeCompare(pb[1]);
  if (Number(pa[2]) !== Number(pb[2])) return Number(pa[2]) - Number(pb[2]);
  return String(pa[3] || '').localeCompare(String(pb[3] || ''), undefined, { numeric: true });
}

export function makeLockFromTunnel(tunnel, chamber) {
  return {
    id: tunnel.id,
    points: tunnel.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    radius: tunnel.radius,
    chamber: chamber
      ? {
          center: { ...chamber.center },
          radii: { ...chamber.radii },
          type: chamber.type,
          size: chamber.size,
          rot: chamber.rot
        }
      : null
  };
}
