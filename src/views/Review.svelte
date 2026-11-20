<script>
  import { store, updateShot, PROJECTS, projectOf, setShotStatus } from '../lib/state.js';
  import { toast, fmtDate } from '../lib/ui.js';
  import Modal from '../components/Modal.svelte';
  import { go, CAPS } from '../lib/nav.js';
  import { buildOrderZip } from '../lib/export/delivery.js';

  let s = $derived($store);
  let caps = $derived(CAPS[s.role] || CAPS.supervisor);
  let tab = $state('queue'); // queue | delivered
  let sel = $state(null); // {orderId, shotId}
  let rejectOpen = $state(false);
  let rejectText = $state('');
  let rejectSeed = $state('');
  let rejectTunnels = $state('');
  let deliverOpen = $state(false);
  let delivOrderId = $state(null);

  let submitted = $derived(
    s.orders.flatMap((o) => o.shots.filter((x) => x.status === 'submitted').map((x) => ({ order: o, shot: x })))
  );
  let approved = $derived(
    s.orders.flatMap((o) => o.shots.filter((x) => x.status === 'approved' || x.status === 'delivered').map((x) => ({ order: o, shot: x })))
  );

  let list = $derived(tab === 'queue' ? submitted : approved);
  let deliveredOrders = $derived(s.orders.filter((o) => o.shots.some((x) => x.status === 'delivered')));

  $effect(() => {
    if (!sel && list.length) sel = { orderId: list[0].order.id, shotId: list[0].shot.id };
    if (sel && !list.some((r) => r.order.id === sel.orderId && r.shot.id === sel.shotId)) {
      sel = list.length ? { orderId: list[0].order.id, shotId: list[0].shot.id } : null;
    }
  });

  let current = $derived(sel ? list.find((r) => r.order.id === sel.orderId && r.shot.id === sel.shotId) : null);
  let proj = $derived(current ? projectOf(s, current.order) : null);

  function openReject() {
    rejectText = '';
    rejectSeed = current?.shot.seed || '';
    rejectTunnels = '';
    rejectOpen = true;
  }

  function doReject() {
    if (!caps.approve) { toast('当前身份无审核权限', 'err'); return; }
    if (!rejectText.trim()) { toast('请填写退回原因', 'err'); return; }
    const ids = rejectTunnels.split(/[,，\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
    const seedChanged = rejectSeed && rejectSeed !== current.shot.seed;
    if (!ids.length && !seedChanged) {
      toast('退回时必须写明要改的种子或甬道编号', 'err');
      return;
    }
    const { order, shot } = current;
    updateShot(order.id, shot.id, (sh) => ({
      ...sh,
      status: 'rejected',
      reworkCount: (sh.reworkCount || 0) + 1,
      history: [
        ...(sh.history || []),
        {
          at: new Date().toISOString(),
          action: 'reject',
          by: '主管',
          text: rejectText.trim(),
          seed: seedChanged ? rejectSeed.trim().toUpperCase() : sh.seed,
          tunnelIds: ids
        }
      ]
    }));
    s = $store;
    rejectOpen = false;
    toast(`已退回 ${shot.id} · 返工次数 +1`, 'ok');
  }

  function doApprove() {
    if (!caps.approve) { toast('当前身份无审核权限', 'err'); return; }
    if (!current) return;
    const { order, shot } = current;
    updateShot(order.id, shot.id, (sh) => ({
      ...sh,
      status: 'approved',
      approvedAt: new Date().toISOString(),
      history: [...(sh.history || []), { at: new Date().toISOString(), action: 'approve', by: '主管', text: '审核通过' }]
    }));
    s = $store;
    toast(`镜头 ${shot.id} 已通过`, 'ok');
  }

  let deliverTargets = $derived(s.orders.filter((o) => o.shots.some((x) => x.status === 'approved')));

  function openDeliver(orderId) {
    delivOrderId = orderId;
    deliverOpen = true;
  }

  let delivOrder = $derived(s.orders.find((o) => o.id === delivOrderId));
  let delivShots = $derived(delivOrder?.shots.filter((x) => x.status === 'approved') || []);
  let delivPending = $derived(delivOrder?.shots.filter((x) => x.status !== 'approved' && x.status !== 'delivered') || []);

  function doDeliver() {
    if (!caps.deliver) { toast('当前身份无交付权限', 'err'); return; }
    if (!delivOrder) return;
    const ids = new Set(delivShots.map((x) => x.id));
    store.update((st) => ({
      ...st,
      orders: st.orders.map((o) =>
        o.id !== delivOrder.id
          ? o
          : {
              ...o,
              deliveredAt: new Date().toISOString(),
              shots: o.shots.map((sh) =>
                ids.has(sh.id)
                  ? { ...sh, status: 'delivered', history: [...(sh.history || []), { at: new Date().toISOString(), action: 'deliver', by: '主管', text: `整包交付 ${ids.size} 个镜头` }] }
                  : sh
              )
            }
      )
    }));
    deliverOpen = false;
    toast(`订单 ${delivOrder.id} 已整包交付 · ${ids.size} 个镜头`, 'ok');
  }

  let packBusy = $state(false);

  async function downloadPack(orderId) {
    const order = s.orders.find((o) => o.id === orderId);
    if (!order) return;
    const delivered = order.shots.filter((x) => x.status === 'delivered');
    if (!delivered.length) {
      toast('该订单还没有已交付的镜头', 'err');
      return;
    }
    packBusy = true;
    try {
      const packOrder = { ...order, shots: delivered };
      const { blob, checks } = await buildOrderZip(packOrder, PROJECTS.find((p) => p.id === order.projectId));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${order.id}-delivery.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      const bad = checks.filter((c) => !c.ok);
      toast(bad.length ? `交付包已导出，但 ${bad.length} 个镜头复现校验失败` : `交付包已导出 · ${delivered.length} 个镜头，全部可复现`, bad.length ? 'err' : 'ok', 3400);
    } catch (e) {
      toast(`导出失败：${e.message || e}`, 'err');
    } finally {
      packBusy = false;
    }
  }

  function openShot(r) {
    if (!r) return;
    store.update((st) => ({ ...st, activeOrderId: r.order.id, activeShotId: r.shot.id }));
    go('studio');
  }

  const ACTION = { submit: '提交', reject: '退回', approve: '通过', deliver: '交付' };

  function delivProgress(order) {
    const n = order.shots.length;
    const ok = order.shots.filter((x) => x.status === 'approved' || x.status === 'delivered').length;
    return { ok, n };
  }
</script>

<svelte:head><title>审核交付 · 蚁筑 NESTWORKS</title></svelte:head>

<div class="review-page">
  <div class="rp-head">
    <div>
      <h1>审核交付</h1>
      <p class="page-sub">核对镜头预览与场景参数。退回时必须写明要改的种子或甬道编号；通过后可由主管整包交付给客户。</p>
    </div>
    <div class="seg tabs">
      <button class:on={tab === 'queue'} onclick={() => { tab = 'queue'; sel = null; }}>待审核 <span class="cnt">{submitted.length}</span></button>
      <button class:on={tab === 'delivered'} onclick={() => { tab = 'delivered'; sel = null; }}>已通过 <span class="cnt">{approved.length}</span></button>
    </div>
  </div>

  <div class="rp-grid">
    <aside class="queue scroll">
      {#if list.length === 0}
        <div class="empty">
          <div class="empty-title">{tab === 'queue' ? '没有待审核的镜头' : '暂无已通过的镜头'}</div>
          <div class="empty-sub">{tab === 'queue' ? '制作员提交后，镜头会出现在这里。' : '审核通过的镜头可在此整包交付。'}</div>
        </div>
      {/if}
      {#each list as r (r.shot.id)}
        <button class="q-item {sel?.shotId === r.shot.id ? 'on' : ''}" onclick={() => (sel = { orderId: r.order.id, shotId: r.shot.id })}>
          <div class="q-thumb">
            {#if r.shot.preview}
              <img src={r.shot.preview} alt="" />
            {:else}
              <div class="thumb-empty"></div>
            {/if}
          </div>
          <div class="q-info">
            <div class="q-label">{r.shot.label}</div>
            <div class="q-sub mono">{r.shot.id}</div>
            <div class="q-badges">
              {#if r.shot.reworkCount > 0}<span class="chip rework">返工 {r.shot.reworkCount}</span>{/if}
              {#if r.shot.status === 'submitted'}<span class="chip submitted">待审</span>{/if}
              {#if r.shot.status === 'approved'}<span class="chip approved">通过</span>{/if}
              {#if r.shot.status === 'delivered'}<span class="chip delivered">已交付</span>{/if}
            </div>
          </div>
        </button>
      {/each}

      {#if tab === 'delivered' && deliverTargets.length}
        <div class="deliver-box">
          <div class="db-title">整包交付</div>
          <p class="db-sub">同一订单内所有已通过镜头一起交付。</p>
          {#each deliverTargets as o (o.id)}
            <div class="db-row">
              <div class="db-name">{o.id}<span class="db-prog">{delivProgress(o).ok}/{delivProgress(o).n}</span></div>
              <button class="btn sm primary" onclick={() => openDeliver(o.id)}>整包交付</button>
            </div>
          {/each}
        </div>
      {/if}

      {#if tab === 'delivered' && deliveredOrders.length}
        <div class="deliver-box done">
          <div class="db-title">交付包下载</div>
          <p class="db-sub">含 manifest、每镜头参数与种子、预览图；导出时逐个复现校验。</p>
          {#each deliveredOrders as o (o.id)}
            <div class="db-row">
              <div class="db-name">{o.id}<span class="db-prog">{o.shots.filter((x) => x.status === 'delivered').length} 镜头</span></div>
              <button class="btn sm teal" onclick={() => downloadPack(o.id)} disabled={packBusy}>
                {packBusy ? '打包中…' : '下载 ZIP'}
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </aside>

    <section class="detail scroll">
      {#if current}
        <div class="dt-head">
          <div>
            <div class="dt-kicker">{proj?.name} · {current.order.id}</div>
            <h2 class="dt-title">{current.shot.label}</h2>
            <div class="dt-meta">
              <span class="mono dim">{current.shot.id}</span>
              <span class="sep">/</span>
              <span>种子 <b class="mono">{current.shot.seed}</b></span>
              {#if current.shot.reworkCount > 0}
                <span class="chip rework">返工 {current.shot.reworkCount} 次</span>
              {/if}
            </div>
          </div>
          <div class="dt-actions">
            <button class="btn ghost" onclick={() => openShot(current)}>打开场景</button>
            {#if current.shot.status === 'submitted'}
              <button class="btn danger" onclick={openReject} disabled={!caps.approve}>退回</button>
              <button class="btn primary" onclick={doApprove} disabled={!caps.approve}>通过</button>
            {:else if current.shot.status === 'approved'}
              <span class="chip approved"><span class="dot"></span>已通过审核</span>
              <button class="btn primary" onclick={() => openDeliver(current.order.id)} disabled={!caps.deliver}>整包交付</button>
            {:else}
              <span class="chip delivered"><span class="dot"></span>已交付</span>
            {/if}
          </div>
        </div>

        <div class="preview-big">
          {#if current.shot.preview}
            <img src={current.shot.preview} alt={current.shot.label} />
            <div class="pb-tag">{current.shot.scene?.camera?.label || '全景透视'}</div>
          {:else}
            <div class="thumb-empty lg">该镜头尚未保存预览</div>
          {/if}
        </div>

        <div class="cols">
          <div class="card">
            <div class="card-title">场景参数</div>
            {#if current.shot.scene?.params || current.shot.params}
              {@const p = current.shot.scene?.params || current.shot.params}
              <div class="kv"><span class="k">入口数量</span><span class="v">{p.entrances}</span></div>
              <div class="kv"><span class="k">巢深</span><span class="v">{p.depth} m</span></div>
              <div class="kv"><span class="k">主道分支角</span><span class="v">{p.branchAngle}°</span></div>
              <div class="kv"><span class="k">分室层数</span><span class="v">{p.levels}</span></div>
              <div class="kv"><span class="k">通道管径</span><span class="v">{p.tunnelDiameter} m</span></div>
              <div class="divider"></div>
              <div class="kv"><span class="k">材质</span><span class="v">{current.shot.scene?.soil === 'damp' ? '湿土' : current.shot.scene?.soil === 'gravel' ? '砂砾' : '干土'}</span></div>
              <div class="kv"><span class="k">剖切</span><span class="v">{current.shot.scene?.cut?.enabled ? `开 · ${Math.round((current.shot.scene?.cut?.depth || 0) * 100)}%` : '关'}</span></div>
            {:else}
              <p class="dim" style="font-size:11.5px">尚未保存场景参数。</p>
            {/if}
            {#if current.shot.scene?.locks && Object.keys(current.shot.scene.locks).length}
              <div class="divider"></div>
              <div class="locks">
                <span class="dim" style="font-size:10.5px">锁定甬道</span>
                <div class="tag-row">
                  {#each Object.keys(current.shot.scene.locks) as id}
                    <code>{id}</code>
                  {/each}
                </div>
              </div>
            {/if}
          </div>

          <div class="card">
            <div class="card-title">时间线</div>
            {#if current.shot.deadline}
              {@const dl = current.shot.deadline}
              <div class="kv"><span class="k">截止时间</span><span class="v" style="color:{new Date(dl) < new Date() ? 'var(--red)' : 'var(--fg-0)'}">{fmtDate(dl, true)}</span></div>
            {/if}
            {#if current.shot.submittedAt}
              <div class="kv"><span class="k">提交时间</span><span class="v">{fmtDate(current.shot.submittedAt, true)}</span></div>
            {/if}
            <div class="divider"></div>
            <div class="tl">
              {#each [...(current.shot.history || [])].reverse() as h, i}
                <div class="tl-item {h.action}">
                  <span class="tl-dot"></span>
                  <div class="tl-body">
                    <div class="tl-top">
                      <b>{h.action === 'reject' ? '退回' : h.action === 'approve' ? '通过' : h.action === 'submit' ? '提交' : '交付'}</b>
                      <span class="dim">{h.by}</span>
                      <span class="dim tl-time mono">{fmtDate(h.at, true)}</span>
                    </div>
                    <div class="tl-text">{h.text}</div>
                    {#if h.tunnelIds?.length || h.seed}
                      <div class="tl-ids">
                        {#if h.seed}<span>种子 <code>{h.seed}</code></span>{/if}
                        {#each h.tunnelIds || [] as t}<code>{t}</code>{/each}
                      </div>
                    {/if}
                  </div>
                </div>
              {/each}
              {#if !current.shot.history?.length}<p class="dim" style="font-size:11.5px">暂无记录。</p>{/if}
            </div>
          </div>
        </div>
      {:else}
        <div class="empty">
          <div class="empty-title">选择左侧一个镜头</div>
          <div class="empty-sub">这里会显示预览、场景参数与审核时间线。</div>
        </div>
      {/if}
    </section>
  </div>
</div>

<Modal open={rejectOpen} title="退回镜头" sub="退回会将该镜头返工次数 +1，并把意见、指定种子与甬道编号记录到时间线。" onclose={() => (rejectOpen = false)} width={560}
  footer={null}>
  <div class="reject-form">
    <label class="field">
      <span class="field-label">退回原因 <span class="req">必填</span></span>
      <textarea rows="3" bind:value={rejectText} placeholder="例如：剖切面上 M2 甬道被土挡住，请把 M2 走向改平缓。"></textarea>
    </label>
    <div class="two">
      <label class="field">
        <span class="field-label">要改的甬道编号</span>
        <input type="text" bind:value={rejectTunnels} placeholder="M2, B1-2-1" class="mono" />
      </label>
      <label class="field">
        <span class="field-label">指定种子</span>
        <input type="text" bind:value={rejectSeed} placeholder={current?.shot.seed || ''} class="mono" />
      </label>
    </div>
    <p class="req-hint">
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.3" stroke="currentColor" stroke-width="1.3"/><path d="M8 4.6v4M8 11.2v.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      甬道编号与种子至少填一项；两者都留空将无法退回。
    </p>
    <div class="modal-foot" style="padding:10px 0 0;border:0">
      <button class="btn ghost" onclick={() => (rejectOpen = false)}>取消</button>
      <button class="btn danger" onclick={doReject}>确认退回</button>
    </div>
  </div>
</Modal>

<Modal open={deliverOpen} title="整包交付" sub="以下已通过镜头将作为一个交付包标记为已交付。" onclose={() => (deliverOpen = false)} width={520}
  footer={null}>
  {#if delivOrder}
    <div class="deliv-list">
      {#each delivShots as sh (sh.id)}
        <div class="dl-row"><span class="chip approved">通过</span><span>{sh.label}</span><span class="mono dim">{sh.id}</span></div>
      {/each}
      {#if delivPending.length}
        <div class="dl-warn">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 2.4l6 11H2l6-11z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 6.6v3M8 11.6v.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          {delivPending.length} 个镜头未通过，不会包含在本次交付中
        </div>
      {/if}
    </div>
    <div class="modal-foot" style="padding:12px 0 0;border:0">
      <button class="btn ghost" onclick={() => (deliverOpen = false)}>取消</button>
      <button class="btn primary" onclick={doDeliver}>交付 {delivShots.length} 个镜头</button>
    </div>
  {/if}
</Modal>

<style>
  .review-page { height: 100%; display: flex; flex-direction: column; padding: 20px 24px 0; max-width: 1220px; margin: 0 auto; min-height: 0; }
  .rp-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; flex: none; }
  .rp-head h1 { font-size: 20px; font-weight: 650; letter-spacing: -0.02em; }
  .page-sub { font-size: 12.5px; color: var(--fg-2); margin: 5px 0 0; max-width: 620px; line-height: 1.6; }
  .tabs { flex: none; }
  .cnt { font-family: var(--mono); font-size: 10px; opacity: 0.7; margin-left: 3px; }

  .rp-grid { display: grid; grid-template-columns: 276px 1fr; gap: 16px; flex: 1; min-height: 0; padding: 16px 0 0; }
  .queue { min-height: 0; display: flex; flex-direction: column; gap: 6px; padding-right: 4px; }
  .q-item { display: grid; grid-template-columns: 66px 1fr; gap: 10px; padding: 8px; background: var(--bg-1); border: 1px solid var(--line-soft); border-radius: 9px; text-align: left; transition: all 0.14s; }
  .q-item:hover { border-color: var(--line); background: var(--bg-2); }
  .q-item.on { border-color: rgba(232,166,60,0.45); background: rgba(232,166,60,0.06); }
  .q-thumb { width: 66px; height: 44px; border-radius: 5px; overflow: hidden; background: #0a0b0d; }
  .q-thumb img { width: 100%; height: 100%; object-fit: cover; }
  .thumb-empty { height: 100%; background: repeating-linear-gradient(45deg, #14161a, #14161a 5px, #191c21 5px, #191c21 10px); border-radius: 0; }
  .thumb-empty.lg { display: grid; place-items: center; height: 100%; color: var(--fg-3); font-size: 11.5px; border-radius: 10px; }
  .q-info { min-width: 0; }
  .q-label { font-size: 12px; font-weight: 550; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .q-sub { font-size: 10px; color: var(--fg-3); }
  .q-badges { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
  .chip.rework { color: #d99a5a; background: rgba(217,154,90,0.11); border-color: rgba(217,154,90,0.26); font-size: 9.5px; padding: 1px 6px; }

  .deliver-box { margin-top: 10px; background: var(--bg-1); border: 1px solid var(--line); border-radius: 10px; padding: 12px; }
  .deliver-box.done { border-color: rgba(70,184,164,0.28); background: rgba(70,184,164,0.04); }
  .db-title { font-size: 11.5px; font-weight: 600; letter-spacing: 0.04em; }
  .db-sub { font-size: 10.5px; color: var(--fg-3); margin: 3px 0 10px; line-height: 1.5; }
  .db-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0; border-top: 1px solid var(--line-soft); }
  .db-name { font-size: 11.5px; font-family: var(--mono); display: flex; align-items: center; gap: 6px; }
  .db-prog { font-size: 9.5px; color: var(--fg-3); }

  .detail { min-height: 0; display: flex; flex-direction: column; gap: 12px; padding-right: 4px; padding-bottom: 24px; }
  .dt-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .dt-kicker { font-size: 10.5px; color: var(--fg-3); letter-spacing: 0.03em; }
  .dt-title { font-size: 18px; font-weight: 650; margin-top: 2px; }
  .dt-meta { display: flex; align-items: center; gap: 8px; margin-top: 5px; font-size: 11px; color: var(--fg-2); flex-wrap: wrap; }
  .dt-meta b { color: var(--fg-0); font-weight: 500; }
  .sep { opacity: 0.4; }
  .dt-actions { display: flex; gap: 7px; align-items: center; flex: none; }

  .preview-big { position: relative; border-radius: 11px; overflow: hidden; background: #08090b; border: 1px solid var(--line-soft); aspect-ratio: 1440 / 900; }
  .preview-big img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .pb-tag { position: absolute; bottom: 8px; left: 10px; background: rgba(8,9,11,0.8); border: 1px solid var(--line); font-size: 10px; padding: 2px 8px; border-radius: 5px; color: var(--fg-2); }

  .cols { display: grid; grid-template-columns: 1fr 1.2fr; gap: 12px; }
  .card { background: var(--bg-1); border: 1px solid var(--line-soft); border-radius: 10px; padding: 13px 14px; min-width: 0; }
  .card-title { font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--fg-1); margin-bottom: 9px; }
  .locks { display: flex; flex-direction: column; gap: 6px; }

  .tl { display: flex; flex-direction: column; gap: 10px; }
  .tl-item { display: flex; gap: 9px; }
  .tl-dot { width: 7px; height: 7px; border-radius: 50%; margin-top: 5px; background: var(--fg-3); flex: none; }
  .tl-item.reject .tl-dot { background: var(--red); }
  .tl-item.approve .tl-dot { background: var(--green); }
  .tl-item.submit .tl-dot { background: var(--blue); }
  .tl-item.deliver .tl-dot { background: var(--violet); }
  .tl-body { min-width: 0; }
  .tl-top { display: flex; align-items: baseline; gap: 7px; font-size: 11.5px; flex-wrap: wrap; }
  .tl-top b { font-weight: 600; }
  .tl-time { font-size: 9.5px; }
  .tl-text { font-size: 11px; color: var(--fg-2); line-height: 1.6; margin-top: 1px; }
  .tl-ids { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 4px; font-size: 10px; color: var(--fg-3); }
  .tl-ids code { font-size: 10px; color: var(--amber); }

  .reject-form { display: flex; flex-direction: column; gap: 12px; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .req { color: var(--red); font-size: 10px; }
  .req-hint { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--fg-3); margin: 0; }
  .req-hint svg { flex: none; color: var(--amber); }
  .deliv-list { display: flex; flex-direction: column; gap: 6px; }
  .dl-row { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px; padding: 8px 10px; background: var(--bg-2); border-radius: 7px; font-size: 12px; }
  .dl-row .mono { font-size: 10.5px; }
  .dl-warn { display: flex; align-items: center; gap: 7px; font-size: 11px; color: var(--amber); background: var(--amber-soft); border: 1px solid rgba(232,166,60,0.22); padding: 7px 10px; border-radius: 7px; margin-top: 3px; }
</style>
