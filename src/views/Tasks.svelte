<!-- shared status helpers -->
<script module>
  export const STATUS = {
    draft: { label: '草稿', cls: 'draft' },
    submitted: { label: '待审核', cls: 'submitted' },
    approved: { label: '已通过', cls: 'approved' },
    rejected: { label: '已退回', cls: 'rejected' },
    delivered: { label: '已交付', cls: 'delivered' }
  };

  export function deadlineClass(iso) {
    if (!iso) return '';
    const diff = new Date(iso).getTime() - Date.now();
    if (diff < 0) return 'overdue';
    if (diff < 86400000 * 1.5) return 'urgent';
    return '';
  }

  export function deadlineText(iso) {
    if (!iso) return '无截止';
    const d = new Date(iso);
    const diff = d.getTime() - Date.now();
    const md = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (diff < 0) return `${md} · 已逾期`;
    const h = Math.round(diff / 3600000);
    if (h < 24) return `${md} · 剩 ${h}h`;
    return `${md} · 剩 ${Math.round(h / 24)}d`;
  }
</script>

<script>
  import { store, selectOrder, selectShot, projectOf, PROJECTS, updateShot, addShot, nextShotId } from '../lib/state.js';
  import { go, CAPS } from '../lib/nav.js';
  import { toast, fmtDate } from '../lib/ui.js';
  import Modal from '../components/Modal.svelte';

  let s = $derived($store);
  let caps = $derived(CAPS[s.role] || CAPS.designer);
  let filter = $state('all');
  let addOpen = $state(false);
  let newLabel = $state('');
  let newCam = $state('persp');

  let rows = $derived(
    s.orders.flatMap((o) => {
      const p = PROJECTS.find((x) => x.id === o.projectId);
      return o.shots.map((sh) => ({ order: o, shot: sh, project: p }));
    })
  );

  let filtered = $derived(filter === 'all' ? rows : rows.filter((r) => r.shot.status === filter));

  let counts = $derived({
    all: rows.length,
    draft: rows.filter((r) => r.shot.status === 'draft').length,
    submitted: rows.filter((r) => r.shot.status === 'submitted').length,
    approved: rows.filter((r) => r.shot.status === 'approved').length,
    rejected: rows.filter((r) => r.shot.status === 'rejected').length,
    delivered: rows.filter((r) => r.shot.status === 'delivered').length
  });

  function open(r) {
    selectOrder(r.order.id);
    selectShot(r.shot.id);
    go('studio');
  }

  function submit(r) {
    if (!caps.submit) {
      toast('当前身份无法提交审核', 'err');
      return;
    }
    if (!r.shot.scene) {
      toast('请先在场景制作里保存该镜头', 'err');
      return;
    }
    updateShot(r.order.id, r.shot.id, (sh) => ({
      ...sh,
      status: 'submitted',
      submittedAt: new Date().toISOString(),
      history: [...(sh.history || []), { at: new Date().toISOString(), action: 'submit', by: '制作员', text: '提交审核' }]
    }));
    s = $store;
    toast(`镜头 ${r.shot.id} 已提交审核`, 'ok');
  }

  let newLabelDef = $derived(newLabel || '新镜头');

  function addShotTo(r) {
    const id = addShot(r.order.id, { label: newLabelDef, camera: newCam, note: '' });
    addOpen = false;
    newLabel = '';
    if (id) {
      toast(`已新建镜头 ${id}`, 'ok');
      selectOrder(r.order.id);
      selectShot(id);
      go('studio');
    }
  }

  function addTarget() {
    const o = s.orders.find((x) => x.id === s.activeOrderId) || s.orders[0];
    return { order: o };
  }

  const CAMS = { persp: '透视', top: '俯视', front: '剖切正视' };
</script>

<svelte:head><title>镜头任务 · 蚁筑 NESTWORKS</title></svelte:head>

