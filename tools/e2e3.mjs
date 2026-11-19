import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-webgpu','--enable-features=Vulkan'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR '+e.message));
page.on('console', m => { if (m.type()==='error' && !m.text().includes('404')) errors.push('CONSOLE '+m.text()); });
await page.goto('http://127.0.0.1:5175/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1600);

// ---------- API-level invariant: manual work survives regeneration ----------
const invariant = await page.evaluate(() => {
  const { app, store } = window.__winglab;
  const spec = store.variants[0];
  let target = null;
  for (const w of spec.wings) for (const c of w.cells) {
    if (c.margin) continue;
    if (!target || c.area > target.cell.area) target = { wing: w, cell: c };
  }
  app.setCellColor(target.cell.id, [200, 0.8, 0.45]);
  app.toggleCellLock(target.cell.id);
  const spot = target.wing.spots[0];
  app.moveSpot(spot.id, 0.05, -0.03);
  const lockedId = target.cell.id, spotId = spot.id;
  app.setParams({ wingWidth: 0.92, spotDensity: 0.85, hueBase: 210, veinDensity: 0.8 });
  app.generateAll({ keepOverrides: true });
  const after = store.variants[0];
  let cellNow = null, spotNow = null;
  for (const w of after.wings) {
    const c = w.cells.find(x => x.id === lockedId);
    if (c) cellNow = { locked: !!c.locked, color: c.color, edited: !!c.edited };
    const s = w.spots.find(x => x.id === spotId);
    if (s) spotNow = { edited: !!s.edited };
  }
  // a cell we never touched must have re-coloured under the new hue
  let untouched = null;
  for (const w of after.wings) for (const c of w.cells) {
    if (!c.margin && !c.color) { untouched = { id: c.id }; break; }
    if (untouched) break;
  }
  return { lockedId, spotId, cellNow, spotNow, untouched, newParams: { hueBase: after.params.hueBase, wingWidth: after.params.wingWidth } };
});
console.log('INVARIANT:', JSON.stringify(invariant, null, 1));

// ---------- UI click-through ----------
async function clickFreePoint() {
  const sel = await page.evaluate(() => {
    const { store } = window.__winglab;
    const spec = store.variants[store.activeVariant];
    const inPoly = (pt, poly) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
        if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
      }
      return inside;
    };
    // pick the largest cell, then a point inside it far from any spot
    let best = null;
    for (const w of spec.wings) for (const c of w.cells) {
      if (c.margin) continue;
      if (!best || c.area > best.cell.area) best = { cell: c, wing: w };
    }
    const b = best.cell.bounds;
    let pt = null;
    outer: for (let gy = 1; gy < 12; gy++) for (let gx = 1; gx < 12; gx++) {
      const cand = [b.minX + (b.width * gx) / 12, b.minY + (b.height * gy) / 12];
      if (!inPoly(cand, best.cell.poly)) continue;
      let clear = true;
      for (const sp of best.wing.spots) {
        if (Math.hypot(sp.x - cand[0], sp.y - cand[1]) < Math.max(sp.rx, sp.ry) * 2 + 0.03) { clear = false; break; }
      }
      if (clear) { pt = cand; break outer; }
    }
    if (!pt) return null;
    const m = best.wing.transform;
    const art = [m.a * pt[0] + m.c * pt[1] + m.e, m.b * pt[0] + m.d * pt[1] + m.f];
    const v = store.view;
    const cv = document.querySelector('canvas').getBoundingClientRect();
    return { id: best.cell.id, sx: cv.left + v.tx + art[0] * v.scale, sy: cv.top + v.ty + art[1] * v.scale };
  });
  if (!sel) return null;
  await page.mouse.click(sel.sx, sel.sy);
  await page.waitForTimeout(250);
  return sel;
}

const sel = await clickFreePoint();
const picked = await page.evaluate(() => window.__winglab.store.selection);
console.log('UI clicked', sel?.id, '-> selected', JSON.stringify(picked));

const panelKind = await page.evaluate(() => document.querySelector('.panel .head .kicker')?.textContent || null);
console.log('inspector shows kind:', panelKind);

const before = await page.evaluate(() => document.querySelector('.panel .picker span')?.textContent || null);
await page.evaluate(() => {
  const sws = [...document.querySelectorAll('.panel .swatches .sw')];
  sws[sws.length - 1].click();
});
await page.waitForTimeout(300);
const afterCol = await page.evaluate(() => document.querySelector('.panel .picker span')?.textContent || null);
console.log('preset colour', before, '->', afterCol, before !== afterCol ? '(changed)' : '(same)');

const pill = async () => (await page.locator('.pill').textContent()).trim();
console.log('pill:', await pill());
await page.screenshot({ path: 'tools/e2e-final.png' });

// spot interaction: click a spot, drag it
const spotPt = await page.evaluate(() => {
  const { store } = window.__winglab;
  const spec = store.variants[store.activeVariant];
  const w = spec.wings.find((w) => w.key === 'hind-right');
  const sp = w.spots[0];
  const m = w.transform;
  const art = [m.a * sp.x + m.c * sp.y + m.e, m.b * sp.x + m.d * sp.y + m.f];
  const v = store.view;
  const cv = document.querySelector('canvas').getBoundingClientRect();
  return { id: sp.id, x: sp.x, y: sp.y, sx: cv.left + v.tx + art[0] * v.scale, sy: cv.top + v.ty + art[1] * v.scale };
});
await page.mouse.move(spotPt.sx, spotPt.sy);
await page.mouse.down();
await page.mouse.move(spotPt.sx + 18, spotPt.sy - 10, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(300);
const spotAfter = await page.evaluate((id) => {
  const { store } = window.__winglab;
  const ov = store.overridesByVariant[store.activeVariant]?.spots?.[id];
  return ov ? { dx: +ov.dx.toFixed(3), dy: +ov.dy.toFixed(3) } : null;
}, spotPt.id);
console.log('spot drag offset:', JSON.stringify(spotAfter));
await page.screenshot({ path: 'tools/e2e-spot.png' });

await page.locator('.icon-btn[title^="校验确定性"]').click();
await page.waitForTimeout(250);
console.log('toast:', (await page.evaluate(() => document.querySelector('.toast')?.textContent || '')).trim());
console.log(errors.length ? errors.join(' | ') : 'no console errors');
await browser.close();
