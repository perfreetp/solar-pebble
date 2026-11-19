// 运行时冒烟测试:驱动本机 Chrome 验证四个界面与 three.js 场景
import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://127.0.0.1:5173/';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1600,1000'],
});

const errors = [];
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

const results = [];
function check(name, cond, extra = '') {
  results.push({ name, ok: Boolean(cond), extra });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
}

try {
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  // 清空本地存档,保证从初始地形与演示批次开始
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 2000));

  // 1. 外壳与四界面导航
  const navLabels = await page.$$eval('.nav button', (els) => els.map((e) => e.textContent.trim()));
  check('四个界面导航', navLabels.length === 4, navLabels.join('/'));

  // 2. 建模界面 three.js 画布与体素
  const canvasCount = await page.$$eval('canvas', (els) => els.length);
  check('three.js WebGL 画布挂载', canvasCount >= 1, `${canvasCount} canvas`);
  const layerRows = await page.$$eval('.layer-row', (els) => els.length);
  check('三个编辑层(表土/溅射/基岩)', layerRows === 3, `${layerRows} 行`);
  const voxelStat = await page.$eval('.vp-stat', (el) => el.textContent);
  check('视口显示半米体素信息', voxelStat.includes('0.5m'));
  const totalText = await page.$$eval('.stat-card b', (els) => els.map((e) => e.textContent));
  check('体素统计已生成', Number(totalText[0].replace(/[^0-9]/g, '')) > 100, totalText[0]);

  // 3. 镜像开关(原生 checkbox 隐藏,点 label.switch)
  const mirrorLabel = await page.$('.switch');
  const before = await page.$eval('.switch input', (el) => el.checked);
  await mirrorLabel.click();
  await new Promise((r) => setTimeout(r, 300));
  const after = await page.$$eval('.vp-stat', (els) => els[0].textContent);
  check('镜像对称轴可开启', !before && after.includes('镜像 开'));

  // 4. 工具切换
  const toolBtns = await page.$$('.tool-btn');
  await toolBtns[2].click(); // 框选
  const activeTool = await page.$eval('.tool-btn.active', (el) => el.textContent.trim());
  check('工具可切换到框选', activeTool === '框选', activeTool);

  // 5. 扫描功能(初始实心地形应无孤立)
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    btns.find((b) => b.textContent.includes('扫描孤立体素'))?.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  const scanText = await page.$$eval('.scan-finding', (els) => els.map((e) => e.textContent));
  check('导出前扫描可运行', scanText.length === 2 && scanText.some((t) => t.includes('孤立体素')), scanText.join(' | '));

  // 6. 减面(异步 meshoptimizer,轮询结果)
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    btns.find((b) => b.textContent.includes('按预算合并减面'))?.click();
  });
  await page.waitForSelector('.kv dd', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 500));
  const reduction = await page.evaluate(() => {
    const kv = [...document.querySelectorAll('.kv dd')].map((e) => e.textContent);
    const mode = document.querySelector('.vp-stat').textContent;
    return { kv, mode };
  });
  check('贪婪合并生成单网格', reduction.mode.includes('减面网格'), reduction.kv.join(' / '));
  // 默认 35% 预算高于贪婪结果,采用视觉无损的贪婪网格(不二次塌缩)
  const greedyRatio = parseFloat(reduction.kv.find((t) => t.includes('%')));
  check('贪婪合并显著降面(视觉无损)', greedyRatio <= 40, `${greedyRatio}%`);

  // 一键减到两成:触发贪婪 + meshopt 二次塌缩
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('一键减到两成'))?.click();
  });
  await new Promise((r) => setTimeout(r, 1200));
  const reduced = await page.evaluate(() => {
    const kv = [...document.querySelectorAll('.kv dd')].map((e) => e.textContent);
    return { ratio: parseFloat(kv.find((t) => t.includes('%'))), after: kv[2] };
  });
  check('一键减面达到原来两成', reduced.ratio <= 20, `${reduced.ratio}% → ${reduced.after} 面`);

  await page.screenshot({ path: 'scripts/shots/01-model.png' });

  // 7. 素材批次界面
  const nav = await page.$$('.nav button');
  await nav[1].click();
  await new Promise((r) => setTimeout(r, 600));
  const batchCards = await page.$$eval('.batch-card', (els) => els.length);
  check('批次列表渲染(含演示批次)', batchCards >= 2, `${batchCards} 批`);
  const severeTags = await page.$$eval('td .tag.severe', (els) => els.length);
  check('自动检查问题已分级展示', severeTags >= 1, `${severeTags} 个严重标签`);
  await page.screenshot({ path: 'scripts/shots/02-batches.png' });

  // 8. 复核台:逐条确认/驳回
  await nav[2].click();
  await new Promise((r) => setTimeout(r, 500));
  // 等待演示批次脱离「检查中」
  await page.waitForFunction(
    () => !document.querySelector('.panel-h')?.textContent.includes('自动检查中'),
    { timeout: 5000 },
  ).catch(() => {});
  const issueCardsBefore = await page.$$eval('.issue-card', (els) => els.length);
  check('复核台存在待处理问题', issueCardsBefore > 0, `${issueCardsBefore} 张问题卡`);
  // 用 JS 点击,规避滚动容器内元素不可点击的问题
  const confirmed = await page.evaluate(() => {
    const btn = document.querySelector('.issue-card .actions button.primary');
    if (!btn) return false;
    btn.click();
    return true;
  });
  await new Promise((r) => setTimeout(r, 300));
  if (confirmed) {
    // 该问题卡的状态标签应从「待处理」变为「已确认」
    const decided = await page.$$eval(
      '.issue-card',
      (els) =>
        els.some((card) =>
          [...card.querySelectorAll('.tag')].some((t) => t.textContent.trim() === '已确认'),
        ),
    );
    check('逐条确认可写入复核结论', decided);
  } else {
    check('逐条确认可写入复核结论', false, '未找到确认按钮');
  }
  const rejected = await page.evaluate(() => {
    const btn = document.querySelector('.issue-card .actions button.danger');
    if (!btn) return false;
    btn.click();
    return true;
  });
  await new Promise((r) => setTimeout(r, 300));
  check('逐条驳回可写入复核结论', rejected);
  await page.screenshot({ path: 'scripts/shots/03-review.png' });

  // 9. 放行中心
  await nav[3].click();
  await new Promise((r) => setTimeout(r, 500));
  const gateText = await page.$$eval('.issue-card .tag', (els) => els.map((e) => e.textContent));
  check('放行闸门状态展示', gateText.some((t) => t.includes('闸门')), gateText.join('/'));
  const releaseBtn = await page.$$eval('button.primary', (els) =>
    els.some((b) => b.textContent.includes('整批放行') && b.disabled),
  );
  check('未达标批次放行按钮禁用', releaseBtn);
  await page.screenshot({ path: 'scripts/shots/04-release.png' });

  // 10. 完整放行一个达标批次:选无驳回项的演示批次,全部问题确认后放行
  await nav[2].click();
  await new Promise((r) => setTimeout(r, 400));
  const cardCount = await page.$$eval('.batch-card', (els) => els.length);
  let goodBatchFound = false;
  for (let i = 0; i < cardCount; i++) {
    const cards = await page.$$('.batch-card');
    if (i >= cards.length) break;
    // JS 点击切换批次,避免滚动问题
    await page.evaluate((idx) => document.querySelectorAll('.batch-card')[idx].click(), i);
    await new Promise((r) => setTimeout(r, 300));
    // 右侧复核板标题是含「逐条复核」的 .panel-h
    const header = await page.evaluate(
      () =>
        [...document.querySelectorAll('.panel-h')]
          .map((e) => e.textContent)
          .find((t) => t.includes('逐条复核')) ?? '',
    );
    if (!header.includes('戈壁')) continue;
    goodBatchFound = true;
    for (let guard = 0; guard < 40; guard++) {
      const clicked = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find(
          (b) => b.textContent.trim() === '全部确认',
        );
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });
      await new Promise((r) => setTimeout(r, 150));
      if (!clicked) break;
    }
    break;
  }
  check('找到可放行的演示批次(戈壁)', goodBatchFound);
  await nav[3].click();
  await new Promise((r) => setTimeout(r, 400));
  const canRelease = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('整批放行'));
    return btn ? !btn.disabled : false;
  });
  check('全部复核后闸门通过', canRelease);
  if (canRelease) {
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => b.textContent.includes('整批放行'))?.click();
    });
    await new Promise((r) => setTimeout(r, 300));
    const released = await page.$$eval('.tag.ok', (els) => els.some((e) => e.textContent === '已放行'));
    check('整批放行成功', released);
  } else {
    check('整批放行成功', false, '按钮不可用');
  }
} catch (e) {
  errors.push(`test-exception: ${e.stack || e.message}`);
} finally {
  console.log('\n--- 浏览器错误 ---');
  if (errors.length === 0) console.log('无控制台错误');
  else errors.forEach((e) => console.log(e));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n结果:${results.length - failed.length}/${results.length} 通过`);
  await browser.close();
  process.exit(failed.length || errors.length ? 1 : 0);
}
