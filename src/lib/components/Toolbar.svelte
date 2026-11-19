<script>
  import { LAYER_INFO } from '../scene.js';

  let { store, app, viewport, onSubmitted = () => {} } = $props();

  const tools = [
    { id: 'select', label: '选择', icon: '↖', hint: '点选翅室 / 拖动斑点' },
    { id: 'pan', label: '平移', icon: '✥', hint: '拖动平移画布' },
    { id: 'pickColor', label: '取色', icon: '◉', hint: '点翅室取其颜色' }
  ];

  let confirmClear = $state(false);
  $effect(() => {
    if (store.lockedCount + store.editedCount === 0) confirmClear = false;
  });

  function toggleLayer(k) {
    app.setLayers({ [k]: !store.layers[k] });
  }
</script>

<div class="bar">
  <div class="group">
    <button class="tool ico-only" onclick={() => app.undo()} disabled={store.undoDepth === 0} title={store.undoDepth ? `撤销：${store.undoLabel} (Ctrl+Z)` : '没有可撤销的操作'}>↶</button>
    <button class="tool ico-only" onclick={() => app.redo()} disabled={store.redoDepth === 0} title={store.redoDepth ? `重做：${store.redoLabel} (Ctrl+Shift+Z)` : '没有可重做的操作'}>↷</button>
  </div>

  <div class="divider"></div>

  <div class="group">
    {#each tools as t (t.id)}
      <button class="tool" class:active={store.tool === t.id} onclick={() => app.setTool(t.id)} title={`${t.label} — ${t.hint}`}>
        <span class="ico">{t.icon}</span>
        <span class="lbl">{t.label}</span>
      </button>
    {/each}
  </div>

  <div class="divider"></div>

  <div class="group layers">
    <span class="cap">分层</span>
    {#each LAYER_INFO as l (l.key)}
      <button class="layer" class:on={store.layers[l.key]} onclick={() => toggleLayer(l.key)} title={l.hint}>
        <span class="dot"></span>{l.label}
      </button>
    {/each}
  </div>

  <div class="divider"></div>

  <div class="group">
    <button class="ghost icon-btn" onclick={() => viewport?.fit?.()} title="适应窗口 (F)">⤢</button>
    <button class="ghost icon-btn" onclick={() => {
      const r = app.verifyDeterminism();
      app.toast(r.ok ? `确定性校验通过 · ${r.a.slice(0, 8)}` : '确定性校验失败', r.ok ? 'ok' : 'bad');
    }} title="校验确定性：用相同种子与参数重新生成两次,比对几何指纹">✓</button>
    <button class="ghost icon-btn" onclick={() => app.setSelection(null)} title="取消选择 (Ctrl+D)">✕</button>
    {#if store.lockedCount + store.editedCount > 0}
      {#if confirmClear}
        <span class="confirm">清空全部手工改动?此操作不可撤销</span>
        <button class="danger sm" onclick={() => { app.clearAllOverrides(); confirmClear = false; }}>确认清空</button>
        <button class="ghost sm" onclick={() => (confirmClear = false)}>取消</button>
      {:else}
        <button class="ghost warn" onclick={() => (confirmClear = true)}>清空手工改动 ({store.lockedCount + store.editedCount})</button>
      {/if}
    {/if}
  </div>

  <div class="spacer"></div>

  <div class="group status">
    <span class="pill">{store.lockedCount} 锁 / {store.editedCount} 改</span>
    <button
      class="primary submit"
      onclick={() => {
        if (!store.variants.length) return;
        app.submitToBatch();
        app.toast(`变体 ${store.activeVariant + 1} 已提交到批次`, 'ok');
        onSubmitted();
      }}
      disabled={!store.variants.length}
      title="把当前变体提交到批次,系统随即自动质检"
    >
      进批次
    </button>
  </div>
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 11px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    flex-wrap: wrap;
  }
  .group { display: flex; align-items: center; gap: 3px; }
  .divider { width: 1px; height: 20px; background: var(--line); }
  .spacer { flex: 1; }
  .tool {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 9px;
    background: transparent;
    border: 1px solid transparent;
    color: var(--ink-2);
    border-radius: 6px;
    font-size: 12px;
  }
  .tool:hover { background: var(--panel-2); color: var(--ink); }
  .tool.active { background: var(--panel-3); border-color: var(--line-2); color: var(--ink); }
  .ico { font-size: 13px; line-height: 1; opacity: 0.85; }
  .ico-only { font-size: 15px; padding: 3px 8px; line-height: 1; }
  .ico-only:disabled { opacity: 0.3; }
  .cap {
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-3);
    margin-right: 5px;
  }
  .layer {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11.5px;
    padding: 4px 8px;
    background: transparent;
    border: 1px solid var(--line);
    border-radius: 999px;
    color: var(--ink-3);
  }
  .layer .dot { width: 6px; height: 6px; border-radius: 50%; background: #3c4438; }
  .layer.on { color: var(--ink-2); border-color: var(--line-2); }
  .layer.on .dot { background: var(--accent); }
  .layer:hover { color: var(--ink); }
  .ghost { background: transparent; border-color: transparent; color: var(--ink-2); font-size: 12px; padding: 5px 8px; }
  .ghost:hover:not(:disabled) { background: var(--panel-2); }
  .ghost.warn { color: var(--warn); }
  .confirm { font-size: 11px; color: var(--warn); }
  .sm { font-size: 11px; padding: 3px 9px; }
  .status { gap: 8px; }
  .icon-btn { width: 27px; padding: 4px 0; text-align: center; }
  .submit { font-size: 12px; padding: 5px 14px; white-space: nowrap; }
  .pill {
    font-size: 10.5px;
    color: var(--ink-3);
    background: var(--bg-2);
    border: 1px solid var(--line);
    padding: 3px 9px;
    border-radius: 999px;
    white-space: nowrap;
  }
</style>
