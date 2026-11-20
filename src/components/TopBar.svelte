<script>
  import { view, VIEWS, go, homeFor, roleLabel } from '../lib/nav.js';
  import { store, setRole, ROLES, ROLE_ORDER } from '../lib/state.js';
  import { toast } from '../lib/ui.js';

  const icons = {
    cube: 'M8 1.6l5.6 3.2v6.4L8 14.4 2.4 11.2V4.8L8 1.6zm0 1.6L4 5.2v5.6l4 2.3 4-2.3V5.2L8 3.2z',
    list: 'M2.6 4.2h10.8M2.6 8h10.8M2.6 11.8h6.6',
    check: 'M3 8.4l3.3 3.2L13.2 4.4',
    cart: 'M2 3h2l1.6 8h8M6.2 13.2a1 1 0 100-.1M12 13.2a1 1 0 100-.1'
  };

  let s = $derived($store);

  function switchRole(r) {
    setRole(r);
    const target = homeFor(r);
    view.set(target);
    toast(`已切换为${roleLabel(r)} · 进入「${VIEWS.find((v) => v.key === target)?.label}」`, 'ok', 2000);
  }

  function navTo(v) {
    const res = go(v.key);
    if (!res.ok) toast(res.reason, 'err');
  }

  function allowed(v) {
    return v.roles.includes(s.role);
  }
</script>

<header class="topbar">
  <div class="brand">
    <div class="brand-mark"></div>
    <div>
      <div class="brand-name">蚁筑 NESTWORKS</div>
      <div class="brand-sub">地下蚁巢 · 过程式场景平台</div>
    </div>
  </div>

  <nav class="nav">
    {#each VIEWS as v}
      <button
        class:on={$view === v.key}
        class:denied={!allowed(v)}
        onclick={() => navTo(v)}
        aria-disabled={!allowed(v)}
        title={allowed(v) ? v.label : `${roleLabel(s.role)}无权限进入`}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d={icons[v.icon]} stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        {v.label}
      </button>
    {/each}
  </nav>

  <div class="topbar-spacer"></div>

  <div class="role-switch">
    <span class="role-label">当前身份</span>
    <div class="role-seg" role="tablist" aria-label="身份切换">
      {#each ROLE_ORDER as r}
        <button
          class:on={s.role === r}
          role="tab"
          aria-selected={s.role === r}
          onclick={() => switchRole(r)}
        >{ROLES[r].label}</button>
      {/each}
    </div>
  </div>
</header>

<style>
  .nav button.denied { opacity: 0.4; }
  .nav button.denied:hover { color: var(--fg-2); }
</style>
