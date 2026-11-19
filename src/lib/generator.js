// Deterministic wing generator.
//
// Contract: generateSpecimen({ speciesId, params, seed, variant }) must produce
// identical geometry for the same inputs. All randomness comes from Rng seeded
// by an explicit string; nothing consults Math.random or the wall clock.
//
// Every wing is generated in a normalised "wing space": the hinge sits at the
// origin, +y points up along the body, +x points outward, and the species
// profile's maximum radius is ≈1. Placement into artboard units happens in
// layoutWings, which bakes an anisotropic scale into wing.transform — so
// 翅长 changes the y scale, 翅宽 the x scale, without touching topology.
//
// Manual edits live in a separate `overrides` map keyed by stable ids, so a
// regeneration re-applies them on top of freshly computed geometry.

import { Rng, hash01, fingerprint } from './rng.js';
import {
  arcTable,
  pointAt,
  polyArea,
  polyCentroid,
  polyBounds,
  pointInPolygon,
  distToPolygonBoundary,
  triangulate,
  TAU,
  lerp,
  clamp01
} from './geometry.js';
import { clamp, contrastRatio } from './color.js';
import { getSpecies } from './species.js';

export const DEFAULT_PARAMS = {
  wingLength: 0.82,
  wingWidth: 0.66,
  hindRatio: 0.84,
  spotDensity: 0.55,
  hueBase: 30,
  hueWidth: 50,
  saturation: 0.78,
  lightness: 0.54,
  veinDensity: 0.55,
  spotSize: 0.6,
  marginBand: 0.6,
  asymmetry: 0.012
};

export const PARAM_META = [
  { key: 'wingLength', label: '翅长', min: 0.6, max: 1.0, step: 0.005, fmt: (v) => (v * 100).toFixed(0) + '%' },
  { key: 'wingWidth', label: '翅宽', min: 0.4, max: 1.0, step: 0.005, fmt: (v) => (v * 100).toFixed(0) + '%' },
  { key: 'hindRatio', label: '前后翅比例', min: 0.6, max: 1.0, step: 0.005, fmt: (v) => '后翅 ' + (v * 100).toFixed(0) + '%' },
  { key: 'spotDensity', label: '斑点密度', min: 0, max: 1, step: 0.01, fmt: (v) => (v * 100).toFixed(0) + '%' },
  { key: 'hueBase', label: '色相起点', min: 0, max: 359, step: 1, fmt: (v) => v.toFixed(0) + '°' },
  { key: 'hueWidth', label: '色相范围', min: 0, max: 180, step: 1, fmt: (v) => '±' + (v / 2).toFixed(0) + '°' },
  { key: 'saturation', label: '饱和度', min: 0.12, max: 1, step: 0.01, fmt: (v) => (v * 100).toFixed(0) + '%' },
  { key: 'lightness', label: '明度', min: 0.18, max: 0.86, step: 0.01, fmt: (v) => (v * 100).toFixed(0) + '%' },
  { key: 'veinDensity', label: '翅脉密度', min: 0, max: 1, step: 0.01, fmt: (v) => (v * 100).toFixed(0) + '%' },
  { key: 'spotSize', label: '斑点大小', min: 0.15, max: 1, step: 0.01, fmt: (v) => (v * 100).toFixed(0) + '%' },
  { key: 'marginBand', label: '边缘带宽度', min: 0, max: 1, step: 0.01, fmt: (v) => (v * 100).toFixed(0) + '%' },
  { key: 'asymmetry', label: '对称扰动', min: 0, max: 0.06, step: 0.001, fmt: (v) => (v * 100).toFixed(1) + '%' }
];

export const ARTBOARD = { width: 168, height: 122 };
/** Artboard units per wing-space unit (normalised wing length ≈ 34 units). */
export const WING_UNIT = 44;

export function defaultParamsFor(speciesId) {
  const sp = getSpecies(speciesId);
  return { ...DEFAULT_PARAMS, ...sp.defaults };
}

export function clampParams(p) {
  const out = {};
  for (const m of PARAM_META) {
    const v = Number(p?.[m.key]);
    out[m.key] = Number.isFinite(v) ? Math.min(m.max, Math.max(m.min, v)) : DEFAULT_PARAMS[m.key];
  }
  return out;
}

export function paramsKey(params) {
  return PARAM_META.map((m) => Number(params[m.key]).toFixed(4)).join(',');
}

