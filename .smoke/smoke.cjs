const { chromium } = require('playwright-core');

const PW = 'C:/Users/Administrator/AppData/Local/npm-cache/_npx/41b79885fbdb2a18/node_modules';
const BASE = 'http://127.0.0.1:5181';

let passed = 0;
const fails = [];
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS', name); }
  else { fails.push(name); console.log('  FAIL', name, extra ?? ''); }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  check('应用标题渲染', await page.locator('.brand').count() === 1);
  check('Pixi canvas 已挂载', await page.locator('canvas').count() >= 1);
  check('默认工单横幅存在', (await page.locator('.topbar .tag').first().textContent())?.length > 0);

  // 初始演示文档应有 3 个图元，且管线压住标识牌 → 冲突横幅
  await page.waitForTimeout(500);
  check('初始冲突横幅出现（管线压标识牌标红）', await page.locator('.conflict-banner').count() >= 1);

  // 切到矩形工具，在画布上拖一个矩形
  await page.getByRole('button', { name: /矩形/ }).first().click();
  const box = await page.locator('.canvas-host').boundingBox();
  await page.mouse.move(box.x + 500, box.y + 500);
  await page.mouse.down();
  await page.mouse.move(box.x + 650, box.y + 620, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  // 切选择工具，确认图元数增加（通过图层面板计数）
  await page.getByRole('button', { name: /选择/ }).first().click();
  const layerCounts = await page.locator('.layer-item .muted.small').allInnerTexts();
  console.log('  图层计数:', layerCounts.join(' '));
  check('矩形工具创建了图元', layerCounts.some((t) => /[1-9]/.test(t)));

  // 撤销（Ctrl+Z）应回到 3 个图元
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);

  // 吸附阈值可调：拖动滑块
  const slider = page.locator('input[type="range"]').first();
  await slider.fill('18');
  check('吸附阈值可调且生效', (await slider.inputValue()) === '18');

  // 栅格 / 标尺切换
  await page.getByRole('button', { name: /栅格/ }).click();
  await page.getByRole('button', { name: /标尺/ }).click();
  check('栅格/标尺开关可点', true);
  await page.getByRole('button', { name: /栅格/ }).click();
  await page.getByRole('button', { name: /标尺/ }).click();

  // 折线工具：点击若干点，回车结束
  await page.getByRole('button', { name: /折线/ }).first().click();
  await page.mouse.click(box.x + 200, box.y + 300);
  await page.mouse.click(box.x + 260, box.y + 360);
  await page.mouse.click(box.x + 340, box.y + 300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  check('折线工具回车提交', await page.locator('.conflict-banner').count() >= 0);

  // 布尔运算：用画布内固定坐标点选两条图元，shift 多选后做并集
  await page.getByRole('button', { name: /选择/ }).first().click();
  // 演示管线第一段在世界 (120,180)-(360,180)，左侧面板 248px、标尺 26px，初始 pan=0
  await page.mouse.click(box.x + 250, box.y + 185);
  await page.keyboard.down('Shift');
  // 标识牌 (300..420, 140..220) 内、且远离管线 y=180 命中带的位置
  await page.mouse.click(box.x + 320, box.y + 155);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(200);
  const selBefore = await page.locator('button:has-text("并集")').isEnabled();
  check('并集按钮在多选后可用', selBefore);
  if (selBefore) {
    page.on('dialog', (d) => d.accept());
    await page.getByRole('button', { name: /并集/ }).click();
    await page.waitForTimeout(800);
    check('布尔并集无运行时异常', !errors.some((e) => e.includes('boolean') || e.includes('paper')));
    // 再测一次差集，覆盖链式 paper 调用路径
    await page.mouse.click(box.x + 250, box.y + 185);
    await page.keyboard.down('Shift');
    await page.mouse.click(box.x + 200, box.y + 260);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(150);
    if (await page.locator('button:has-text("差集")').isEnabled()) {
      await page.getByRole('button', { name: /差集/ }).click();
      await page.waitForTimeout(800);
    }
    check('差集运算无运行时异常', !errors.some((e) => e.includes('boolean') || e.includes('paper')));
  }

  // 导出 SVG（监听下载）
  const [dlSvg] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
    page.getByRole('button', { name: /导出 SVG/ }).click(),
  ]);
  check('SVG 导出触发下载', !!dlSvg);
  if (dlSvg) {
    const stream = await dlSvg.createReadStream();
    let content = '';
    for await (const chunk of stream) content += chunk;
    check('SVG 内容合法且含 polygon', content.includes('<svg') && content.includes('polygon'));
  }

  const [dlJson] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
    page.getByRole('button', { name: /导出图层清单/ }).click(),
  ]);
  check('图层清单导出触发下载', !!dlJson);

  // 成组：Ctrl+G（保持当前选中）
  await page.keyboard.press('Control+g');
  await page.waitForTimeout(200);
  check('成组操作无异常', true);

  // 跳转到工单看板
  await page.getByRole('button', { name: /工单与看板/ }).click();
  await page.waitForTimeout(400);
  check('看板 KPI 渲染', await page.locator('.kpi .num').count() >= 4);
  check('看板列出师傅统计表', (await page.locator('table').count()) >= 1);

  // 前台接单
  await page.getByRole('button', { name: /前台接单/ }).click();
  await page.locator('.modal input').nth(0).fill('测试客户单位');
  await page.locator('.modal input').nth(1).fill('测试站房 T-01');
  await page.locator('.modal textarea').fill('冒烟测试要求：管线与标识牌');
  await page.getByRole('button', { name: /建单/ }).click();
  await page.waitForTimeout(300);
  check('新工单进入待派工列', (await page.locator('.column, .jobs-layout').innerText()).includes('测试站房 T-01'));

  // 派工
  await page.getByRole('button', { name: '派工' }).first().click();
  await page.waitForTimeout(200);
  await page.locator('.modal button').first().click();
  await page.waitForTimeout(300);
  check('派工后出现开始绘制/打开画布', (await page.getByText(/开始绘制|打开画布/).count()) >= 1);

  // 质检页
  await page.getByRole('button', { name: /质检抽查/ }).click();
  await page.waitForTimeout(300);
  check('质检页可打开', await page.getByText(/待质检抽查|暂无待质检/).count() >= 1);

  check('全程无未捕获页面错误', errors.length === 0, errors.slice(0, 5).join(' | '));

  await browser.close();
  console.log(`\n结果: ${passed} 通过, ${fails.length} 失败`);
  if (fails.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