<div class="tasks-page scroll">
  <div class="page-head">
    <div>
      <h1>镜头任务</h1>
      <p class="page-sub">按项目汇总所有镜头，制作员从草稿推进到待审；退回的镜头会标出错因与返工次数。</p>
    </div>
    <div class="head-actions">
      <button class="btn primary" onclick={() => (addOpen = true)} disabled={!caps.addShot}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        新建镜头
      </button>
    </div>
  </div>

  <div class="filters">
    {#each [
      ['all', '全部'],
      ['draft', '草稿'],
      ['submitted', '待审核'],
      ['rejected', '已退回'],
      ['approved', '已通过'],
      ['delivered', '已交付']
    ] as [k, label]}
      <button class="filter {filter === k ? 'on' : ''}" onclick={() => (filter = k)}>
        {label}<span class="fcount">{counts[k]}</span>
      </button>
    {/each}
  </div>

  {#each s.orders as o (o.id)}
    {@const proj = projectOf(s, o)}
    <section class="order-block">
      <div class="order-head">
        <div class="order-main">
          <div class="order-id mono">{o.id}</div>
          <div>
            <div class="order-title">{o.title}</div>
            <div class="order-sub">{proj?.name} · {proj?.client}</div>
          </div>
        </div>
        <div class="order-meta">
          <span class="dim">项目截止</span>
          <span class="mono">{fmtDate(proj?.deadline)}</span>
        </div>
      </div>

      <div class="shot-rows">
        {#each o.shots as sh (sh.id)}
          {@const st = STATUS[sh.status]}
          <div class="shot-row {deadlineClass(sh.deadline)}">
            <div class="sr-thumb">
              {#if sh.preview}
                <img src={sh.preview} alt={sh.label} />
              {:else}
                <div class="thumb-empty">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 7l8-4 8 4v10l-8 4-8-4V7z" stroke="currentColor" stroke-width="1.3"/><path d="M4 7l8 4 8-4M12 11v10" stroke="currentColor" stroke-width="1.1" opacity="0.5"/></svg>
                </div>
              {/if}
            </div>
            <div class="sr-body">
              <div class="sr-top">
                <span class="sr-label">{sh.label}</span>
                <span class="chip {st.cls}"><span class="dot"></span>{st.label}</span>
                {#if sh.reworkCount > 0}
                  <span class="chip rework" title="被退回后重做的次数">
                    <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><path d="M13.3 8a5.3 5.3 0 11-1.7-3.9M13.3 1.9v3.4H10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    返工 {sh.reworkCount}
                  </span>
                {/if}
              </div>
              <div class="sr-note">{sh.note}</div>
              <div class="sr-meta">
                <span class="mono dim">{sh.id}</span>
                <span class="sep">·</span>
                <span>{CAMS[sh.camera] || '透视'}</span>
                <span class="sep">·</span>
                <span class="mono" title="随机种子">种子 {sh.seed || '—'}</span>
                {#if sh.scene?.locks && Object.keys(sh.scene.locks).length}
                  <span class="sep">·</span>
                  <span class="chip locked xs">{Object.keys(sh.scene.locks).length} 锁定</span>
                {/if}
              </div>
              {#if sh.status === 'rejected' && sh.history?.length}
                {@const last = [...sh.history].reverse().find((h) => h.action === 'reject')}
                {#if last}
                  <div class="sr-reject">
                    <span class="rj-ico">!</span>
                    <div class="rj-text">
                      <b>退回意见</b>{last.text}
                      {#if last.tunnelIds?.length}<span class="rj-ids">要求改：{#each last.tunnelIds as t}<code>{t}</code>{/each}</span>{/if}
                      {#if last.seed && last.seed !== sh.seed}<span class="rj-ids">指定种子 <code>{last.seed}</code></span>{/if}
                    </div>
                  </div>
                {/if}
              {/if}
            </div>
            <div class="sr-side">
              <div class="deadline {deadlineClass(sh.deadline)}">
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/><path d="M8 4.6V8l2.4 1.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
                {deadlineText(sh.deadline)}
              </div>
              <div class="sr-actions">
                <button class="btn sm" onclick={() => open({ order: o, shot: sh })}>
                  {sh.status === 'rejected' ? '返工' : sh.status === 'approved' || sh.status === 'delivered' ? '查看' : '编辑'}
                </button>
                {#if sh.status === 'draft' || sh.status === 'rejected'}
                  <button class="btn sm primary" onclick={() => submit({ order: o, shot: sh })} disabled={!sh.scene || !caps.submit}>提交</button>
                {:else if sh.status === 'submitted'}
                  <span class="awaiting">等待主管审核</span>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/each}

  {#if filtered.length === 0}
    <div class="empty">
      <div class="empty-title">该状态下暂无镜头</div>
      <div class="empty-sub">切换筛选，或新建一个镜头开始制作。</div>
    </div>
  {/if}
</div>

<Modal open={addOpen} title="新建镜头" sub="新镜头归入当前项目订单，保存场景后即可提交审核。" onclose={() => (addOpen = false)} width={480}>
  <div class="form">
    <label class="field">
      <span class="field-label">镜头名称</span>
      <input type="text" placeholder="例如：第 4 集 侧剖 · 菌圃特写" bind:value={newLabel} />
    </label>
    <div class="field">
      <span class="field-label">初始视角</span>
      <div class="seg">
        {#each Object.entries(CAMS) as [k, v]}
          <button class:on={newCam === k} onclick={() => (newCam = k)}>{v}</button>
        {/each}
      </div>
    </div>
  </div>
  <div class="modal-foot" style="padding:14px 0 0; border:0">
    <button class="btn ghost" onclick={() => (addOpen = false)}>取消</button>
    <button class="btn primary" onclick={() => addShotTo(addTarget())}>创建镜头</button>
  </div>
</Modal>

<style>
  .tasks-page { height: 100%; padding: 22px 26px 60px; max-width: 1080px; margin: 0 auto; }
  .page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 16px; }
  .page-head h1 { font-size: 20px; font-weight: 650; letter-spacing: -0.02em; }
  .page-sub { font-size: 12.5px; color: var(--fg-2); margin: 5px 0 0; max-width: 560px; line-height: 1.6; }

  .filters { display: flex; gap: 5px; margin-bottom: 20px; flex-wrap: wrap; }
  .filter { border: 1px solid var(--line-soft); background: var(--bg-1); color: var(--fg-2); padding: 5px 11px; border-radius: 999px; font-size: 12px; display: flex; align-items: center; gap: 6px; }
  .filter:hover { color: var(--fg-0); border-color: var(--line); }
  .filter.on { background: var(--amber-soft); color: var(--amber); border-color: rgba(232,166,60,0.35); }
  .fcount { font-size: 10px; font-family: var(--mono); opacity: 0.75; }

  .order-block { margin-bottom: 22px; background: var(--bg-1); border: 1px solid var(--line-soft); border-radius: 12px; overflow: hidden; }
  .order-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 16px; border-bottom: 1px solid var(--line-soft); background: rgba(255,255,255,0.012); }
  .order-main { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .order-id { font-size: 11px; color: var(--amber); background: var(--amber-soft); padding: 2px 7px; border-radius: 5px; border: 1px solid rgba(232,166,60,0.24); flex: none; }
  .order-title { font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .order-sub { font-size: 11px; color: var(--fg-3); margin-top: 1px; }
  .order-meta { display: flex; flex-direction: column; align-items: flex-end; font-size: 10.5px; gap: 1px; flex: none; }

  .shot-rows { display: flex; flex-direction: column; }
  .shot-row { display: grid; grid-template-columns: 112px minmax(0, 1fr) auto; gap: 14px; padding: 13px 16px; border-bottom: 1px solid var(--line-soft); transition: background 0.14s; }
  .shot-row:last-child { border-bottom: 0; }
  .shot-row:hover { background: rgba(255,255,255,0.017); }

  .sr-thumb { width: 112px; height: 70px; border-radius: 8px; overflow: hidden; background: #0a0b0d; border: 1px solid var(--line-soft); position: relative; }
  .sr-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .thumb-empty { height: 100%; display: grid; place-items: center; color: var(--fg-3); background: repeating-linear-gradient(45deg, #14161a, #14161a 6px, #191c21 6px, #191c21 12px); }

  .sr-body { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .sr-top { display: flex; align-items: center; gap: 8px; }
  .sr-label { font-size: 13px; font-weight: 600; }
  .sr-note { font-size: 11.5px; color: var(--fg-2); line-height: 1.5; }
  .sr-meta { display: flex; align-items: center; gap: 6px; font-size: 10.5px; color: var(--fg-3); flex-wrap: wrap; margin-top: 1px; }
  .sep { opacity: 0.4; }
  .chip.xs { font-size: 9.5px; padding: 1px 6px; }

  .chip.rework { color: #d99a5a; background: rgba(217,154,90,0.11); border-color: rgba(217,154,90,0.26); font-size: 10px; }

  .sr-reject { display: flex; gap: 8px; margin-top: 7px; background: rgba(217,97,79,0.07); border: 1px solid rgba(217,97,79,0.2); border-radius: 7px; padding: 7px 10px; }
  .rj-ico { width: 15px; height: 15px; border-radius: 50%; background: var(--red); color: #1a0805; font-size: 10px; font-weight: 800; display: grid; place-items: center; flex: none; margin-top: 1px; }
  .rj-text { font-size: 11px; color: #e4b7ae; line-height: 1.6; }
  .rj-text b { color: var(--red); margin-right: 6px; font-size: 10.5px; letter-spacing: 0.03em; }
  .rj-ids { display: block; margin-top: 3px; font-size: 10px; color: var(--fg-2); }
  .rj-ids code { font-size: 10px; color: var(--amber); padding: 0 4px; margin-left: 3px; }

  .sr-side { display: flex; flex-direction: column; align-items: flex-end; justify-content: space-between; gap: 10px; min-width: 152px; }
  .deadline { display: flex; align-items: center; gap: 5px; font-size: 10.5px; color: var(--fg-3); font-family: var(--mono); white-space: nowrap; }
  .deadline.urgent { color: var(--amber); }
  .deadline.overdue { color: var(--red); }
  .sr-actions { display: flex; align-items: center; gap: 6px; }
  .awaiting { font-size: 10.5px; color: var(--blue); }

  .form { display: flex; flex-direction: column; gap: 14px; }
</style>
