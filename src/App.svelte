<script>
  import EditorView from './views/EditorView.svelte';
  import ReviewView from './views/ReviewView.svelte';
  import CompareView from './views/CompareView.svelte';

  const ROUTES = ['editor', 'review', 'compare'];
  const initialRoute = ROUTES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'editor';
  let route = $state({ name: initialRoute });

  function go(name) {
    route.name = name;
    location.hash = name;
  }

  $effect(() => {
    const onHash = () => {
      const n = location.hash.slice(1);
      if (ROUTES.includes(n)) route.name = n;
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  });

  const nav = [
    { id: 'editor', label: '🪲 建模工作台', sub: '界面 1' },
    { id: 'review', label: '📝 版本审核', sub: '界面 2' },
    { id: 'compare', label: '🔍 版本对比', sub: '界面 3' }
  ];
</script>

<div class="shell">
  <header class="topbar">
    <div class="brand">
      <span class="logo">🐞</span>
      <div>
        <strong>虫虫体素工坊</strong>
        <span class="muted">儿童昆虫科普 · 角色建模</span>
      </div>
    </div>
    <nav class="nav">
      {#each nav as item (item.id)}
        <button
          class:narrow={route.name === item.id}
          class:active={route.name === item.id}
          onclick={() => go(item.id)}
        >
          {item.label}<span class="nav-sub">{item.sub}</span>
        </button>
      {/each}
    </nav>
  </header>

  <main class="content">
    {#key route.name}
      {#if route.name === 'editor'}
        <EditorView />
      {:else if route.name === 'review'}
        <ReviewView />
      {:else}
        <CompareView />
      {/if}
    {/key}
  </main>
</div>

<style>
  .shell { display: flex; flex-direction: column; height: 100%; }
  .topbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 18px;
    background: #fff;
    border-bottom: 1px solid var(--line);
    gap: 12px; flex-wrap: wrap;
  }
  .brand { display: flex; align-items: center; gap: 10px; }
  .logo { font-size: 28px; }
  .brand strong { display: block; font-size: 16px; }
  .nav { display: flex; gap: 8px; }
  .nav button { display: flex; flex-direction: column; align-items: center; line-height: 1.3; }
  .nav-sub { font-size: 11px; opacity: .75; }
  .content { flex: 1; min-height: 0; padding: 14px; }
</style>
