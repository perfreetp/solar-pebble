<script>
  import { summarize } from '../validation.js';
  import { specimenToSvg } from '../svgExport.js';

  function formatVal(c) {
    if (c.check === 'symmetry') return c.value.toFixed(2) + '%';
    if (c.check === 'density' && c.key.includes('balance')) return c.value.toFixed(2) + '×';
    if (c.check === 'density') return c.value.toFixed(2) + '%';
    if (c.key === 'contrast-palette') return (c.value * 100).toFixed(1) + '%';
    return c.value.toFixed(2) + ':1';
  }

  let { app, store } = $props();

  const entries = $derived.by(() =>
    store.batch.entries.map((e) => ({
      ...e,
      thumb: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(specimenToSvg(e.specimen, { background: 'transparent' }))
    }))
  );
  const summary = $derived(app.batchSummary());

  const sevLabel = (s) => (s === 'blocking' ? '阻断' : '警告');
  const statusLabel = (s) => ({ pending: '待复核', approved: '已通过', rejected: '已驳回' })[s];
  const typeLabel = (c) => ({ symmetry: '对称', density: '密度', contrast: '对比' })[c] || c;

  let expanded = $state(null);
  $effect(() => {
    if (store.batchSelected) expanded = store.batchSelected;
  });

  const selected = $derived(entries.find((e) => e.id === expanded) || null);

  function exportPack() {
    app.requestExport?.();
  }
</script>

