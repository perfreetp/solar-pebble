/**
 * 全量浏览器端到端测试：四个界面 + 编辑器核心交互 + 导出下载。
 * 运行前请先 `npm run build && npm start`（默认 8788 端口）。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:8788';
const OUT = path.resolve('tests/shots');
fs.mkdirSync(OUT, { recursive: true });

const problems = [];
const consoleErrors = [];
const results = [];

function record(ok, msg) {
  results.push({ ok, msg });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) problems.push(msg);
}

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, locale: 'zh-CN' });
const page = await ctx.newPage();

page.on('console', (msg) => {
  if (msg.type() === 'error') {
    const t = msg.text();
    if (!t.includes('favicon')) consoleErrors.push(t);
  }
});
page.on('pageerror', (err) => consoleErrors.push(`PAGEERROR: ${err.message}`));
page.on('response', (res) => {
  if (res.status() >= 400 && !res.url().includes('favicon')) {
    problems.push(`${res.status()} ${res.url()}`);
  }
});

const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled', timeout: 60000 });

/** 让测试可重复跑：确保有一张待质检的单，并把 ORD-2608 拉回建模中。 */
async function ensureFixture() {
  const api = async (method, url, body, member) => {
    const res = await fetch(`${BASE}/api${url}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Member': member },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.json().catch(() => ({}));
  };
  const orders = await api('GET', '/orders', undefined, 'u-clerk');
  const submitted = orders.filter((o) => o.status === 'submitted');
  if (!submitted.length) {
    // 找一个已分派给 许宁 或 陈砚 的单，重新送回质检
    const cand = orders.find((o) => o.assignee === 'u-m1' || o.assignee === 'u-m2') || orders[0];
    await api('PUT', `/orders/${cand.id}/model`, undefined, cand.assignee).catch(() => {});
    const detail = await api('GET', `/orders/${cand.id}`, undefined, 'u-clerk');
    if (detail.status === 'queued' || detail.status === 'draft') {
      await api('POST', `/orders/${cand.id}/status`, { status: 'building' }, cand.assignee);
    }
    await api('POST', `/orders/${cand.id}/status`, { status: 'submitted' }, cand.assignee);
  }
  // ORD-2608 保证处于建模中，建模台可写
  const o = await api('GET', '/orders/ORD-2608', undefined, 'u-clerk');
  if (o.status === 'rejected') {
    await api('POST', '/orders/ORD-2608/status', { status: 'building' }, 'u-m2').catch(() => {});
  }
}

await ensureFixture();

async function go(hash) {
  await page.goto(`${BASE}/#${hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
}

async function canvasInk() {
  // WebGL 画布 preserveDrawingBuffer=false，readPixels 读不到合成帧，改为截图统计
  const buf = await page.locator('canvas').first().screenshot({ animations: 'disabled', timeout: 60000 });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const { data } = g.getImageData(0, 0, c.width, c.height);
    const seen = new Set();
    let lit = 0;
    for (let y = 0; y < c.height; y += 5) {
      for (let x = 0; x < c.width; x += 5) {
        const i = (y * c.width + x) * 4;
        seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
        if (data[i] > 30 || data[i + 1] > 30 || data[i + 2] > 30) lit++;
      }
    }
    return { colors: seen.size, lit };
  }, buf.toString('base64'));
}

// ── 1. 接单台 ───────────────────────────────────────────────
await go('/orders');
await page.waitForSelector('.order-card', { timeout: 20000 });
await page.locator('.filter-chip:has-text("全部")').click();
await page.waitForTimeout(400);
const cards = await page.locator('.order-card').count();
record(cards >= 7, `接单台列出 ${cards} 个工单`);
const sidebarLoad = await page.locator('.load-row').count();
record(sidebarLoad === 4, `侧栏显示 ${sidebarLoad} 位建模师傅的负荷`);
await shot('01-orders');

// 搜索
await page.locator('.search').fill('阿里斯塔克斯');
await page.waitForTimeout(800);
const searched = await page.locator('.order-card').count();
record(searched >= 1 && searched < cards, `搜索“阿里斯塔克斯”命中 ${searched} 条`);
await page.locator('.search').fill('');
await page.waitForTimeout(600);

// 详情抽屉
await page.locator('.order-card').first().click();
await page.waitForSelector('.drawer .d-section', { timeout: 8000 });
const drawerTitle = await page.locator('.drawer h2').innerText();
record(drawerTitle.length > 0, `详情抽屉打开：${drawerTitle.slice(0, 22)}`);
await shot('02-order-detail');
await page.locator('.drawer-head .btn-icon').click();

