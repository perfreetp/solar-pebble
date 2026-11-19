// Body, head and antennae geometry in artboard coordinates. Shared by the
// WebGPU scene builder and the vector exporter so both draw the same insect.

import { ellipsePoints } from './geometry.js';

/**
 * @returns {{
 *   fills: Array<{poly: number[][], color: number[]}>,
 *   lines: Array<{pts: number[][], width: number, color: number[], closed?: boolean}>
 * }}
 * Colours are HSL triples.
 */
export function bodyShapes(specimen) {
  const body = specimen.body;
  const fills = [];
  const lines = [];
  if (!body) return { fills, lines };
  const palette = specimen.wings[0]?.palette || { dark: [30, 0.3, 0.12] };
  const bodyColor = [30, 0.24, 0.2];
  const edgeColor = [30, 0.32, 0.08];

  const segs = 30;
  const baseY = body.y + 2;
  const len = 24;
  const halfWidth = (t) => 2.5 * Math.sin(Math.PI * (0.22 + t * 0.74)) * (1 - t * 0.3);
  const abdomen = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    abdomen.push([body.x + halfWidth(t), baseY + t * len]);
  }
  for (let i = segs; i >= 0; i--) {
    const t = i / segs;
    abdomen.push([body.x - halfWidth(t), baseY + t * len]);
  }
  fills.push({ poly: abdomen, color: bodyColor });
  for (let i = 1; i < 7; i++) {
    const t = i / 7.4;
    const y = baseY + t * len;
    const w = halfWidth(t);
    lines.push({ pts: [[body.x - w * 0.9, y], [body.x + w * 0.9, y]], width: 0.16, color: edgeColor });
  }

  const thorax = ellipsePoints(body.x, body.y, 5.2, 10.2, 0, 32);
  fills.push({ poly: thorax, color: bodyColor });
  lines.push({ pts: thorax, width: 0.16, color: edgeColor, closed: true });

  const head = ellipsePoints(body.x, body.y - 11.4, 4.3, 4.7, 0, 26);
  fills.push({ poly: head, color: bodyColor });
  fills.push({ poly: ellipsePoints(body.x - 3.0, body.y - 12.0, 1.4, 1.8, 0, 14), color: edgeColor });
  fills.push({ poly: ellipsePoints(body.x + 3.0, body.y - 12.0, 1.4, 1.8, 0, 14), color: edgeColor });

  for (const side of [-1, 1]) {
    const base = [body.x + side * 1.7, body.y - 14.5];
    const tip = [body.x + side * 13.0, body.y - 28.5];
    const ctrl = [body.x + side * 10.2, body.y - 23.5];
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const u = 1 - t;
      pts.push([u * u * base[0] + 2 * u * t * ctrl[0] + t * t * tip[0], u * u * base[1] + 2 * u * t * ctrl[1] + t * t * tip[1]]);
    }
    lines.push({ pts, width: 0.5, color: palette.dark });
    fills.push({ poly: ellipsePoints(tip[0], tip[1], 0.95, 1.15, side * 0.5, 12), color: palette.dark });
  }
  return { fills, lines };
}
