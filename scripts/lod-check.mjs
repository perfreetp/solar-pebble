// 验证四级 LOD：逐级放大截图并记录簇数量、标签数量
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--disable-gpu', '--no-sandbox',
    `--user-data-dir=C:\\Users\\Administrator\\AppData\\Local\\Temp\\edge-lod-${Date.now()}`],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 950 });
const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:5180/';
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle2' });
await sleep(3000);

const canvas = await page.$('.canvas-host canvas');
const box = await canvas.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

const lods = [];
for (let step = 0; step < 6; step++) {
  await sleep(1200); // 等待瓦片生成
  const info = await page.evaluate(() => {
    const badge = document.querySelector('.lod-badge')?.textContent ?? '';
    return badge;
  });
  const lod = info.match(/LOD (\d)/)?.[1];
  await page.screenshot({ path: `.e2e/lod-step${step}.png` });
  lods.push({ step, lod, badge: info.replace(/\s+/g, ' ').trim() });
  // 以中心为锚点放大
  await page.mouse.move(cx, cy);
  await page.mouse.wheel({ deltaY: -360 });
}
console.log('LOD 演进:');
for (const l of lods) console.log(`  step${l.step}: ${l.badge}`);
const distinct = new Set(lods.map((l) => l.lod));
console.log('覆盖的 LOD 级别:', [...distinct].sort().join(', '));

await browser.close();
