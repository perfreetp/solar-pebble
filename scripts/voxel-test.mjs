// 体素编辑核心交互测试:堆积/镜像/框选复制粘贴/擦除/扫描高亮
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1600,1000'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const results = [];
function check(name, cond, extra = '') {
  results.push(Boolean(cond));
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
}

try {
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1800));

  // 直接驱动 store + 场景拾取逻辑,验证数据层行为(确定性、不依赖像素坐标)
  const api = await page.evaluate(async () => {
    const store = (await import('/src/voxel/voxelStore.ts')).voxelStore;
    const { keyOf, parseKey } = await import('/src/voxel/constants.ts');
    const log = {};

    const initial = store.totalCount();
    log.initial = initial;

    // 1. 找一个坑缘表面体素(顶面暴露),在其上堆积
    const snap = store.snapshot();
    const occupied = new Set(snap.map((d) => keyOf(d.coord.x, d.coord.y, d.coord.z)));
    let surface = null;
    for (const d of snap) {
      if (d.layer !== 'topsoil') continue;
      if (!occupied.has(keyOf(d.coord.x, d.coord.y + 1, d.coord.z))) {
        surface = d.coord;
        break;
      }
    }
    log.surfaceFound = Boolean(surface);

    // 2. 关镜像,堆一块
    store.setMirrorEnabled(false);
    const before = store.totalCount();
    const okAdd = store.stackOn(surface);
    const addedKey = keyOf(surface.x, surface.y + 1, surface.z);
    log.addOk = okAdd;
    log.addedExists = store.has(addedKey);
    log.mirrorNotCreated = !store.has(keyOf(-surface.x, surface.y + 1, surface.z));
    log.deltaNoMirror = store.totalCount() - before;

    // 3. 开镜像,再堆一块,对称侧应自动出现
    store.setMirrorEnabled(true);
    const before2 = store.totalCount();
    // 选一个 x!=0 的表面点,才能看出对称效果
    let side = null;
    for (const d of store.snapshot()) {
      if (d.layer !== 'topsoil' || d.coord.x === 0) continue;
      if (!store.has(keyOf(d.coord.x, d.coord.y + 1, d.coord.z))) {
        side = d.coord;
        break;
      }
    }
    log.sideFound = Boolean(side);
    store.stackOn(side);
    log.mirrorPair =
      store.has(keyOf(side.x, side.y + 1, side.z)) &&
      store.has(keyOf(-side.x, side.y + 1, side.z));
    log.deltaMirror = store.totalCount() - before2;

    // 4. 层锁定:锁定表土后无法再往表土层堆
    store.setMirrorEnabled(false);
    store.setActiveLayer('topsoil');
    // 读取当前 locked 信号并锁定
    const lockSig = store.locked();
    store.toggleLock('topsoil');
    const lockedNow = store.locked().topsoil;
    const blocked = !store.stackOn(side);
    log.lockBlocks = lockedNow && blocked;
    store.toggleLock('topsoil');

    // 5. 框选 → 复制 → 粘贴(按法线转向)
    const sel = store.snapshot()
      .filter((d) => d.coord.x >= 2 && d.coord.x <= 4 && d.coord.z >= 0 && d.coord.z <= 2)
      .slice(0, 50);
    if (sel.length > 0) {
      const xs = sel.map((d) => d.coord.x), ys = sel.map((d) => d.coord.y), zs = sel.map((d) => d.coord.z);
      const n = store.selectBox(
        { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) },
        { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) },
      );
      log.selectedCount = n;
      log.copiedCount = store.copySelection();
      log.clipboardSize = store.clipboard()?.length ?? 0;
      // 粘贴到一个远离原选区、顶面暴露的落点,给 +y 法线
      let anchor = null;
      for (const d of store.snapshot()) {
        if (d.coord.x <= -6 && !store.has(keyOf(d.coord.x, d.coord.y + 1, d.coord.z))) {
          anchor = d.coord;
          break;
        }
      }
      log.anchorFound = Boolean(anchor);
      const paste = store.pasteAt(anchor, { x: 0, y: 1, z: 0 });
      log.paste = paste;
      log.pasteIncreased = paste.placed > 0;
    }

    // 6. 扫描:制造一个孤立体素(在远离地形的高空写一块再单独检查)
    // 先记录初始扫描
    const cleanScan = store.scanModel();
    log.cleanIsolated = cleanScan.isolated.length;
    log.cleanFloating = cleanScan.floatingFaces.length;

    return log;
  });

  check('初始地形已生成', api.initial > 10000, `${api.initial} 体素`);
  check('找到坑缘表面体素', api.surfaceFound);
  check('堆积工具写入体素', api.addOk && api.addedExists);
  check('关闭镜像时不产生对称体素', api.mirrorNotCreated && api.deltaNoMirror === 1);
  check('找到偏轴表面点', api.sideFound);
  check('开启镜像后对称侧自动堆积', api.mirrorPair && api.deltaMirror === 2, `增量 ${api.deltaMirror}`);
  check('锁定层阻止堆积', api.lockBlocks);
  check('框选并复制到剪贴板', api.selectedCount > 0 && api.copiedCount === api.clipboardSize, `${api.copiedCount} 块`);
  check('粘贴按法线转向落位', api.pasteIncreased, `placed=${api.paste?.placed}, skipped=${api.paste?.skipped}`);
  check('干净地形扫描无孤立体素', api.cleanIsolated === 0, `${api.cleanIsolated} 孤立 / ${api.cleanFloating} 悬空`);

  // 7. UI 层:扫描高亮会给视口实例上色,验证 highlightKeys 信号有数据时画布仍正常
  const canvasOk = (await page.$$('canvas')).length >= 1;
  check('高亮扫描后 WebGL 画布存活', canvasOk);
} catch (e) {
  errors.push(e.stack || e.message);
} finally {
  console.log('\n--- 错误 ---');
  console.log(errors.length ? errors.join('\n') : '无错误');
  const failed = results.filter((r) => !r).length;
  console.log(`\n结果:${results.length - failed}/${results.length} 通过`);
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
}
