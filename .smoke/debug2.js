// 复现 smoke 失败场景:多物体 + 俯视图
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox'], defaultViewport: { width: 1600, height: 900 },
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('dialog', async (d) => { console.log('DIALOG:', d.message()); await d.dismiss(); });

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
  await sleep(600);

  // 4 个设备
  const btns = await page.$$('.palette-item');
  for (const b of btns) { await b.click(); await sleep(120); }

  const pos0 = await page.evaluate(() => JSON.parse(localStorage.getItem('park-iso-editor-v1')).objects.map((o) => [o.type, o.x, o.y]));
  console.log('initial:', JSON.stringify(pos0));

  // 拖第一个物体(可能被别的物体挡住)
  const g = await page.$('svg.canvas g.obj polygon');
  const box = await g.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const hit = await page.evaluate((x, y) => {
    const el = document.elementFromPoint(x, y);
    return el ? el.tagName + '.' + (el.getAttribute('class') || '') : 'none';
  }, cx, cy);
  console.log('elementFromPoint at drag start:', hit);

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy + 40, { steps: 8 });
  await page.mouse.up();
  await sleep(300);
  const pos1 = await page.evaluate(() => JSON.parse(localStorage.getItem('park-iso-editor-v1')).objects.map((o) => [o.type, o.x, o.y]));
  console.log('after drag:', JSON.stringify(pos1));

  // 切俯视图,加点
  await page.evaluate(() => {
    [...document.querySelectorAll('.topbar button')].find((x) => x.textContent === '俯视图').click();
  });
  await sleep(150);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((x) => x.textContent === '在画布上加点').click();
  });
  await sleep(150);
  const svg = await page.$('svg.canvas');
  const sb = await svg.boundingBox();
  const hit2 = await page.evaluate((x, y) => {
    const el = document.elementFromPoint(x, y);
    return el ? el.tagName + '.' + (el.getAttribute('class') || '') : 'none';
  }, sb.x + sb.width / 2, sb.y + sb.height / 2);
  console.log('elementFromPoint at canvas center (top view):', hit2);
  await page.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await sleep(300);
  const npts = await page.evaluate(() => document.querySelectorAll('svg.canvas g.task-point').length);
  console.log('task points:', npts);
  const pts = await page.evaluate(() => JSON.parse(localStorage.getItem('park-iso-editor-v1')).task.points);
  console.log('stored points:', JSON.stringify(pts));

  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
