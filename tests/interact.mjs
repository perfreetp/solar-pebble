/**
 * 浏览器端编辑交互测试：真实鼠标操作 + WebGL 画布。
 * 覆盖：画笔落子、框选填充/替换、镜像对称落子、图层次范围与锁定、撤销。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:8788';
const OUT = path.resolve('tests/shots');
fs.mkdirSync(OUT, { recursive: true });

const problems = [];
const consoleErrors = [];

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();

page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

const check = (cond, msg) => {
  if (!cond) problems.push(msg);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
};

async function totalCells() {
  const t = await page.locator('.hud-tl .hud-v').nth(1).innerText();
  return Number(t.replace(/[^\d]/g, ''));
}

async function openEditor() {
  await page.goto(`${BASE}/#/build/ORD-2608`, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('lunar.member', 'u-m2'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('canvas.gl-canvas', { timeout: 20000 });
  await page.waitForTimeout(3500);
}

await openEditor();
const box = await page.locator('canvas.gl-canvas').boundingBox();

// 1) 画笔：单击模型表面应增加体素
const baseCells = await totalCells();
await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.55);
await page.waitForTimeout(150);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(300);
const afterPaint = await totalCells();
check(afterPaint > baseCells, `画笔放置增加体素 ${baseCells} → ${afterPaint}`);

// 2) 撤销恢复
await page.keyboard.press('Control+z');
await page.waitForTimeout(400);
check((await totalCells()) === baseCells, `撤销恢复到 ${baseCells}`);

// 3) 擦除工具
await page.keyboard.press('e');
await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.55);
await page.waitForTimeout(120);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(300);
const afterErase = await totalCells();
check(afterErase < baseCells, `擦除减少体素 ${baseCells} → ${afterErase}`);
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
check((await totalCells()) === baseCells, '撤销擦除');
await page.keyboard.press('b');

// 4) 镜像：开启后一次落子应增加偶数个（或至少比单侧多）
await page.keyboard.press('m');
await page.waitForTimeout(250);
const mirrorOn = await page.locator('.mirror-flag').count();
check(mirrorOn > 0, '镜像角标出现');
await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.6);
await page.waitForTimeout(150);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(400);
const afterMirror = await totalCells();
check(afterMirror - baseCells >= 2, `镜像落子增加 ${afterMirror - baseCells} 格（应 ≥ 2）`);
await page.screenshot({ path: path.join(OUT, 'e2e-mirror.png') });
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
await page.keyboard.press('m');
await page.waitForTimeout(200);

// 5) 框选工具拖拽出选区
await page.keyboard.press('s');
await page.mouse.move(box.x + box.width * 0.38, box.y + box.height * 0.45);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(500);
const selBadge = await page.locator('.hud-br .mirror-flag').filter({ hasText: '选区' }).count();
const selCountText = selBadge ? await page.locator('.hud-br .mirror-flag').filter({ hasText: '选区' }).innerText() : '';
check(selBadge > 0, `框选产生选区（${selCountText.replace(/\s+/g, ' ')}）`);
await page.screenshot({ path: path.join(OUT, 'e2e-selection.png') });

// 6) 选区填充（换成亮色材质，便于看结果）
await page.locator('.mat-tile[title*="照明带"]').click();
const beforeFill = await totalCells();
await page.locator('.sel-toolbar .st-btn[title*="填充"]').click();
await page.waitForTimeout(600);
const afterFill = await totalCells();
check(afterFill >= beforeFill, `区域填充完成 ${beforeFill} → ${afterFill}`);
await page.screenshot({ path: path.join(OUT, 'e2e-fill.png') });
await page.keyboard.press('Control+z');
await page.waitForTimeout(400);

// 7) 阵列复制
await page.locator('.sel-toolbar .st-btn[title*="阵列"]').click();
await page.waitForSelector('.modal .axis-btn', { timeout: 5000 });
await page.locator('.axis-btn').nth(1).click();
await page.locator('.modal input[type=number]').first().fill('2');
const arrayEst = await page.locator('.preview .num').innerText();
check(Number(arrayEst.replace(/[^\d]/g, '')) > 0, `阵列预览给出预计格数 ${arrayEst}`);
await page.locator('.modal-foot .btn-primary').click();
await page.waitForTimeout(800);
const afterArray = await totalCells();
check(afterArray > afterFill - (afterFill - beforeFill), `阵列复制新增体素（当前 ${afterArray}）`);
await page.screenshot({ path: path.join(OUT, 'e2e-array.png') });
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
await page.keyboard.press('Escape');

// 8) 图层锁定：锁定当前层后该层不可编辑
await page.locator('.lb-cell').nth(9).click();
await page.waitForTimeout(200);
const activeLayer = await page.locator('.layer-num').innerText();
await page.keyboard.press('l');
await page.waitForTimeout(300);
const locked = await page.locator('.lb-cell.locked').count();
check(locked > 0, `图层锁定生效（${activeLayer.replace(/\s+/g, ' ')}）`);

// 9) 聚焦模式
await page.locator('.lb-focus').click();
await page.waitForTimeout(400);
const focusOn = await page.locator('.hud-br .mirror-flag').filter({ hasText: '聚焦' }).count();
check(focusOn > 0, '聚焦模式已开启');
await page.screenshot({ path: path.join(OUT, 'e2e-focus.png') });

// 10) 层范围：限定 5–12 层
await page.keyboard.press('l');
await page.locator('.lb-range input').first().fill('5');
await page.locator('.lb-range input').first().press('Enter');
await page.locator('.lb-range input').nth(1).fill('12');
await page.locator('.lb-range input').nth(1).press('Enter');
await page.waitForTimeout(600);
const inRange = await page.locator('.lb-cell.inRange').count();
check(inRange === 8, `可编辑层范围 = 5–12（实际高亮 ${inRange} 层）`);

// 11) 体检 + 问题聚焦
await page.locator('.lb-range input').first().fill('1');
await page.locator('.lb-range input').first().press('Enter');
await page.locator('.lb-range input').nth(1).fill('96');
await page.locator('.lb-range input').nth(1).press('Enter');
await page.waitForTimeout(400);
await page.locator('.ed-head button:has-text("体检")').click();
await page.waitForTimeout(2500);
const verdict = await page.locator('.verdict').count();
check(verdict > 0, '体检出结论');
const locateBtns = await page.locator('.locate-item').count();
console.log(`      定位按钮 ${locateBtns} 个`);
if (locateBtns) {
  await page.locator('.locate-item').first().click();
  await page.waitForTimeout(600);
}
await page.screenshot({ path: path.join(OUT, 'e2e-check.png') });

// 12) Ctrl+S 保存
await page.keyboard.press('Control+s');
await page.waitForTimeout(1200);
const savedTag = await page.locator('.ed-head .tag').filter({ hasText: '已保存' }).count();
check(savedTag > 0, 'Ctrl+S 保存成功');

console.log('\n--- console errors ---');
console.log(consoleErrors.length ? consoleErrors.join('\n') : '(none)');
console.log('\n--- problems ---');
console.log(problems.length ? problems.join('\n') : '(none)');

await browser.close();
process.exit(problems.length || consoleErrors.length ? 1 : 0);
