/* 真实交互测试：射线拾取 + 框选（模拟 PointerEvent） */
const created = await (await fetch('http://127.0.0.1:9222/json/new?http://127.0.0.1:5174/?pick=' + Date.now(), { method: 'PUT' })).json();
const ws = new WebSocket(created.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    const h = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === mid) { ws.removeEventListener('message', h); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
await send('Runtime.enable');
const errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
});
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
await evalJs(`localStorage.removeItem('ecovivarium-editor-state-v1')`);
await evalJs(`location.reload()`);
await evalJs(`new Promise((res)=>{const t=setInterval(()=>{if(document.querySelector('app-shell')?.shadowRoot?.querySelector('view-editor')?.shadowRoot?.querySelector('canvas')){clearInterval(t);res();}},150)})`);
await new Promise((r) => setTimeout(r, 1500));

const result = await evalJs(`(async () => {
  const { store } = await import('/src/store.ts');
  const ed = document.querySelector('app-shell').shadowRoot.querySelector('view-editor');
  const canvas = ed.shadowRoot.querySelector('canvas');
  const rect = canvas.getBoundingClientRect();
  const fire = (type, x, y) => canvas.dispatchEvent(new PointerEvent(type, {
    bubbles: true, clientX: rect.left + x, clientY: rect.top + y, button: 0, pointerId: 1
  }));
  const fireUp = (x, y) => window.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, clientX: rect.left + x, clientY: rect.top + y, button: 0, pointerId: 1
  }));
  // 1) 用相机投影定位枯木屏幕坐标后点击
  const target = store.components.find(c => c.kind === 'log');
  // 投影需要引擎相机：直接遍历几种典型落点，记录每种点击后的选中数
  const probes = [[rect.width*0.42, rect.height*0.55],[rect.width*0.5, rect.height*0.52],[rect.width*0.55, rect.height*0.58]];
  const pickResults = [];
  for (const [px, py] of probes) {
    store.clearSelection();
    fire('pointerdown', px, py);
    fireUp(px, py);
    await new Promise(r=>setTimeout(r,80));
    pickResults.push(store.selection.size);
  }
  const anyPicked = pickResults.some(n => n === 1);
  // 2) 框选：空白处按下拖出大框，框住多个构件
  store.clearSelection();
  fire('pointerdown', rect.width*0.05, rect.height*0.05);
  fire('pointermove', rect.width*0.95, rect.height*0.95);
  fireUp(rect.width*0.95, rect.height*0.95);
  await new Promise(r=>setTimeout(r,150));
  const marqueeCount = store.selection.size;
  // 3) Delete 键删除（删掉框选结果）
  const before = store.components.length;
  const selectedBefore = store.selection.size;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  await new Promise(r=>setTimeout(r,100));
  const after = store.components.length;
  const deletedRight = after === before - selectedBefore;
  return JSON.stringify({ anyPicked, pickResults, marqueeCount, selectedBefore, before, after, deletedRight, errors: 0 });
})()`);
const data = JSON.parse(result);
console.log(result);
const ok = data.anyPicked && data.marqueeCount >= 2 && data.deletedRight;
console.log(ok ? 'PASS: 拾取/框选/删除均正常' : 'FAIL: 交互断言未满足');
console.log('exceptions:', errors.length ? errors.join(' | ') : 'none');
ws.close();
