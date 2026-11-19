// Scene builder: turns a specimen into flat triangle primitives in artboard
// coordinates. Shared by the WebGPU renderer, the PNG/SVG exporters and the
// headless debug renderer, so every surface shows identical art.
//
// Primitives are grouped into four display layers (翅形 / 翅室 / 翅脉 / 斑点)
// plus a "detail" layer for the body. Within each layer, primitives are emitted
// in a fixed paint order so that a plain triangle list reproduces the artwork.

import { hslToRgb } from './color.js';
import { cellColor } from './generator.js';
import { ellipsePoints, transformPoint, TAU } from './geometry.js';
import { pointInPolygon } from './geometry.js';
import { bodyShapes } from './body.js';

/** Paint order across layers. */
export const PAINT_ORDER = ['fill', 'cells', 'band', 'veins', 'outline', 'spots', 'detail', 'overlay'];

/** Which paint stages belong to each user-facing layer toggle. */
export const LAYER_GROUPS = {
  shape: ['fill', 'band', 'outline'],
  cells: ['cells'],
  veins: ['veins'],
  spots: ['spots'],
  detail: ['detail']
};

export const LAYER_INFO = [
  { key: 'shape', label: '翅形', hint: '轮廓、底色与边缘带' },
  { key: 'cells', label: '翅室', hint: '翅室分区填色' },
  { key: 'veins', label: '翅脉', hint: '主脉、横脉与细脉' },
  { key: 'spots', label: '斑点', hint: '斑点与眼纹' },
  { key: 'detail', label: '虫体', hint: '躯干与触角' }
];

const W = {
  outline: 0.012,
  vein: 0.0075,
  cross: 0.0046,
  secondary: 0.0024,
  cellEdge: 0.002,
  spotRim: 0.0026
};

export function rgba(c, alpha = 1) {
  const [r, g, b] = hslToRgb(c[0], c[1], c[2]);
  return [r, g, b, alpha];
}

class Layer {
  constructor() {
    this.pos = [];
    this.col = [];
  }
  tri(a, b, c, color) {
    this.pos.push(a[0], a[1], b[0], b[1], c[0], c[1]);
    for (let i = 0; i < 3; i++) this.col.push(color[0], color[1], color[2], color[3]);
  }
  poly(points, color) {
    for (let i = 1; i + 1 < points.length; i++) this.tri(points[0], points[i], points[i + 1], color);
  }
  line(points, width, color, closed = false) {
    const hw = width / 2;
    const n = points.length;
    const segs = closed ? n : n - 1;
    const stops = [];
    for (let i = 0; i < segs; i++) {
      const a = points[i];
      const b = points[(i + 1) % n];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dx, dy);
      if (l < 1e-7) continue;
      const nx = (-dy / l) * hw;
      const ny = (dx / l) * hw;
      const ex = (dx / l) * hw * 0.85;
      const ey = (dy / l) * hw * 0.85;
      const p0 = [a[0] - ex + nx, a[1] - ey + ny];
      const p1 = [a[0] - ex - nx, a[1] - ey - ny];
      const p2 = [b[0] + ex - nx, b[1] + ey - ny];
      const p3 = [b[0] + ex + nx, b[1] + ey + ny];
      this.tri(p0, p1, p2, color);
      this.tri(p0, p2, p3, color);
      stops.push(a);
    }
    if (closed) {
      // round joins: a small disc at every vertex hides the thin wedge gaps
      const r = hw;
      for (const v of points) {
        const seg = 6;
        for (let k = 0; k < seg; k++) {
          const a0 = (k / seg) * TAU;
          const a1 = ((k + 1) / seg) * TAU;
          this.tri(v, [v[0] + Math.cos(a0) * r, v[1] + Math.sin(a0) * r], [v[0] + Math.cos(a1) * r, v[1] + Math.sin(a1) * r], color);
        }
      }
    }
    return stops;
  }
  get empty() {
    return this.pos.length === 0;
  }
}

function xf(wing, p) {
  return transformPoint(p, wing.transform);
}

function xfPath(wing, pts) {
  return pts.map((p) => xf(wing, p));
}

function scaleOf(m) {
  return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
}

/**
 * @param {object} specimen
 * @param {object} [opts]
 * @param {boolean} [opts.selection] emit selection/lock overlay primitives
 * @param {object} [opts.selectionInfo] {cellId, spotId, hoverCellId, hoverSpotId, lockCellIds}
 * @param {boolean} [opts.showSecondary=true]
 * @param {object} [opts.wingFilter] optional Set of wing keys to draw
 */
