// 冒烟测试:加载 -> 添加设备 -> 拾取 -> 手柄 -> 拖动/碰撞回退 -> 旋转/复制 -> 镜头 -> 导出 -> 点位 -> 提交 -> 复核
const puppeteer = require('puppeteer-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--window-size=1600,900'],
    defaultViewport: { width: 1600, height: 900 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('CONSOLE: ' + m.text()); });
  page.on('dialog', async (d) => { await d.dismiss(); });

  let failed = 0;
  const step = async (name, fn) => {
    try { await fn(); console.log('OK   ' + name); }
    catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
  };
  const objs = () => page.evaluate(() => JSON.parse(localStorage.getItem('park-iso-editor-v1')).objects);
  const clickBtn = (text, scope = 'button') =>
    page.evaluate((t, s) => {
      const b = [...document.querySelectorAll(s)].find((x) => x.textContent === t);
      if (!b) throw new Error('按钮不存在: ' + t);
      b.click();
    }, text, scope);

  await page.goto(URL, { waitUntil: 'networkidle0' });
  await sleep(800);

  await step('页面加载,画布渲染', async () => {
    await page.waitForSelector('svg.canvas', { timeout: 5000 });
  });

  await step('设备库添加 4 种设备', async () => {
    const btns = await page.$$('.palette-item');
    if (btns.length !== 4) throw new Error('palette items = ' + btns.length);
    for (const b of btns) { await b.click(); await sleep(150); }
    await page.waitForFunction(() => document.querySelectorAll('svg.canvas g.obj').length >= 4, { timeout: 3000 });
  });

  await step('拾取物体并显示参数面板', async () => {
    const obj = await page.$('svg.canvas g.obj');
    const box = await obj.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(200);
    await page.waitForFunction(() => document.body.innerText.includes('位置与姿态'), { timeout: 3000 });
  });

  await step('选中后出现三轴手柄', async () => {
    await page.waitForSelector('svg.canvas g.gizmo', { timeout: 3000 });
    const n = await page.$$eval('svg.canvas g.gizmo line', (ls) => ls.length);
    if (n < 6) throw new Error('gizmo lines = ' + n);
  });

  await step('拖动手柄 X 轴移动物体', async () => {
    // 选中最后一个物体(机柜,位置孤立)
    const gs = await page.$$('svg.canvas g.obj');
    const last = gs[gs.length - 1];
    const box = await last.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(200);
    const before = (await objs()).map((o) => [o.x, o.y]);
    // 第一个 gizmo 圆点 = X 轴端点
    const handle = await page.$('svg.canvas g.gizmo circle');
    const hb = await handle.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + 60, hb.y + hb.height / 2, { steps: 6 });
    await page.mouse.up();
    await sleep(300);
    const after = (await objs()).map((o) => [o.x, o.y]);
    if (JSON.stringify(before) === JSON.stringify(after)) throw new Error('位置未变化');
  });

  await step('碰撞/越界时标红并推回原位', async () => {
    const before = (await objs()).map((o) => [o.x, o.y]);
    // 把第一个物体拖到第二个物体身上
    const gs = await page.$$('svg.canvas g.obj');
    const b0 = await gs[0].boundingBox();
    const b1 = await gs[1].boundingBox();
    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
    await page.mouse.down();
    await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2, { steps: 8 });
    await sleep(100);
    await page.mouse.up();
    await sleep(300);
    const after = (await objs()).map((o) => [o.x, o.y]);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('碰撞后未回退: ' + JSON.stringify(after));
  });

  await step('R 旋转与 Ctrl+D 批量复制', async () => {
    const n0 = await page.$$eval('svg.canvas g.obj', (o) => o.length);
    await page.keyboard.press('r');
    await sleep(150);
    await page.keyboard.down('Control');
    await page.keyboard.press('d');
    await page.keyboard.up('Control');
    await sleep(300);
    const n1 = await page.$$eval('svg.canvas g.obj', (o) => o.length);
    if (n1 <= n0) throw new Error(`复制失败 ${n0} -> ${n1}`);
  });

  await step('镜头切换(4 轴测角 + 俯视)', async () => {
    for (const l of ['轴测·东南', '轴测·西南', '轴测·西北', '俯视图', '轴测·东北']) {
      await clickBtn(l, '.topbar button');
      await sleep(120);
    }
  });

  await step('俯视图导出物料清单', async () => {
    await clickBtn('俯视图', '.topbar button');
    await clickBtn('物料清单', '.tabs button');
    await sleep(200);
    const disabled = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('导出物料清单'));
      return b ? b.disabled : 'missing';
    });
    if (disabled !== false) throw new Error('导出按钮状态: ' + disabled);
    await page.waitForFunction(() => document.body.innerText.includes('场地利用率'), { timeout: 3000 });
  });

  await step('老师添加任务点位(点击含物体的位置也能放置)', async () => {
    await clickBtn('在画布上加点');
    await sleep(150);
    const svg = await page.$('svg.canvas');
    const box = await svg.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); // 场地中心(有物体)
    await sleep(200);
    // 再换一个类型加第二点(空旷处)
    await page.evaluate(() => {
      const sel = [...document.querySelectorAll('select')].find((s) => s.options[s.selectedIndex]?.text === '监测微站');
      sel.value = 'probe';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await clickBtn('在画布上加点');
    await sleep(150);
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.35);
    await sleep(200);
    const n = await page.$$eval('svg.canvas g.task-point', (p) => p.length);
    if (n !== 2) throw new Error('task points = ' + n);
  });

  await step('学员提交作业并自动评分', async () => {
    await clickBtn('学员', '.topbar button');
    await sleep(150);
    await page.type('.name-input', '张三');
    await clickBtn('提交作业');
    await sleep(300);
    await page.waitForFunction(() => document.body.innerText.includes('自动评分'), { timeout: 3000 });
  });

  await step('老师复核打分与错题汇总', async () => {
    await clickBtn('老师', '.topbar button');
    await clickBtn('成绩', '.tabs button');
    await sleep(200);
    await page.waitForFunction(() => document.body.innerText.includes('张三'), { timeout: 3000 });
    await clickBtn('查看布置');
    await sleep(300);
    await page.waitForFunction(() => document.body.innerText.includes('正在复核'), { timeout: 3000 });
    await clickBtn('退出复核');
    await sleep(200);
    await clickBtn('确认复核');
    await sleep(200);
    await page.waitForFunction(() => document.body.innerText.includes('错题汇总'), { timeout: 3000 });
  });

  console.log('\n--- 控制台/页面错误 ---');
  console.log(errors.length ? errors.join('\n') : '(无)');
  await browser.close();
  process.exit(errors.length || failed ? 2 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
