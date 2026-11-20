<script>
  import { store, PROJECTS, projectOf, addOrder } from '../lib/state.js';
  import { toasts, toast, fmtDate, fmtRelative, deadlineMeta } from '../lib/ui.js';
  import Modal from '../components/Modal.svelte';
  import { go, CAPS } from '../lib/nav.js';

  let s = $derived($store);
  let caps = $derived(CAPS[s.role] || CAPS.client);
  let selected = $state(PROJECTS[0].id);
  let orderOpen = $state(false);
  let orderTitle = $state('');
  let briefOpen = $state(null);

  let project = $derived(PROJECTS.find((p) => p.id === selected) || PROJECTS[0]);
  let projectOrders = $derived(s.orders.filter((o) => o.projectId === project.id));

  const STATUS = {
    draft: { label: '制作中', cls: 'draft' },
    submitted: { label: '待审核', cls: 'submitted' },
    approved: { label: '已通过', cls: 'approved' },
    rejected: { label: '退回返工', cls: 'rejected' },
    delivered: { label: '已交付', cls: 'delivered' }
  };

  const CAM_LABEL = { persp: '透视', top: '俯视', front: '剖切正视' };

  function progress(order) {
    const done = order.shots.filter((x) => x.status === 'delivered').length;
    const ok = order.shots.filter((x) => x.status === 'approved' || x.status === 'delivered').length;
    return { done, ok, total: order.shots.length };
  }

  function pct(order) {
    const p = progress(order);
    return p.total ? Math.round(((p.ok * 0.7 + p.done * 0.3) / p.total) * 100) : 0;
  }

  function createOrder() {
    if (!caps.placeOrder) { toast('当前身份无法下单', 'err'); return; }
    if (!orderTitle.trim()) { toast('请填写订单名称', 'err'); return; }
    const id = addOrder(project.id, orderTitle.trim());
    orderOpen = false;
    orderTitle = '';
    if (id) toast(`订单 ${id} 已创建 · 含 2 个待制作镜头`, 'ok');
  }

  function allDeliveredOrders() {
    return projectOrders.filter((o) => o.shots.length && o.shots.every((x) => x.status === 'delivered'));
  }

  let dl = $derived(deadlineMeta(project.deadline));
</script>

<svelte:head><title>项目下单 · 蚁筑 NESTWORKS</title></svelte:head>

