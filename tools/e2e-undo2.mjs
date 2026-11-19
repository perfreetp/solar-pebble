import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://127.0.0.1:5175/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1300);

const r = await page.evaluate(() => {
  const { app, store } = window.__winglab;
  const cell = store.variants[0].wings[0].cells[3];
  const id = cell.id;
  const states = [];
  app.setCellColor(id, [15, 0.9, 0.5]);
  states.push(['after colour', store.undoDepth, JSON.parse(JSON.stringify(store.overridesByVariant[0]?.cells?.[id] ?? null))]);
  app.toggleCellLock(id);
  states.push(['after lock', store.undoDepth, JSON.parse(JSON.stringify(store.overridesByVariant[0]?.cells?.[id] ?? null))]);
  app.undo();
  states.push(['after undo', store.undoDepth, JSON.parse(JSON.stringify(store.overridesByVariant[0]?.cells?.[id] ?? null)), store.redoDepth]);
  app.undo();
  states.push(['after undo2', store.undoDepth, JSON.parse(JSON.stringify(store.overridesByVariant[0]?.cells?.[id] ?? null)), store.redoDepth]);
  app.redo();
  states.push(['after redo', store.undoDepth, JSON.parse(JSON.stringify(store.overridesByVariant[0]?.cells?.[id] ?? null)), store.redoDepth]);
  return states;
});
r.forEach(x => console.log(JSON.stringify(x)));

// keyboard undo path
await page.mouse.click(800, 400);
await page.evaluate(() => {
  const { app, store } = window.__winglab;
  const c = store.variants[0].wings[1].cells[2];
  app.setCellColor(c.id, [200, 0.7, 0.4]);
});
await page.waitForTimeout(150);
const before = await page.evaluate(() => window.__winglab.store.editedCount);
await page.keyboard.press('Control+z');
await page.waitForTimeout(200);
const afterKb = await page.evaluate(() => window.__winglab.store.editedCount);
console.log('ctrl+z editedCount', before, '->', afterKb);
console.log(errors.join(' | ') || 'no errors');
await browser.close();
