<script>
  import { view, VIEWS, HOME_VIEW } from './lib/nav.js';
  import { store } from './lib/state.js';
  import { toasts } from './lib/ui.js';
  import TopBar from './components/TopBar.svelte';
  import Toasts from './components/Toasts.svelte';
  import Studio from './views/Studio.svelte';
  import Tasks from './views/Tasks.svelte';
  import Review from './views/Review.svelte';
  import Client from './views/Client.svelte';
  import { activeOrder, activeShot } from './lib/state.js';
  import { CAPS } from './lib/nav.js';

  let s = $derived($store);
  let order = $derived(activeOrder(s));
  let shot = $derived(activeShot(s));

  // Keep the visible view within what the current role may open.
  $effect(() => {
    const allowed = VIEWS.find((v) => v.key === $view)?.roles || [];
    if (!allowed.includes(s.role)) {
      view.set(HOME_VIEW[s.role] || 'studio');
    }
  });
</script>

<div class="app">
  <TopBar />
  <div class="stage">
    {#if $view === 'studio'}
      {#key `${shot?.id ?? 'none'}`}
        <Studio {shot} {order} readOnly={!CAPS[s.role]?.editScene} />
      {/key}
    {:else if $view === 'tasks'}
      <Tasks />
    {:else if $view === 'review'}
      <Review />
    {:else if $view === 'client'}
      <Client />
    {/if}
  </div>
</div>
<Toasts />

<style>
  .stage { min-height: 0; overflow: hidden; }
</style>
