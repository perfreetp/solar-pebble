<script>
  import { PARAM_META, defaultParamsFor } from '../generator.js';
  import { SPECIES_LIST } from '../species.js';
  import { hslToHex } from '../color.js';

  let { app, store } = $props();

  let advanced = $state(false);

  const params = $derived(store.params);
  const species = $derived(SPECIES_LIST.find((s) => s.id === store.speciesId));

  const mainKeys = ['wingLength', 'wingWidth', 'hindRatio', 'spotDensity', 'spotSize'];
  const colorKeys = ['hueBase', 'hueWidth', 'saturation', 'lightness'];
  const detailKeys = ['veinDensity', 'marginBand', 'asymmetry'];

  const meta = (k) => PARAM_META.find((m) => m.key === k);

  function set(k, v) {
    app.setParams({ [k]: Number(v) });
  }

  function hueHex(k) {
    const p = params;
    return hslToHex(p[k], 0.75, k === 'hueBase' ? 0.55 : 0.5);
  }

  function resetParams() {
    app.setParams(defaultParamsFor(store.speciesId));
    app.generateAll();
  }

  let seedDraft = $state('');
  $effect(() => {
    seedDraft = store.seed;
  });

  function commitSeed() {
    const v = String(seedDraft || '').trim();
    if (!v) return;
    app.setSeed(v);
  }

  function onSeedKey(e) {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
      commitSeed();
    }
  }

  const activeSpec = $derived(store.variants[store.activeVariant] || null);
</script>

