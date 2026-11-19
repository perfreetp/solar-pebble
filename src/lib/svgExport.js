// Vector export: emits the wing as real SVG shapes (outlines, cell paths,
// vein strokes, spot ellipses), grouped by layer — not as the triangle soup
// the raster viewport uses. This is what ships in the asset package, so it
// stays editable in Illustrator / Figma.
//
// Two entry points:
//   wingToSvg(specimen, wing)       single wing, local coordinates
//   specimenToSvg(specimen, opts)   whole butterfly, artboard coordinates

import { hslCss } from './color.js';
import { cellColor } from './generator.js';
import { bodyShapes } from './body.js';

function n(v) {
  return Math.round(v * 1000) / 1000;
}

function pathFromPoly(poly, transform = null) {
  const pts = transform ? poly.map(transform) : poly;
  if (!pts.length) return '';
  let d = `M${n(pts[0][0])} ${n(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) d += `L${n(pts[i][0])} ${n(pts[i][1])}`;
  return d + 'Z';
}

function linePath(pts, transform = null) {
  const p = transform ? pts.map(transform) : pts;
  if (!p.length) return '';
  let d = `M${n(p[0][0])} ${n(p[0][1])}`;
  for (let i = 1; i < p.length; i++) d += `L${n(p[i][0])} ${n(p[i][1])}`;
  return d;
}

function ellipsePath(cx, cy, rx, ry, rot) {
  // SVG arc-based ellipse path, avoids transform attributes
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const p0 = [cx + rx * c, cy + rx * s];
  const p1 = [cx - rx * c, cy - rx * s];
  return `M${n(p0[0])} ${n(p0[1])}A${n(rx)} ${n(ry)} ${n((rot * 180) / Math.PI)} 1 0 ${n(p1[0])} ${n(p1[1])}A${n(rx)} ${n(ry)} ${n((rot * 180) / Math.PI)} 1 0 ${n(p0[0])} ${n(p0[1])}Z`;
}

function transformOf(wing, extraScale = 1) {
  const m = wing.transform;
  return (p) => [m.a * p[0] + m.c * p[1] + m.e, m.b * p[0] + m.d * p[1] + m.f];
}

function strokeScale(wing) {
  return Math.sqrt(Math.abs(wing.transform.a * wing.transform.d - wing.transform.b * wing.transform.c));
}

/**
 * @param {object} specimen
 * @param {object} wing
 * @param {{layers?: string[], scale?: number}} [opts]
 */
export function wingToSvg(specimen, wing, opts = {}) {
  // opts.coords = 'artboard' (default) or 'local' — local keeps the wing in its
  // own frame (hinge at origin, unit wing length), which is what a maker wants
  // when dropping a single wing into a layout.
  const local = opts.coords === 'local';
  const artScale = strokeScale(wing);
  const tf = local ? (p) => [p[0] * artScale, p[1] * artScale] : transformOf(wing);
  const s = local ? 1 : artScale / 44;
  const layers = opts.layers || ['shape', 'cells', 'veins', 'spots'];
  const parts = [];
  const pal = wing.palette;

  const has = (k) => layers.includes(k);
  const groups = [];

  if (has('shape')) {
    const g = [];
    g.push(`<path id="wing-fill" d="${pathFromPoly(wing.poly, tf)}" fill="${hslCss(pal.ground)}" stroke="none"/>`);
    g.push(`<path id="outline" d="${pathFromPoly(wing.poly, tf)}" fill="none" stroke="${hslCss(pal.dark)}" stroke-width="${n(0.5 * s)}" stroke-linejoin="round"/>`);
    if (wing.band) {
      const d =
        linePath(wing.band.outer, tf) +
        'L' + n(tf(wing.band.inner[wing.band.inner.length - 1])[0]) + ' ' + n(tf(wing.band.inner[wing.band.inner.length - 1])[1]) +
        linePath(wing.band.inner.slice().reverse(), tf).replace('M', 'L') +
        'Z';
      g.push(`<path id="margin-band" class="margin-band" d="${d}" fill="${hslCss(wing.bandColor)}" fill-rule="evenodd" stroke="none"/>`);
    }
    for (const f of []) g.push(f);
    groups.push(['shape', g.join('')]);
  }

  if (has('cells')) {
    const g = [];
    for (const cell of wing.cells) {
      const color = cellColor(specimen, wing, cell);
      g.push(
        `<path id="${cell.id}" class="wing-cell${cell.locked ? ' locked' : ''}${cell.edited ? ' edited' : ''}" data-cell="${cell.id}" d="${pathFromPoly(
          cell.poly,
          tf
        )}" fill="${hslCss(color)}" stroke="${hslCss([color[0], Math.min(1, color[1] + 0.04), Math.max(0.02, color[2] - 0.12)])}" stroke-width="${n(
          0.12 * s
        )}" stroke-opacity="0.55"/>`
      );
    }
    groups.push(['cells', g.join('')]);
  }

  if (has('veins')) {
    const g = [];
    for (const v of wing.veins) g.push(`<path class="vein" d="${linePath(v.pts, tf)}" fill="none" stroke="${hslCss(pal.vein)}" stroke-width="${n(0.62 * s)}" stroke-linecap="round"/>`);
    for (const cv of wing.crossVeins) g.push(`<path class="cross-vein" d="${linePath(cv.pts, tf)}" fill="none" stroke="${hslCss(pal.vein)}" stroke-width="${n(0.4 * s)}" stroke-linecap="round"/>`);
    for (const sv of wing.secondary) g.push(`<path class="veinlet" d="${linePath(sv.pts, tf)}" fill="none" stroke="${hslCss(pal.vein)}" stroke-width="${n(0.22 * s)}" stroke-linecap="round" stroke-opacity="0.5"/>`);
    groups.push(['veins', g.join('')]);
  }

  if (has('spots')) {
    const g = [];
    for (const spot of wing.spots) {
      const [cx, cy] = tf([spot.x, spot.y]);
      const sc = strokeScale(wing);
      g.push(
        `<path id="${spot.id}" class="wing-spot" data-spot="${spot.id}" d="${ellipsePath(cx, cy, spot.rx * sc, spot.ry * sc, spot.rot)}" fill="${hslCss(
          spot.color
        )}" stroke="${hslCss([spot.color[0], spot.color[1] * 0.85, Math.max(0.04, spot.color[2] - 0.2)])}" stroke-width="${n(0.14 * s)}" stroke-opacity="0.75"/>`
      );
      if (spot.accent) {
        g.push(
          `<path class="spot-core" d="${ellipsePath(cx, cy, spot.rx * sc * 0.42, spot.ry * sc * 0.42, spot.rot)}" fill="${hslCss([
            spot.color[0],
            spot.color[1],
            Math.min(0.98, spot.color[2] + 0.3)
          ])}" stroke="none"/>`
        );
      }
    }
    groups.push(['spots', g.join('')]);
  }

  return groups;
}

