// Colour helpers. All wing colours are stored as HSL so global hue-range
// parameters can deterministically re-map them.

export function clamp(v, a = 0, b = 1) {
  return v < a ? a : v > b ? b : v;
}

export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s);
  l = clamp(l);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [r + m, g + m, b + m];
}

export function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

export function hslToHex(h, s, l) {
  const [r, g, b] = hslToRgb(h, s, l);
  return (
    '#' +
    [r, g, b]
      .map((v) => Math.round(clamp(v) * 255).toString(16).padStart(2, '0'))
      .join('')
  );
}

export function hexToHsl(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return rgbToHsl(r, g, b);
}

export function relativeLuminance(h, s, l) {
  const [r, g, b] = hslToRgb(h, s, l).map((v) => {
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two HSL colours. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a[0], a[1], a[2]);
  const lb = relativeLuminance(b[0], b[1], b[2]);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Shortest signed hue distance a-b in degrees, in (-180,180]. */
export function hueDelta(a, b) {
  let d = ((a - b) % 360 + 540) % 360 - 180;
  return d;
}

/** Map a source hue into a target hue window, preserving relative position. */
export function remapHue(srcHue, hueBase, hueWidth, sourceBase) {
  // srcHue is "relative hue offset" tucked into [0,360); fold to -180..180
  const off = hueDelta(srcHue, sourceBase) / 360; // -0.5..0.5
  return ((hueBase + off * hueWidth) % 360 + 360) % 360;
}

export function hslCss(c) {
  return `hsl(${c[0].toFixed(1)} ${(c[1] * 100).toFixed(1)}% ${(c[2] * 100).toFixed(1)}%)`;
}

export function mixHsl(a, b, t) {
  return [a[0] + hueDelta(b[0], a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function adjustHsl(c, { dh = 0, ds = 0, dl = 0 }) {
  return [((c[0] + dh) % 360 + 360) % 360, clamp(c[1] + ds), clamp(c[2] + dl)];
}
