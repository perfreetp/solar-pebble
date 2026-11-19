import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-webgpu','--enable-features=Vulkan'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('CONSOLE ' + m.text()); });
await page.goto('http://127.0.0.1:5175/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1600);

// submit all four variants to the batch
await page.evaluate(() => {
  const { app } = window.__winglab;
  for (let i = 0; i < 4; i++) app.submitToBatch(i);
});
await page.waitForTimeout(400);

await page.getByRole('button', { name: /^批次/ }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: 'tools/mod-batch.png' });
const batchText = await page.locator('.batch').innerText();
console.log('BATCH HEADER:', batchText.split('\n').slice(0, 8).join(' | '));

// choose entry 1 and approve every check through the review API
await page.getByRole('button', { name: /^复核$/ }).click();
await page.waitForTimeout(400);
const status = await page.evaluate(() => {
  const { app, store } = window.__winglab;
  for (const e of store.batch.entries) {
    for (const c of e.checks) app.setVerdict(e.id, c.key, 'approved');
    app.reviewEntry(e.id, 'approved', '检查通过');
  }
  return app.batchSummary();
});
console.log('AFTER APPROVE:', JSON.stringify(status));
await page.waitForTimeout(300);
await page.screenshot({ path: 'tools/mod-review.png' });

// a batch with a blocking defect: force low spot density + high asymmetry
const blocked = await page.evaluate(() => {
  const { app, store } = window.__winglab;
  app.setParams({ spotDensity: 0.0, asymmetry: 0.055, hueBase: 30 });
  app.generateAll();
  const e = app.submitToBatch(0);
  return { id: e.id, summary: e.summary, keys: e.checks.map(c => `${c.severity}:${c.key}`) };
});
console.log('BLOCKED ENTRY:', JSON.stringify(blocked));
await page.waitForTimeout(500);
await page.getByRole('button', { name: /^复核$/ }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: 'tools/mod-review-blocked.png' });

console.log(errors.length ? errors.join(' | ') : 'no console errors');
await browser.close();