<aside class="panel">
  <div class="scroll">

    <section class="block">
      <h2>物种模板</h2>
      <div class="species">
        {#each SPECIES_LIST as sp (sp.id)}
          <button
            class="sp"
            class:active={store.speciesId === sp.id}
            onclick={() => app.setSpecies(sp.id)}
            title={`${sp.name} · ${sp.accent}
${sp.blurb}`}
          >
            <svg viewBox="0 0 44 32" aria-hidden="true">
              <path
                d={sp.id === 'swallowtail'
                  ? 'M22 17C16 15 8 9 4 3c7 0 12 3 16 8 3-6 7-9 12-9-1 7-5 12-9 15z'
                  : sp.id === 'nymphalid'
                    ? 'M22 17C15 16 7 11 4 5c6-2 12 0 16 6 3-7 8-10 13-9-1 7-5 11-10 15z'
                    : 'M22 17C16 15 9 10 5 4c6-1 11 1 15 7 3-7 8-10 12-9-1 7-4 12-8 15z'}
              />
              <path d={sp.id === 'swallowtail' ? 'M22 17c-5 1-11 6-13 12 5-1 9-4 12-9 2 5 5 8 9 9-1-7-4-11-8-12z' : 'M22 17c-6 1-11 6-12 12 5 0 10-3 13-8 2 5 5 8 9 9-1-7-4-12-9-13z'} />
            </svg>
            <span class="nm">{sp.name}</span>
          </button>
        {/each}
      </div>
      {#if species}
        <p class="blurb"><b>{species.accent}</b><br />{species.blurb}</p>
      {/if}
    </section>

    <section class="block">
      <h2>翅形与斑点</h2>
      {#each mainKeys as k (k)}
        {@const m = meta(k)}
        <label class="slider">
          <span class="lbl">
            {m.label}
            <b class="mono">{m.fmt(params[k])}</b>
          </span>
          <input type="range" min={m.min} max={m.max} step={m.step} value={params[k]} oninput={(e) => set(k, e.target.value)} />
        </label>
      {/each}
    </section>

    <section class="block">
      <h2>配色</h2>
      <div class="hue-strip">
        {#each [0, 60, 120, 180, 240, 300] as h}
          <span style:background={hslToHex(h, 0.7, 0.5)}></span>
        {/each}
        <div class="window" style:left={(params.hueBase - params.hueWidth / 2) / 3.6 + '%'} style:width={params.hueWidth / 3.6 + '%'}></div>
      </div>
      {#each colorKeys as k (k)}
        {@const m = meta(k)}
        <label class="slider">
          <span class="lbl">
            {m.label}
            <b class="mono">{m.fmt(params[k])}</b>
          </span>
          <input type="range" min={m.min} max={m.max} step={m.step} value={params[k]} oninput={(e) => set(k, e.target.value)} />
        </label>
      {/each}
      <div class="swatches palette-preview">
        {#if activeSpec}
          {#each activeSpec.wings[1].palette.tones as t, i}
            <span class="sw" style:background={hslToHex(t[0], t[1], t[2])} title={'色调 ' + (i + 1)}></span>
          {/each}
          <span class="sw" style:background={hslToHex(...activeSpec.wings[1].palette.spotLight)} title="浅斑"></span>
          <span class="sw" style:background={hslToHex(...activeSpec.wings[1].palette.spotDark)} title="深斑"></span>
        {/if}
      </div>
    </section>

    <section class="block">
      <button class="disclose" onclick={() => (advanced = !advanced)}>
        <span class:open={advanced}>▸</span> 细节参数
      </button>
      {#if advanced}
        {#each detailKeys as k (k)}
          {@const m = meta(k)}
          <label class="slider">
            <span class="lbl">
              {m.label}
              <b class="mono">{m.fmt(params[k])}</b>
            </span>
            <input type="range" min={m.min} max={m.max} step={m.step} value={params[k]} oninput={(e) => set(k, e.target.value)} />
          </label>
        {/each}
        <div class="note small dim">对称扰动是左右翅唯一允许的差异来源;调高会触发复核的对称告警。</div>
      {/if}
    </section>

    <section class="block seedblock">
      <h2>种子</h2>
      <div class="seed-row">
        <input class="mono" type="text" bind:value={seedDraft} onkeydown={onSeedKey} onblur={commitSeed} spellcheck="false" />
        <button class="primary" onclick={() => {
          commitSeed();
          app.generateAll();
        }}>生成</button>
      </div>
      <div class="seed-actions">
        <button class="ghost small" onclick={() => app.newSeed()}>随机新种子</button>
        <button class="ghost small" onclick={() => app.generateAll({ keepOverrides: true })} disabled={store.editedCount + store.lockedCount === 0}>
          按参数重算 · 保留改动
        </button>
      </div>
      {#if store.seedHistory.length}
        <div class="history">
          <span class="dim small">最近</span>
          {#each store.seedHistory.slice(0, 6) as s}
            <button class="chip mono" onclick={() => app.setSeed(s)}>{s}</button>
          {/each}
        </div>
      {/if}
    </section>
  </div>

  <footer class="foot">
    <button class="ghost small" onclick={resetParams}>恢复模板默认值</button>
  </footer>
</aside>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .scroll {
    overflow-y: auto;
    overflow-x: hidden;
    padding: 4px 14px 14px;
    flex: 1;
    min-height: 0;
    scrollbar-gutter: stable;
  }
  .block {
    padding: 11px 0;
    border-bottom: 1px solid var(--line);
    min-width: 0;
  }
  .block:last-child { border-bottom: none; }
  h2 {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-3);
    margin: 0 0 10px;
  }
  .species { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .sp {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 9px 6px 7px;
    min-width: 0;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    transition: all 120ms ease;
  }
  .sp:hover { border-color: var(--line-2); background: var(--panel-2); }
  .sp.active {
    border-color: var(--accent-2);
    background: linear-gradient(180deg, #d9a44117, #d9a44108);
    box-shadow: inset 0 0 0 1px #d9a44133;
  }
  .sp svg { width: 100%; max-width: 46px; height: 30px; fill: currentColor; color: var(--ink-3); flex-shrink: 0; }
  .sp.active svg { color: var(--accent); }
  .nm { font-size: 12px; font-weight: 600; letter-spacing: 0.04em; }
  .blurb { font-size: 11px; color: var(--ink-3); margin: 9px 0 0; line-height: 1.55; }
  .blurb b { color: var(--ink-2); font-weight: 500; }

  .slider { display: block; margin-bottom: 7px; }
  .lbl {
    display: flex;
    gap: 8px;
    min-width: 0;
    justify-content: space-between;
    align-items: baseline;
    font-size: 12px;
    color: var(--ink-2);
    margin-bottom: 1px;
  }
  .lbl b { font-weight: 500; color: var(--ink); font-size: 11px; }

  .hue-strip {
    position: relative;
    display: flex;
    height: 8px;
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 12px;
    opacity: 0.85;
  }
  .hue-strip > span { flex: 1; }
  .hue-strip .window {
    position: absolute;
    top: 0;
    bottom: 0;
    border: 1.5px solid #fff;
    border-radius: 4px;
    box-shadow: 0 0 0 1px #0008;
    opacity: 1;
    pointer-events: none;
  }
  .swatches { display: flex; gap: 5px; margin-top: 6px; }
  .sw { flex: 1; height: 18px; border-radius: 4px; border: 1px solid #0005; }

  .disclose {
    background: none;
    border: none;
    padding: 0;
    color: var(--ink-2);
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .disclose span { display: inline-block; transition: transform 120ms ease; font-size: 9px; }
  .disclose span.open { transform: rotate(90deg); }
  .note { margin-top: 8px; line-height: 1.5; }

  .seed-row { display: flex; gap: 6px; }
  .seed-row input { flex: 1; letter-spacing: 0.04em; }
  .seed-actions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
  .seed-actions button { flex: 1 1 auto; }
  .history { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-top: 9px; }
  .chip {
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 999px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    color: var(--ink-2);
  }
  .chip:hover { border-color: var(--accent-2); color: var(--ink); }

  .foot {
    padding: 9px 14px;
    border-top: 1px solid var(--line);
    background: var(--bg-2);
    display: flex;
    justify-content: flex-end;
  }
</style>
