// Screenshot helper: drives the dev server with puppeteer-core + local Chrome.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const OUT = process.env.OUT || 'shots';
fs.mkdirSync(OUT, { recursive: true });

const plan = JSON.parse(process.argv[2] || '[]');

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--hide-scrollbars', '--force-device-scale-factor=1']
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 950, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error' || t === 'warning') logs.push(`[${t}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

for (const step of plan) {
  if (step.goto) {
    await page.goto(BASE + step.goto, { waitUntil: 'networkidle2', timeout: 60000 });
  }
  if (step.eval) {
    try {
      const r = await page.evaluate(step.eval);
      if (r !== undefined) console.log('EVAL', JSON.stringify(r));
    } catch (e) {
      console.log('EVAL_ERR', e.message);
    }
  }
  if (step.click) {
    try {
      await page.evaluate((sel) => {
        const el = [...document.querySelectorAll(sel)].find((e) => e.offsetParent !== null);
        if (!el) throw new Error('not found: ' + sel);
        el.click();
      }, step.click);
    } catch (e) {
      console.log('CLICK_ERR', e.message);
    }
  }
  if (step.wait) await new Promise((r) => setTimeout(r, step.wait));
  if (step.shot) {
    await page.screenshot({ path: path.join(OUT, step.shot + '.png') });
    console.log('SHOT', step.shot);
  }
}

if (logs.length) console.log('--- CONSOLE ---\n' + logs.slice(0, 40).join('\n'));
await browser.close();