export function buildScene(specimen, opts = {}) {
  const L = {};
  for (const k of PAINT_ORDER) L[k] = new Layer();
  const wingFilter = opts.wingFilter || null;
  const wings = specimen.wings.filter((w) => !wingFilter || wingFilter.has(w.key));

  // ---------- body & antennae ----------
  {
    const shapes = bodyShapes(specimen);
    for (const f of shapes.fills) L.detail.poly(f.poly, rgba(f.color, 1));
    for (const l of shapes.lines) L.detail.line(l.pts, l.width, rgba(l.color, 1), !!l.closed);
  }

  // ---------- wings ----------
  for (const wing of wings) {
    const pal = wing.palette;
    const m = wing.transform;
    const s = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
    const darkCol = rgba(pal.dark, 1);

    // silhouette fill
    for (let i = 0; i + 5 < wing.outlineTri.length; i += 6) {
      const a = xf(wing, [wing.outlineTri[i], wing.outlineTri[i + 1]]);
      const b = xf(wing, [wing.outlineTri[i + 2], wing.outlineTri[i + 3]]);
      const c = xf(wing, [wing.outlineTri[i + 4], wing.outlineTri[i + 5]]);
      L.fill.tri(a, b, c, rgba(pal.ground, 1));
    }

    // cells
    for (const cell of wing.cells) {
      const c = cellColor(specimen, wing, cell);
      const poly = xfPath(wing, cell.poly);
      L.cells.poly(poly, rgba(c, 1));
      L.cells.line(poly, W.cellEdge * s, rgba([c[0], Math.min(1, c[1] + 0.04), Math.max(0.02, c[2] - 0.12)], 0.5), true);
    }

    // margin band, drawn above cells, along the outer margin only
    if (wing.band) {
      const outer = xfPath(wing, wing.band.outer);
      const inner = xfPath(wing, wing.band.inner);
      const n = outer.length;
      for (let i = 0; i < n - 1; i++) {
        L.band.tri(outer[i], outer[i + 1], inner[i + 1], rgba(wing.bandColor, 0.95));
        L.band.tri(outer[i], inner[i + 1], inner[i], rgba(wing.bandColor, 0.95));
      }
      // scalloped inner edge for a hand-cut look
      L.band.line(inner, 0.0045, rgba([wing.bandColor[0], wing.bandColor[1], Math.min(0.9, wing.bandColor[2] + 0.12)], 0.8));
    }

    // veins
    for (const v of wing.veins) L.veins.line(xfPath(wing, v.pts), W.vein * s, rgba(pal.dark, 0.95));
    for (const cv of wing.crossVeins) L.veins.line(xfPath(wing, cv.pts), W.cross * s, rgba(pal.dark, 0.9));
    if (opts.showSecondary !== false) {
      for (const sv of wing.secondary) L.veins.line(xfPath(wing, sv.pts), W.secondary * s, rgba(pal.dark, 0.42));
    }

    // outline stroke
    L.outline.line(xfPath(wing, wing.poly), W.outline * s, darkCol, true);

    // spots
    for (const spot of wing.spots) {
      const pts = ellipsePoints(spot.x, spot.y, spot.rx, spot.ry, spot.rot, 24).map((p) => xf(wing, p));
      L.spots.poly(pts, rgba(spot.color, spot.accent ? 0.98 : 0.96));
      L.spots.line(pts, W.spotRim * s, rgba([spot.color[0], spot.color[1] * 0.85, Math.max(0.04, spot.color[2] - 0.2)], 0.75), true);
      if (spot.accent) {
        const inner = ellipsePoints(spot.x, spot.y, spot.rx * 0.4, spot.ry * 0.4, spot.rot, 18).map((p) => xf(wing, p));
        L.spots.poly(inner, rgba([spot.color[0], spot.color[1], Math.min(0.98, spot.color[2] + 0.3)], 0.95));
      }
    }
  }

  // ---------- overlay ----------
  if (opts.selection) {
    const ov = L.overlay;
    const sel = opts.selectionInfo || {};
    for (const wing of wings) {
      const s = Math.sqrt(Math.abs(wing.transform.a * wing.transform.d - wing.transform.b * wing.transform.c));
      for (const cell of wing.cells) {
        if (cell.locked) {
          // subtle gold tint + a lock glyph, so a locked cell reads instantly
          // without competing with the artwork itself
          const poly = xfPath(wing, cell.poly);
          ov.poly(poly, [0.98, 0.8, 0.33, 0.1]);
          ov.line(poly, 0.34, [0.98, 0.8, 0.33, 0.5], true);
          const c = xf(wing, cell.centroid);
          drawLockGlyph(ov, c);
        }
        if (cell.id === sel.cellId) {
          const poly = xfPath(wing, cell.poly);
          ov.poly(poly, [0.98, 0.8, 0.3, 0.16]);
          ov.line(poly, 0.45, [0.99, 0.84, 0.36, 1], true);
        } else if (cell.id === sel.hoverCellId) {
          const poly = xfPath(wing, cell.poly);
          ov.poly(poly, [1, 1, 1, 0.06]);
          ov.line(poly, 0.3, [1, 1, 1, 0.55], true);
        }
      }
      for (const spot of wing.spots) {
        if (spot.id === sel.spotId) {
          const ring = ellipsePoints(spot.x, spot.y, spot.rx * 1.6 + 0.5, spot.ry * 1.6 + 0.5, spot.rot, 28).map((p) => xf(wing, p));
          ov.line(ring, 0.5, [0.98, 0.78, 0.24, 1], true);
        } else if (spot.id === sel.hoverSpotId) {
          const ring = ellipsePoints(spot.x, spot.y, spot.rx * 1.3 + 0.3, spot.ry * 1.3 + 0.3, spot.rot, 22).map((p) => xf(wing, p));
          ov.line(ring, 0.3, [1, 1, 1, 0.55], true);
        }
      }
    }
    if (sel.spotId) {
      const found = findSpot(specimen, sel.spotId);
      if (found) {
        const { wing, spot } = found;
        const c = xf(wing, [spot.x, spot.y]);
        const s = Math.sqrt(Math.abs(wing.transform.a * wing.transform.d - wing.transform.b * wing.transform.c));
        const r = Math.max(0.7, 0.55 * s * 0.08);
        ov.poly(ellipsePoints(c[0], c[1], r, r, 0, 14), [0.98, 0.78, 0.24, 1]);
        ov.line(ellipsePoints(c[0], c[1], r + 0.4, r + 0.4, 0, 18), 0.1, [0.08, 0.08, 0.08, 0.8], true);
        const hx = c[0] + r * 2.0;
        const hy = c[1];
        ov.line([c, [hx, hy]], 0.13, [1, 1, 1, 0.8]);
        ov.poly(ellipsePoints(hx, hy, 0.75, 0.75, 0, 12), [1, 1, 1, 0.97]);
        ov.line(ellipsePoints(hx, hy, 0.75, 0.75, 0, 12), 0.1, [0.08, 0.08, 0.08, 0.85], true);
      }
    }
  }

  // ---------- pack ----------
  const out = {};
  for (const k of PAINT_ORDER) {
    const layer = L[k];
    out[k] = layer.empty
      ? null
      : { positions: new Float32Array(layer.pos), colors: new Float32Array(layer.col), vertexCount: layer.pos.length / 2 };
  }
  out.triangleCount = Object.values(out).reduce((n, l) => n + (l ? l.vertexCount / 3 : 0), 0);
  return out;
}

