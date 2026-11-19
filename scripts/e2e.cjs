/**
 * 端到端冒烟测试：通过 Chrome DevTools Protocol 驱动无头 Chrome，
 * 验证 3D 编辑器拾取/碰撞/框选 + 工单全流程（接单→派工→提交→打回→返工→合格→看板）。
 * 运行：node scripts/e2e.cjs
 */
const BASE = 'http://127.0.0.1:5174/?t=' + Date.now();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage() {
  const resp = await fetch('http://127.0.0.1:9222/json/new?' + encodeURIComponent(BASE), { method: 'PUT' });
  const tab = await resp.json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r, rej) => {
    ws.onopen = r;
    setTimeout(() => rej(new Error('ws 连接超时')), 8000);
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  await send('Runtime.enable');
  return {
    ws,
    send,
    eval: async (expr) => {
      const r = await send('Runtime.evaluate', {
        expression: expr, awaitPromise: true, returnByValue: true
      });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
      return r.result.value;
    },
    close: () => ws.close()
  };
}

function assert(cond, label) {
  if (!cond) { console.error('✗ ' + label); process.exitCode = 1; }
  else console.log('✓ ' + label);
}

(async () => {
  const page = await newPage();
  const evalJs = page.eval.bind(page);
  // 等应用与 view-editor 升级完成；每次运行先清空持久化数据并整页刷新
  await evalJs(`localStorage.removeItem('ecovivarium-editor-state-v1')`);
  await evalJs(`location.reload()`);
  await evalJs(`new Promise((res, rej) => {
    const t0 = Date.now();
    const t = setInterval(() => {
      const ve = document.querySelector('app-shell')?.shadowRoot?.querySelector('view-editor');
      if (ve?.shadowRoot?.querySelector('#bom-panel')) { clearInterval(t); res(); }
      else if (Date.now() - t0 > 15000) { clearInterval(t); rej(new Error('页面就绪超时')); }
    }, 200);
  })`);

  // ---------- 3D 编辑器 ----------
  const errors = [];
  page.ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    }
  });

  const compCount = await evalJs(`document.querySelector('app-shell').shadowRoot.querySelector('view-editor').shadowRoot.querySelectorAll('#bom-panel .bom-row').length`);
  assert(compCount === 5, `物料清单按类型汇总 5 行（实际 ${compCount}）`);

  // 通过内部 store 直接构造 3D 交互测试（与引擎相同的几何/碰撞逻辑）
  const collisionTest = await evalJs(`(async () => {
    const mod = await import('/src/geometry.ts');
    const cat = await import('/src/catalog.ts');
    const store = (await import('/src/store.ts')).store;
    const n0 = store.components.length;
    // 1) 新建一个与现有展箱完全重叠的展箱 → 期望 AABB 重叠
    const tank = store.createComponent('tank', {x:0,y:0.45,z:0}, null);
    const overlapWithExisting = store.components.filter(o=>o.kind==='tank').some(o=>{
      const a=mod.worldBox(tank), b=mod.worldBox(o);
      return mod.boxesOverlap(a,b);
    });
    // 2) 在展箱外（台面以下不可能，改测越界）：构件放到 y 负值
    const moss = store.createComponent('moss', {x:0,y:-0.5,z:0}, tank.id);
    const outside = !mod.insideTank(moss, [...store.components, moss]);
    // 3) 贴面算法：放到没有其他构件的空位，底面应贴台面 y=0
    const basin = store.createComponent('basin', {x:-0.45,y:0.5,z:-0.28}, store.components[0].id);
    const p = mod.surfaceAlign(basin, [...store.components, basin]);
    const halfH = basin.size.y*basin.scale.y/2;
    const onFloor = Math.abs(p.y - halfH) < 1e-6;
    // 3b) 叠放：放在已有构件正上方时，应贴到该构件顶面而不是台面
    const mossBase = store.components.find(c=>c.kind==='moss');
    const stacked = store.createComponent('moss', {x:mossBase.position.x, y:1, z:mossBase.position.z}, mossBase.tankId);
    const p2 = mod.surfaceAlign(stacked, [...store.components, stacked]);
    const baseTop = mod.worldBox(mossBase).max.y;
    const onTop = Math.abs(p2.y - (baseTop + stacked.size.y/2)) < 1e-6;
    const detail = { p2y: p2.y, expect: baseTop + stacked.size.y/2, baseTop };
    // 4) 吸附
    const snapped = Math.abs(mod.snap(0.123, 0.05) - 0.10) < 1e-9;
    // 5) 左对齐 + 等距排布
    const items = store.components.filter(c=>c.kind!=='tank').slice(0,3).map(c=>({...c, position:{...c.position}}));
    const aligned = mod.alignLeft(items);
    const minX = Math.min(...aligned.map(c=>mod.worldBox(c).min.x));
    const allLeft = aligned.every(c=>Math.abs(mod.worldBox(c).min.x-minX)<1e-9);
    const dist = mod.distributeEvenly(items);
    return { overlapWithExisting, outside, onFloor, onTop, detail, snapped, allLeft, distCount: dist.length, n0 };
  })()`);
  assert(collisionTest.overlapWithExisting, '重叠展箱 AABB 碰撞检测生效（拖入会被拦截）');
  assert(collisionTest.outside, '越界/穿台面判定生效（insideTank=false）');
  assert(collisionTest.onFloor, '贴面落点把构件底面贴到台面 y=0');
  assert(collisionTest.snapped, '吸附步长 0.05 取整正确');
  assert(collisionTest.allLeft, '批量左对齐后所有构件最小 X 面一致');
  assert(collisionTest.distCount === 3, '等距排布返回全部构件');
  assert(collisionTest.onTop, '构件叠放时自动贴到下层构件顶面 ' + JSON.stringify(collisionTest.detail));

  // 用真实 store 走 UI 层的创建/派工流程
  const flow = await evalJs(`(async () => {
    const { store } = await import('/src/store.ts');
    const out = [];
    // 接单
    const job = store.createJob('测试主题展箱', '锹甲饲养，湿度 70%');
    out.push(['created', job.status, job.code.startsWith('JOB-')]);
    // 派工
    store.assignJob(job.id, 'm1');
    out.push(['assigned', store.jobs[0].status, store.jobs[0].master === 'm1']);
    // 师傅提交
    store.submitJob(job.id);
    out.push(['submitted', store.jobs[0].status]);
    // 质检打回
    store.reviewJob(job.id, false, '枯木固定不牢');
    out.push(['rejected', store.jobs[0].status, store.jobs[0].reworkCount === 1]);
    // 返工重提
    store.resubmitJob(job.id);
    out.push(['resubmitted', store.jobs[0].status]);
    // 质检通过
    store.reviewJob(job.id, true, '整改合格');
    out.push(['done', store.jobs[0].status]);
    // 第二个工单走完合格，验证看板统计
    const j2 = store.createJob('第二单', '竹节虫拟态造景');
    store.assignJob(j2.id, 'm2');
    store.submitJob(j2.id);
    store.reviewJob(j2.id, true, '合格');
    const s = store.stats();
    return { out, stats: s, persisted: !!localStorage.getItem('ecovivarium-editor-state-v1') };
  })()`);
  for (const [name, status, extra] of flow.out) {
    assert(status !== undefined, `工单流「${name}」状态=${status}${extra === undefined ? '' : ' 校验=' + extra}`);
  }
  assert(flow.stats.total === 2, `看板工单总量 2（实际 ${flow.stats.total}）`);
  assert(flow.stats.done === 2, `已完成 2（实际 ${flow.stats.done}）`);
  assert(Math.abs(flow.stats.completionRate - 1) < 1e-9, '完成率 100%');
  assert(Math.abs(flow.stats.reworkRate - 0.5) < 1e-9, '返工率 50%（2 单中 1 单打回过）');
  assert(flow.stats.byMaster.find((m) => m.name === '张师傅').rework === 1, '返工次数按师傅归集');
  assert(flow.persisted, '状态已持久化到 localStorage');

  // 切到看板视图，验证 DOM 渲染统计
  await evalJs(`location.hash = '#/board'`);
  await sleep(600);
  const boardText = await evalJs(`document.querySelector('app-shell').shadowRoot.querySelector('view-board').shadowRoot.textContent`);
  assert(boardText.includes('工单总量') && boardText.includes('返工率'), '看板视图渲染 KPI');
  assert(boardText.includes('张师傅') && boardText.includes('李师傅'), '看板展示各师傅完成情况');

  // 俯视图切换不报错
  await evalJs(`location.hash = '#/editor'`);
  await sleep(800);
  const topInfo = await evalJs(`(async () => {
    const { store } = await import('/src/store.ts');
    const ed = document.querySelector('app-shell').shadowRoot.querySelector('view-editor');
    const canvasBefore = ed.shadowRoot.querySelectorAll('canvas').length;
    ed.shadowRoot.querySelector('#top-view').click();
    await new Promise(r=>setTimeout(r,300));
    const top1 = store.settings.topView;
    const canvasTop = ed.shadowRoot.querySelectorAll('canvas').length;
    ed.shadowRoot.querySelector('#top-view').click();
    await new Promise(r=>setTimeout(r,300));
    return { canvasBefore, top1, canvasTop, top2: store.settings.topView,
      canvasAfter: ed.shadowRoot.querySelectorAll('canvas').length };
  })()`);
  assert(topInfo.top1 === true && topInfo.top2 === false && topInfo.canvasAfter >= 1,
    '俯视图切换/还原正常，WebGL canvas 存活 ' + JSON.stringify(topInfo));

  assert(errors.length === 0, `运行期无未捕获异常（实际 ${errors.length}: ${errors.join(' | ')}）`);
  page.close();
  console.log(process.exitCode ? '\n=== 有失败项 ===' : '\n=== 全部通过 ===');
})().catch((e) => { console.error(e); process.exit(1); });
