import type { ColorMode, Creek, Level } from '../core/types';
import { classIndex } from '../core/generator';

export type { ColorMode };

export interface RGB {
  r: number;
  g: number;
  b: number;
}

function hex(h: string): RGB {
  const v = parseInt(h.replace('#', ''), 16);
  return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 };
}

/** 分级配色盘: 每级 5 色 */
export const LEVEL_COLORS: Record<Level, string> = {
  1: '#5fe0d8',
  2: '#3fa9c4',
  3: '#3d7f9b',
};

export const LEVEL_LABEL: Record<Level, string> = {
  1: '主干沟',
  2: '支沟',
  3: '毛细沟',
};

/** 按沟长分级: 由短到长 5 级 (深→亮) */
export const LENGTH_RAMP = ['#1d3f5c', '#245f78', '#2f8291', '#47a8a4', '#79d0c0'].map(hex);

/** 按密度分级: 紫→青→黄 */
export const DENSITY_RAMP = ['#2b1e4a', '#3a3d7a', '#2f7d8f', '#5fb87c', '#e3d36a'].map(hex);

/** 按高程分级: 低滩 (蓝绿) → 高滩 (褐) */
export const ELEVATION_RAMP = ['#1f6f8b', '#3e8f8a', '#79a06a', '#b39b58', '#c98a4b'].map(hex);

export const SELECTION_COLOR = hex('#ffd166');

export interface ColorOptions {
  mode: ColorMode;
}

export function creekColor(creek: Creek, opts: ColorOptions, network?: { classes?: unknown }): RGB {
  void network;
  switch (opts.mode) {
    case 'level':
      return hex(LEVEL_COLORS[creek.level]);
    case 'length':
      return LENGTH_RAMP[Math.min(4, creek.classIdx.length)] ?? LENGTH_RAMP[2];
    case 'density':
      return DENSITY_RAMP[Math.min(4, creek.classIdx.density)] ?? DENSITY_RAMP[2];
    case 'elevation':
      return ELEVATION_RAMP[Math.min(4, creek.classIdx.elevation)] ?? ELEVATION_RAMP[2];
    default:
      return hex(LEVEL_COLORS[creek.level]);
  }
}

export function rampFor(mode: ColorMode): RGB[] {
  switch (mode) {
    case 'length':
      return LENGTH_RAMP;
    case 'density':
      return DENSITY_RAMP;
    case 'elevation':
      return ELEVATION_RAMP;
    default:
      return [hex(LEVEL_COLORS[1]), hex(LEVEL_COLORS[2]), hex(LEVEL_COLORS[3])];
  }
}

export function toCss(c: RGB, alpha = 1): string {
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export { classIndex };

/** 高程底图的色带 (低 → 高) */
export const HYPSO_RAMP = [
  '#0a1b24',
  '#0e2c33',
  '#143b39',
  '#2a4a35',
  '#4b5a37',
  '#6d6238',
].map(hex);

export function sampleRamp(ramp: RGB[], t: number): RGB {
  const x = Math.max(0, Math.min(1, t)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(x));
  const f = x - i;
  return {
    r: ramp[i].r + (ramp[i + 1].r - ramp[i].r) * f,
    g: ramp[i].g + (ramp[i + 1].g - ramp[i].g) * f,
    b: ramp[i].b + (ramp[i + 1].b - ramp[i].b) * f,
  };
}
