// 批注持久化：创建批注 → 刷新 → 确认仍在
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:5190/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--disable-gpu', '--no-sandbox',
    `--user-data-dir=C:\\Users\\Administrator\\AppData\\Local\\Temp\\edge-persist-${Date.now()}`],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 950 });
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle2' });
await sleep(2500);

// 打开批注模式并打点
await page.click('.canvas-toolbar .btn-small');
await sleep(200);
const box = await (await page.$('.canvas-host canvas')).boundingBox();
await page.mouse.click(box.x + 500, box.y + 400);
await sleep(400);
await page.type('.modal textarea', '持久化验证批注-刷新后应保留');
await page.click('.modal .btn-primary');
await sleep(500);
const before = await page.$$eval('.anno-item', (e) => e.length);

// 确认 localStorage 已写入
const stored = await page.evaluate(() => localStorage.getItem('spaceport-review-state-v1'));
const hasStored = stored !== null && stored.includes('持久化验证批注');

// 刷新
await page.reload({ waitUntil: 'networkidle2' });
await sleep(2500);
const after = await page.$$eval('.anno-item', (e) => e.length);
const textAfter = await page.$$eval('.anno-item', (els) =>
  els.some((e) => e.textContent.includes('持久化验证批注')));

console.log(`刷新前批注 ${before} 条, localStorage 写入=${hasStored}, 刷新后 ${after} 条, 内容保留=${textAfter}`);
const pass = before >= 1 && hasStored && after >= 1 && textAfter;
console.log(pass ? '✓ 批注持久化通过' : '✗ 持久化失败');
await browser.close();
process.exitCode = pass ? 0 : 1;
