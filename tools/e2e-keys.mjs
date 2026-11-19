import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://127.0.0.1:5175/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1300);
await page.mouse.click(820, 420); // focus the page, not a control
const out = {};
out.afterClick = await page.evaluate(() => window.__winglab.store.tool);

await page.keyboard.press('2');
out.toolAfter2 = await page.evaluate(() => window.__winglab.store.tool);
await page.keyboard.press('1');
out.toolAfter1 = await page.evaluate(() => window.__winglab.store.tool);

await page.evaluate(() => {
  const { store } = window.__winglab;
  const c = store.variants[0].wings[1].cells.find(c => !c.margin);
  store.selection = { cellId: c.id, spotId: null, wing: 'fore-left' };
});
await page.waitForTimeout(200);
const lockedBefore = await page.evaluate(() => window.__winglab.store.lockedCount);
await page.keyboard.press('l');
await page.waitForTimeout(250);
out.lockedDelta = (await page.evaluate(() => window.__winglab.store.lockedCount)) - lockedBefore;

await page.keyboard.press('Control+z');
await page.waitForTimeout(250);
out.lockedAfterUndo = await page.evaluate(() => window.__winglab.store.lockedCount);

await page.keyboard.press('Control+d');
await page.waitForTimeout(200);
out.selectionAfterCtrlD = await page.evaluate(() => JSON.stringify(window.__winglab.store.selection));

// while typing in the seed input, shortcuts must not fire
await page.locator('input.mono').first().click();
await page.keyboard.type('abc2');
out.toolWhileTyping = await page.evaluate(() => window.__winglab.store.tool);
out.seedText = await page.locator('input.mono').first().inputValue();

console.log(JSON.stringify(out, null, 1));
console.log(errors.join(' | ') || 'no errors');
await browser.close();
