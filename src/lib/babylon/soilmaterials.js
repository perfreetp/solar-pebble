// Soil material palettes: dry / damp / gravel, each with procedural textures.
import { Color3, DynamicTexture, Texture } from '@babylonjs/core';

import '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import '@babylonjs/core/Materials/Textures/texture.js';

// Colours stay in sRGB hex so the palette reads clearly; Babylon converts to
// linear space for PBR through the texture + manual gamma on the albedo.
export const SOIL_PRESETS = {
  dry: {
    key: 'dry',
    label: '干土',
    desc: '疏松的黄褐壤土，颗粒感强',
    base: '#b48f63',
    deep: '#82653f',
    accent: '#d0b184',
    speck: '#5f4830',
    strata: '#a07d52',
    roughness: 0.96,
    cut: '#bd9a6f',
    exposure: 1.16,
    groundTint: '#8f7452'
  },
  damp: {
    key: 'damp',
    label: '湿土',
    desc: '深褐、湿润，反光更强',
    base: '#6a5138',
    deep: '#3c2d1f',
    accent: '#8a6d4c',
    speck: '#231a12',
    strata: '#58432e',
    roughness: 0.66,
    cut: '#775c40',
    exposure: 1.26,
    groundTint: '#4d3c2b'
  },
  gravel: {
    key: 'gravel',
    label: '砂砾',
    desc: '砂砾混层，亮暗对比大',
    base: '#a49a87',
    deep: '#665f52',
    accent: '#d5cbb7',
    speck: '#4a4437',
    strata: '#8c8375',
    roughness: 0.88,
    cut: '#b3a894',
    exposure: 1.14,
    groundTint: '#8a8272'
  }
};

export const SOIL_ORDER = ['dry', 'damp', 'gravel'];

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map();

export function getSoilTextures(scene, presetKey) {
  const key = `soil:${presetKey}`;
  if (cache.has(key)) return cache.get(key);
  const preset = SOIL_PRESETS[presetKey];
  const out = {
    diffuse: makeSoilTexture(scene, preset, 1024, 0.55, 1),
    cut: makeSoilTexture(scene, preset, 512, 0.8, 4),
    roughness: null,
    bump: null
  };
  out.bump = makeBumpTexture(scene, preset, 512);
  cache.set(key, out);
  return out;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function makeSoilTexture(scene, preset, size, grainScale, salt) {
  const tex = new DynamicTexture(`soil-${preset.key}-${size}`, { width: size, height: size }, scene, false);
  const ctx = tex.getContext();
  const R = rng(1234 + salt * 77);
  const [br, bg, bb] = hexToRgb(preset.base);
  const [dr, dg, db] = hexToRgb(preset.deep);
  const [sr, sg, sb] = hexToRgb(preset.speck);
  const [ar, ag, ab] = hexToRgb(preset.accent);
  const [tr, tg, tb] = hexToRgb(preset.strata || preset.deep);

  ctx.fillStyle = preset.base;
  ctx.fillRect(0, 0, size, size);

  // broad uneven patches
  for (let i = 0; i < 120; i++) {
    const x = R() * size;
    const y = R() * size;
    const rad = (0.03 + R() * 0.2) * size;
    const mix = R();
    const c = mix < 0.5 ? `rgb(${dr},${dg},${db})` : `rgb(${br},${bg},${bb})`;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, c.replace('rgb', 'rgba').replace(')', ',0.32)'));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  // sediment strata: every soil type shows layering, more so for gravel
  const bands = preset.key === 'gravel' ? 34 : preset.key === 'damp' ? 20 : 14;
  for (let i = 0; i < bands; i++) {
    const y = R() * size;
    const h = (0.003 + R() * (preset.key === 'gravel' ? 0.024 : 0.014)) * size;
    const a = preset.key === 'gravel' ? 0.12 + R() * 0.22 : 0.05 + R() * 0.1;
    ctx.fillStyle = R() < 0.5 ? `rgba(${ar},${ag},${ab},${a})` : `rgba(${tr},${tg},${tb},${a})`;
    ctx.fillRect(0, y, size, h);
  }

  // grains
  const grains = Math.round(size * grainScale * 2.4);
  for (let i = 0; i < grains; i++) {
    const x = R() * size;
    const y = R() * size;
    const r = (preset.key === 'gravel' ? 1.2 + R() * 2.6 : 0.5 + R() * 1.4) * (size / 1024);
    const pick = R();
    if (pick < 0.18) ctx.fillStyle = `rgba(${sr},${sg},${sb},${0.5 + R() * 0.4})`;
    else if (pick < 0.36) ctx.fillStyle = `rgba(${ar},${ag},${ab},${0.3 + R() * 0.4})`;
    else ctx.fillStyle = `rgba(${dr},${dg},${db},${0.22 + R() * 0.32})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.6 + R() * 0.7), R() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // pebbles for gravel
  if (preset.key === 'gravel') {
    for (let i = 0; i < 420; i++) {
      const x = R() * size;
      const y = R() * size;
      const r = 1.6 + R() * 4.2;
      const l = Math.floor(120 + R() * 90);
      ctx.fillStyle = `rgba(${l},${l - 6},${l - 22},${0.5 + R() * 0.4})`;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.55 + R() * 0.5), R() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(40,34,26,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  tex.update(false);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 8;
  return tex;
}

function makeBumpTexture(scene, preset, size) {
  const tex = new DynamicTexture(`bump-${preset.key}-${size}`, { width: size, height: size }, scene, true);
  const ctx = tex.getContext();
  const R = rng(999 + size);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  const n = Math.round(size * 1.6);
  for (let i = 0; i < n; i++) {
    const x = R() * size;
    const y = R() * size;
    const r = 0.8 + R() * 3.4;
    const v = Math.floor(70 + R() * 120);
    ctx.fillStyle = `rgba(${v},${v},${v},0.5)`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.5 + R() * 0.7), R() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  tex.update(false);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}
