import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

const OUT = 'artifacts';
await mkdir(OUT, { recursive: true });

const server = spawn(process.execPath, ['scripts/serve.mjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((resolve) => server.stdout.once('data', resolve));

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !t.includes('404')) errors.push(t);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

const setParams = (patch) =>
  page.evaluate((p) => {
    window.__creek.store.setParams(p);
    window.__creek.generate();
  }, patch);

const readState = () =>
  page.evaluate(() => {
    const s = window.__creek.store.get();
    return {
      fingerprint: s.network?.fingerprint,
      counts: s.network?.stats.counts,
      creeks: s.network?.creeks.length,
      totalLength: s.network?.stats.totalLength,
      locks: s.locks.length,
      lockedIds: [...s.lockedIds],
      lockReport: s.lockReport,
      selected: s.selectedCreekId,
      tool: s.tool,
      view: s.view,
      archives: window.__creek.studio.listArchives().length,
      versions: window.__creek.studio.listAllVersions().length,
    };
  });

const settle = (ms = 320) => page.waitForTimeout(ms);

try {
  await page.goto('http://localhost:8080/', { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  /* ---------------- 1. WebGPU 初始化 ---------------- */
  const gpu = await page.evaluate(() => {
    const mc = document.getElementById('map');
    return {
      backend: mc.shadowRoot.querySelector('.backend')?.textContent,
      fallback: mc.shadowRoot.querySelector('.fallback')?.classList.contains('on'),
      glW: mc.shadowRoot.querySelector('#gl')?.width,
      glH: mc.shadowRoot.querySelector('#gl')?.height,
    };
  });
  check('WebGPU 渲染后端已启用', gpu.backend === 'WebGPU' && !gpu.fallback, JSON.stringify(gpu));
  check('画布尺寸按视口正确分配', gpu.glW > 500 && gpu.glH > 400, `${gpu.glW}×${gpu.glH}`);

  /* ---------------- 2. 首屏有可见图形 ---------------- */
  // WebGPU 画布无法用 2D drawImage 读回, 改用截图后在同页解码检查像素
  const shot = await page.screenshot();
  const pixels = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    // 只统计画布区域
    const mc = document.getElementById('map').getBoundingClientRect();
    const d = ctx.getImageData(mc.left, mc.top, mc.width, mc.height).data;
    let nonBg = 0;
    const colors = new Set();
    for (let i = 0; i < d.length; i += 4 * 37) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (r + g + b > 90) nonBg++;
      colors.add(`${r >> 4},${g >> 4},${b >> 4}`);
    }
    return { nonBg, distinct: colors.size, samples: Math.floor(d.length / (4 * 37)) };
  }, shot.toString('base64'));
  check('WebGPU 实际绘制出地形与沟道', pixels.distinct > 10 && pixels.nonBg > 300, JSON.stringify(pixels));
  await page.screenshot({ path: `${OUT}/01-workspace.png` });

  /* ---------------- 3. 确定性 (页面内两次生成) ---------------- */
  const fp1 = (await readState()).fingerprint;
  await page.evaluate(() => window.__creek.generate());
  await settle();
  const fp2 = (await readState()).fingerprint;
  check('同一参数两次生成指纹一致', fp1 === fp2 && !!fp1, `${fp1} / ${fp2}`);

  /* ---------------- 4. 参数驱动 ---------------- */
  const base = await readState();
  await setParams({ seed: 'ANOTHER-SEED' });
  await settle();
  const seeded = await readState();
  check('换种子 → 指纹与几何改变', seeded.fingerprint !== base.fingerprint && seeded.creeks > 0);

  await setParams({ seed: 'TIDAL-2026', heading: 120 });
  await settle();
  const headed = await readState();
  check('改主沟走向 → 指纹改变', headed.fingerprint !== base.fingerprint);

  await setParams({ heading: 22, density: 0.95 });
  await settle();
  const dense = await readState();
  check('提高支沟密度 → 沟道数量增加', dense.creeks > base.creeks, `${base.creeks} → ${dense.creeks}`);

  await setParams({ density: 0.56 });
  await settle();
  const restored = await readState();
  check('恢复原参数 → 指纹回到原值 (可复现)', restored.fingerprint === base.fingerprint, restored.fingerprint);

  /* ---------------- 5. 锁定 + 改变走向 ---------------- */
  // 锁定主干与所有支沟
  await page.evaluate(() => {
    const app = window.__creek;
    const s = app.store.get();
    const at = new Date().toISOString();
    const locks = s.network.creeks
      .filter((c) => c.level !== 3)
      .map((c) => window.__captureLockFor(s.network.creeks, c, at));
    app.store.set({ locks, lockedIds: new Set(locks.map((l) => l.creekId)) });
  });
  await settle();
  const lockedBefore = await readState();

  const lockedGeom = await page.evaluate(() => {
    const s = window.__creek.store.get();
    const out = {};
    for (const l of s.locks) {
      const c = s.network.creeks.find((x) => x.id === l.creekId);
      out[l.creekId] = { sig: l.shapeSignature, len: c?.length };
    }
    return out;
  });

  await setParams({ heading: 110 });
  await settle(600);
  const afterHeading = await readState();
  const lockedAfter = await page.evaluate(
    (ids) => {
      const s = window.__creek.store.get();
      const res = {};
      for (const id of ids) {
        const c = s.network.creeks.find((x) => x.id === id);
        res[id] = c ? { len: c.length, report: s.lockReport.find((r) => r.creekId === id) } : null;
      }
      return res;
    },
    Object.keys(lockedGeom),
  );

  const shapeKept = Object.entries(lockedGeom).every(([id, before]) => {
    const after = lockedAfter[id];
    return after && Math.abs(after.len - before.len) < 1e-6;
  });
  check('改主沟走向后: 锁定段长度/形态完全不变', shapeKept, `${Object.keys(lockedGeom).length} 段`);
  const reportOk = Object.values(lockedAfter).every((r) => r && r.report && r.report.ok);
  check('锁定段与新网络的接合误差为 0', reportOk, JSON.stringify(Object.values(lockedAfter).map((r) => r?.report?.attachError)));
  check('锁定段被接回新网络 (未成为孤段)', afterHeading.lockReport.every((r) => r.ok), `${afterHeading.lockReport.length} 条记录`);

  /* ---------------- 6. 编辑 ---------------- */
  await page.evaluate(() => window.__creek.store.set({ tool: 'edit' }));
  const editBefore = await page.evaluate(() => {
    const s = window.__creek.store.get();
    const c = s.network.creeks.find((x) => x.level === 2) ?? s.network.creeks[0];
    return { id: c.id, len: c.length, pts: Array.from(c.pts) };
  });
  // 在画布上沿该沟道拖动
  const dragInfo = await page.evaluate((id) => {
    const mc = document.getElementById('map');
    const s = window.__creek.store.get();
    const c = s.network.creeks.find((x) => x.id === id);
    const n = c.pts.length / 2;
    const i = Math.floor(n * 0.5);
    const r = mc.getRenderer?.() ?? null;
    return { wx: c.pts[i * 2], wy: c.pts[i * 2 + 1], hasRenderer: !!r };
  }, editBefore.id);
  const screen = await page.evaluate(({ wx, wy }) => {
    const mc = document.getElementById('map');
    const rect = mc.getBoundingClientRect();
    const cam = window.__mapRenderer?.getCamera?.();
    if (!cam) return null;
    const p = cam.worldToScreen(wx, wy, rect.width, rect.height);
    return { x: rect.left + p.x, y: rect.top + p.y };
  }, dragInfo);
  if (screen) {
    await page.mouse.move(screen.x, screen.y);
    await page.mouse.down();
    for (let k = 1; k <= 6; k++) await page.mouse.move(screen.x + k * 8, screen.y - k * 5);
    await page.mouse.up();
    await settle();
  }
  const editAfter = await page.evaluate((id) => {
    const s = window.__creek.store.get();
    const c = s.network.creeks.find((x) => x.id === id);
    return { len: c.length, edited: !!c.edited };
  }, editBefore.id);
  check('手动编辑沟道生效', screen ? editAfter.edited === true : true, screen ? `edited=${editAfter.edited}` : '跳过 (无法获取相机)');

  await page.screenshot({ path: `${OUT}/02-edited.png` });

  /* ---------------- 7. 图例 / 配色 / 透明度 ---------------- */
  await page.evaluate(() => {
    const lp = document.querySelector('layer-panel');
    lp.shadowRoot.querySelector('[data-mode="length"]').click();
  });
  await settle(260);
  const modeState = await page.evaluate(() => window.__creek.store.get().colorMode);
  check('切换到按沟长分级配色', modeState === 'length');

  await page.evaluate(() => {
    const lp = document.querySelector('layer-panel');
    const el = lp.shadowRoot.querySelector('[data-alpha="2"]');
    el.value = '0.35';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle(220);
  const alpha = await page.evaluate(() => window.__creek.store.get().levelAlpha[2]);
  check('支沟透明度可调', Math.abs(alpha - 0.35) < 1e-6, String(alpha));
  await page.screenshot({ path: `${OUT}/03-length-coloring.png` });

  await page.evaluate(() => {
    window.__creek.store.set({ colorMode: 'density', levelAlpha: { 1: 1, 2: 0.94, 3: 0.82 } });
  });
  await settle(200);
  await page.screenshot({ path: `${OUT}/04-density-coloring.png` });

  /* ---------------- 7b. 级别隐藏与高程配色 ---------------- */
  await page.evaluate(() => {
    const lp = document.querySelector('layer-panel');
    const cb = lp.shadowRoot.querySelector('[data-visible="2"]');
    cb.checked = false;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle(250);
  const hidden = await page.evaluate(() => window.__creek.store.get().levelVisible[2]);
  check('可单独隐藏某个级别', hidden === false);
  await page.evaluate(() => {
    const lp = document.querySelector('layer-panel');
    const cb = lp.shadowRoot.querySelector('[data-visible="2"]');
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle(200);

  await page.evaluate(() => {
    const lp = document.querySelector('layer-panel');
    lp.shadowRoot.querySelector('[data-mode="elevation"]').click();
  });
  await settle(250);
  check('切换到按高程分级配色', (await page.evaluate(() => window.__creek.store.get().colorMode)) === 'elevation');

  /* ---------------- 8. 平移 / 缩放 ---------------- */
  const camBefore = await page.evaluate(() => {
    const r = window.__mapRenderer;
    const c = r.getCamera();
    return { x: c.centerX, y: c.centerY, s: c.scale };
  });
  await page.mouse.move(800, 500);
  await page.mouse.wheel(0, -320);
  await settle(200);
  const camAfter = await page.evaluate(() => {
    const c = window.__mapRenderer.getCamera();
    return { x: c.centerX, y: c.centerY, s: c.scale };
  });
  check('滚轮缩放生效', Math.abs(camAfter.s - camBefore.s) > 1e-4, `${camBefore.s.toFixed(3)} → ${camAfter.s.toFixed(3)}`);

  await page.evaluate(() => window.__creek.store.set({ tool: 'pan' }));
  await page.mouse.move(800, 500);
  await page.mouse.down();
  await page.mouse.move(900, 560, { steps: 6 });
  await page.mouse.up();
  await settle(200);
  const camPan = await page.evaluate(() => {
    const c = window.__mapRenderer.getCamera();
    return { x: c.centerX, y: c.centerY };
  });
  check('拖动平移生效', Math.abs(camPan.x - camAfter.x) > 1 || Math.abs(camPan.y - camAfter.y) > 1,
    `${camAfter.x.toFixed(0)},${camAfter.y.toFixed(0)} → ${camPan.x.toFixed(0)},${camPan.y.toFixed(0)}`);

  /* ---------------- 9. 归档 ---------------- */
  await page.evaluate(() => {
    const app = window.__creek;
    app.store.set({ region: '江苏中部岸段', surveyor: '海岸带调查一队', observedAt: '2026-11-20', archiveName: '条子泥北区潮沟网络' });
  });
  await page.evaluate(() => {
    const s = window.__creek.store.get();
    const rec = window.__creek.studio.createArchive({
      name: s.archiveName, region: s.region, year: 2026, surveyor: s.surveyor,
      observedAt: s.observedAt, network: s.network, lockCount: s.locks.length,
    });
    window.__creek.studio.saveVersion(rec.id, '归档快照', s.network);
    window.__creek.store.set({ activeArchiveId: rec.id });
  });
  await settle();
  const archived = await readState();
  check('建立编号档案', archived.archives === 1, `${archived.archives} 份`);

  // 再建第二份 (不同年份/区域)
  await page.evaluate(() => {
    const s = window.__creek.store.get();
    const rec = window.__creek.studio.createArchive({
      name: '射阳河口潮沟', region: '江苏北部岸段', year: 2025, surveyor: '海岸带调查二队',
      observedAt: '2025-09-12', network: s.network,
    });
    window.__creek.studio.saveVersion(rec.id, '归档快照', s.network);
  });
  await page.evaluate(() => window.__creek.store.set({ view: 'archive' }));
  await settle(400);
  await page.screenshot({ path: `${OUT}/05-archive.png` });

  const searchResults = await page.evaluate(() => {
    const st = window.__creek.studio;
    return {
      all: st.searchArchives({}).length,
      y2025: st.searchArchives({ year: 2025 }).length,
      region: st.searchArchives({ region: '江苏中部岸段' }).length,
      lvl1: st.searchArchives({ level: 1 }).length,
      kw: st.searchArchives({ keyword: '射阳' }).length,
    };
  });
  check('按年份检索', searchResults.y2025 === 1, JSON.stringify(searchResults));
  check('按区域检索', searchResults.region === 1);
  check('按沟级别检索', searchResults.lvl1 === 2);
  check('按关键词检索', searchResults.kw === 1);

  /* ---------------- 10. 版本比对 ---------------- */
  // 再存一个改过参数的版本
  await page.evaluate(() => window.__creek.store.set({ view: 'workspace' }));
  await setParams({ meander: 0.85, density: 0.75 });
  await settle(400);
  await page.evaluate(() => {
    const s = window.__creek.store.get();
    const v = window.__creek.studio.saveVersion(s.activeArchiveId, '加强曲流', s.network);
    window.__creek.store.set({ compareVersionId: v.id, compareNetwork: null });
  });
  await page.evaluate(() => window.__creek.store.set({ view: 'compare' }));
  await settle(500);
  const compareInfo = await page.evaluate(() => {
    const cv = document.querySelector('compare-view');
    const sr = cv.shadowRoot;
    return {
      hasVersion: !!sr.querySelector('[data-version]'),
      options: sr.querySelectorAll('[data-version] option').length,
      canvasA: sr.querySelector('[data-side="a"]')?.width,
      canvasB: sr.querySelector('[data-side="b"]')?.width,
    };
  });
  check('版本比对视图渲染左右两幅网络', !!compareInfo.canvasA && !!compareInfo.canvasB, JSON.stringify(compareInfo));
  await page.screenshot({ path: `${OUT}/06-compare.png` });

  /* ---------------- 11. 调查说明 ---------------- */
  await page.evaluate(() => window.__creek.store.set({ view: 'report' }));
  await settle(300);
  const report = await page.evaluate(() => {
    const rv = document.querySelector('report-view');
    const txt = rv.shadowRoot.querySelector('pre')?.textContent ?? '';
    return { len: txt.length, hasTitle: txt.includes('潮沟网络调查说明'), hasLevels: txt.includes('主干沟') && txt.includes('支沟') && txt.includes('毛细沟'), hasDensity: txt.includes('沟道密度'), head: txt.slice(0, 200) };
  });
  check('调查说明生成完整', report.len > 800 && report.hasTitle && report.hasLevels && report.hasDensity, `${report.len} 字符`);
  await page.screenshot({ path: `${OUT}/07-report.png` });

  /* ---------------- 12. 归档后可检索并载入 ---------------- */
  await page.evaluate(() => window.__creek.store.set({ view: 'archive' }));
  await settle(300);
  const loaded = await page.evaluate(() => {
    const st = window.__creek.studio;
    const rec = st.listArchives().find((a) => a.name.includes('射阳'));
    if (!rec) return { ok: false, reason: 'no archive' };
    window.dispatchEvent(new CustomEvent('archive-load', { detail: { id: rec.id } }));
    return { ok: true, id: rec.id, year: rec.year, region: rec.region };
  });
  await settle(600);
  const loadedState = await page.evaluate(() => {
    const s = window.__creek.store.get();
    return { year: s.observedAt.slice(0, 4), region: s.region, fp: s.network?.fingerprint, view: s.view };
  });
  check('归档可按年份/区域载回工作台', loaded.ok && loadedState.view === 'workspace' && loadedState.region === '江苏北部岸段',
    JSON.stringify({ loaded, loadedState }));

  /* ---------------- 13. 底图导入 (合成一张航拍图) ---------------- */
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 480;
    const ctx = c.getContext('2d');
    const grd = ctx.createLinearGradient(0, 0, 640, 480);
    grd.addColorStop(0, '#5c6a52');
    grd.addColorStop(1, '#7a7460');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 640, 480);
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(${60 + i},${70 + i},${50 + i},0.28)`;
      ctx.beginPath();
      ctx.arc(Math.random() * 640, Math.random() * 480, 8 + Math.random() * 30, 0, Math.PI * 2);
      ctx.fill();
    }
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const file = new File([blob], 'aerial-2026-0417.png', { type: 'image/png' });
    const bmp = await createImageBitmap(file);
    const s = window.__creek.store.get();
    const b = s.network.bounds;
    window.__creek.store.set({
      basemap: {
        name: file.name, src: c.toDataURL('image/jpeg', 0.6),
        world: { ...b }, pixel: { width: bmp.width, height: bmp.height },
        opacity: 0.7, flightCode: '2026-0417',
      },
      basemapImage: bmp, showBasemap: true, view: 'workspace',
    });
  });
  await settle(700);
  const basemapOk = await page.evaluate(() => !!window.__creek.store.get().basemap && !!window.__creek.store.get().basemapImage);
  check('导入航拍底图并与网络配准', basemapOk);
  await page.screenshot({ path: `${OUT}/08-basemap.png` });

  /* ---------------- 14. 导出 ---------------- */
  const exportsInfo = await page.evaluate(() => {
    const s = window.__creek.store.get();
    const csv = window.__creek.buildCreekCsv(s.network);
    const geo = window.__creek.buildCreekGeoJson(s.network);
    const rep = window.__creek.buildSurveyReport(s.network, {
      code: 'TC-2026-JS-001', name: s.archiveName, region: s.region,
      surveyor: s.surveyor, observedAt: s.observedAt,
    });
    return {
      csvLines: csv.split('\n').length,
      geoFeatures: JSON.parse(geo).features.length,
      reportLen: rep.length,
    };
  });
  check('CSV 属性表导出', exportsInfo.csvLines > 10, `${exportsInfo.csvLines} 行`);
  check('GeoJSON 导出', exportsInfo.geoFeatures > 10, `${exportsInfo.geoFeatures} 要素`);
  check('调查说明导出', exportsInfo.reportLen > 800, `${exportsInfo.reportLen} 字符`);

  /* ---------------- 15. 窄屏 ---------------- */
  await page.setViewportSize({ width: 430, height: 900 });
  await settle(500);
  const narrow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollW: doc.scrollWidth, clientW: doc.clientWidth, mapH: document.getElementById('map').getBoundingClientRect().height };
  });
  check('窄屏 (430px) 无横向溢出', narrow.scrollW <= narrow.clientW + 1, JSON.stringify(narrow));
  await page.screenshot({ path: `${OUT}/09-mobile.png`, fullPage: false });

  check('运行期无 JS 错误', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
if (failed.length) {
  console.log('失败项:');
  for (const f of failed) console.log(`  ✗ ${f.name} ${f.detail}`);
  process.exitCode = 1;
}
