<script>
  let { label = '复制', text = '', title = '', cls = '' } = $props();
  let done = $state(false);

  async function run() {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e2) { /* noop */ }
      document.body.removeChild(ta);
    }
    done = true;
    setTimeout(() => (done = false), 1500);
  }
</script>

<button class="copybtn {done ? 'done' : ''} {cls}" onclick={run} title={title || text}>
  {#if done}
    <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><path d="M2.5 8.5L6 12l7.5-8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    已复制
  {:else}
    <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1.6" stroke="currentColor" stroke-width="1.6"/><path d="M11 3.4A1.9 1.9 0 009.1 2H3.9A1.9 1.9 0 002 3.9v5.2A1.9 1.9 0 003.4 11" stroke="currentColor" stroke-width="1.6"/></svg>
    {label}
  {/if}
</button>
