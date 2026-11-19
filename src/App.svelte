<script>
  import { createAppState } from './lib/appState.svelte.js';
  import Viewport from './lib/components/Viewport.svelte';
  import GeneratorPanel from './lib/components/GeneratorPanel.svelte';
  import InspectorPanel from './lib/components/InspectorPanel.svelte';
  import VariantStrip from './lib/components/VariantStrip.svelte';
  import Toolbar from './lib/components/Toolbar.svelte';
  import BatchPanel from './lib/components/BatchPanel.svelte';
  import ReviewPanel from './lib/components/ReviewPanel.svelte';
  import { buildAssetPack, downloadBlob } from './lib/export.js';

  const app = createAppState();
  const st = app.state;
  let tab = $state('generator');
  let viewport = $state(null);
  let exporting = $state(null);

  app.requestExport = async () => {
    exporting = { progress: 0 };
    try {
      const { blob, name, entries } = await buildAssetPack(app, st, (p) => (exporting = { progress: p }));
      downloadBlob(blob, name);
      app.toast(`素材包已导出 · ${entries} 个条目`, 'ok');
      app.pushLog(`放行并导出素材包 · ${entries} 个条目`);
    } catch (err) {
      console.error(err);
      app.toast('导出失败:' + err.message, 'bad');
    } finally {
      exporting = null;
    }
  };

  // Dev-only hook so the E2E harness can drive the same API the UI uses.
  // Stripped from production builds.
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    window.__winglab = { app, store: st };
  }

  const blocked = $derived(app.batchSummary().blocking);
  const entryCount = $derived(st.batch.entries.length);
</script>

