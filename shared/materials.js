/**
 * 材质字典 —— 服务端与前端共用。
 * 体素在存储里只是一个 uint8 材质 id，颜色/分组/自发光都在这里定义，
 * 这样改配色不需要重写任何已保存的模型。
 */

export const GROUPS = [
  {
    key: 'cave',
    name: '洞体',
    short: '洞',
    desc: '熔岩管原始岩壁、塌落体与碎石地基',
    color: '#8d9199',
  },
  {
    key: 'lining',
    name: '内壁',
    short: '壁',
    desc: '洞体内表面的密封衬里与隔热层',
    color: '#c9a878',
  },
  {
    key: 'habitat',
    name: '舱体',
    short: '舱',
    desc: '居住舱、工作舱的主体结构与舷窗',
    color: '#9fc0ce',
  },
  {
    key: 'utility',
    name: '设备',
    short: '设',
    desc: '支撑桁架、照明带、管线与锚固',
    color: '#d3a08a',
  },
];

export const GROUP_BY_KEY = Object.fromEntries(GROUPS.map((g) => [g.key, g]));

/**
 * id 从 1 开始，0 表示空气（不占用）。
 * emissive: 0..1，只影响观感，导出时写入 MTL 的 Ke。
 */
export const MATERIALS = [
  { id: 1, key: 'basalt', name: '玄武岩基体', group: 'cave', color: '#4e5156', rough: 0.95, metal: 0.0, emissive: 0 },
  { id: 2, key: 'breccia', name: '角砾岩', group: 'cave', color: '#5e594f', rough: 0.95, metal: 0.0, emissive: 0 },
  { id: 3, key: 'regolith', name: '月壤固结层', group: 'cave', color: '#6c6457', rough: 1.0, metal: 0.0, emissive: 0 },

  { id: 4, key: 'seal', name: '密封衬里', group: 'lining', color: '#b39872', rough: 0.72, metal: 0.05, emissive: 0 },
  { id: 5, key: 'insul', name: '隔热衬层', group: 'lining', color: '#8a7d69', rough: 0.9, metal: 0.0, emissive: 0 },
  { id: 6, key: 'steelLining', name: '钢衬板', group: 'lining', color: '#77828c', rough: 0.45, metal: 0.55, emissive: 0 },

  { id: 7, key: 'hull', name: '钛合金舱壁', group: 'habitat', color: '#c3ccd3', rough: 0.38, metal: 0.6, emissive: 0 },
  { id: 8, key: 'panel', name: '复合壁板', group: 'habitat', color: '#98a4ad', rough: 0.6, metal: 0.25, emissive: 0 },
  { id: 9, key: 'deck', name: '舱内地板', group: 'habitat', color: '#6b7782', rough: 0.75, metal: 0.15, emissive: 0 },
  { id: 10, key: 'glazing', name: '观测舷窗', group: 'habitat', color: '#74cfe0', rough: 0.1, metal: 0.1, emissive: 0.5 },
  { id: 11, key: 'airlock', name: '气闸框', group: 'habitat', color: '#d9a961', rough: 0.4, metal: 0.5, emissive: 0 },
  { id: 12, key: 'radiator', name: '散热板', group: 'habitat', color: '#b3674f', rough: 0.55, metal: 0.3, emissive: 0 },

  { id: 13, key: 'strut', name: '支撑桁架', group: 'utility', color: '#6f767d', rough: 0.5, metal: 0.5, emissive: 0 },
  { id: 14, key: 'light', name: '照明带', group: 'utility', color: '#ffe3a3', rough: 0.3, metal: 0.0, emissive: 1.0 },
  { id: 15, key: 'conduit', name: '管线槽', group: 'utility', color: '#a06a4a', rough: 0.6, metal: 0.2, emissive: 0 },
  { id: 16, key: 'anchor', name: '地基锚固', group: 'utility', color: '#565b60', rough: 0.8, metal: 0.4, emissive: 0 },
];

export const MAT = Object.fromEntries(MATERIALS.map((m) => [m.key, m]));

export const MATERIAL_BY_ID = (() => {
  const table = new Array(256).fill(null);
  for (const m of MATERIALS) table[m.id] = m;
  return table;
})();

export const MAX_MATERIAL_ID = MATERIALS.reduce((a, m) => Math.max(a, m.id), 0);

export function materialOf(id) {
  return MATERIAL_BY_ID[id] || null;
}

export function groupOf(id) {
  const m = MATERIAL_BY_ID[id];
  return m ? m.group : null;
}

/** 材质层预设：一键切换配色组时用得上，也供导出时排序。 */
export const MATERIAL_ORDER = MATERIALS.map((m) => m.id);

/** sRGB hex -> linear 0..1，渲染与 MTL 都需要。 */
export function hexToLinear(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [
    srgbToLinear(((n >> 16) & 255) / 255),
    srgbToLinear(((n >> 8) & 255) / 255),
    srgbToLinear((n & 255) / 255),
  ];
}

export function hexToSrgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function colorCssOf(id) {
  const m = MATERIAL_BY_ID[id];
  return m ? m.color : '#000000';
}
