<script>
  import { toasts } from '../lib/ui.js';
</script>

<div class="toast-wrap" aria-live="polite">
  {#each $toasts as t (t.id)}
    <div class="toast {t.kind === 'ok' ? 'ok' : t.kind === 'err' ? 'err' : ''}">
      <span class="ico"></span>
      <span>{t.message}</span>
    </div>
  {/each}
</div>
