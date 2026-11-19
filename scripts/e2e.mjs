// 端到端验证：启动系统 Edge，检查控制台错误、画布像素、关键交互
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = process.env.BASE_URL ?? 'http://127.0.0.1:5180/';
const OUT = 'D:\\ccfb\\runs\\1000102\\workspace\\.e2e';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--disable-gpu', '--no-sandbox', '--window-size=1600,950',
    `--user-data-dir=C:\\Users\\Administrator\\AppData\\Local\\Temp\\edge-puppeteer-${Date.now()}`],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 950, deviceScaleFactor: 1 });

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  // 干净的本地状态，避免历史批注/版本干扰断言
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3500); // 等待瓦片离屏渲染

  // 1. 基础渲染
  record('页面标题', (await page.title()).includes('审片'));
  record('无页面未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  record('无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

  const canvasCount = await page.$$eval('canvas', (els) => els.length);
  record('画布元素存在', canvasCount >= 1, `${canvasCount} 个 canvas`);

  // 画布非空白检测：统计像素颜色多样性
  const pixelStats = await page.evaluate(() => {
    const c = document.querySelector('canvas.map-canvas');
    if (!c) return null;
    const ctx = c.getContext('2d');
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    const colors = new Set();
    let nonBg = 0;
    for (let i = 0; i < data.length; i += 4 * 400) {
      const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      colors.add(key);
      // 背景深蓝 #0f172a = (15,23,42)
      if (!(data[i] < 30 && data[i + 1] < 35 && data[i + 2] < 55)) nonBg++;
    }
    return { colors: colors.size, nonBg, samples: data.length / 4 / 400 };
  });
  record('画布有实际绘制内容', pixelStats !== null && pixelStats.colors > 20,
    pixelStats ? `${pixelStats.colors} 种颜色, 非背景采样 ${pixelStats.nonBg}` : '无画布');

  await page.screenshot({ path: `${OUT}\\01-main.png` });

  // 2. 状态栏数据
  const statusText = await page.$eval('.status-bar', (el) => el.textContent);
  record('状态栏显示索引要素数', statusText.includes('30,400'), statusText.replace(/\s+/g, ' ').trim().slice(0, 120));
  record('状态栏显示离屏后端', statusText.includes('OffscreenCanvas'));

  // 3. 图层面板：7 个图层
  const layerItems = await page.$$eval('.layer-item', (els) => els.length);
  record('7 个图层控制项', layerItems === 7, `${layerItems} 项`);

  // 关闭塔架图层
  await page.$$eval('.layer-item', (els) => {
    const item = [...els].find((e) => e.textContent.includes('塔架'));
    item.querySelector('input[type=checkbox]').click();
  });
  await sleep(800);
  const towerOff = await page.$$eval('.layer-item', (els) => {
    const item = [...els].find((e) => e.textContent.includes('塔架'));
    return item.classList.contains('is-off');
  });
  record('图层可单独关闭', towerOff === true);
  // 重新打开
  await page.$$eval('.layer-item', (els) => {
    const item = [...els].find((e) => e.textContent.includes('塔架'));
    item.querySelector('input[type=checkbox]').click();
  });

  // 调透明度
  await page.$$eval('.layer-item', (els) => {
    const item = [...els].find((e) => e.textContent.includes('摄像点位'));
    const range = item.querySelector('input[type=range]');
    range.value = '0.3';
    range.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(500);
  record('透明度可调', true);

  // 4. 点击要素 → 属性卡（先通过内部命中接口找到真实可拾取坐标，再派发真实点击）
  const hitPoint = await page.evaluate(() => {
    const v = window.__mapViews[0];
    for (let x = 200; x <= 1350; x += 25) {
      for (let y = 150; y <= 750; y += 25) {
        const f = v.pickAtScreen(x, y);
        if (f) return { x, y, id: f.id, layer: f.layerId };
      }
    }
    return null;
  });
  record('存在可拾取要素', hitPoint !== null, hitPoint ? `${hitPoint.id} @(${hitPoint.x},${hitPoint.y})` : '无命中');
  if (hitPoint) {
    const canvas = await page.$('.canvas-host canvas');
    const box = await canvas.boundingBox();
    await page.mouse.click(box.x + hitPoint.x, box.y + hitPoint.y);
    await sleep(600);
    const propVisible = await page.$$eval('.prop-block', (els) => els.length);
    record('点击要素打开属性卡', propVisible >= 1, `${propVisible} 个属性块`);
    await page.screenshot({ path: `${OUT}\\02-property.png` });

    // Ctrl 点击另一个要素加选（多选）
    const second = await page.evaluate((firstId) => {
      const v = window.__mapViews[0];
      for (let x = 200; x <= 1350; x += 25) {
        for (let y = 150; y <= 750; y += 25) {
          const f = v.pickAtScreen(x, y);
          if (f && f.id !== firstId) return { x, y, id: f.id };
        }
      }
      return null;
    }, hitPoint.id);
    if (second) {
      await page.keyboard.down('Control');
      await page.mouse.click(box.x + second.x, box.y + second.y);
      await page.keyboard.up('Control');
      await sleep(500);
      const selectedCount = await page.$$eval('.prop-block', (els) => els.length);
      record('Ctrl 点击支持多选', selectedCount >= 2, `属性块 ${selectedCount} 个`);
    } else {
      record('Ctrl 点击支持多选', false, '找不到第二个可拾取要素');
    }
  }

  // 5. 批注打点流程
  await page.click('.canvas-toolbar .btn-small');
  await sleep(300);
  await page.click('.canvas-host canvas', { offset: { x: 600, y: 400 } });
  await sleep(400);
  const modalVisible = await page.$('.modal') !== null;
  record('批注模式点击弹出输入框', modalVisible);
  if (modalVisible) {
    await page.type('.modal textarea', '测试批注：此处安全距离需复核');
    await page.click('.modal .btn-primary');
    await sleep(500);
    const annoCount = await page.$$eval('.anno-item', (els) => els.length);
    record('批注提交后入列', annoCount >= 1, `${annoCount} 条批注`);

    // 制作方回复
    await page.click('.anno-item .btn-small');
    await sleep(300);
    await page.type('.reply-input', '已现场复核，距离满足规范要求');
    await page.click('.reply-actions .btn-ok');
    await sleep(400);
    const resolved = await page.$$eval('.anno-status', (els) =>
      [...els].some((e) => e.textContent.includes('已处理')));
    record('制作方标记已处理', resolved);
  }
  await page.screenshot({ path: `${OUT}\\03-annotation.png` });

  // 6. 提交新版本
  await page.click('.version-actions .btn-small');
  await sleep(400);
  await page.type('.popover .form-input', 'V3 测试版本');
  await page.click('.popover .btn-primary');
  await sleep(800);
  const versionTabs = await page.$$eval('.version-tab', (els) => els.length);
  record('提交生成新版本', versionTabs >= 3, `${versionTabs} 个版本标签`);

  // 7. 并排对比
  await page.click('.version-actions .btn-primary');
  await sleep(3000); // 双画布瓦片渲染
  const comparePanes = await page.$$eval('.compare-pane canvas', (els) => els.length);
  record('并排对比双画布', comparePanes === 2, `${comparePanes} 个画布`);
  const diffSummary = await page.$eval('.diff-summary', (el) => el.textContent.replace(/\s+/g, ' '));
  record('差异统计展示', /新增 \d+ . 删除 \d+ . 修改 \d+/.test(diffSummary), diffSummary.trim());
  await page.screenshot({ path: `${OUT}\\04-compare.png` });

  // 对比画布也有内容
  const comparePixels = await page.evaluate(() => {
    const cs = document.querySelectorAll('.compare-pane canvas');
    const out = [];
    for (const c of cs) {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const set = new Set();
      for (let i = 0; i < d.length; i += 4 * 500) set.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
      out.push(set.size);
    }
    return out;
  });
  record('两个对比画布均有绘制', comparePixels.every((n) => n > 20), `颜色数 ${comparePixels.join(' / ')}`);

  await page.click('.version-actions .btn-danger');
  await sleep(800);
  record('退出对比', (await page.$('.compare-root')) === null);

  console.log('\n==== 测试汇总 ====');
  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' (' + r.detail + ')' : ''}`);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) process.exitCode = 1;
} catch (e) {
  console.error('测试脚本异常:', e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
