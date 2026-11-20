// 三种昆虫的程序化体素模板:独角仙 / 锹甲 / 蝴蝶
// 约定:头朝 -Z,背朝 +Y,左右沿 X 对称;坐标范围适配 24x24x24 网格
import { key } from './voxel.js';

const C = {
  rhinoBody: '#5b3a1e',
  rhinoDark: '#3f2813',
  rhinoHorn: '#c9a06a',
  stagBody: '#2f2a33',
  stagDark: '#1b1820',
  stagJaw: '#8a7f94',
  bfBody: '#4a3520',
  bfWingL: '#e87938',
  bfWingR: '#e8a238',
  bfSpot: '#2c2233',
  bfVein: '#7a4a22',
  leg: '#241a10',
  eye: '#111111'
};

function ellipsoid(cx, cy, cz, rx, ry, rz, color, out) {
  for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
        const d = ((x - cx) ** 2) / (rx * rx) + ((y - cy) ** 2) / (ry * ry) + ((z - cz) ** 2) / (rz * rz);
        if (d <= 1) out.set(key(x, y, z), { x, y, z, c: color });
      }
    }
  }
}

function line(x0, y0, z0, x1, y1, z1, color, out) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    const z = Math.round(z0 + (z1 - z0) * t);
    out.set(key(x, y, z), { x, y, z, c: color });
  }
}

function legs(out, color) {
  // 三对足,左右对称,弯折造型
  for (const side of [-1, 1]) {
    const zs = [-3, 0, 3];
    for (const z of zs) {
      line(side * 2, 1, z, side * 5, 0, z + 1, color, out);
      line(side * 5, 0, z + 1, side * 6, 0, z + 3, color, out);
    }
  }
}

/** 独角仙:椭圆鞘翅 + 头角 + 胸角 */
export function rhinoBeetle() {
  const out = new Map();
  ellipsoid(0, 3, 2, 4, 2.4, 5, C.rhinoBody, out);   // 腹部鞘翅
  ellipsoid(0, 3, -4, 3, 2, 2.6, C.rhinoDark, out);  // 胸
  ellipsoid(0, 2.6, -7, 2, 1.6, 2, C.rhinoDark, out); // 头
  // 头角:向前上方挑起,末端分叉
  line(0, 3, -8, 0, 4, -11, C.rhinoHorn, out);
  line(0, 4, -11, 1, 5, -12, C.rhinoHorn, out);
  line(0, 4, -11, -1, 5, -12, C.rhinoHorn, out);
  // 胸角
  line(0, 5, -4, 0, 7, -6, C.rhinoHorn, out);
  // 眼睛
  out.set(key(1, 3, -8), { x: 1, y: 3, z: -8, c: C.eye });
  out.set(key(-1, 3, -8), { x: -1, y: 3, z: -8, c: C.eye });
  // 鞘翅中缝
  for (let z = -1; z <= 6; z++) out.set(key(0, 5, z), { x: 0, y: 5, z, c: C.rhinoDark });
  legs(out, C.leg);
  return out;
}

/** 锹甲:深色身体 + 一对夸张大颚 */
export function stagBeetle() {
  const out = new Map();
  ellipsoid(0, 3, 2, 3.6, 2.2, 5, C.stagBody, out);
  ellipsoid(0, 3, -4, 2.8, 1.9, 2.4, C.stagDark, out);
  ellipsoid(0, 2.6, -7, 1.8, 1.5, 1.8, C.stagDark, out);
  // 大颚:左右两片,向前伸出再向内弯,带齿
  for (const side of [-1, 1]) {
    line(side * 1, 3, -8, side * 3, 3, -11, C.stagJaw, out);
    line(side * 3, 3, -11, side * 2, 4, -12, C.stagJaw, out);
    line(side * 2, 4, -12, side * 1, 4, -12, C.stagJaw, out);
    // 颚齿
    out.set(key(side * 3, 4, -10), { x: side * 3, y: 4, z: -10, c: C.stagJaw });
    out.set(key(side * 2, 4, -11), { x: side * 2, y: 4, z: -11, c: C.stagJaw });
  }
  out.set(key(1, 3, -8), { x: 1, y: 3, z: -8, c: C.eye });
  out.set(key(-1, 3, -8), { x: -1, y: 3, z: -8, c: C.eye });
  for (let z = -1; z <= 6; z++) out.set(key(0, 5, z), { x: 0, y: 5, z, c: C.stagDark });
  legs(out, C.leg);
  return out;
}

/** 蝴蝶:细身体 + 左右四片带斑纹的翅膀(平铺展开) */
export function butterfly() {
  const out = new Map();
  // 身体:一条竖向小柱
  ellipsoid(0, 2, 0, 0.9, 0.9, 5, C.bfBody, out);
  // 触角
  line(0, 3, -4, 1, 4, -6, C.bfVein, out);
  line(0, 3, -4, -1, 4, -6, C.bfVein, out);

  const wing = (side) => {
    const wingColor = side > 0 ? C.bfWingR : C.bfWingL;
    // 前翅(大)与后翅(小),沿 X 展开
    ellipsoid(side * 4, 3, -2, 3.4, 0.6, 3.4, wingColor, out);
    ellipsoid(side * 3.4, 3, 2.4, 2.6, 0.6, 2.4, wingColor, out);
    // 翅脉
    for (let t = 1; t <= 6; t++) {
      const x = side * t;
      if (out.has(key(x, 4, -2))) out.set(key(x, 4, -2), { x, y: 4, z: -2, c: C.bfVein });
      if (out.has(key(x, 4, 2))) out.set(key(x, 4, 2), { x, y: 4, z: 2, c: C.bfVein });
    }
    // 斑纹(对称)
    const spots = [
      [5, -3], [3, -1], [6, 0], [4, 3], [2, 4]
    ];
    for (const [ax, az] of spots) {
      const x = side * ax;
      if (out.has(key(x, 4, az))) out.set(key(x, 4, az), { x, y: 4, z: az, c: C.bfSpot });
    }
  };
  wing(1);
  wing(-1);
  return out;
}

export const TEMPLATES = [
  { id: 'rhino', name: '独角仙', build: rhinoBeetle },
  { id: 'stag', name: '锹甲', build: stagBeetle },
  { id: 'butterfly', name: '蝴蝶', build: butterfly }
];