<div class="batch">
  <header class="bhead">
    <div>
      <h2>批次 <span class="mono id">#{store.batch.id}</span></h2>
      <p class="dim small">提交后系统自动检查左右对称、斑点密度、颜色对比度。阻断项必须清零才可放行。</p>
    </div>
    <div class="counters">
      <span class="cnt"><b>{summary.total}</b> 条目</span>
      <span class="cnt bad"><b>{summary.blocking}</b> 阻断</span>
      <span class="cnt warn"><b>{summary.warning}</b> 警告</span>
      <span class="cnt ok"><b>{summary.rejected === 0 ? '0' : summary.rejected}</b> 驳回</span>
    </div>
  </header>

  {#if !entries.length}
    <div class="empty">
      <div class="big">⬚</div>
      <h3>批次里还没有条目</h3>
      <p>在生成器里挑一个满意的变体,点「进批次」提交。</p>
    </div>
  {:else}
    <div class="split">
      <ul class="list">
        {#each entries as e (e.id)}
          {@const s = e.summary}
          <li>
            <button class="row" class:sel={expanded === e.id} onclick={() => (expanded = e.id)}>
              <img src={e.thumb} alt="" />
              <div class="rinfo">
                <div class="r1">
                  <b>{e.specimen.speciesName}</b>
                  <span class="mono dim small">{e.specimen.seed} · V{e.specimen.variant + 1}</span>
                </div>
                <div class="r2">
                  {#if s.blocking}<span class="tag bad">{s.blocking} 阻断</span>{/if}
                  {#if s.warning}<span class="tag warn">{s.warning} 警告</span>{/if}
                  {#if !s.total}<span class="tag ok">无问题</span>{/if}
                </div>
              </div>
              <span class="st" class:pending={e.review.status === 'pending'} class:approved={e.review.status === 'approved'} class:rejected={e.review.status === 'rejected'}>
                {statusLabel(e.review.status)}
              </span>
            </button>
          </li>
        {/each}
      </ul>

      {#if selected}
        {@const s = selected.summary}
        <div class="detail">
          <div class="dhead">
            <div>
              <div class="eyebrow">
                <span class="st" class:pending={selected.review.status === 'pending'} class:approved={selected.review.status === 'approved'} class:rejected={selected.review.status === 'rejected'}>
                  {statusLabel(selected.review.status)}
                </span>
                <span class="mono small dim">条目 {selected.id}</span>
              </div>
              <h3>{selected.specimen.speciesName} · 变体 {selected.specimen.variant + 1} <span class="vn">{selected.specimen.variantLabel}</span></h3>
              <span class="mono small dim">种子 {selected.specimen.seed} · 指纹 {selected.specimen.fingerprint.slice(0, 10)}</span>
            </div>
            <div class="dhead-actions">
              <button class="ghost small" onclick={() => app.removeEntry(selected.id)}>移出批次</button>
              {#if selected.review.status === 'rejected'}
                <button class="primary small" onclick={() => app.resubmit(selected.id)}>退回制作员修改</button>
              {/if}
            </div>
          </div>

          <div class="cols">
            <div class="col-preview">
              <img class="thumb-lg" src={selected.thumb} alt="" />
              <dl class="specs">
                <dt>翅室</dt><dd class="mono">{selected.specimen.wings.reduce((n, w) => n + w.cells.length, 0)}</dd>
                <dt>斑点</dt><dd class="mono">{selected.specimen.wings.reduce((n, w) => n + w.spots.length, 0)}</dd>
                <dt>手工改动</dt><dd class="mono">{Object.keys(selected.overrides?.cells || {}).length + Object.keys(selected.overrides?.spots || {}).length}</dd>
                <dt>提交</dt><dd class="mono small">{new Date(selected.submittedAt).toLocaleTimeString('zh-CN', { hour12: false })}</dd>
              </dl>
            </div>

            <div class="col-checks">
              <h4>
                自动检查
                {#if !selected.checks.length}
                  <span class="ok-pill">全部通过</span>
                {:else}
                  {#if s.blocking}<span class="bad-pill">{s.blocking} 阻断</span>{/if}
                  {#if s.warning}<span class="warn-pill">{s.warning} 警告</span>{/if}
                {/if}
              </h4>
              {#if !selected.checks.length}
                <div class="pass">
                  <span class="check">✓</span>
                  <p class="small">左右对称偏差、斑点密度、颜色对比度均在阈值内,可直接送复核。</p>
                </div>
              {:else}
                <ul class="checks">
                  {#each selected.checks as c (c.key)}
                    <li class="check-item" class:blocking={c.severity === 'blocking'}>
                      <div class="ctop">
                        <span class="sev" class:bad={c.severity === 'blocking'} class:warn={c.severity === 'warning'}>{sevLabel(c.severity)}</span>
                        <span class="ctype">{typeLabel(c.check)}</span>
                        <b class="ctitle">{c.title}</b>
                        <span class="cval mono">{formatVal(c)}</span>
                      </div>
                      <p class="cdetail">{c.detail}</p>
                      <p class="chint dim"><span>建议</span> {c.hint}</p>
                    </li>
                  {/each}
                </ul>
              {/if}
              <p class="hintline dim small">复核在「复核」模块逐条确认。阻断项必须清零才能放行。</p>
            </div>
          </div>

          <section class="overview">
            <h4>整批检查一览</h4>
            <table>
              <thead>
                <tr><th>条目</th><th>对称</th><th>密度</th><th>对比</th><th>状态</th></tr>
              </thead>
              <tbody>
                {#each entries as e (e.id)}
                  {@const byCheck = (k) => e.checks.filter((c) => c.check === k)}
                  <tr class:sel={e.id === selected.id} onclick={() => (expanded = e.id)}>
                    <td class="who"><span class="who-nm">{e.specimen.speciesName}</span> <span class="mono dim">V{e.specimen.variant + 1}</span></td>
                    {#each ['symmetry', 'density', 'contrast'] as k}
                      {@const items = byCheck(k)}
                      <td class="ck">
                        {#if !items.length}
                          <span class="cell-ok" title="通过">✓</span>
                        {:else}
                          {@const worst = items.some((c) => c.severity === 'blocking') ? 'blocking' : 'warning'}
                          <span class="mini" class:bad={worst === 'blocking'} class:warn={worst === 'warning'}
                            title={items.map((c) => `${c.title}：${c.detail}`).join('  /  ')}>
                            {worst === 'blocking' ? '阻' : '警'}{items.length > 1 ? items.length : ''}
                          </span>
                        {/if}
                      </td>
                    {/each}
                    <td><span class="st" class:pending={e.review.status === 'pending'} class:approved={e.review.status === 'approved'} class:rejected={e.review.status === 'rejected'}>{statusLabel(e.review.status)}</span></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </section>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .batch { display: flex; flex-direction: column; min-height: 0; height: 100%; }
  .bhead {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 20px;
    padding: 16px 18px;
    border-bottom: 1px solid var(--line);
    flex-wrap: wrap;
  }
  .bhead h2 { font-size: 15px; margin: 0 0 5px; font-weight: 600; }
  .id { color: var(--ink-3); font-weight: 400; font-size: 12px; }
  .bhead p { margin: 0; line-height: 1.5; }
  .counters { display: flex; gap: 8px; }
  .cnt {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    font-size: 10px;
    color: var(--ink-3);
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 5px 11px;
    min-width: 54px;
  }
  .cnt b { font-size: 15px; color: var(--ink); font-family: ui-monospace, monospace; }
  .cnt.bad b { color: #e8896f; }
  .cnt.warn b { color: var(--warn); }
  .cnt.ok b { color: var(--ok); }

  .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: var(--ink-3); }
  .empty .big { font-size: 40px; opacity: 0.25; }
  .empty h3 { margin: 0; font-size: 14px; color: var(--ink-2); }
  .empty p { margin: 0; font-size: 12px; }

  .split { display: grid; grid-template-columns: 300px minmax(0, 1fr); min-height: 0; flex: 1; }
  .list { list-style: none; margin: 0; padding: 8px; overflow-y: auto; border-right: 1px solid var(--line); }
  .list li { margin-bottom: 4px; }
  .row {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    text-align: left;
    padding: 6px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .row:hover { border-color: var(--line-2); }
  .row.sel { border-color: var(--accent-2); background: var(--panel-2); }
  .row img { width: 46px; height: 34px; border-radius: 4px; object-fit: cover; background: #14170f; flex-shrink: 0; }
  .rinfo { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .r1 { display: flex; align-items: baseline; gap: 6px; }
  .r1 b { font-size: 12px; }
  .r2 { display: flex; gap: 4px; flex-wrap: wrap; }
  .tag { font-size: 9px; padding: 1px 6px; border-radius: 999px; font-weight: 600; }
  .tag.bad { color: #f0b0a2; background: #cf5f4a2e; }
  .tag.warn { color: #f0cd85; background: #e0a33e26; }
  .tag.ok { color: #a9d99a; background: #7fb06926; }
  .st { font-size: 9.5px; padding: 2px 7px; border-radius: 999px; white-space: nowrap; }
  .st.pending { background: #6f9bc41f; color: #a8c6e0; }
  .st.approved { background: #7fb06922; color: #a9d99a; }
  .st.rejected { background: #cf5f4a2e; color: #f0b0a2; }

  .detail { padding: 16px 18px; overflow-y: auto; min-height: 0; }
  .eyebrow { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .vn {
    font-size: 10px;
    font-weight: 500;
    color: var(--ink-3);
    background: var(--panel-3);
    border: 1px solid var(--line);
    padding: 0 6px;
    border-radius: 4px;
    vertical-align: 2px;
    margin-left: 4px;
  }
  .dhead-actions { display: flex; gap: 6px; }
  .cols { display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: 18px; align-items: start; }
  .thumb-lg { width: 100%; border-radius: 8px; border: 1px solid var(--line); background: radial-gradient(circle at 50% 40%, #1e2219, #14170f); display: block; }
  .specs { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin: 10px 0 0; font-size: 11px; }
  .specs dt { color: var(--ink-3); }
  .specs dd { margin: 0; text-align: right; color: var(--ink-2); }
  .col-checks h4 { display: flex; align-items: center; gap: 7px; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-3); margin: 0 0 9px; }
  .ok-pill { font-size: 9px; letter-spacing: 0; text-transform: none; color: #a9d99a; background: #7fb06922; padding: 1px 7px; border-radius: 999px; font-weight: 600; }
  .bad-pill { font-size: 9px; letter-spacing: 0; text-transform: none; color: #f0b0a2; background: #cf5f4a2e; padding: 1px 7px; border-radius: 999px; font-weight: 600; }
  .warn-pill { font-size: 9px; letter-spacing: 0; text-transform: none; color: #f0cd85; background: #e0a33e26; padding: 1px 7px; border-radius: 999px; font-weight: 600; }
  .hintline { margin: 12px 0 0; }
  .pass p { margin: 0; }
  .thumb-lg { width: 210px; aspect-ratio: 168 / 122; flex-shrink: 0; border-radius: 8px; border: 1px solid var(--line); object-fit: contain; background: radial-gradient(circle at 50% 40%, #1e2219, #14170f); }
  .dhead { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
  .dhead h3 { font-size: 14px; margin: 0 0 3px; font-weight: 600; }
  .pass { display: flex; gap: 12px; align-items: flex-start; padding: 14px; background: #7fb06912; border: 1px solid #7fb06933; border-radius: 8px; }
  .pass p { margin: 3px 0 0; }
  .check { color: var(--ok); font-size: 18px; line-height: 1; }

  .checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .check-item {
    padding: 10px 12px;
    background: #e0a33e0f;
    border: 1px solid #e0a33e30;
    border-left: 3px solid var(--warn);
    border-radius: 6px;
  }
  .check-item.blocking { background: #cf5f4a10; border-color: #cf5f4a3a; border-left-color: var(--bad); }
  .ctop { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
  .sev { font-size: 9.5px; font-weight: 700; letter-spacing: 0.05em; padding: 1px 6px; border-radius: 999px; }
  .sev.bad { background: #cf5f4a; color: #fff; }
  .sev.warn { background: #e0a33e; color: #241a06; }
  .ctype { font-size: 10px; color: var(--ink-3); }
  .ctitle { font-size: 12.5px; font-weight: 600; }
  .cval { margin-left: auto; font-size: 11px; color: var(--ink-2); }
  .cdetail { margin: 6px 0 0; font-size: 11.5px; color: var(--ink-2); line-height: 1.55; }
  .chint { margin: 5px 0 0; font-size: 11px; line-height: 1.5; }
  .chint span { color: var(--ink-3); }
  .overview { margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--line); }
  .overview h4 { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-3); margin: 0 0 9px; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  th { text-align: left; font-weight: 500; color: var(--ink-3); font-size: 10px; padding: 0 8px 6px; border-bottom: 1px solid var(--line); }
  td { padding: 6px 8px; border-bottom: 1px solid #ffffff08; }
  tbody tr { cursor: pointer; }
  tbody tr:hover { background: #ffffff06; }
  tbody tr.sel { background: #d9a4410f; }
  .who { white-space: nowrap; }
  .who-nm { font-weight: 600; }
  .cell-ok { color: var(--ok); }
  .mini {
    display: inline-block;
    font-size: 9px;
    font-weight: 700;
    width: 16px;
    height: 16px;
    line-height: 16px;
    text-align: center;
    border-radius: 4px;
    margin-right: 3px;
  }
  .mini.warn { background: #e0a33e26; color: #f0cd85; }
  .mini.bad { background: #cf5f4a33; color: #f0b0a2; }
</style>