/** Small padlock glyph drawn from primitives, in artboard units. */
function drawLockGlyph(layer, c) {
  const col = [0.98, 0.82, 0.4, 0.95];
  const dark = [0.12, 0.1, 0.05, 0.9];
  const w = 1.15;
  const h = 0.95;
  // body
  layer.poly(
    [
      [c[0] - w, c[1] - h * 0.1],
      [c[0] + w, c[1] - h * 0.1],
      [c[0] + w, c[1] + h],
      [c[0] - w, c[1] + h]
    ],
    col
  );
  // shackle
  const arc = [];
  const r0 = 0.72;
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI + (Math.PI * i) / 12;
    arc.push([c[0] + Math.cos(a) * r0, c[1] - h * 0.1 + Math.sin(a) * r0]);
  }
  layer.line(arc, 0.34, col);
  // keyhole
  layer.poly(ellipsePoints(c[0], c[1] + h * 0.34, 0.19, 0.19, 0, 8), dark);
}

export function findSpot(specimen, id) {
  for (const wing of specimen.wings) {
    const spot = wing.spots.find((s) => s.id === id);
    if (spot) return { wing, spot };
  }
  return null;
}

export function wingToArtboard(wing, p) {
  return transformPoint(p, wing.transform);
}

export function artboardToWing(wing, p) {
  const m = wing.transform;
  const det = m.a * m.d - m.b * m.c || 1e-9;
  const x = p[0] - m.e;
  const y = p[1] - m.f;
  return [(m.d * x - m.c * y) / det, (-m.b * x + m.a * y) / det];
}
