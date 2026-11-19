<script>
  import { specimenToSvg } from '../svgExport.js';
  import { CHECK_INFO } from '../validation.js';

  let { app, store } = $props();

  const summary = $derived(app.batchSummary());
  const entries = $derived(
    store.batch.entries.map((e) => ({
      ...e,
      thumb: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(specimenToSvg(e.specimen, { background: 'transparent' }))
    }))
  );

  let currentId = $state(null);

  const filtered = $derived.by(() => {
    const f = store.reviewFilter;
    if (f === 'blocking') return entries.filter((e) => e.summary.blocking > 0);
    if (f === 'warning') return entries.filter((e) => e.summary.warning > 0);
    if (f === 'pending') return entries.filter((e) => e.review.status === 'pending');
    return entries;
  });

  const current = $derived(entries.find((e) => e.id === currentId) || null);

  $effect(() => {
    const list = filtered;
    if (!list.find((e) => e.id === currentId)) currentId = list[0]?.id ?? entries[0]?.id ?? null;
  });

  const typeLabel = (c) => ({ symmetry: '对称', density: '密度', contrast: '对比' })[c] || c;

  function formatVal(c) {
    if (c.check === 'symmetry') return c.value.toFixed(2) + '%';
    if (c.check === 'density' && c.key.includes('balance')) return c.value.toFixed(2) + '×';
    if (c.check === 'density') return c.value.toFixed(2) + '%';
    if (c.key === 'contrast-palette') return (c.value * 100).toFixed(1) + '%';
    return c.value.toFixed(2) + ':1';
  }

  const itemOf = (entry, key) => entry?.review.items.find((i) => i.key === key);

  let noteDraft = $state('');
  $effect(() => {
    noteDraft = current?.review.note || '';
    currentId;
  });

  function approve(entryId, key) {
    app.setVerdict(entryId, key, 'approved');
  }
  function reject(entryId, key) {
    app.setVerdict(entryId, key, 'rejected');
    app.toast('已驳回该条 · 需退回制作员修改', 'warn');
  }

  function approveAll() {
    if (!current) return;
    for (const c of current.checks) app.setVerdict(current.id, c.key, 'approved');
    app.reviewEntry(current.id, 'approved', noteDraft);
  }
  function rejectAll() {
    if (!current) return;
    for (const c of current.checks) app.setVerdict(current.id, c.key, 'rejected');
    app.reviewEntry(current.id, 'rejected', noteDraft);
  }

  const canRelease = $derived(summary.canRelease);

  function release() {
    if (!canRelease) return;
    app.requestExport?.();
  }

  const pendingItems = $derived(current ? current.review.items.filter((i) => i.verdict === 'pending').length : 0);
</script>