// ---------------------------------------------------------------------------
// Polar helpers
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180;

function polar(phiDeg, r) {
  const a = phiDeg * DEG;
  return [Math.sin(a) * r, Math.cos(a) * r];
}

function interp2(profile, key, phi) {
  const n = profile.length;
  if (phi <= profile[0][0]) return profile[0][key];
  if (phi >= profile[n - 1][0]) return profile[n - 1][key];
  for (let i = 0; i < n - 1; i++) {
    const a0 = profile[i][0];
    const a1 = profile[i + 1][0];
    if (phi >= a0 && phi <= a1) {
      const t = (phi - a0) / Math.max(1e-9, a1 - a0);
      // smoothstep between control points for a scalloped, organic margin
      const st = t * t * (3 - 2 * t);
      return lerp(profile[i][key], profile[i + 1][key], t * 0.55 + st * 0.45);
    }
  }
  return profile[n - 1][key];
}

function makeWobble(rng, amp) {
  const terms = [];
  for (let k = 0; k < 3; k++) {
    terms.push({ freq: 2.2 + k * 2.3 + rng.range(-0.35, 0.35), phase: rng.range(0, TAU), amp: (amp * rng.range(0.5, 1)) / (1 + k * 1.2) });
  }
  return (u) => {
    const env = Math.sin(Math.PI * clamp01(u));
    let v = 0;
    for (const t of terms) v += Math.sin(u * t.freq * TAU + t.phase) * t.amp;
    return v * env;
  };
}

// ---------------------------------------------------------------------------
// Outline
// ---------------------------------------------------------------------------

const OUTLINE_SAMPLES = 120;

function radiusRaw(def, phi) {
  let r = interp2(def.profile, 1, phi);
  const tail = def.tail;
  if (tail) {
    const d = (phi - tail.angle) / tail.width;
    r += (tail.length - 1) * Math.exp(-d * d * 0.5) * 0.55;
  }
  return r;
}

function buildOutline(def, wobble) {
  const phi0 = def.profile[0][0];
  const phi1 = def.profile[def.profile.length - 1][0];
  const pts = [];
  for (let i = 0; i < OUTLINE_SAMPLES; i++) {
    const u = i / (OUTLINE_SAMPLES - 1);
    const phi = lerp(phi0, phi1, u);
    const r = Math.max(0.05, radiusRaw(def, phi) + wobble(u) * 0.03);
    pts.push(polar(phi, r));
  }
  const outerCount = pts.length;
  // close along the hinge with a shallow concave arc
  const startR = Math.hypot(pts[0][0], pts[0][1]);
  const endR = Math.hypot(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  const baseR = Math.min(startR, endR) * 0.28;
  const back = [];
  const steps = 10;
  for (let k = 1; k < steps; k++) {
    const u = 1 - k / steps;
    const phi = lerp(phi0, phi1, u);
    back.push(polar(phi, baseR * (1 - 0.35 * Math.sin(Math.PI * (k / steps)))));
  }
  const outline = [...pts, ...back];
  outline.outerCount = outerCount;
  return outline;
}

// ---------------------------------------------------------------------------
// Veins
// ---------------------------------------------------------------------------

function veinCount(def, params) {
  const step = params.veinDensity < 0.34 ? -1 : params.veinDensity > 0.72 ? 1 : 0;
  return Math.max(4, def.veinCount + step);
}

function buildVeins(def, outline, params, rng) {
  const count = veinCount(def, params);
  const [a, b] = def.veinSpan;
  const veins = [];
  for (let i = 0; i < count; i++) {
    const q = count === 1 ? 0.5 : i / (count - 1);
    const phi = lerp(a, b, q);
    const rEnd = radiusRaw(def, phi) * 0.97;
    const rStart = 0.055;
    const swirl = rng.range(-1, 1) * 2.6 * (0.35 + params.veinDensity);
    const steps = 30;
    const pts = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const rr = lerp(rStart, rEnd, Math.pow(t, 0.92));
      const ph = phi + swirl * (1 - t) * (q - 0.5) * 2;
      pts.push(polar(ph, rr));
    }
    veins.push({ id: `v${i}`, q, phi, pts, table: arcTable(pts) });
  }
  return veins;
}