<div class="shell">
  <header class="top">
    <div class="brand">
      <svg viewBox="0 0 32 26" class="mark" aria-hidden="true">
        <path d="M16 13C11 11 5 7 2 2c5 0 9 2 12 6 2-4 5-6 9-6-1 5-4 9-7 11z" />
        <path d="M16 13c-4 1-8 5-9 9 4-1 7-3 9-7 2 4 4 6 7 7-1-5-3-8-7-9z" />
      </svg>
      <div class="bt">
        <strong>翅纹工坊</strong>
        <span class="sub">Lepidoptera Wing Lab · 文创过程式生成</span>
      </div>
    </div>

    <nav>
      <button class:active={tab === 'generator'} onclick={() => (tab = 'generator')}>
        生成器
        {#if st.lockedCount + st.editedCount}<span class="nb">{st.lockedCount + st.editedCount}</span>{/if}
      </button>
      <button class:active={tab === 'batch'} onclick={() => (tab = 'batch')}>
        批次
        {#if entryCount}<span class="nb">{entryCount}</span>{/if}
        {#if blocked}<span class="nb bad">{blocked}</span>{/if}
      </button>
      <button class:active={tab === 'review'} onclick={() => (tab = 'review')}>复核</button>
    </nav>

    <div class="right">
      <span class="seed mono small dim">种子 {st.seed}</span>
    </div>
  </header>

  {#if tab === 'generator'}
    <div class="work">
      <GeneratorPanel {app} store={st} />
      <div class="center">
        <Toolbar store={st} {app} viewport={viewport} onSubmitted={() => (tab = 'batch')} />
        <div class="stage">
          <Viewport bind:this={viewport} store={st} {app} />
        </div>
        <VariantStrip {app} store={st} onSubmitted={() => (tab = 'batch')} />
      </div>
      <InspectorPanel {app} store={st} />
    </div>
  {:else if tab === 'batch'}
    <div class="page">
      <BatchPanel {app} store={st} />
    </div>
  {:else}
    <div class="page">
      <ReviewPanel {app} store={st} />
    </div>
  {/if}

  {#if st.toast}
    <div class="toast" class:ok={st.toast.kind === 'ok'} class:warn={st.toast.kind === 'warn'} class:bad={st.toast.kind === 'bad'}>
      {st.toast.msg}
    </div>
  {/if}

  {#if exporting}
    <div class="modal">
      <div class="mbox">
        <h3>正在打包素材</h3>
        <div class="bar"><div style:width={Math.round(Math.min(1, exporting.progress) * 100) + '%'}></div></div>
        <p class="dim small">生成分层 SVG、2048px PNG 与生成记录…</p>
      </div>
    </div>
  {/if}
</div>

<style>
  .shell { display: grid; grid-template-rows: 50px 1fr; height: 100%; }
  .top {
    display: flex;
    align-items: center;
    gap: 26px;
    padding: 0 16px;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .brand { display: flex; align-items: center; gap: 10px; }
  .mark { width: 26px; height: 21px; fill: var(--accent); }
  .bt strong { display: block; font-size: 13.5px; letter-spacing: 0.03em; }
  .sub { display: block; font-size: 9.5px; color: var(--ink-3); letter-spacing: 0.05em; }
  nav { display: flex; gap: 3px; }
  nav button {
    display: flex;
    align-items: center;
    gap: 6px;
    border: none;
    background: transparent;
    color: var(--ink-3);
    padding: 6px 15px;
    border-radius: 7px;
    font-size: 12.5px;
  }
  nav button:hover { color: var(--ink-2); background: var(--panel-2); }
  nav button.active { background: var(--panel-3); color: var(--ink); }
  .nb {
    font-size: 9px;
    background: #ffffff14;
    color: var(--ink-2);
    padding: 0 5px;
    border-radius: 999px;
    line-height: 15px;
  }
  .nb.bad { background: #cf5f4a3a; color: #f0b0a2; }
  .right { margin-left: auto; display: flex; align-items: center; gap: 14px; }

  .work {
    display: grid;
    grid-template-columns: 286px minmax(0, 1fr) 268px;
    gap: 10px;
    padding: 10px;
    min-height: 0;
  }
  .center { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 9px; min-height: 0; min-width: 0; }
  .stage { min-height: 0; }
  .page { height: 100%; padding: 10px; min-height: 0; }
  .page > :global(*) { height: 100%; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }

  .toast {
    position: fixed;
    bottom: 22px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--panel-3);
    border: 1px solid var(--line-2);
    padding: 9px 18px;
    border-radius: 999px;
    font-size: 12px;
    box-shadow: var(--shadow);
    z-index: 50;
  }
  .toast.ok { border-color: #7fb06966; color: #c3e3b4; }
  .toast.warn { border-color: #e0a33e66; color: #f0cd85; }
  .toast.bad { border-color: #cf5f4a66; color: #f0b0a2; }

  .modal { position: fixed; inset: 0; background: #000a; display: grid; place-items: center; z-index: 60; backdrop-filter: blur(2px); }
  .mbox { background: var(--panel); border: 1px solid var(--line-2); border-radius: 12px; padding: 22px 26px; width: 340px; box-shadow: var(--shadow); }
  .mbox h3 { margin: 0 0 14px; font-size: 14px; }
  .bar { height: 5px; background: var(--bg-2); border-radius: 3px; overflow: hidden; margin-bottom: 10px; }
  .bar div { height: 100%; background: var(--accent); transition: width 200ms ease; }
  .mbox p { margin: 0; }

  @media (max-width: 1360px) {
    .work { grid-template-columns: 252px minmax(0, 1fr) 236px; }
  }
  @media (max-width: 1120px) {
    .work { grid-template-columns: 236px minmax(0, 1fr); }
    .work > :global(:last-child) { display: none; }
    .center { grid-template-rows: auto minmax(0, 1fr) auto; }
  }
  @media (max-width: 900px) {
    .work { grid-template-columns: minmax(0, 1fr); }
    .work > :global(:first-child) { display: none; }
  }
  @media (max-height: 760px) {
    .shell { grid-template-rows: 46px 1fr; }
    .top { gap: 16px; }
    .sub { display: none; }
  }
</style>
