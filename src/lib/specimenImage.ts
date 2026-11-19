import { DOC_H, DOC_W } from '../types';
import type { Pt } from '../types';

/**
 * 程序化生成"标本底图":用 OffscreenCanvas 绘制半透明的昆虫翅轮廓
 * 与天然翅脉纹理。返回 ImageBitmap,供主画布作为放大底图。
 */
export async function generateSpecimenBitmap(seed: number, familyHint = 0): Promise<ImageBitmap> {
  const W = DOC_W, H = DOC_H;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d')!;
  const rnd = mulberry32(seed);

  // 纸面底色
  ctx.fillStyle = '#f3ead6';
  ctx.fillRect(0, 0, W, H);
  // 颗粒噪点
  const img = ctx.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 14;
    img.data[i] = clampByte(img.data[i] + n);
    img.data[i + 1] = clampByte(img.data[i + 1] + n);
    img.data[i + 2] = clampByte(img.data[i + 2] + n * 0.7);
  }
  ctx.putImageData(img, 0, 0);

  // 翅体(两片翅 + 胸)
  ctx.save();
  ctx.translate(W / 2, H / 2 - 30);
  drawWing(ctx, rnd, -1, familyHint);
  drawWing(ctx, rnd, 1, familyHint);
  // 胸部
  const grad = ctx.createRadialGradient(0, 40, 10, 0, 40, 90);
  grad.addColorStop(0, 'rgba(90,60,35,0.55)');
  grad.addColorStop(1, 'rgba(90,60,35,0.08)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(0, 60, 42, 110, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 比例尺与标签
  ctx.strokeStyle = 'rgba(80,60,40,0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(1080, 880); ctx.lineTo(1180, 880);
  ctx.moveTo(1080, 874); ctx.lineTo(1080, 886);
  ctx.moveTo(1180, 874); ctx.lineTo(1180, 886);
  ctx.stroke();
  ctx.fillStyle = 'rgba(80,60,40,0.8)';
  ctx.font = '16px serif';
  ctx.fillText('2 mm', 1112, 906);

  return canvas.transferToImageBitmap();
}

function drawWing(ctx: OffscreenCanvasRenderingContext2D, rnd: () => number, side: number, familyHint: number) {
  ctx.save();
  ctx.scale(side, 1);
  // 翅膜
  ctx.beginPath();
  ctx.moveTo(30, 60);
  ctx.bezierCurveTo(180, -150, 480, -120, 560, 90);
  ctx.bezierCurveTo(470, 260, 180, 250, 40, 130);
  ctx.bezierCurveTo(10, 100, 10, 78, 30, 60);
  ctx.closePath();
  const mem = ctx.createLinearGradient(0, -120, 0, 240);
  mem.addColorStop(0, 'rgba(214,186,140,0.65)');
  mem.addColorStop(1, 'rgba(186,150,100,0.5)');
  ctx.fillStyle = mem;
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,85,50,0.55)';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // 天然翅脉(浅底纹,供钢笔描摹)
  ctx.strokeStyle = 'rgba(110,78,45,0.35)';
  ctx.lineWidth = 2;
  const mainVeins = familyHint === 1 ? 7 : 5;
  for (let v = 0; v < mainVeins; v++) {
    const t = v / (mainVeins - 1);
    const sy = 70 + t * 120;
    const ey = -80 + t * 300 + (rnd() - 0.5) * 30;
    ctx.beginPath();
    ctx.moveTo(36, sy);
    ctx.bezierCurveTo(160, sy - 60 + rnd() * 40, 380, ey - 40, 545, ey);
    ctx.stroke();
  }
  // 横脉
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = 'rgba(110,78,45,0.28)';
  for (let i = 0; i < 9; i++) {
    const x = 120 + i * 45 + rnd() * 14;
    ctx.beginPath();
    ctx.moveTo(x, -60 + rnd() * 20);
    ctx.quadraticCurveTo(x + 20, 80, x - 10, 220 + rnd() * 20);
    ctx.stroke();
  }
  // 斑纹(鳞粉深浅)
  for (let i = 0; i < 6; i++) {
    const cx = 160 + rnd() * 340;
    const cy = -80 + rnd() * 280;
    const r = 26 + rnd() * 46;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * (0.5 + rnd() * 0.5), rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(150,95,45,${0.08 + rnd() * 0.12})`;
    ctx.fill();
  }
  ctx.restore();
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampByte(v: number) { return v < 0 ? 0 : v > 255 ? 255 : v; }

let seedCounter = 1000;
export function nextSeed() { return ++seedCounter; }

export function bitmapToPoint(): Pt { return { x: 0, y: 0 }; }