// Cross veins are placed by *radius* fraction, so the bands keep similar
// visual widths regardless of how the outline flares.
const CUT_RADIUS_FRACTIONS = [0.5, 0.7, 0.84, 0.93];

function cutFractions(def, params) {
  const n = Math.max(1, def.crossVeins);
  const shift = (params.veinDensity - 0.5) * 0.04;
  return CUT_RADIUS_FRACTIONS.slice(0, n).map((f, k) => clamp(f + shift * (k + 1) * 0.7, 0.22, 0.93));
}

/** Point on a vein at radius fraction r of [start→end radius]. */
function veinPointAtRadius(vein, rFrac) {
  const pts = vein.pts;
  const r0 = Math.hypot(pts[0][0], pts[0][1]);
  const r1 = Math.hypot(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  const target = lerp(r0, r1, clamp01(rFrac));
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (Math.hypot(pts[mid][0], pts[mid][1]) < target) lo = mid;
    else hi = mid;
  }
  const ra = Math.hypot(pts[lo][0], pts[lo][1]);
  const rb = Math.hypot(pts[hi][0], pts[hi][1]);
  const t = clamp01((target - ra) / Math.max(1e-9, rb - ra));
  return [lerp(pts[lo][0], pts[hi][0], t), lerp(pts[lo][1], pts[hi][1], t)];
}

/** Sub-curve of a vein between two radius fractions. */
function veinSub(vein, r0, r1, steps = 9) {
  const out = [];
  for (let s = 0; s <= steps; s++) out.push(veinPointAtRadius(vein, lerp(r0, r1, s / steps)));
  return out;
}

/** Cross-vein curve between two veins at the same radius fraction. */
function crossAtRadius(veins, i, rFrac, bowSign) {
  const a = veinPointAtRadius(veins[i], rFrac);
  const b = veinPointAtRadius(veins[i + 1], rFrac);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1e-6;
  const bow = Math.min(len * 0.2, 0.03 * (1 + rFrac)) * bowSign;
  const mid = [(a[0] + b[0]) / 2 - (dy / len) * bow, (a[1] + b[1]) / 2 + (dx / len) * bow];
  const pts = [];
  const steps = 12;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const u = 1 - t;
    pts.push([u * u * a[0] + 2 * u * t * mid[0] + t * t * b[0], u * u * a[1] + 2 * u * t * mid[1] + t * t * b[1]]);
  }
  return pts;
}

function buildCrossVeins(veins, cutRadii) {
  const all = [];
  const n = veins.length;
  for (let i = 0; i < n - 1; i++) {
    const row = [];
    for (let j = 0; j < cutRadii.length; j++) {
      const bow = (hash01(`bow|${i}|${j}`) - 0.5) * 2;
      const pts = crossAtRadius(veins, i, cutRadii[j], bow);
      row.push(pts);
      all.push({ id: `cv${i}-${j}`, i, j, r: cutRadii[j], pts });
    }
    veins[i].crosses = row;
  }
  return all;
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

function buildCells(outline, veins, cutRadii, wingKey) {
  const cells = [];
  const n = veins.length;
  const stops = [0, ...cutRadii, 1];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < stops.length - 1; j++) {
      const r0 = stops[j];
      const r1 = stops[j + 1];
      const sideA = veinSub(veins[i], r0, r1, 9);
      const sideB = veinSub(veins[i + 1], r0, r1, 9);
      const isMarginal = j === stops.length - 2;
      let far;
      let near;
      if (isMarginal) {
        const tipA = veins[i].pts[veins[i].pts.length - 1];
        const tipB = veins[i + 1].pts[veins[i + 1].pts.length - 1];
        const ia = nearestIndex(outline, tipA);
        const ib = nearestIndex(outline, tipB);
        far = walkOutline(outline, ia, ib, 16);
        near = veins[i].crosses[j - 1] || [veins[i].pts[0], veins[i + 1].pts[0]];
      } else {
        const bow = (hash01(`bow|${i}|${j}`) - 0.5) * 2;
        far = crossAtRadius(veins, i, stops[j + 1], bow);
        near = j === 0 ? [veins[i].pts[0], veins[i + 1].pts[0]] : veins[i].crosses[j - 1];
      }
      const poly = [...sideA, ...far.slice(1, -1), ...sideB.slice().reverse(), ...near.slice().reverse().slice(1, -1)];
      const area = polyArea(poly);
      if (area < 1e-5) continue;
      cells.push({
        id: `${wingKey}-c${i}-${j}`,
        wing: wingKey,
        i,
        j,
        poly,
        centroid: polyCentroid(poly),
        area,
        bounds: polyBounds(poly),
        bandIndex: j,
        margin: isMarginal,
        cutFrac: r1
      });
    }
  }
  return cells;
}

