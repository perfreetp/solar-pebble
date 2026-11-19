<script>
  import { specimenToSvg } from '../svgExport.js';
  import { computeStats, cellColor } from '../generator.js';
  import { runChecks, summarize } from '../validation.js';

  let { app, store, onSubmitted = () => {} } = $props();

  const variants = $derived(store.variants);

  function svgFor(spec) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(specimenToSvg(spec, { background: 'transparent' }));
  }

  const infos = $derived.by(() =>
    variants.map((spec, i) => {
      const stats = computeStats(spec);
      const ov = store.overridesByVariant[i];
      const locked = ov ? Object.values(ov.cells || {}).filter((c) => c.locked).length : 0;
      const edited = ov ? Object.keys(ov.cells || {}).filter((k) => ov.cells[k].hue != null).length + Object.keys(ov.spots || {}).length : 0;
      const checks = runChecks(spec, cellColor);
      return { stats, locked, edited, summary: summarize(checks) };
    })
  );

  let submitting = $state(null);

  function submit(i) {
    submitting = i;
    setTimeout(() => {
      app.submitToBatch(i);
      app.toast(`变体 ${i + 1} 已提交到批次`, 'ok');
      submitting = null;
      onSubmitted();
    }, 90);
  }
</script>

<div class="strip">
  <div class="head">
    <div class="title">
      <h2>变体对比</h2>
      <span class="dim small">同一组参数 · 4 个变体 · 选中一个继续打磨或提交</span>
    </div>
    <div class="meta dim small">
      种子 <b class="mono">{store.seed}</b>
    </div>
  </div>
  <div class="cards">
    {#each variants as spec, i (spec.id)}
      {@const info = infos[i]}
      <div class="card" class:active={store.activeVariant === i} role="button" tabindex="0"
        onclick={() => app.setActiveVariant(i)}
        onkeydown={(e) => e.key === 'Enter' && app.setActiveVariant(i)}>
        <div class="thumb">
          <img src={svgFor(spec)} alt={`变体 ${i + 1}`} draggable="false" />
          <span class="idx">V{i + 1} · {spec.variantLabel}</span>
          {#if info.summary.blocking}
            <span class="flag bad" title="有阻断项">{info.summary.blocking} 阻断</span>
          {:else if info.summary.warning}
            <span class="flag warn" title="有警告">{info.summary.warning} 警告</span>
          {:else}
            <span class="flag ok">通过</span>
          {/if}
          <span class="vnote" title={spec.variantNote}>{spec.variantNote}</span>
          {#if info.locked || info.edited}
            <span class="edits" title="手工改动">✎{info.locked ? ` ${info.locked}锁` : ''}{info.edited ? ` ${info.edited}改` : ''}</span>
          {/if}
        </div>
        <div class="info">
          <div class="stats mono">
            <span>{info.stats.cellCount} 室</span>
            <span>{info.stats.spotCount} 斑</span>
            <span>{spec.fingerprint.slice(0, 6)}</span>
          </div>
          <button class="submit" onclick={(e) => { e.stopPropagation(); submit(i); }} disabled={submitting != null}>
            {submitting === i ? '提交中…' : '进批次'}
          </button>
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .strip {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 11px 13px 12px;
  }
  .head { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 9px; gap: 12px; }
  .title { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  h2 {
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-3);
    margin: 0;
    font-weight: 600;
  }
  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 9px; }
  .card {
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow: hidden;
    cursor: pointer;
    transition: border-color 120ms ease, background 120ms ease;
    outline: none;
  }
  .card:hover { border-color: var(--line-2); background: var(--panel-2); }
  .card.active { border-color: var(--accent-2); box-shadow: 0 0 0 1px #d9a44159; }
  .thumb {
    position: relative;
    aspect-ratio: 168 / 122;
    background: radial-gradient(circle at 50% 40%, #1e2219, #14170f);
    display: grid;
    place-items: center;
    overflow: hidden;
  }
  .thumb img { width: 100%; height: 100%; object-fit: contain; display: block; pointer-events: none; }
  .idx {
    white-space: nowrap;
    position: absolute;
    top: 5px;
    left: 6px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--ink-3);
    background: #0d0f0cb3;
    padding: 1px 5px;
    border-radius: 4px;
  }
  .flag {
    position: absolute;
    top: 5px;
    right: 6px;
    font-size: 9px;
    padding: 1px 6px;
    border-radius: 999px;
    font-weight: 600;
  }
  .flag.ok { color: #a9d99a; background: #7fb06926; }
  .flag.warn { color: #f0cd85; background: #e0a33e26; }
  .flag.bad { color: #f0b0a2; background: #cf5f4a2e; }
  .vnote {
    position: absolute;
    bottom: 5px;
    right: 6px;
    font-size: 8.5px;
    color: #cfd4c4;
    background: #0d0f0cc9;
    padding: 1px 5px;
    border-radius: 4px;
    max-width: 88%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .edits {
    position: absolute;
    top: 22px;
    left: 6px;
    font-size: 9px;
    color: #f0cd85;
    background: #0d0f0ccc;
    padding: 1px 5px;
    border-radius: 4px;
  }
  .info { display: flex; align-items: center; justify-content: space-between; gap: 5px; padding: 5px 6px 6px; flex-wrap: wrap; }
  .stats { display: flex; gap: 6px; font-size: 9.5px; color: var(--ink-3); white-space: nowrap; min-width: 0; }
  .stats span { white-space: nowrap; }
  .stats span:last-child { color: #5f675c; letter-spacing: 0.03em; }
  .submit {
    font-size: 10.5px;
    padding: 3px 8px;
    border-radius: 5px;
    background: var(--panel-3);
    border: 1px solid var(--line-2);
    white-space: nowrap;
    color: var(--ink-2);
  }
  .card.active .submit { background: var(--accent); border-color: var(--accent-2); color: #241a06; font-weight: 600; }
  .card.active .submit:hover:not(:disabled) { background: #e7b452; }
</style>
