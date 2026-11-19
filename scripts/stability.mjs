// 交互稳定性：拖动帧率、瓦片缓存增长、切图层不崩
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:5190/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--disable-gpu', '--no-sandbox',
    `--user-data-dir=C:\\Users\\Administrator\\AppData\\Local\\Temp\\edge-stab-${Date.now()}`],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 950 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle2' });
await sleep(3000);

const canvas = await page.$('.canvas-host canvas');
const box = await canvas.boundingBox();
const sx = box.x + box.width / 2;
const sy = box.y + box.height / 2;

// 注入 FPS 计数器
await page.evaluate(() => {
  window.__frames = 0;
  const orig = window.requestAnimationFrame;
  window.requestAnimationFrame = (cb) => orig((t) => { window.__frames++; cb(t); });
});

// 连续拖动（模拟平移）：分多段小位移
await page.mouse.move(sx, sy);
await page.mouse.down();
const t0 = await page.evaluate(() => performance.now());
for (let i = 0; i < 40; i++) {
  await page.mouse.move(sx + i * 8, sy + Math.sin(i / 3) * 20);
  await sleep(16);
}
await page.mouse.up();
const dt = await page.evaluate(() => performance.now()) - t0;
const frames = await page.evaluate(() => window.__frames);
const fps = (frames / dt) * 1000;
console.log(`拖动期间约 ${fps.toFixed(0)} FPS（${frames} 帧 / ${dt.toFixed(0)}ms）`);
console.log(pageErrors.length === 0 ? '✓ 拖动无异常' : `✗ 异常: ${pageErrors.join('|')}`);

await sleep(1500);
const tilesAfterDrag = await page.$eval('.status-bar', (e) =>
  Number(e.textContent.match(/瓦片缓存 (\d+)/)?.[1] ?? 0));
console.log(`拖动后瓦片缓存 ${tilesAfterDrag} 张`);

// 快速切换所有图层显隐（压测样式签名失效与回退）
const layerCount = await page.$$eval('.layer-item', (els) => els.length);
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < layerCount; i++) {
    await page.$$eval('.layer-item input[type=checkbox]', (els, idx) => {
      els[idx]?.click();
    }, i);
    await sleep(60);
    await page.$$eval('.layer-item input[type=checkbox]', (els, idx) => {
      els[idx]?.click();
    }, i);
  }
}
await sleep(1000);
const stillOk = await page.$$eval('canvas.map-canvas', (els) => els.length);
console.log(stillOk >= 1 && pageErrors.length === 0
  ? '✓ 快速切图层稳定，画布存活'
  : '✗ 切图层出现问题');

// 缩放过程中的过渡：连续滚轮，确认无白屏（非背景像素占比始终 >0）
const samples = [];
for (let i = 0; i < 8; i++) {
  await page.mouse.move(sx, sy);
  await page.mouse.wheel({ deltaY: -200 });
  await sleep(120);
  const nonBg = await page.evaluate(() => {
    const c = document.querySelector('canvas.map-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let j = 0; j < d.length; j += 4 * 800) {
      if (!(d[j] < 30 && d[j + 1] < 35 && d[j + 2] < 55)) n++;
    }
    return n;
  });
  samples.push(nonBg);
}
const minNonBg = Math.min(...samples);
console.log(`连续缩放中非背景采样最小值 ${minNonBg}（>0 即无白屏）`);
console.log(minNonBg > 0 ? '✓ 缩放过渡无白屏' : '✗ 出现白屏');

await page.screenshot({ path: '.e2e/stability-final.png' });
await browser.close();

const pass = pageErrors.length === 0 && stillOk >= 1 && minNonBg > 0 && fps >= 30;
console.log(pass ? '\n稳定性验证通过' : '\n稳定性验证失败');
process.exitCode = pass ? 0 : 1;
