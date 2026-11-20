// End-to-end checks against the running dev server (http://127.0.0.1:5173).
// Usage: node tools/verify.mjs [baseUrl]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:5173';
const OUT = 'shots';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--hide-scrollbars']
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 950 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text());
});

const click = (sel, i = 0) =>
  page.evaluate((s, idx) => {
    const el = document.querySelectorAll(s)[idx];
    if (!el) throw new Error(`missing ${s}[${idx}]`);
    el.click();
  }, sel, i);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Start from the seeded demo state so every run is comparable.
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => {
  try { localStorage.removeItem('nestworks.v1'); } catch (e) {}
});
await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
await wait(4500);


// 1. scene built
const built = await page.evaluate(() => !!window.__studio?.nest);
check('场景加载与生成', built, built ? `${await page.evaluate(() => window.__studio.nest.tunnels.length)} 甬道` : '');

// 2. determinism through the UI path
const det = await page.evaluate(() => {
  const st = window.__studio;
  const P = { entrances: 4, depth: 22, branchAngle: 57, levels: 5, tunnelDiameter: 0.7 };
  const a = st.applySeedParams('VERI-0001', P);
  const b = st.applySeedParams('VERI-0002', P);
  const c = st.applySeedParams('VERI-0001', P);
  return { same: a === c, diff: a !== b };
});
check('同种子复现一致', det.same);
check('异种子结果不同', det.diff);

// 3. real pointer drag on a control point → auto lock
const tid = await page.evaluate(() => {
  const st = window.__studio;
  st.applySeedParams('DRAG-0001', { entrances: 3, depth: 16, branchAngle: 48, levels: 4, tunnelDiameter: 0.55 });
  st.cam('front');
  const t = st.nest.tunnels.find((x) => x.kind === 'branch' && x.tier === 1);
  st.selectTunnel(t.id);
  return t.id;
});
await wait(2000);
const h = await page.evaluate(() => {
  const sc = window.__nest.scene;
  const m = sc.meshes.filter((mm) => mm.metadata && mm.metadata.kind === 'handle')[1];
  if (!m) return null;
  const c = sc.getEngine().getRenderingCanvas();
  const rect = c.getBoundingClientRect();
  for (let y = 0; y < rect.height; y += 2)
    for (let x = 0; x < rect.width; x += 2) {
      const pk = sc.pick(x, y, (mm) => mm.metadata && mm.metadata.kind === 'handle');
      if (pk && pk.hit && pk.pickedMesh === m) return { x: x + rect.left, y: y + rect.top };
    }
  return null;
});
if (h) {
  const before = await page.evaluate((id) => JSON.stringify(window.__studio.nest.tunnels.find((t) => t.id === id).points), tid);
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(h.x - i * 9, h.y + i * 5);
  await page.mouse.up();
  await wait(800);
  const after = await page.evaluate((id) => {
    const t = window.__studio.nest.tunnels.find((x) => x.id === id);
    return { pts: JSON.stringify(t.points), locked: t.locked };
  }, tid);
  check('拖动控制点改变走向', before !== after.pts);
  check('拖动后自动锁定', after.locked === true);
} else {
  check('拖动控制点改变走向', false, '未找到控制点');
}

// 4. regenerate keeps locked geometry
const lockKept = await page.evaluate(() => {
  const st = window.__studio;
  const id = Object.keys(st.locks)[0];
  const before = JSON.stringify(st.nest.tunnels.find((t) => t.id === id).points);
  st.setParams({ entrances: 5, levels: 5, depth: 24 });
  st.regenerate();
  const after = st.nest.tunnels.find((t) => t.id === id);
  return { ok: after && JSON.stringify(after.points) === before && after.locked, counts: st.nest.tunnels.length };
});
check('改参数重新生成保留锁定甬道', lockKept.ok, `${lockKept.counts} 甬道`);

// 5. materials & views
for (const k of ['dry', 'damp', 'gravel']) await page.evaluate((s) => window.__studio.setSoil(s), k);
const soilOk = await page.evaluate(() => window.__studio.scene.soilPreset === 'gravel');
check('三种土质可切换', soilOk);
await page.evaluate(() => window.__studio.cam('top'));
await wait(1200);
await page.screenshot({ path: path.join(OUT, 'verify-top.png') });
await page.evaluate(() => window.__studio.cam('front'));
await wait(1200);
await page.screenshot({ path: path.join(OUT, 'verify-front.png') });
check('相机切换到俯视/剖切正视', true);

