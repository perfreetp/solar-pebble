// 调试:拖动与点位放置为何失效
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
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });
  page.on('dialog', async (d) => { console.log('DIALOG:', d.message()); await d.dismiss(); });

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
  await sleep(600);

  // 添加一个设备
  await page.click('.palette-item');
  await sleep(300);

  // 探查第一个物体的屏幕位置
  const info = await page.evaluate(() => {
    const g = document.querySelector('svg.canvas g.obj');
    const r = g.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
  });
  console.log('obj screen box:', JSON.stringify(info));

  // 监听事件流
  await page.evaluate(() => {
    window.__log = [];
    const svg = document.querySelector('svg.canvas');
    for (const t of ['pointerdown', 'pointermove', 'pointerup']) {
      window.addEventListener(t, (e) => {
        if (window.__log.length < 20) window.__log.push(t + ' @' + Math.round(e.clientX) + ',' + Math.round(e.clientY) + ' target=' + (e.target.tagName || '?') + '.' + (e.target.getAttribute && e.target.getAttribute('class') || ''));
      }, true);
    }
  });

  await page.mouse.move(info.x, info.y);
  await page.mouse.down();
  await page.mouse.move(info.x + 60, info.y + 30, { steps: 5 });
  await page.mouse.up();
  await sleep(400);

  const log = await page.evaluate(() => window.__log);
  console.log(log.join('\n'));

  const pos = await page.evaluate(() => JSON.parse(localStorage.getItem('park-iso-editor-v1')).objects.map((o) => [o.x, o.y, o.z]));
  console.log('positions after drag:', JSON.stringify(pos));

  // 点位放置调试
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent === '在画布上加点');
    b.click();
  });
  await sleep(150);
  const placing = await page.evaluate(() => document.body.innerText.includes('点击场地放置'));
  console.log('placing hint visible:', placing);
  await page.mouse.click(800, 450);
  await sleep(300);
  const npts = await page.evaluate(() => document.querySelectorAll('svg.canvas g.task-point').length);
  console.log('task points:', npts);

  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
