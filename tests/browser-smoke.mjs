// 真实浏览器（系统 Chrome + WebGPU）冒烟：页面装配、GPU 初始化、笔刷落子、镜像、预览绕飞
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.VITE_URL || 'http://127.0.0.1:5173/';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(SHOTS, { recursive: true });

const failures = [];
const ok = (cond, msg) => {
  if (cond) console.log('  ✓ ' + msg);
  else { failures.push(msg); console.error('  ✗ ' + msg); }
};

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-webgpu-developer-features'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

try {
  // 每次从干净存档开始，避免上一轮测试的体素污染演示数据
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE, { waitUntil: 'networkidle' });

  const hasGpu = await page.evaluate(() => !!navigator.gpu);
  console.log('[1] 浏览器 WebGPU 支持：' + (hasGpu ? '是' : '否（跳过 GPU 断言）'));

  await page.waitForSelector('project-page table tbody tr');
  const rowText = await page.locator('project-page table tbody tr').first().innerText();
  ok(rowText.includes('长征系列演示火箭'), '项目页渲染出演示条目：' + rowText.split('\t')[1]);

  // 进入建模页
  await page.locator('project-page button[data-act="open"]').click();
  await page.waitForSelector('editor-page canvas');
  await page.waitForTimeout(800); // 等若干帧渲染

  const canvas = page.locator('editor-page canvas');
  const box = await canvas.boundingBox();
  ok(box && box.width > 400 && box.height > 400, `画布尺寸正常 ${box?.width}×${box?.height}`);

  const hasCurrent = await page.evaluate(() => !!window.voxelStore.current);
  ok(hasCurrent, '当前条目已载入');
  const before = await page.evaluate(() =>
    window.voxelStore.current.layers.reduce((n, l) => n + l.voxels.size, 0));
  ok(before > 100, `演示火箭体素数 ${before}`);

  if (hasGpu) {
    const gpuErrors = await page.evaluate(() => window.__gpuErrors ?? []);
    ok(gpuErrors.length === 0, 'WebGPU 无未捕获错误' + (gpuErrors.length ? '：' + gpuErrors.join(';') : ''));
  }

  // 切到笔刷，选与演示涂装不同的颜色，点火箭实体表面：沿面法线在外侧落 1 子
  await page.locator('[data-tool="paint"]').click();
  await page.locator('#custom-color').fill('#ff00ff');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(120);
  const canvasCount = await page.locator('editor-page canvas').count();
  ok(canvasCount === 1, '建模画布存在');
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(200);
  const afterPaint = await page.evaluate(() =>
    window.voxelStore.current.layers.reduce((n, l) => n + l.voxels.size, 0));
  ok(afterPaint === before + 1, `命中面法线外侧落 1 子（${before} → ${afterPaint}）`);

  // 打开镜像，再在实体表面落一子，检查对称（普通格 +2，对称面格 +1）
  await page.locator('#mirror-btn').click();
  const mirrorOn = await page.evaluate(() => window.voxelStore.settings.mirrorX);
  ok(mirrorOn === true, 'X 镜像已开启');
  await page.mouse.move(cx + 30, cy - 20);
  await page.mouse.click(cx + 30, cy - 20);
  await page.waitForTimeout(150);
  const afterMirror = await page.evaluate(() =>
    window.voxelStore.current.layers.reduce((n, l) => n + l.voxels.size, 0));
  ok(afterMirror >= afterPaint + 1 && afterMirror <= afterPaint + 2,
    `镜像落子生效（${afterPaint} → ${afterMirror}，普通格 +2 / 对称面 +1）`);
  const mirroredPair = await page.evaluate(() => {
    const active = window.voxelStore.activeLayer;
    let pairs = 0;
    for (const k of active.voxels.keys()) {
      const [x, y, z] = k.split(',').map(Number);
      const mx = 2 * 63 - x;
      if (mx !== x && active.voxels.has(`${mx},${y},${z}`)) pairs++;
    }
    return pairs;
  });
  ok(mirroredPair >= 1, `镜像两侧成对存在（${mirroredPair} 对）`);

  // 正交切换
  await page.locator('#ortho-btn').click();
  const ortho = await page.evaluate(() => window.voxelStore.settings.ortho);
  ok(ortho === true, '正交视图已切换');
  await page.screenshot({ path: join(SHOTS, 'editor-ortho.png') });

  // 导出统计弹窗
  await page.locator('#export-btn').click();
  await page.waitForSelector('dialog .stat-grid');
  const stats = await page.locator('dialog .stat-grid').innerText();
  ok(/体素数/.test(stats) && /三角面数/.test(stats) && /顶点数/.test(stats), '导出前显示体素/顶点/三角面统计：\n' + stats);
  await page.locator('dialog #dlg-cancel').click();

  // 进入预览页，验证自动绕飞
  await page.locator('#preview-btn').click();
  await page.waitForSelector('preview-page canvas');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(SHOTS, 'preview-orbit.png') });
  const previewVisible = await page.locator('preview-page .badge').innerText();
  ok(previewVisible.includes('自动绕飞'), '预览页只读绕飞标识存在');
  if (hasGpu) {
    const gpuErrors2 = await page.evaluate(() => window.__gpuErrors ?? []);
    ok(gpuErrors2.length === 0, '预览页 WebGPU 无未捕获错误');
  }

  const realErrors = consoleErrors.filter((e) =>
    !e.includes('favicon') && !e.includes('404') && !e.includes('status of 404'));
  ok(realErrors.length === 0,
    '控制台无错误' + (realErrors.length ? '：' + realErrors.join(' | ') : ''));
} catch (e) {
  failures.push('异常: ' + e.message);
  console.error(e);
} finally {
  await page.evaluate(() => localStorage.clear()).catch(() => {});
  await browser.close();
}

if (failures.length) {
  console.error(`\n浏览器冒烟失败 ${failures.length} 项`);
  process.exit(1);
}
console.log('\n浏览器冒烟全部通过，截图在 tests/shots/');