function nearestIndex(outline, p) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < outline.length; i++) {
    const d = Math.hypot(outline[i][0] - p[0], outline[i][1] - p[1]);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

function walkOutline(outline, ia, ib, count) {
  const n = outline.length;
  const fwd = (ib - ia + n) % n;
  const back = (ia - ib + n) % n;
  const forward = fwd <= back;
  const steps = forward ? fwd : back;
  const pts = [];
  for (let k = 0; k <= steps; k++) pts.push(outline[forward ? (ia + k) % n : (ia - k + n) % n]);
  if (pts.length <= count) return pts;
  const table = arcTable(pts);
  const out = [];
  for (let k = 0; k < count; k++) out.push(pointAt(pts, k / (count - 1), table));
  return out;
}

// ---------------------------------------------------------------------------
// Secondary veinlets
// ---------------------------------------------------------------------------

function buildSecondary(cells, params, seed, side) {
  const out = [];
  if (params.veinDensity <= 0.15) return out;
  for (const cell of cells) {
    const ck = `${cell.i}|${cell.j}`;
    const r = hash01(`sv|${ck}|${seed}`);
    if (params.veinDensity < 0.42 && r > 0.45) continue;
    if (Math.sqrt(cell.area) < 0.05) continue;
    const c = cell.centroid;
    const n = 1 + Math.floor(r * 2.4);
    for (let k = 0; k < n; k++) {
      const ang = hash01(`sa|${ck}|${k}|${seed}`) * TAU;
      const reach = Math.sqrt(cell.area) * (0.3 + 0.3 * hash01(`sr|${ck}|${k}`));
      let far = null;
      for (let f = 1; f > 0.2; f -= 0.08) {
        const p = [c[0] + Math.cos(ang) * reach * f, c[1] + Math.sin(ang) * reach * f];
        if (pointInPolygon(p[0], p[1], cell.poly)) {
          far = p;
          break;
        }
      }
      if (!far) continue;
      const dx = far[0] - c[0];
      const dy = far[1] - c[1];
      const bow = (hash01(`sm|${ck}|${k}`) - 0.5) * 0.22;
      const mid = [(c[0] + far[0]) / 2 - dy * bow, (c[1] + far[1]) / 2 + dx * bow];
      const pts = [];
      for (let s = 0; s <= 6; s++) {
        const t = s / 6;
        const u = 1 - t;
        pts.push([u * u * c[0] + 2 * u * t * mid[0] + t * t * far[0], u * u * c[1] + 2 * u * t * mid[1] + t * t * far[1]]);
      }
      out.push({ id: `${cell.id}-sv${k}`, pts });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Margin band
// ---------------------------------------------------------------------------

/**
 * Margin band along the *outer* margin only. Each vertex is pulled toward the
 * wing root by `depth`, which follows the flare of the wing and never cuts
 * back across the wing near the hinge the way a whole-outline inset would.
 * Returns {outer, inner} strips of equal length, or null when too thin.
 */
function buildBand(outline, params) {
  const depth = params.marginBand * 0.09;
  if (depth < 0.006) return null;
  const n = outline.outerCount || outline.length;
  const outer = outline.slice(0, n);
  const inner = outer.map((p) => {
    const r = Math.hypot(p[0], p[1]) || 1e-6;
    const k = Math.max(0.02, 1 - depth / r);
    return [p[0] * k, p[1] * k];
  });
  return { outer, inner };
}

// ---------------------------------------------------------------------------
// Palette & cell colouring
// ---------------------------------------------------------------------------

/**
 * Palette with deliberate luminance separation: cells alternate between tones
 * that differ enough to read as separate patches at print size, and spots pick
 * a tone from the opposite end of the ramp.
 */
function buildPalette(params, rng) {
  const base = params.hueBase;
  const width = params.hueWidth;
  const sat = clamp(params.saturation, 0, 1);
  const light = clamp(params.lightness, 0.24, 0.78);

  const hue = (k) => ((base + width * k) % 360 + 360) % 360;

  // three cell tones with a fixed lightness gap (~0.10) around the base
  const toneLight = clamp(light + 0.17, 0.2, 0.92);
  const toneMid = clamp(light, 0.18, 0.8);
  const toneDeep = clamp(light - 0.17, 0.1, 0.7);
  const toneA = [hue(0.12), clamp(sat * 0.78), toneLight];
  const toneB = [hue(-0.1), clamp(sat * 0.86), toneMid];
  const toneC = [hue(0.26), clamp(sat * 0.74), toneDeep];

  const ground = [hue(0.18), clamp(sat * 0.6), clamp(light + 0.16, 0.2, 0.95)];
  const dark = [hue(0.04), clamp(sat * 0.5), clamp(light * 0.3, 0.04, 0.22)];
  const vein = [hue(0.02), clamp(sat * 0.5), clamp(light * 0.34, 0.04, 0.24)];
  // spots: one near-white, one near-black — both far from the cell tones
  const spotLight = [hue(-0.22), clamp(sat * 0.26), clamp(light + 0.34, 0.78, 0.98)];
  const spotDark = [hue(0.1), clamp(sat * 0.55), clamp(light * 0.2, 0.03, 0.14)];
  const accent = [hue(0.78), clamp(sat * 1.02, 0, 1), clamp(light + 0.02, 0.2, 0.9)];

  return { tones: [toneA, toneB, toneC], ground, dark, vein, spotLight, spotDark, accent, base, width };
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function adjust(c, dh, ds, dl) {
  return [((c[0] + dh) % 360 + 360) % 360, clamp(c[1] + ds), clamp(c[2] + dl)];
}

/**
 * Cell fill. A 2×2 checkerboard over (vein index, radial band) cycles the three
 * tones so that no two side-by-side cells share a tone, and the margin band
 * takes the darker tone. Manual colours bypass all of this.
 */
export function pickCellColor(palette, cell, seed, variant) {
  // hash on the side-free cell key so mirrored cells always match
  const h = hash01(`cc|${cell.i}|${cell.j}|${seed}|${variant}`);
  const tones = palette.tones;
  let c;
  if (cell.margin) {
    // margin cells sit under the band — give them a clear dark step so the
    // band edge reads even when the band itself is thin
    c = mix(tones[2], palette.dark, 0.72);
  } else {
    const parity = (cell.i + cell.bandIndex * 2) % 3;
    c = tones[parity];
    if (cell.bandIndex === 0) c = mix(c, palette.ground, 0.35);
  }
  // tiny stable per-cell variation keeps the wing from looking mechanically flat
  c = adjust(c, (h - 0.5) * 6, (h - 0.5) * 0.05, (h - 0.5) * 0.02);
  return c;
}

export function cellColor(specimen, wing, cell) {
  if (cell.color) return cell.color;
  return pickCellColor(wing.palette, cell, specimen.seed, specimen.variant);
}

// ---------------------------------------------------------------------------
// Spots
// ---------------------------------------------------------------------------

/**
 * Spots are allocated from an *area budget* rather than per-cell counts, so
 * all four wings end up with near-identical spot coverage at the same
 * parameters — which is what the density check compares.
 *
 * budget = coverageTarget * wingArea, split across cells by cell area; each
 * spot is drawn from its cell's share, and leftover share rolls into the
 * neighbour order deterministically.
 */
function buildSpots(wingKey, cells, palette, params, rng, seed, variant, wingArea) {
  const spots = [];
  const areaTarget = clamp(params.spotDensity, 0, 1) * 0.115;
  if (areaTarget <= 0.0005) return spots;
  const budget = areaTarget * (wingArea || cells.reduce((a, c) => a + c.area, 0));
  const sizeBase = 0.6 + 0.8 * params.spotSize;

  // pass 1: per-cell target area, proportional to cell area, weighted toward margin
  const weights = cells.map((c) => c.area * (c.margin ? 1.25 : 1));
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;

  let left = budget;
  for (let ci = 0; ci < cells.length && left > 1e-6; ci++) {
    const cell = cells[ci];
    const rArea = Math.sqrt(cell.area);
    if (rArea < 0.085) continue;
    let cellBudget = (budget * weights[ci]) / totalW;
    // do not let one cell take more than 55% of its own area
    cellBudget = Math.min(cellBudget, cell.area * 0.55);
    const cellTone = pickCellColor(palette, cell, seed, variant);
    // choose whichever ink separates further from this cell
    const cLight = contrastRatio(palette.spotLight, cellTone);
    const cDark = contrastRatio(palette.spotDark, cellTone);
    const ink = (cLight >= cDark ? palette.spotLight : palette.spotDark).slice();
    let guard = 0;
    while (cellBudget > 1e-6 && guard++ < 40) {
      const baseR = Math.max(0.016, rArea * 0.085 * sizeBase) * rng.range(0.72, 1.1);
      const maxR = rArea * 0.2;
      const rr = Math.min(baseR, maxR);
      const area = Math.PI * rr * rr;
      if (area > cellBudget * 1.35) break;
      const b = cell.bounds;
      let p = cell.centroid;
      const local = spots.filter((x) => x.cellId === cell.id);
      for (let tries = 0; tries < 44; tries++) {
        const cand = [rng.range(b.minX, b.maxX), rng.range(b.minY, b.maxY)];
        if (!pointInPolygon(cand[0], cand[1], cell.poly)) continue;
        if (distToPolygonBoundary(cand[0], cand[1], cell.poly) < rr * 0.9) continue;
        let clash = false;
        for (const other of local) {
          if (Math.hypot(other.x - cand[0], other.y - cand[1]) < (rr + Math.max(other.rx, other.ry)) * 1.15) {
            clash = true;
            break;
          }
        }
        if (clash) continue;
        p = cand;
        break;
      }
      const elong = rng.range(0.84, 1.18);
      spots.push({
        id: `${cell.id}-s${spots.length}`,
        cellId: cell.id,
        wing: wingKey,
        x: p[0],
        y: p[1],
        rx: rr * elong,
        ry: rr / elong,
        rot: rng.range(0, TAU),
        color: ink,
        accent: false,
        source: 'auto'
      });
      cellBudget -= area;
      left -= area;
    }
  }
  return spots;
}

// ---------------------------------------------------------------------------
// Wing assembly
// ---------------------------------------------------------------------------

/**
 * Build one wing from the SEED-FREE rng stream, then mirror it for the other
 * side. Both sides therefore derive from one geometry; the only thing that can
 * make them differ is params.asymmetry, applied afterwards by `makeAsymmetric`.
 */
function buildWingGeometry(species, kind, params, seed, variant) {
  const def = kind === 'fore' ? species.fore : species.hind;
  const rng = new Rng(`${seed}|${species.id}|${kind}|${variant}|geo`);
  const wobble = makeWobble(rng, 0.012);
  const outline = buildOutline(def, wobble);
  const veins = buildVeins(def, outline, params, rng);
  const cutRadii = cutFractions(def, params);
  const crossVeins = buildCrossVeins(veins, cutRadii);
  const cells = buildCells(outline, veins, cutRadii, kind);
  const secondary = buildSecondary(cells, params, seed, 'neutral');
  const palette = buildPalette(params, rng);
  const wingArea = polyArea(outline);
  const spots = buildSpots(kind, cells, palette, params, rng, seed, variant, wingArea);
  const band = buildBand(outline, params);
  return { kind, def, outline, veins, crossVeins, cells, secondary, palette, spots, band, seed, variant };
}

/** Append the wing key to every id so the two sides stay independently referenceable. */
function keyed(geometry, side) {
  const wingKey = `${geometry.kind}-${side}`;
  const fix = (id) => `${wingKey}-${id.replace(/^(fore|hind)-/, '')}`;
  return {
    key: wingKey,
    kind: geometry.kind,
    side,
    poly: geometry.outline,
    outlineTri: triangulate(geometry.outline),
    band: geometry.band,
    bandColor: geometry.palette.dark,
    veins: geometry.veins.map((v) => ({ ...v, id: `v${v.q != null ? '' : ''}` })),
    crossVeins: geometry.crossVeins.map((c) => ({ ...c, id: c.id })),
    secondary: geometry.secondary.map((sv) => ({ ...sv, id: fix(sv.id) })),
    cells: geometry.cells.map((c) => ({ ...c, id: fix(c.id), wing: wingKey })),
    spots: geometry.spots.map((sp) => ({ ...sp, id: fix(sp.id), cellId: fix(sp.cellId), wing: wingKey })),
    palette: geometry.palette,
    bounds: polyBounds(geometry.outline),
    maxR: Math.max(...geometry.outline.map((p) => Math.hypot(p[0], p[1])))
  };
}

/** Push points that fell outside the (possibly perturbed) outline back inside. */
function warpPointsToward(pts, outline) {
  return pts.map((p) => {
    if (pointInPolygon(p[0], p[1], outline)) return p;
    const c = polyCentroid(outline);
    for (let f = 0.9; f > 0.05; f -= 0.1) {
      const q = [c[0] + (p[0] - c[0]) * f, c[1] + (p[1] - c[1]) * f];
      if (pointInPolygon(q[0], q[1], outline)) return q;
    }
    return c;
  });
}

/**
 * Apply the symmetry disturbance. Left and right wings are compared in their
 * own outward-pointing frames, so "symmetric" means identical local geometry.
 * `params.asymmetry` pushes small, seeded offsets that differ per side: this is
 * the only source of left/right deviation.
 */
function makeAsymmetric(wing, params, seed, variant) {
  const amp = params.asymmetry;
  if (!amp || amp <= 0) return wing;
  const key = `${seed}|${wing.kind}|${wing.side}|${variant}`;
  const k = amp * 6.5;
  // outline: radial perturbation, smooth along the outline
  let phase = hash01(`ao|${key}`) * TAU;
  let freq = 2 + Math.floor(hash01(`af|${key}`) * 3);
  wing.poly = wing.poly.map((p, i) => {
    const r = Math.hypot(p[0], p[1]);
    if (r < 1e-6) return p;
    const u = i / wing.poly.length;
    const d = Math.sin(u * TAU * freq + phase) * k * 0.55 * Math.min(1, r * 2.2);
    const s = (r + d) / r;
    return [p[0] * s, p[1] * s];
  });
  wing.outlineTri = triangulate(wing.poly);
  wing.bounds = polyBounds(wing.poly);
  wing.maxR = Math.max(...wing.poly.map((p) => Math.hypot(p[0], p[1])));
  if (wing.band) {
    wing.band = buildBand(wing.poly, params);
  }
  // spots drift
  wing.spots = wing.spots.map((sp) => {
    const a = hash01(`as|${key}|${sp.id}`) * TAU;
    const rr = k * 0.7 * hash01(`ar|${key}|${sp.id}`);
    return { ...sp, x: sp.x + Math.cos(a) * rr, y: sp.y + Math.sin(a) * rr };
  });
  // veins and cells keep their generated topology; only their points near the
  // new margin are nudged outward so they do not detach from the outline.
  if (wing.veins) {
    wing.veins = wing.veins.map((v) => ({ ...v, pts: warpPointsToward(v.pts, wing.poly) }));
  }
  if (wing.crossVeins) {
    wing.crossVeins = wing.crossVeins.map((c) => ({ ...c, pts: warpPointsToward(c.pts, wing.poly) }));
  }
  return wing;
}

/**
 * Variants are four *interpretations* of one parameter set. Each variant
 * applies a small, fixed, deterministic offset to a subset of the parameters —
 * different wing proportions, a different spot budget, a different hue push.
 * Variant 0 is the user's parameters exactly as set. Because the offset is
 * fixed (not random), each variant is itself perfectly reproducible from
 * (seed, params, variant).
 */
export const VARIANT_OFFSETS = [
  { label: '原样', note: '完全按当前参数', offset: {} },
  { label: '宽翅', note: '翅幅 +8%，斑点略疏', offset: { wingWidth: 0.08, spotDensity: -0.1, hindRatio: 0.03 } },
  { label: '密纹', note: '翅脉更密，斑点更多', offset: { veinDensity: 0.16, spotDensity: 0.14, spotSize: -0.08 } },
  { label: '深红', note: '色相转红，色域更收，边缘带更宽', offset: { hueBase: -26, hueWidth: -16, marginBand: 0.14, lightness: -0.05 } }
];

function applyVariantOffset(params, variant) {
  const spec = VARIANT_OFFSETS[variant % VARIANT_OFFSETS.length];
  if (!spec || !spec.offset) return params;
  const out = { ...params };
  for (const [k, d] of Object.entries(spec.offset)) {
    out[k] = Number(params[k]) + d;
  }
  return out;
}

export function generateSpecimen({ speciesId, params, seed, variant = 0 }) {
  const species = getSpecies(speciesId);
  const p = clampParams(applyVariantOffset(params, variant));
  const variantKey = String(variant);
  const wings = [];
  for (const kind of ['hind', 'fore']) {
    const geom = buildWingGeometry(species, kind, p, seed, variantKey);
    for (const side of ['right', 'left']) {
      const wing = makeAsymmetric(keyed(geom, side), p, seed, variantKey);
      wings.push(wing);
    }
  }
  const specimen = {
    id: `${seed}-v${variant}`,
    speciesId: species.id,
    speciesName: species.name,
    seed: String(seed),
    variant,
    variantLabel: VARIANT_OFFSETS[variant % VARIANT_OFFSETS.length]?.label || '',
    variantNote: VARIANT_OFFSETS[variant % VARIANT_OFFSETS.length]?.note || '',
    params: p,
    baseParams: clampParams(params),
    wings,
    fingerprint: fingerprint({
      species: species.id,
      seed: String(seed),
      variant: variantKey,
      params: PARAM_META.map((m) => Number(p[m.key]).toFixed(5))
    }),
    createdAt: Date.now()
  };
  layoutWings(specimen);
  return specimen;
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

export function layoutWings(specimen) {
  const p = specimen.params;
  const cx = ARTBOARD.width * 0.5;
  const cy = ARTBOARD.height * 0.5 - 1;
  // 翅长 drives the vertical scale, 翅宽 the horizontal scale
  const lenScale = 0.72 + 0.42 * p.wingLength;
  const widScale = 0.7 + 0.58 * p.wingWidth;
  for (const wing of specimen.wings) {
    const isLeft = wing.side === 'left';
    const isFore = wing.kind === 'fore';
    const sideSign = isLeft ? -1 : 1;
    const hindS = isFore ? 1 : 0.62 + 0.42 * p.hindRatio;
    const sx = sideSign * WING_UNIT * widScale * (0.94 + 0.08 * hindS);
    const sy = WING_UNIT * lenScale * hindS * (isFore ? 1 : 0.98);
    const rootX = cx + sideSign * 2.4;
    const rootY = cy + (isFore ? -1.4 : 2.0);
    wing.transform = { a: sx, b: 0, c: 0, d: sy, e: rootX, f: rootY };
    wing.sideSign = sideSign;
  }
  specimen.artboard = ARTBOARD;
  specimen.body = { x: cx, y: cy };
  return specimen;
}

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

export function emptyOverrides() {
  return { cells: {}, spots: {} };
}

export function applyOverrides(specimen, overrides) {
  const ov = overrides || emptyOverrides();
  const cellOv = ov.cells || {};
  const spotOv = ov.spots || {};
  for (const wing of specimen.wings) {
    for (const cell of wing.cells) {
      const o = cellOv[cell.id];
      if (o) {
        if (o.hue != null) cell.color = [o.hue, o.sat, o.light];
        cell.locked = !!o.locked;
        cell.edited = !!(o.hue != null || o.locked);
      } else {
        cell.color = null;
        cell.locked = false;
        cell.edited = false;
      }
    }
    for (const spot of wing.spots) {
      const o = spotOv[spot.id];
      if (o) {
        spot.x += o.dx || 0;
        spot.y += o.dy || 0;
        if (o.sizeMul) {
          spot.rx *= o.sizeMul;
          spot.ry *= o.sizeMul;
        }
        spot.edited = true;
      } else {
        spot.edited = false;
      }
    }
  }
  specimen.overrides = ov;
  return specimen;
}

export function computeStats(specimen) {
  let cellCount = 0;
  let spotCount = 0;
  let area = 0;
  let spotArea = 0;
  for (const wing of specimen.wings) {
    cellCount += wing.cells.length;
    spotCount += wing.spots.length;
    area += polyArea(wing.poly);
    for (const s of wing.spots) spotArea += Math.PI * s.rx * s.ry;
  }
  return {
    cellCount,
    spotCount,
    area,
    spotCoverage: spotArea / Math.max(1e-6, area),
    spotDensityPerArea: spotCount / Math.max(1e-6, area)
  };
}

export function artboardBounds(specimen) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const wing of specimen.wings) {
    const m = wing.transform;
    for (const p of wing.poly) {
      const x = m.a * p[0] + m.c * p[1] + m.e;
      const y = m.b * p[0] + m.d * p[1] + m.f;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
