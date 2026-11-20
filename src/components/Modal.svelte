<script>
  let { open = false, title = '', sub = '', width = 560, onclose, children, footer } = $props();

  function esc(e) {
    if (e.key === 'Escape') onclose?.();
  }
</script>

<svelte:window onkeydown={esc} />

{#if open}
  <div class="scrim" onclick={(e) => { if (e.target === e.currentTarget) onclose?.(); }} role="presentation">
    <div class="modal" style="max-width:{width}px" role="dialog" aria-modal="true" aria-label={title}>
      <div class="modal-head">
        <div>
          <div class="modal-title">{title}</div>
          {#if sub}<div class="modal-sub">{sub}</div>{/if}
        </div>
        <button class="x-btn" onclick={() => onclose?.()} aria-label="关闭">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="modal-body">{@render children?.()}</div>
      {#if footer}<div class="modal-foot">{@render footer()}</div>{/if}
    </div>
  </div>
{/if}