<div class="review">
  <header class="rhead">
    <div>
      <h2>复核</h2>
      <p class="dim small">
        逐条确认或驳回自动检查项。有驳回的条目退回制作员修改后重提;<b class:ok={canRelease}>整批无阻断项且全部确认</b>后方可放行导出。
      </p>
    </div>
    <div class="release">
      <div class="relinfo">
        <span class:ok={canRelease} class:hold={!canRelease}>
          {canRelease ? '可放行' : summary.blocking > 0 ? `${summary.blocking} 个阻断项待处理` : summary.rejected > 0 ? `${summary.rejected} 个条目被驳回` : `${summary.pending} 个条目待复核`}
        </span>
      </div>
      <button class="primary" onclick={release} disabled={!canRelease}>放行并导出素材包</button>
    </div>
  </header>

  {#if !entries.length}
    <div class="empty"><p>批次为空,先去生成器提交变体。</p></div>
  {:else}
    <div class="split">
      <aside class="side">
        <div class="filters">
          {#each [['all', '全部'], ['blocking', '有阻断'], ['warning', '有警告'], ['pending', '待复核']] as [k, label]}
            <button class="filt" class:active={store.reviewFilter === k} onclick={() => app.setReviewFilter(k)}>{label}</button>
          {/each}
        </div>
        <ul class="elist">
          {#each filtered as e (e.id)}
            <li>
              <button class="eitem" class:sel={currentId === e.id} onclick={() => (currentId = e.id)}>
                <img src={e.thumb} alt="" />
                <div class="ei">
                  <div class="l1"><b>{e.specimen.speciesName}</b> <span class="mono small dim">V{e.specimen.variant + 1}</span></div>
                  <div class="l2 small">
                    {#if e.summary.blocking}<span class="bad">{e.summary.blocking} 阻断</span>{/if}
                    {#if e.summary.warning}<span class="warn">{e.summary.warning} 警告</span>{/if}
                    {#if !e.summary.total}<span class="ok">无问题</span>{/if}
                  </div>
                </div>
                <span class="dot" class:pending={e.review.status === 'pending'} class:approved={e.review.status === 'approved'} class:rejected={e.review.status === 'rejected'}></span>
              </button>
            </li>
          {/each}
        </ul>
      </aside>

      {#if current}
        <section class="body">
          <div class="toprow">
            <div class="preview"><img src={current.thumb} alt="" /></div>
            <div class="meta">
              <h3>{current.specimen.speciesName} · 变体 {current.specimen.variant + 1}</h3>
              <div class="kv"><span>种子</span><b class="mono">{current.specimen.seed}</b></div>
              <div class="kv"><span>指纹</span><b class="mono">{current.specimen.fingerprint.slice(0, 12)}</b></div>
              <div class="kv"><span>提交</span><b>{new Date(current.submittedAt).toLocaleString('zh-CN', { hour12: false })}</b></div>
              <div class="kv">
                <span>状态</span>
                <b class:pending={current.review.status === 'pending'} class:approved={current.review.status === 'approved'} class:rejected={current.review.status === 'rejected'}>
                  {{ pending: '待复核', approved: '已通过', rejected: '已驳回' }[current.review.status]}
                </b>
              </div>
            </div>
          </div>

          {#if !current.checks.length}
            <div class="pass">
              <span class="tick">✓</span>
              <div>
                <b>自动检查全部通过</b>
                <p class="dim small">此条目没有需要在复核环节处理的告警。</p>
              </div>
            </div>
          {:else}
            <ul class="items">
              {#each current.checks as c (c.key)}
                {@const it = itemOf(current, c.key)}
                <li class="ri" class:blocking={c.severity === 'blocking'} class:approved={it?.verdict === 'approved'} class:rejected={it?.verdict === 'rejected'}>
                  <div class="ri-top">
                    <span class="sev" class:bad={c.severity === 'blocking'} class:warn={c.severity === 'warning'}>
                      {c.severity === 'blocking' ? '阻断' : '警告'}
                    </span>
                    <span class="ctype">{typeLabel(c.check)}</span>
                    <b class="ctitle">{c.title}</b>
                    <span class="cval mono">{formatVal(c)}</span>
                    <span class="verdict" class:ok={it?.verdict === 'approved'} class:no={it?.verdict === 'rejected'}>
                      {it?.verdict === 'approved' ? '已确认' : it?.verdict === 'rejected' ? '已驳回' : '待处理'}
                    </span>
                  </div>
                  <p class="cdetail">{c.detail}</p>
                  <p class="chint dim"><span>建议</span> {c.hint}</p>
                  <div class="vactions">
                    <button class="okbtn" onclick={() => approve(current.id, c.key)} disabled={it?.verdict === 'approved'}>确认</button>
                    <button class="nobtn" onclick={() => reject(current.id, c.key)} disabled={it?.verdict === 'rejected'}>驳回</button>
                    {#if it?.at}<span class="dim small mono">更新于 {new Date(it.at).toLocaleTimeString('zh-CN', { hour12: false })}</span>{/if}
                  </div>
                </li>
              {/each}
            </ul>
          {/if}

          <div class="reviewfoot">
            <label class="notefield">
              <span class="dim small">复核备注</span>
              <textarea bind:value={noteDraft} rows="2" placeholder="给制作员的说明,例如:左边斑点请向左移一点…"></textarea>
            </label>
            <div class="batchacts">
              <button class="ghost" onclick={approveAll} disabled={!current.checks.length}>全部确认</button>
              <button class="ghost danger" onclick={rejectAll} disabled={!current.checks.length}>整条驳回</button>
              {#if current.review.status === 'rejected'}
                <button class="primary" onclick={() => app.resubmit(current.id)}>退回制作员修改</button>
              {/if}
            </div>
          </div>
        </section>
      {/if}
    </div>
  {/if}
</div>

<style>
  .review { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .rhead {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 20px;
    padding: 16px 18px;
    border-bottom: 1px solid var(--line);
    flex-wrap: wrap;
  }
  .rhead h2 { font-size: 15px; margin: 0 0 5px; font-weight: 600; }
  .rhead p { margin: 0; line-height: 1.55; max-width: 640px; }
  .rhead b.ok { color: var(--ok); }
  .release { display: flex; align-items: center; gap: 12px; }
  .relinfo span { font-size: 11.5px; }
  .relinfo .ok { color: var(--ok); }
  .relinfo .hold { color: var(--warn); }
  .empty { flex: 1; display: grid; place-items: center; color: var(--ink-3); font-size: 12px; }
  .split { display: grid; grid-template-columns: 290px 1fr; flex: 1; min-height: 0; }
  .side { border-right: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; }
  .filters { display: flex; gap: 4px; padding: 9px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .filt { font-size: 11px; padding: 3px 9px; border-radius: 999px; background: transparent; border: 1px solid var(--line); color: var(--ink-3); }
  .filt.active { background: var(--panel-3); border-color: var(--line-2); color: var(--ink); }
  .elist { list-style: none; margin: 0; padding: 7px; overflow-y: auto; }
  .elist li { margin-bottom: 4px; }
  .eitem {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 7px;
    text-align: left;
  }
  .eitem.sel { border-color: var(--accent-2); background: var(--panel-2); }
  .eitem img { width: 42px; height: 31px; border-radius: 4px; background: #14170f; flex-shrink: 0; }
  .ei { flex: 1; min-width: 0; }
  .l1 { display: flex; gap: 5px; align-items: baseline; font-size: 12px; }
  .l2 { display: flex; gap: 5px; margin-top: 2px; }
  .l2 .bad { color: #e8896f; }
  .l2 .warn { color: var(--warn); }
  .l2 .ok { color: var(--ok); }
  .dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .dot.pending { background: var(--info); }
  .dot.approved { background: var(--ok); }
  .dot.rejected { background: var(--bad); }

  .body { overflow-y: auto; padding: 16px 18px; min-height: 0; }
  .toprow { display: flex; gap: 18px; align-items: flex-start; margin-bottom: 16px; }
  .preview {
    width: 220px;
    flex-shrink: 0;
    aspect-ratio: 168 / 122;
    background: radial-gradient(circle at 50% 40%, #1e2219, #14170f);
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow: hidden;
  }
  .preview img { width: 100%; height: 100%; object-fit: contain; }
  .meta h3 { font-size: 14px; margin: 0 0 9px; font-weight: 600; }
  .kv { display: flex; gap: 9px; font-size: 11px; margin-bottom: 4px; }
  .kv span { color: var(--ink-3); width: 34px; flex-shrink: 0; }
  .kv b { font-weight: 500; color: var(--ink-2); }
  .kv b.pending { color: #a8c6e0; }
  .kv b.approved { color: var(--ok); }
  .kv b.rejected { color: var(--bad); }

  .pass { display: flex; gap: 12px; align-items: flex-start; padding: 14px; background: #7fb06912; border: 1px solid #7fb06933; border-radius: 8px; margin-bottom: 12px; }
  .tick { color: var(--ok); font-size: 18px; line-height: 1; }
  .pass p { margin: 3px 0 0; }

  .items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .ri {
    padding: 10px 12px;
    border-radius: 7px;
    background: #e0a33e0f;
    border: 1px solid #e0a33e30;
    border-left: 3px solid var(--warn);
  }
  .ri.blocking { background: #cf5f4a10; border-color: #cf5f4a3a; border-left-color: var(--bad); }
  .ri.approved { border-left-color: var(--ok); background: #7fb0690d; }
  .ri.rejected { border-left-color: var(--bad); opacity: 0.82; }
  .ri-top { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
  .sev { font-size: 9.5px; font-weight: 700; padding: 1px 6px; border-radius: 999px; }
  .sev.bad { background: var(--bad); color: #fff; }
  .sev.warn { background: var(--warn); color: #241a06; }
  .ctype { font-size: 10px; color: var(--ink-3); }
  .ctitle { font-size: 12.5px; font-weight: 600; }
  .cval { margin-left: auto; font-size: 11px; color: var(--ink-2); }
  .verdict { font-size: 9.5px; padding: 1px 7px; border-radius: 999px; background: #6f9bc41f; color: #a8c6e0; }
  .verdict.ok { background: #7fb06922; color: #a9d99a; }
  .verdict.no { background: #cf5f4a2e; color: #f0b0a2; }
  .cdetail { margin: 6px 0 0; font-size: 11.5px; color: var(--ink-2); line-height: 1.55; }
  .chint { margin: 5px 0 0; font-size: 11px; line-height: 1.5; }
  .chint span { color: var(--ink-3); }
  .vactions { display: flex; align-items: center; gap: 7px; margin-top: 9px; }
  .okbtn { font-size: 11px; padding: 3px 12px; background: #7fb06920; border-color: #7fb06955; color: #b6dca8; }
  .okbtn:hover:not(:disabled) { background: #7fb06933; }
  .nobtn { font-size: 11px; padding: 3px 12px; background: #cf5f4a16; border-color: #cf5f4a44; color: #f0b0a2; }
  .nobtn:hover:not(:disabled) { background: #cf5f4a2b; }

  .reviewfoot { margin-top: 15px; padding-top: 14px; border-top: 1px solid var(--line); display: flex; gap: 14px; align-items: flex-end; flex-wrap: wrap; }
  .notefield { flex: 1; min-width: 240px; display: flex; flex-direction: column; gap: 4px; }
  textarea { resize: vertical; min-height: 44px; font-size: 12px; }
  .batchacts { display: flex; gap: 7px; flex-wrap: wrap; }
</style>
