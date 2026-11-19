import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
await page.goto('http://127.0.0.1:5175/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1400);

const res = await page.evaluate(async () => {
  const { app, store } = window.__winglab;
  app.submitToBatch(0);
  app.submitToBatch(3);
  for (const e of store.batch.entries) {
    for (const c of e.checks) app.setVerdict(e.id, c.key, 'approved');
    app.reviewEntry(e.id, 'approved', 'ok');
  }
  const mod = await import('/src/lib/export.js');
  const { blob, name, entries } = await mod.buildAssetPack(app, store, () => {});
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
  return { name, entries, size: buf.length, b64: btoa(bin), summary: app.batchSummary() };
});
console.log('pack', res.name, res.size, 'bytes,', res.entries, 'entries');
mkdirSync('tools/out', { recursive: true });
writeFileSync('tools/out/pack.zip', Buffer.from(res.b64, 'base64'));
console.log('summary', JSON.stringify(res.summary));
await browser.close();