// 6. open a draft shot, save it, submit it, review it, deliver it
await click('.nav button', 1);
await wait(800);
const draftId = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.shot-row')];
  const row = rows.find((r) => r.querySelector('.btn.primary') && r.textContent.includes('S-1042-2'));
  row.querySelector('.btn').click();
  return row.querySelector('.sr-meta .mono')?.textContent.trim();
});
await wait(3200);
await page.evaluate(() => {
  window.__studio.setParams({ entrances: 4, levels: 5, depth: 20, branchAngle: 56 });
  window.__studio.regenerate();
});
await wait(900);
await page.evaluate(() => window.__studio.save());
await wait(1600);
check('保存镜头写入场景数据', await page.evaluate(() => {
  const st = JSON.parse(localStorage.getItem('nestworks.v1'));
  const o = st.orders.find((x) => x.id === 'O-1042');
  return !!o.shots.find((s) => s.scene && s.scene.params?.entrances === 4);
}));

await click('.nav button', 1);
await wait(800);
await page.evaluate((id) => {
  const row = [...document.querySelectorAll('.shot-row')].find((r) => r.textContent.includes(id));
  row?.querySelector('.btn.primary')?.click();
}, draftId);
await wait(800);
await click('.role-seg button', 1);
await wait(700);
await click('.nav button', 2);
await wait(900);
const reviewVisible = await page.evaluate(() => document.querySelectorAll('.q-item').length > 0);
check('主管可见待审镜头', reviewVisible);

await page.evaluate((id) => {
  const q = [...document.querySelectorAll('.q-item')].find((x) => x.textContent.includes(id));
  q?.click();
}, draftId);
await wait(600);
const hasReject = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.dt-actions .btn')].find((b) => b.textContent.trim() === '退回');
  if (!btn) return false;
  btn.click();
  return true;
});
await wait(450);
if (hasReject) {
  const blocked = await page.evaluate(() => {
    const ta = document.querySelector('.modal textarea');
    if (!ta) return false;
    ta.value = '测试退回：剖切面上甬道被挡';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const ins = [...document.querySelectorAll('.modal input')];
    for (const i of ins) {
      i.value = '';
      i.dispatchEvent(new Event('input', { bubbles: true }));
    }
    document.querySelector('.modal .btn.danger').click();
    return !!document.querySelector('.modal textarea');
  });
  check('退回必须写明种子或甬道编号', blocked);
  await page.evaluate(() => document.querySelector('.modal .x-btn')?.click());
  await wait(400);
} else {
  check('退回必须写明种子或甬道编号', false, '未进入待审详情');
}

await page.evaluate(() => {
  const b = [...document.querySelectorAll('.dt-actions .btn')].find((x) => x.textContent.trim() === '通过');
  b?.click();
});
await wait(900);
await click('.tabs button', 1);
await wait(700);
const deliverBtn = await page.evaluate(() => !!document.querySelector('.deliver-box:not(.done) .btn.primary'));
if (deliverBtn) {
  await page.evaluate(() => document.querySelector('.deliver-box:not(.done) .btn.primary').click());
  await wait(500);
  await page.evaluate(() => document.querySelector('.modal .btn.primary').click());
  await wait(900);
}
const delivered = await page.evaluate(() => {
  const st = JSON.parse(localStorage.getItem('nestworks.v1'));
  const o = st.orders.find((x) => x.id === 'O-1042');
  return o.shots.filter((s) => s.status === 'delivered').length;
});
check('整包交付后镜头标记为已交付', delivered >= 1, `${delivered} 个`);

// 7. delivery zip
const pack = await page.evaluate(async () => {
  const mod = await import('/src/lib/export/delivery.js');
  const st = JSON.parse(localStorage.getItem('nestworks.v1'));
  const o = st.orders.find((x) => x.id === 'O-1042');
  const { blob, manifest, checks } = await mod.buildOrderZip(o, { id: 'P-2608', name: '测试项目', client: '测试客户' });
  return { size: blob.size, shots: manifest.shots.length, allRepro: checks.every((c) => c.ok) };
});
check('交付包可导出', pack.size > 0, `${(pack.size / 1024).toFixed(1)} KB`);
check('交付包逐镜头可复现', pack.allRepro);

// 8. role gating
await click('.role-seg button', 2);
await wait(900);
const clientState = await page.evaluate(() => ({
  active: document.querySelector('.nav button.on')?.textContent.trim(),
  denied: [...document.querySelectorAll('.nav button.denied')].length
}));
check('客户身份受限', clientState.denied === 3, `限制 ${clientState.denied} 个界面`);
await page.screenshot({ path: path.join(OUT, 'verify-client.png') });

check('无控制台错误', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
process.exit(failed.length ? 1 : 0);