const WING_LABEL = { 'fore-right': '前翅·右', 'fore-left': '前翅·左', 'hind-right': '后翅·右', 'hind-left': '后翅·左' };

export function specimenToSvg(specimen, opts = {}) {
  const width = 168;
  const height = 122;
  const layers = opts.layers || ['shape', 'cells', 'veins', 'spots'];
  const wingFilter = opts.wingFilter || null;
  const groups = [];
  for (const wing of specimen.wings) {
    if (wingFilter && !wingFilter.has(wing.key)) continue;
    const sub = wingToSvg(specimen, wing, { layers });
    for (const [name, markup] of sub) groups.push([`${wing.key}-${name}`, markup]);
  }
  // body on top
  const shapes = bodyShapes(specimen);
  if (!wingFilter || true) {
    const g = [];
    for (const f of shapes.fills) g.push(`<path d="${pathFromPoly(f.poly)}" fill="${hslCss(f.color)}" stroke="none"/>`);
    for (const l of shapes.lines) {
      g.push(`<path d="${linePath(l.pts)}${l.closed ? 'Z' : ''}" fill="none" stroke="${hslCss(l.color)}" stroke-width="${l.width}" stroke-linecap="round"/>`);
    }
    groups.push(['body', g.join('')]);
  }
  const title = opts.title || `${specimen.speciesName} · ${specimen.seed} · 变体 ${specimen.variant + 1}`;
  const bg = opts.background ? `<rect width="${width}" height="${height}" fill="${opts.background}"/>` : '';
  // no width/height attributes: let CSS size the element so it fills its box
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
<title>${escapeXml(title)}</title>
<desc>物种 ${escapeXml(specimen.speciesName)} · 种子 ${escapeXml(String(specimen.seed))} · 指纹 ${specimen.fingerprint}</desc>
${bg}${groups.map(([name, markup]) => `<g id="${name}">${markup}</g>`).join('\n')}
</svg>`;
}

function escapeXml(s) {
  return String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
}
