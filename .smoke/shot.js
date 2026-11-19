const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox'], defaultViewport: { width: 1600, height: 900 },
  });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
  await sleep(600);

  // 摆几件设备 + 两个任务点位
  const btns = await page.$$('.palette-item');
  for (const b of btns) { await b.click(); await sleep(120); }
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((x) => x.textContent === '在画布上加点').click();
  });
  const svg = await page.$('svg.canvas');
  const sb = await svg.boundingBox();
  await page.mouse.click(sb.x + sb.width * 0.6, sb.y + sb.height * 0.45);
  await sleep(200);
  // 选中第一个物体显示手柄
  const g = await page.$('svg.canvas g.obj');
  const gb = await g.boundingBox();
  await page.mouse.click(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await sleep(300);
  await page.screenshot({ path: 'shot-iso.png' });

  // 俯视图
  await page.evaluate(() => {
    [...document.querySelectorAll('.topbar button')].find((x) => x.textContent === '俯视图').click();
    [...document.querySelectorAll('.tabs button')].find((x) => x.textContent === '物料清单').click();
  });
  await sleep(300);
  await page.screenshot({ path: 'shot-top.png' });

  await browser.close();
  console.log('screenshots saved');
})().catch((e) => { console.error(e); process.exit(1); });
