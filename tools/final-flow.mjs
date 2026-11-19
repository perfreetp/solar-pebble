import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-webgpu','--enable-features=Vulkan'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
await page.goto('http://127.0.0.1:5175/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// 1) make some manual edits on variant 1
const edit = await page.evaluate(() => {
  const { app, store } = window.__winglab;
  const spec = store.variants[0];
  let big = null;
  for (const w of spec.wings) for (const c of w.cells) if (!c.margin && (!big || c.area > big.c.area)) big = { w, c };
  app.setCellColor(big.c.id, [196, 0.85, 0.42]);
  app.toggleCellLock(big.c.id);
  const sp = big.w.spots[0];
  app.moveSpot(sp.id, 0.03, -0.02);
  return { cell: big.c.id, spot: sp.id, locked: store.lockedCount, edited: store.editedCount };
});
console.log('edits:', JSON.stringify(edit));
await page.screenshot({ path: 'tools/f1-generator.png' });

// 2) change params and regenerate keeping edits
await page.evaluate(() => {
  const { app } = window.__winglab;
  app.setParams({ wingWidth: 0.78, spotDensity: 0.62, hueBase: 24, hueRange: 60 });
  app.generateAll({ keepOverrides: true });
});
await page.waitForTimeout(700);
const persisted = await page.evaluate((ids) => {
  const { store } = window.__winglab;
  const spec = store.variants[0];
  let cell = null, spot = null;
  for (const w of spec.wings) {
    const c = w.cells.find(c => c.id === ids.cell); if (c) cell = c;
    const s = w.spots.find(s => s.id === ids.spot); if (s) spot = s;
  }
  return { cellColor: cell?.color, locked: cell?.locked, spotEdited: spot?.edited };
}, edit);
console.log('persisted after regeneration:', JSON.stringify(persisted));
await page.screenshot({ path: 'tools/f2-regenerated.png' });

// 3) submit variant 1 and 2, then review
await page.evaluate(() => {
  const { app } = window.__winglab;
  app.submitToBatch(0);
  app.submitToBatch(1);
});
await page.getByRole('button', { name: /^批次/ }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: 'tools/f3-batch.png' });

await page.getByRole('button', { name: /^复核$/ }).click();
await page.waitForTimeout(500);
// approve everything through the UI review API
await page.evaluate(() => {
  const { app, store } = window.__winglab;
  for (const e of store.batch.entries) {
    for (const c of e.checks) app.setVerdict(e.id, c.key, 'approved');
    app.reviewEntry(e.id, 'approved', '复核通过');
  }
});
await page.waitForTimeout(400);
const summary = await page.evaluate(() => window.__winglab.app.batchSummary());
console.log('review summary:', JSON.stringify(summary));
await page.screenshot({ path: 'tools/f4-review.png' });

// 4) release and export
const releaseBtn = page.getByRole('button', { name: '放行并导出素材包' });
console.log('release enabled:', !(await releaseBtn.isDisabled()));
console.log(errors.join(' | ') || 'no errors');
await browser.close();