<div class="client-page">
  <aside class="projects scroll">
    <div class="cli-head">
      <div class="cli-avatar">客</div>
      <div>
        <div class="cli-name">客户工作台</div>
        <div class="cli-sub">查看项目进度与交付物</div>
      </div>
    </div>
    <div class="proj-list">
      {#each PROJECTS as p (p.id)}
        {@const os = s.orders.filter((o) => o.projectId === p.id)}
        {@const dm = deadlineMeta(p.deadline)}
        <button class="proj {selected === p.id ? 'on' : ''}" onclick={() => (selected = p.id)}>
          <div class="proj-top">
            <span class="proj-code mono">{p.id}</span>
            <span class="proj-dl {dm.urgent ? 'urgent' : ''}" class:overdue={dm.overdue}>{dm.text}</span>
          </div>
          <div class="proj-name">{p.name}</div>
          <div class="proj-foot">
            <span>{p.client}</span>
            <span class="dim">{os.length} 单 · {os.reduce((n, o) => n + o.shots.length, 0)} 镜头</span>
          </div>
        </button>
      {/each}
    </div>
  </aside>

  <main class="proj-view scroll">
    <div class="pv-head">
      <div>
        <div class="pv-code mono">{project.id} · {project.client}</div>
        <h1>{project.name}</h1>
        <div class="pv-meta">
          <span class="chip {dl.overdue ? 'rejected' : dl.urgent ? 'neutral' : 'neutral'}">
            <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.6V8l2.4 1.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
            项目截止 {fmtDate(project.deadline)} · {fmtRelative(project.deadline)}
          </span>
          <span class="dim" style="font-size:11px">共 {project.episodes} 集 · {projectOrders.length} 个订单</span>
        </div>
      </div>
      <button class="btn primary" onclick={() => (orderOpen = true)} disabled={!caps.placeOrder}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        下单
      </button>
    </div>

    <div class="brief">
      <div class="brief-label">需求简报</div>
      <p>{project.brief}</p>
    </div>

    {#if projectOrders.length === 0}
      <div class="empty">
        <div class="empty-title">该项目还没有订单</div>
        <div class="empty-sub">点击“下单”创建一个镜头包，制作员会收到对应的镜头任务。</div>
      </div>
    {/if}

    {#each projectOrders as o (o.id)}
      {@const pr = progress(o)}
      <section class="order-card">
        <div class="oc-head">
          <div class="oc-title-row">
            <span class="mono oc-id">{o.id}</span>
            <h3>{o.title}</h3>
            {#if o.deliveredAt}
              <span class="chip delivered"><span class="dot"></span>已整包交付</span>
            {/if}
          </div>
          <div class="oc-progress">
            <div class="oc-bar"><i style="width:{pct(o)}%"></i></div>
            <span class="mono">{pr.ok}/{pr.total}</span>
          </div>
        </div>

        <div class="shot-grid">
          {#each o.shots as sh (sh.id)}
            {@const st = STATUS[sh.status]}
            {@const dmt = deadlineMeta(sh.deadline)}
            <div class="shot-card">
              <div class="sc-thumb">
                {#if sh.preview}
                  <img src={sh.preview} alt={sh.label} />
                {:else}
                  <div class="sc-empty">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 7l8-4 8 4v10l-8 4-8-4V7z" stroke="currentColor" stroke-width="1.2"/><path d="M4 7l8 4 8-4M12 11v10" stroke="currentColor" stroke-width="1" opacity="0.4"/></svg>
                    <span>待制作</span>
                  </div>
                {/if}
                <span class="sc-cam">{sh.scene?.camera?.label || CAM_LABEL[sh.camera] || '透视'}</span>
                {#if sh.status === 'delivered'}<span class="sc-delivered"><svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M3 8.4l3.2 3.2L13.2 4.4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>交付</span>{/if}
              </div>
              <div class="sc-body">
                <div class="sc-top">
                  <span class="sc-label">{sh.label}</span>
                  <span class="chip {st.cls}"><span class="dot"></span>{st.label}</span>
                </div>
                <div class="sc-meta">
                  <span class="mono">{sh.id}</span>
                  {#if sh.reworkCount > 0}<span class="rw">返工 {sh.reworkCount}</span>{/if}
                  <span class="sc-dl {dmt.urgent ? 'urgent' : ''}" class:overdue={dmt.overdue}>{dmt.text}</span>
                </div>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/each}

    {#if allDeliveredOrders().length}
      <div class="delivered-banner">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" stroke="currentColor" stroke-width="1.3"/><path d="M7.5 12.3l3 3 6-6.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <div>
          <b>{allDeliveredOrders().length} 个订单已整包交付</b>
          <span>交付包内含每个镜头的场景参数、种子与渲染预览。</span>
        </div>
      </div>
    {/if}
  </main>
</div>

<Modal open={orderOpen} title="新建订单" sub={`下单到「${project.name}」，会生成一组默认镜头供制作员加工。`} onclose={() => (orderOpen = false)} width={480}>
  <div class="form">
    <label class="field">
      <span class="field-label">订单名称</span>
      <input type="text" bind:value={orderTitle} placeholder="例如：第 4 集 地下王国 全套镜头" />
    </label>
    <div class="order-preview">
      <div class="op-row"><span>默认包含</span><b>全景透视 + 剖切正视 2 个镜头</b></div>
      <div class="op-row"><span>制作周期</span><b>3 天内首版</b></div>
      <div class="op-row"><span>交付形式</span><b>整包交付（含参数与种子）</b></div>
    </div>
  </div>
  <div class="modal-foot" style="padding:14px 0 0;border:0">
    <button class="btn ghost" onclick={() => (orderOpen = false)}>取消</button>
    <button class="btn primary" onclick={createOrder}>确认下单</button>
  </div>
</Modal>

<style>
  .client-page { display: grid; grid-template-columns: 272px 1fr; height: 100%; min-height: 0; }
  .projects { background: var(--bg-1); border-right: 1px solid var(--line-soft); min-height: 0; padding: 14px 12px; }

  .cli-head { display: flex; align-items: center; gap: 10px; padding: 4px 6px 14px; border-bottom: 1px solid var(--line-soft); margin-bottom: 10px; }
  .cli-avatar { width: 32px; height: 32px; border-radius: 9px; background: linear-gradient(160deg, #2a3242, #1c2230); border: 1px solid var(--line); display: grid; place-items: center; font-size: 12px; color: var(--fg-1); font-weight: 600; }
  .cli-name { font-size: 13px; font-weight: 600; }
  .cli-sub { font-size: 10.5px; color: var(--fg-3); }

  .proj-list { display: flex; flex-direction: column; gap: 4px; }
  .proj { display: flex; flex-direction: column; gap: 4px; padding: 10px 11px; background: transparent; border: 1px solid transparent; border-radius: 9px; text-align: left; transition: all 0.15s; }
  .proj:hover { background: var(--bg-2); }
  .proj.on { background: var(--bg-2); border-color: var(--line); }
  .proj-top { display: flex; align-items: center; justify-content: space-between; }
  .proj-code { font-size: 9.5px; color: var(--amber); letter-spacing: 0.04em; }
  .proj-dl { font-size: 9.5px; color: var(--fg-3); font-family: var(--mono); }
  .proj-dl.urgent { color: var(--amber); }
  .proj-dl.overdue { color: var(--red); }
  .proj-name { font-size: 12.5px; font-weight: 550; line-height: 1.35; }
  .proj-foot { display: flex; justify-content: space-between; font-size: 10px; color: var(--fg-3); }

  .proj-view { min-width: 0; padding: 22px 28px 50px; max-width: 1120px; width: 100%; margin: 0 auto; }
  .pv-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
  .pv-code { font-size: 10.5px; color: var(--fg-3); letter-spacing: 0.04em; }
  .pv-head h1 { font-size: 22px; font-weight: 650; letter-spacing: -0.025em; margin-top: 3px; }
  .pv-meta { display: flex; align-items: center; gap: 10px; margin-top: 8px; flex-wrap: wrap; }

  .brief { margin-top: 16px; background: var(--bg-1); border: 1px solid var(--line-soft); border-left: 2px solid var(--amber-dim); border-radius: 8px; padding: 11px 14px; }
  .brief-label { font-size: 10px; letter-spacing: 0.1em; color: var(--fg-3); text-transform: uppercase; margin-bottom: 3px; }
  .brief p { margin: 0; font-size: 12.5px; color: var(--fg-1); line-height: 1.65; }

  .order-card { margin-top: 18px; background: var(--bg-1); border: 1px solid var(--line-soft); border-radius: 12px; overflow: hidden; }
  .oc-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 16px; border-bottom: 1px solid var(--line-soft); background: rgba(255,255,255,0.012); }
  .oc-title-row { display: flex; align-items: center; gap: 10px; min-width: 0; flex-wrap: wrap; }
  .oc-id { font-size: 10.5px; color: var(--amber); background: var(--amber-soft); padding: 2px 7px; border-radius: 5px; border: 1px solid rgba(232,166,60,0.22); }
  .oc-head h3 { font-size: 13.5px; font-weight: 600; }
  .oc-progress { display: flex; align-items: center; gap: 9px; flex: none; }
  .oc-bar { width: 110px; height: 4px; background: var(--bg-4); border-radius: 2px; overflow: hidden; }
  .oc-bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--teal), var(--green)); border-radius: 2px; transition: width 0.4s; }
  .oc-progress .mono { font-size: 10.5px; color: var(--fg-2); }

  .shot-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; padding: 14px 16px; }
  .shot-card { background: var(--bg-0); border: 1px solid var(--line-soft); border-radius: 9px; overflow: hidden; }
  .sc-thumb { position: relative; aspect-ratio: 16 / 10; background: #08090b; }
  .sc-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .sc-empty { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; color: var(--fg-3); font-size: 10.5px; background: repeating-linear-gradient(45deg, #14161a, #14161a 7px, #191c21 7px, #191c21 14px); }
  .sc-cam { position: absolute; bottom: 6px; left: 7px; font-size: 9.5px; color: var(--fg-2); background: rgba(8,9,11,0.82); border: 1px solid var(--line-soft); padding: 1px 7px; border-radius: 4px; }
  .sc-delivered { position: absolute; top: 6px; right: 7px; display: flex; align-items: center; gap: 3px; font-size: 9.5px; color: var(--green); background: rgba(10,20,12,0.9); border: 1px solid rgba(111,191,115,0.35); padding: 1px 7px; border-radius: 999px; }
  .sc-body { padding: 9px 10px 10px; }
  .sc-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .sc-label { font-size: 12px; font-weight: 550; }
  .sc-meta { display: flex; align-items: center; gap: 8px; margin-top: 5px; font-size: 9.5px; color: var(--fg-3); }
  .sc-meta .mono { font-size: 9.5px; }
  .rw { color: #d99a5a; }
  .sc-dl { margin-left: auto; font-family: var(--mono); }
  .sc-dl.urgent { color: var(--amber); }
  .sc-dl.overdue { color: var(--red); }

  .delivered-banner { display: flex; align-items: flex-start; gap: 10px; margin-top: 20px; padding: 13px 16px; background: linear-gradient(100deg, rgba(167,139,250,0.09), rgba(111,191,115,0.06)); border: 1px solid rgba(167,139,250,0.24); border-radius: 10px; color: var(--violet); }
  .delivered-banner b { display: block; font-size: 12.5px; }
  .delivered-banner span { font-size: 11px; color: var(--fg-2); }

  .form { display: flex; flex-direction: column; gap: 14px; }
  .order-preview { background: var(--bg-0); border: 1px solid var(--line-soft); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
  .op-row { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--fg-2); }
  .op-row b { color: var(--fg-1); font-weight: 500; }
</style>
