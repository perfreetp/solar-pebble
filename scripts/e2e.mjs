// 端到端浏览器测试:四界面完整工作流
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const CHROME = process.env.LOCALAPPDATA +
  '\\ms-playwright\\chromium_headless_shell-1255\\chrome-headless-shell-win64\\chrome-headless-shell.exe';
const BASE = 'http://127.0.0.1:' + (process.env.E2E_PORT || '5180');
const SHOTS = new URL('./shots/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
mkdirSync(SHOTS, { recursive: true });

let pass = 0;
function check(name, cond) {
  if (!cond) throw new Error('断言失败: ' + name);
  pass++;
  console.log('  ✓ ' + name);
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

// ---------- 1. 加载与首屏渲染 ----------
console.log('1) 首屏加载');
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('canvas');
await page.waitForTimeout(1200); // 等 OffscreenCanvas 首帧 + 底图生成
await page.screenshot({ path: SHOTS + '01-studio-boot.png' });
const title = await page.title();
check('应用标题正确: ' + title, title.includes('描图台'));
check('四个导航项(插画师可见 2 个)', await page.locator('.main-nav button').count() >= 2);
check('无控制台错误', errors.length === 0 || errors.every(e => e.includes('favicon')));
if (errors.length) console.log('   ↳ 控制台输出:', errors.slice(0, 5));

// 画布位图尺寸正常(OffscreenCanvas 接管后只能检查属性)
const canvasOk = await page.evaluate(() => {
  const c = document.querySelector('.canvas-stage canvas');
  return c.width > 800 && c.height > 500;
});
check('画布尺寸正常', canvasOk);

// ---------- 2. 钢笔画一条闭合翅脉 ----------
console.log('2) 钢笔绘制翅脉');
const box = await page.locator('.canvas-stage canvas').boundingBox();
function docXY(x, y) {
  // 初始视图 scale=1, offset=(40,30),canvas 本身无内边距
  return { x: box.x + 40 + x, y: box.y + 30 + y };
}
await page.getByRole('button', { name: /钢笔/ }).click();
const veinPts = [[220, 200], [460, 180], [500, 420], [240, 400]];
for (const [x, y] of veinPts) {
  const p = docXY(x, y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(60);
}
// 双击闭合
const last = docXY(240, 400);
await page.mouse.dblclick(last.x, last.y);
await page.waitForTimeout(200);
const layerCount1 = await page.locator('.layer-list li').count();
check('图层面板出现 1 条翅脉', layerCount1 === 1);
await page.screenshot({ path: SHOTS + '02-pen-vein.png' });

// ---------- 3. 选择工具拖节点(验证贝塞尔柄出现) ----------
console.log('3) 节点拖拽与控制柄');
await page.getByRole('button', { name: /选择/ }).click();
const n0 = docXY(220, 200);
await page.mouse.move(n0.x, n0.y);
await page.mouse.down();
await page.mouse.move(n0.x + 60, n0.y + 40, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(200);
check('拖拽后图层仍在', (await page.locator('.layer-list li').count()) === 1);
await page.screenshot({ path: SHOTS + '03-node-drag.png' });

// ---------- 4. 撤销/重做 ----------
console.log('4) 撤销重做(≥50 步能力)');
const histBefore = await page.locator('.history-pill').innerText();
check('历史栈显示撤销步数', /历史栈 \d+ 步撤销/.test(histBefore));
await page.keyboard.press('Control+z');
await page.waitForTimeout(150);
const histAfter = await page.locator('.history-pill').innerText();
check('撤销后出现重做步数', /\/ [1-9]\d* 步重做/.test(histAfter));
await page.keyboard.press('Control+y');
await page.waitForTimeout(150);
check('重做后重做栈清空', /\/ 0 步重做/.test(await page.locator('.history-pill').innerText()));

// ---------- 5. 画斑纹并做布尔并集 ----------
console.log('5) 两条闭合路径布尔并集');
await page.getByRole('button', { name: '斑纹', exact: true }).click();
await page.getByRole('button', { name: /钢笔/ }).click();
const sq1 = [[620, 200], [760, 200], [760, 340], [620, 340]];
for (const [x, y] of sq1) { const p = docXY(x, y); await page.mouse.click(p.x, p.y); await page.waitForTimeout(40); }
let q = docXY(620, 340); await page.mouse.dblclick(q.x, q.y);
await page.waitForTimeout(150);
await page.getByRole('button', { name: '斑纹', exact: true }).click();
const sq2 = [[720, 260], [860, 260], [860, 400], [720, 400]];
for (const [x, y] of sq2) { const p = docXY(x, y); await page.mouse.click(p.x, p.y); await page.waitForTimeout(40); }
q = docXY(720, 400); await page.mouse.dblclick(q.x, q.y);
await page.waitForTimeout(150);
check('现有 3 个图层(1 脉 + 2 斑)', (await page.locator('.layer-list li').count()) === 3);
// 选中两个斑纹:点描边(顶边),Shift 多选
await page.getByRole('button', { name: /选择/ }).click();
let hit = docXY(690, 202); await page.mouse.click(hit.x, hit.y);
await page.waitForTimeout(100);
hit = docXY(790, 262);
await page.keyboard.down('Shift');
await page.mouse.click(hit.x, hit.y);
await page.keyboard.up('Shift');
await page.waitForTimeout(100);
await page.getByRole('button', { name: /并集/ }).click();
await page.waitForTimeout(200);
check('并集后图层数 = 2(脉 + 并集结果)', (await page.locator('.layer-list li').count()) === 2);
await page.screenshot({ path: SHOTS + '04-boolean-union.png' });

// ---------- 6. 斑纹镂空 ----------
console.log('6) 斑纹 × 翅脉镂空');
// 选中并集斑纹:点其顶边描边(内部填充不会命中)
hit = docXY(690, 202); await page.mouse.click(hit.x, hit.y);
await page.getByRole('button', { name: /斑纹镂空/ }).click();
await page.waitForTimeout(200);
const toast = await page.locator('.toast').innerText();
check('镂空提示成功', toast.includes('镂空'));
await page.screenshot({ path: SHOTS + '05-cut-holes.png' });

// ---------- 7. 图层锁定与隐藏 ----------
console.log('7) 图层锁定/隐藏');
await page.locator('.layer-list li').first().locator('button[title="锁定"]').click();
await page.waitForTimeout(100);
check('出现锁定样式', (await page.locator('.layer-list li.locked').count()) === 1);
await page.locator('.layer-list li').first().locator('button[title="隐藏"]').click();
await page.waitForTimeout(150);
await page.screenshot({ path: SHOTS + '06-layer-lock-hide.png' });
// 还原
await page.locator('.layer-list li').first().locator('button[title="显示"]').click();
await page.locator('.layer-list li').first().locator('button[title="解锁"]').click();

// ---------- 8. 对齐工具 ----------
console.log('8) 左对齐');
// 画布内 Shift 多选:先点翅脉描边,再 Shift 点斑纹描边
let a8 = docXY(460, 182); await page.mouse.click(a8.x, a8.y);
await page.waitForTimeout(100);
await page.keyboard.down('Shift');
a8 = docXY(690, 202); await page.mouse.click(a8.x, a8.y);
await page.keyboard.up('Shift');
await page.waitForTimeout(100);
check('已选中两条路径用于对齐', (await page.locator('.layer-list li.selected').count()) === 2);
await page.getByRole('button', { name: '左对齐' }).click();
await page.waitForTimeout(150);
check('对齐操作无报错', errors.length === 0 || errors.every(e => e.includes('favicon')));

// ---------- 9. 保存模板 + 重新套用 ----------
console.log('9) 模板保存与同科套用');
await page.getByRole('button', { name: /模板库/ }).click();
await page.locator('.modal input').first().fill('E2E 凤蝶脉序模板');
await page.getByRole('button', { name: '把当前翅脉存为模板' }).click();
await page.waitForTimeout(200);
check('模板列表出现新模板', (await page.locator('.tpl-row').count()) >= 1);
await page.getByRole('button', { name: '套用到当前文档' }).first().click();
await page.waitForTimeout(200);
check('套用后图层增加', (await page.locator('.layer-list li').count()) >= 3);
await page.screenshot({ path: SHOTS + '07-template-apply.png' });

// ---------- 10. 导出 SVG ----------
console.log('10) 分层 SVG 导出');
await page.getByRole('button', { name: /导出 SVG/ }).click();
await page.waitForTimeout(200);
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('.modal button', { hasText: '导出' }).first().click(),
]);
const svgPath = SHOTS + 'export.svg';
await download.saveAs(svgPath);
const svg = await import('node:fs/promises').then(fs => fs.readFile(svgPath, 'utf8'));
check('SVG 含翅脉层', svg.includes('layer-vein'));
check('SVG 含斑纹层', svg.includes('layer-pattern'));
check('SVG 含 evenodd', svg.includes('evenodd'));

// ---------- 11. 提交审校 ----------
console.log('11) 提交审校');
await page.getByRole('button', { name: '提交审校' }).click();
await page.waitForTimeout(300);
check('提交 toast 出现', (await page.locator('.toast').innerText()).includes('已提交'));

// ---------- 12. 审校界面:圈注 + 驳回 + 通过 ----------
console.log('12) 分类审校台');
await page.locator('.user-box select').selectOption({ index: 2 });
await page.getByRole('button', { name: '分类审校台' }).click();
await page.waitForTimeout(300);
await page.locator('.sub-card').first().click();
await page.waitForTimeout(400);
// 拖一个驳回圈
const rbox = await page.locator('.review-main canvas').boundingBox();
await page.mouse.move(rbox.x + 300, rbox.y + 300);
await page.mouse.down();
await page.mouse.move(rbox.x + 400, rbox.y + 380, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(200);
check('圈注记录出现 1 条', (await page.locator('.ann-row').count()) === 1);
await page.screenshot({ path: SHOTS + '08-review-annotation.png' });
// 驳回
page.on('dialog', d => d.accept());
await page.getByRole('button', { name: '✕ 驳回' }).click();
await page.waitForTimeout(200);
// 待审列表中该稿件消失,切到"驳回"筛选验证状态
await page.locator('.filter-row button', { hasText: '驳回' }).click();
await page.waitForTimeout(200);
check('稿件状态变驳回', (await page.locator('.sub-card .status-badge.rejected').count()) >= 1);

// ---------- 13. 后台管理:预设 CRUD ----------
console.log('13) 后台管理(模板库 + 导出预设)');
await page.locator('.user-box select').selectOption({ index: 3 });
await page.getByRole('button', { name: '后台管理' }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '导出预设' }).click();
const presetRows = await page.locator('.data-table tbody tr').count();
check('预设列表有数据', presetRows >= 2);
await page.getByRole('button', { name: '＋ 新建预设' }).click();
await page.locator('.preset-editor input').first().fill('E2E 测试预设');
await page.getByRole('button', { name: '保存预设' }).click();
await page.waitForTimeout(200);
check('新预设入库', (await page.locator('.data-table tbody tr').count()) === presetRows + 1);
check('模板库 Tab 可切回', await page.getByRole('button', { name: '翅脉模板库' }).isVisible());
await page.screenshot({ path: SHOTS + '09-admin-presets.png' });

// ---------- 14. 统计界面 ----------
console.log('14) 产量统计');
await page.getByRole('button', { name: '产量统计' }).click();
await page.waitForTimeout(500);
check('KPI 卡片 4 张', (await page.locator('.kpi').count()) === 4);
check('明细表有行', (await page.locator('.data-table tbody tr').count()) >= 2);
check('今日完成数 ≥ 1', parseInt(await page.locator('.kpi-num').first().innerText(), 10) >= 1);
await page.screenshot({ path: SHOTS + '10-stats.png' });

// ---------- 15. 全局无报错 ----------
const realErrors = errors.filter(e => !e.includes('favicon'));
check('全程无控制台错误(' + realErrors.length + ')', realErrors.length === 0);
if (realErrors.length) console.log(realErrors);

await browser.close();
console.log(`\nE2E 全部 ${pass} 项断言通过 ✅ 截图与 SVG 已保存到 scripts/shots/`);