// 接单流程（前台身份）
await page.evaluate(() => localStorage.setItem('lunar.member', 'u-clerk'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.locator('.side-head .btn-primary').click();
await page.waitForSelector('.modal .form-grid', { timeout: 8000 });
await page.locator('.modal .input').first().fill('E2E 验收单 · 观测穹顶');
await page.locator('.modal textarea').fill('E2E 自动化创建，用于验证接单链路。');
await page.locator('.modal-foot .btn-primary').click();
await page.waitForTimeout(3000);
record((await page.locator('.toast').count()) > 0, '接单后弹出确认提示');
await page.waitForTimeout(800);

// ── 2. 建模台 ───────────────────────────────────────────────
await page.evaluate(() => localStorage.setItem('lunar.member', 'u-m2'));
await page.goto(`${BASE}/#/build/ORD-2608`, { waitUntil: 'domcontentloaded' });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas.gl-canvas', { timeout: 20000 });
await page.waitForTimeout(4500);

const ink = await canvasInk();
record(ink.colors > 60 && ink.lit > 500, `三维视图渲染正常（${ink.colors} 种颜色 / ${ink.lit} 个亮点）`);
await shot('03-editor');

const cellText = await page.locator('.hud-tl .hud-v').nth(1).innerText();
record(/[\d,]{4,}/.test(cellText), `体素计数显示 ${cellText}`);

const box = await page.locator('canvas.gl-canvas').boundingBox();
await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
await page.waitForTimeout(600);
record((await page.locator('.hover-mat').count()) > 0, '悬停显示体素材质');

await page.locator('.ed-head button:has-text("体检")').click();
await page.waitForTimeout(2500);
record((await page.locator('.verdict').count()) > 0, '合并前体检出结论（悬空 / 薄壁）');
await shot('04-editor-check');

await page.locator('.ed-head button:has-text("导出")').click();
await page.waitForSelector('.level', { timeout: 30000 });
await page.waitForTimeout(900);
const levels = await page.locator('.level').count();
record(levels === 4, `导出提供 ${levels} 档减面`);
const faceText = await page.locator('.level').first().locator('.lv-num').innerText();
record(/\d/.test(faceText), `原始精度面数 ${faceText}`);
await shot('05-export');

const dlPromise = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
await page.locator('.modal-foot button:has-text("导出 zip")').click();
const dl = await dlPromise;
record(!!dl, '点击导出触发文件下载');
if (dl) {
  const p = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(p);
  const size = fs.statSync(p).size;
  record(size > 5000, `导出包 ${dl.suggestedFilename()} · ${(size / 1024).toFixed(0)} KB`);
}
await page.waitForTimeout(1000);

// ── 3. 质检台 ───────────────────────────────────────────────
await page.evaluate(() => localStorage.setItem('lunar.member', 'u-qc'));
await go('/qc');
await page.waitForSelector('.qc-item, .qc-main .empty', { timeout: 25000 });
await page.waitForTimeout(4000);
const qcItems = await page.locator('.qc-item').count();
record(qcItems >= 1, `质检队列 ${qcItems} 单`);
record((await page.locator('.qc-verdict').count()) > 0, '质检页显示体检结论');
const qcPreview = await canvasInk();
record(qcPreview.lit > 200, `质检预览渲染（${qcPreview.lit} 个亮点）`);
await page.locator('.btn-teal:has-text("自动核验全部")').click();
await page.waitForTimeout(3000);
const autoChecked = await page.locator('.check.on').count();
record(autoChecked >= 3, `自动核验勾选 ${autoChecked} 项`);
record((await page.locator('.inspect-item').count()) >= 4, '结构核验数据表已生成');
await shot('06-qc');

await page.locator('.qc-detail-head button:has-text("打回返工")').click();
await page.waitForSelector('.modal textarea', { timeout: 8000 });
await page.locator('.modal .qtag').first().click();
await page.locator('.modal-foot .btn-danger').click();
await page.waitForTimeout(2500);
record((await page.locator('.toast').count()) > 0, '打回后弹出返工计数提示');
await page.waitForTimeout(900);

// ── 4. 看板 ─────────────────────────────────────────────────
await go('/dashboard');
await page.waitForSelector('.kpi', { timeout: 15000 });
await page.waitForTimeout(900);
record((await page.locator('.kpi').count()) === 4, '看板 4 个 KPI 卡片');
record((await page.locator('.hbar-row').count()) === 4, '看板 4 位师傅的完成量条形');
const rates = (await page.locator('.rw-rate').allInnerTexts()).map((t) => Number(t.replace('%', '').trim()));
record(rates.length === 4 && rates.every((r) => r >= 0 && r <= 100), `返工率均在 0–100% 区间（${rates.join(' / ')}）`);
record((await page.locator('.day-col').count()) === 14, '近 14 天节律图');
await shot('07-dashboard');

// ── 结果 ───────────────────────────────────────────────────
console.log(`\n通过 ${results.filter((r) => r.ok).length}/${results.length}`);
console.log('\n--- console errors ---');
console.log(consoleErrors.length ? consoleErrors.join('\n') : '(none)');
console.log('\n--- problems ---');
console.log(problems.length ? problems.join('\n') : '(none)');

await browser.close();
process.exit(problems.length || consoleErrors.length ? 1 : 0);
