<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { NestScene, CHAMBER_COLORS } from '../lib/babylon/nestscene.js';
  import { generateNest, PARAM_DEFS, DEFAULT_PARAMS, normalizeParams, makeLockFromTunnel, CHAMBER_TYPES } from '../lib/nest/generate.js';
  import { encodeReproCode, decodeReproCode, normalizeSeed, makeSeed } from '../lib/nest/seed.js';
  import { SOIL_ORDER, SOIL_PRESETS } from '../lib/babylon/soilmaterials.js';
  import { store } from '../lib/state.js';
  import { toast } from '../lib/ui.js';
  import CopyButton from '../components/CopyButton.svelte';
  import Modal from '../components/Modal.svelte';

  let { shot, order, readOnly = false } = $props();

  let canvasEl;
  let wrapEl;
  let scene = null;
  let nest = $state(null);
  let params = $state({ ...DEFAULT_PARAMS });
  let seed = $state('QK7M-2XPA');
  let locks = $state({});
  let selected = $state(null);
  let soil = $state('dry');
  let cutOn = $state(true);
  let cutDepth = $state(0.52);
  let mode = $state('solid');
  let showCut = $state(true);
  let busy = $state(false);
  let genMs = $state(0);
  let seedLocked = $state(true);
  let reproOpen = $state(false);
  let reproInput = $state('');
  let lightAz = $state(35);
  let dirty = $state(false);
  let camLabel = $state('全景透视');

  // ---------- init from shot ----------
  function loadShot() {
    const p = normalizeParams(shot?.params || shot?.scene?.params || DEFAULT_PARAMS);
    params = { ...p };
    seed = normalizeSeed(shot?.seed || shot?.scene?.seed || makeSeed());
    locks = JSON.parse(JSON.stringify(shot?.locks || shot?.scene?.locks || {}));
    const sc = shot?.scene;
    soil = sc?.soil && SOIL_PRESETS[sc.soil] ? sc.soil : 'dry';
    mode = sc?.mode || 'solid';
    cutOn = sc?.cut ? !!sc.cut.enabled : true;
    cutDepth = sc?.cut?.depth ?? 0.52;
    lightAz = typeof sc?.light === 'number' ? sc.light : 35;
    camLabel = sc?.camera?.label || '全景透视';
    selected = null;
    dirty = false;
  }

  onMount(async () => {
    loadShot();
    scene = new NestScene(canvasEl);
    window.__nest = scene;
    scene.setSoil(soil);
    scene.onSelect = (id) => {
      selected = id;
      selected && scrollInspector();
    };
    scene.onEdit = (tunnelId, index, pos) => {
      handleManualEdit(tunnelId, index, pos);
    };
    rebuild(true);
    const ro = new ResizeObserver(() => scene?.resize());
    ro.observe(wrapEl);
    onDestroy(() => {
      ro.disconnect();
      scene?.dispose();
      scene = null;
    });
  });

  $effect(() => {
    // keep scene in sync when shot id changes externally
    if (shot?.id && nest && shot.id !== lastShotId) {
      lastShotId = shot.id;
      loadShot();
      rebuild(true);
    }
  });
  let lastShotId = $state(null);

  function scrollInspector() {
    tick().then(() => {
      document.getElementById('inspector')?.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // ---------- generation ----------
  function rebuild(fromLoad = false) {
    if (!scene) return;
    busy = true;
    const t0 = performance.now();
    const g = generateNest(params, seed, locks);
    nest = g;
    scene.setSoil(soil);
    scene.buildSoil(g);
    scene.buildNest(g);
    scene.applyMode(mode);
    scene.setCutaway(cutOn, cutDepth);
    scene.setLightAzimuth(lightAz);
    if (fromLoad) {
      const saved = shot?.scene?.camera?.state || null;
      if (saved) scene.applyCameraState(saved);
      else scene.frameTo('perspective', { animate: false });
    }
    genMs = Math.round(performance.now() - t0);
    busy = false;
  }

  function regenerate() {
    if (readOnly) return toast('只读视图，无法修改场景', 'err');
    const n = Object.keys(locks).length;
    rebuild(false);
    dirty = true;
    toast(n ? `已按新参数重算 · 保留 ${n} 条锁定甬道，其余重算` : '已按参数重新生成', 'ok');
  }

  function rerollSeed() {
    if (readOnly) return;
    if (!seedLocked) {
      toast('先锁定种子再换种子', 'err');
      return;
    }
    seed = makeSeed();
    rebuild(false);
    dirty = true;
    toast('已换新种子并重新生成');
  }

  function onSeedInput(e) {
    if (readOnly) return;
    const v = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9);
    seed = v;
  }

  function lockSeed(v) {
    seedLocked = v;
    if (v) toast('种子已锁定，可复制给同事复现', 'ok');
  }

  // ---------- manual edit / locks ----------
  function handleManualEdit(tunnelId, index, pos) {
    if (readOnly) return;
    const t = nest.tunnels.find((x) => x.id === tunnelId);
    if (!t) return;
    const points = t.points.map((p, i) => (i === index ? { ...pos } : { ...p }));
    const chamber = nest.chambers.find((c) => c.tunnelId === tunnelId);
    locks = { ...locks, [tunnelId]: makeLockFromTunnel({ ...t, points }, chamber) };
    dirty = true;
    rebuild(false);
    selected = tunnelId;
    toast(`甬道 ${tunnelId} 已改向并锁定`, 'ok');
  }

  function lockSelection() {
    if (!selected) return;
    const t = nest.tunnels.find((x) => x.id === selected);
    if (!t) {
      toast('分室随其甬道锁定，请选中甬道', 'err');
      return;
    }
    if (locks[t.id]) return toast('该甬道已锁定', 'err');
    const chamber = nest.chambers.find((c) => c.tunnelId === t.id);
    locks = { ...locks, [t.id]: makeLockFromTunnel(t, chamber) };
    dirty = true;
    rebuild(false);
    toast(`已锁定甬道 ${t.id}`, 'ok');
  }

  function unlock(id) {
    const next = { ...locks };
    delete next[id];
    locks = next;
    dirty = true;
    rebuild(false);
    toast(`已解锁 ${id}，下次生成将重算`);
  }

  function unlockAll() {
    locks = {};
    dirty = true;
    rebuild(false);
    toast('已清除全部锁定');
  }

  // ---------- selection info ----------
  let selTunnel = $derived(nest && selected ? nest.tunnels.find((t) => t.id === selected) : null);
  let selChamber = $derived(nest && selected ? nest.chambers.find((c) => c.id === selected) : null);
  let selChamberOfTunnel = $derived(nest && selTunnel ? nest.chambers.find((c) => c.tunnelId === selTunnel.id) : null);
  let lockList = $derived(Object.keys(locks));

  let counts = $derived(nest?.counts || { nursery: 0, granary: 0, fungus: 0 });

  // ---------- camera ----------
  function cam(mode) {
    scene?.frameTo(mode);
    if (mode === 'top') {
      camLabel = '俯视';
      // plan view: show the surface and entrance layout, not a sliced block
      if (cutOn) {
        cutOn = false;
        scene.setCutaway(false, cutDepth);
      }
    } else if (mode === 'front') {
      camLabel = '剖切正视';
      if (!cutOn) {
        cutOn = true;
        scene.setCutaway(true, cutDepth);
      }
    } else {
      camLabel = '全景透视';
    }
    dirty = true;
  }

  function toggleCut() {
    cutOn = !cutOn;
    scene.setCutaway(cutOn, cutDepth);
    dirty = true;
  }

  function onCutDepth(e) {
    cutDepth = Number(e.target.value) / 100;
    scene.setCutDepth(cutDepth);
    dirty = true;
  }

  function setSoil(k) {
    soil = k;
    scene.setSoil(k);
    scene.buildSoil(nest);
    scene.setCutaway(cutOn, cutDepth);
    dirty = true;
  }

  function setMode(m) {
    mode = m;
    scene.applyMode(m);
    dirty = true;
  }

  function onLight(e) {
    lightAz = Number(e.target.value);
    scene.setLightAzimuth(lightAz);
    dirty = true;
  }

  // ---------- repro code ----------
  function openRepro() {
    reproInput = encodeReproCode({ seed, params });
    reproOpen = true;
  }

  function applyRepro() {
    try {
      const out = decodeReproCode(reproInput);
      seed = out.seed;
      params = normalizeParams(out.params);
      locks = {};
      selected = null;
      reproOpen = false;
      rebuild(false);
      dirty = true;
      toast('已按复现码还原参数与种子', 'ok');
    } catch (e) {
      toast(e.message || '复现码无法解析', 'err');
    }
  }

  // ---------- save to shot ----------
  function saveShot() {
    if (!scene || !nest) return;
    const state = {
      seed,
      params: { ...params },
      locks: JSON.parse(JSON.stringify(locks)),
      preview: scene.snapshot(1100, 700),
      scene: {
        seed,
        params: { ...params },
        locks: JSON.parse(JSON.stringify(locks)),
        camera: { state: scene.getCameraState(), label: camLabel },
        soil,
        mode,
        cut: { enabled: cutOn, depth: cutDepth },
        light: lightAz
      },
      notes: shot?.notes || '',
      savedAt: new Date().toISOString()
    };
    store.update((s) => ({
      ...s,
      orders: s.orders.map((o) =>
        o.id !== order.id
          ? o
          : { ...o, shots: o.shots.map((sh) => (sh.id !== shot.id ? sh : { ...sh, ...state, status: sh.status === 'rejected' ? 'draft' : sh.status })) }
      )
    }));
    dirty = false;
    toast('镜头已保存 · 包含当前相机与场景参数', 'ok');
  }

  let paramNote = $derived(JSON.stringify(normalizeParams(params)) !== JSON.stringify(shot?.params ? normalizeParams(shot.params) : normalizeParams(DEFAULT_PARAMS)));

  function fmtVol(v) {
    return v >= 100 ? `${(v / 100).toFixed(1)} m³` : `${Math.round(v * 1000)} L`;
  }

  const STATUS_LABEL = { draft: '草稿', submitted: '待审', approved: '已通过', rejected: '已退回', delivered: '已交付' };

  // test/QA hooks for automated checks
  if (typeof window !== 'undefined') {
    window.__studio = {
      get scene() { return scene; },
      get nest() { return nest; },
      get selected() { return selected; },
      get locks() { return locks; },
      get params() { return params; },
      get seed() { return seed; },
      selectTunnel(id) { selected = id; scene?.select(id, true); },
      clickTunnel(id) { scene?.select(id); },
      simulateDrag(index, x, y, z) {
        if (!selTunnel) return false;
        handleManualEdit(selTunnel.id, index, { x, y, z });
        return true;
      },
      save: saveShot,
      setParams(p) { params = { ...params, ...p }; },
      regenerate,
      // QA: apply an exact seed+params pair and confirm the visible geometry
      reproSignature() {
        return JSON.stringify(nest?.tunnels.map((t) => [t.id, t.points]));
      },
      applySeedParams(nextSeed, nextParams) {
        seed = normalizeSeed(nextSeed);
        params = normalizeParams(nextParams);
        locks = {};
        rebuild(false);
        dirty = true;
        return this.reproSignature();
      },
      cam,
      setSoil,
      setMode,
      toggleCut
    };
  }
</script>

<svelte:head><title>场景制作 · 蚁筑 NESTWORKS</title></svelte:head>

<div class="studio">
  <!-- LEFT: parameters -->
  <aside class="rail left scroll">
    <div class="shot-head">
      <div class="shot-kicker">{order?.title}</div>
      <div class="shot-title">{shot?.label || '未选择镜头'}</div>
      <div class="shot-meta">
        <span class="chip {shot?.status || 'draft'}"><span class="dot"></span>{STATUS_LABEL[shot?.status] || '草稿'}</span>
        <span class="mono dim">{shot?.id}</span>
      </div>
    </div>

    <div class="sect">
      <div class="sect-head">
        <span>生成参数</span>
        <button class="btn sm ghost" onclick={() => { params = { ...DEFAULT_PARAMS }; }} disabled={readOnly}>恢复默认</button>
      </div>

      {#each PARAM_DEFS as def (def.key)}
        <div class="field param">
          <div class="field-label">
            <span>{def.label}</span>
            <span class="val">{params[def.key]}<em>{def.unit}</em></span>
          </div>
          <input
            type="range"
            min={def.min} max={def.max} step={def.step}
            value={params[def.key]}
            disabled={readOnly}
            oninput={(e) => {
              const v = Number(e.target.value);
              params = { ...params, [def.key]: def.step === 1 ? Math.round(v) : Math.round(v * 100) / 100 };
            }}
          />
          <div class="range-scale"><span>{def.min}</span><span>{def.max}</span></div>
        </div>
      {/each}

      <button class="btn primary block gen" onclick={regenerate} disabled={readOnly || busy}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13.2 8a5.2 5.2 0 11-1.6-3.7M13.2 2v3.2H10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        重新生成场景
      </button>
      {#if lockList.length}
        <div class="regen-note">
          <span class="chip locked"><svg width="8" height="8" viewBox="0 0 12 12" fill="none"><rect x="2.4" y="5.2" width="7.2" height="5.4" rx="1.2" stroke="currentColor" stroke-width="1.3"/><path d="M4.2 5.2V4a1.8 1.8 0 013.6 0v1.2" stroke="currentColor" stroke-width="1.3"/></svg>{lockList.length} 条已锁定</span>
          <span>重新生成时原样保留，其余重算</span>
        </div>
      {/if}
      <div class="gen-stat">
        <span>生成耗时 <b>{genMs}ms</b></span>
        <span>·</span>
        <span>甬道 <b>{nest?.stats.tunnels ?? 0}</b></span>
        <span>·</span>
        <span>分室 <b>{nest?.stats.chambers ?? 0}</b></span>
      </div>
    </div>

    <div class="sect">
      <div class="sect-head"><span>随机种子</span>{#if seedLocked}<span class="chip locked">已锁定</span>{:else}<span class="chip neutral">可改</span>{/if}</div>
      <div class="seed-row">
        <input
          type="text" class="mono seed-input"
          value={seed}
          disabled={seedLocked || readOnly}
          oninput={onSeedInput}
          spellcheck="false"
          aria-label="随机种子"
        />
        <button class="lockbtn {seedLocked ? 'on' : ''}" onclick={() => lockSeed(!seedLocked)} title={seedLocked ? '解锁种子' : '锁定种子'} disabled={readOnly}>
          {#if seedLocked}
            <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><rect x="2.4" y="5.2" width="7.2" height="5.4" rx="1.2" stroke="currentColor" stroke-width="1.3"/><path d="M4.2 5.2V4a1.8 1.8 0 013.6 0v1.2" stroke="currentColor" stroke-width="1.3"/></svg>
          {:else}
            <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><rect x="2.4" y="5.2" width="7.2" height="5.4" rx="1.2" stroke="currentColor" stroke-width="1.3"/><path d="M4.2 5.2V4a1.8 1.8 0 013.6 0" stroke="currentColor" stroke-width="1.3"/></svg>
          {/if}
        </button>
      </div>
      <div class="seed-actions">
        <button class="btn sm" onclick={rerollSeed} disabled={readOnly} title="换一个新种子">换一个</button>
        <CopyButton label="复制种子" text={seed} />
        <button class="btn sm ghost" onclick={openRepro}>复现码</button>
      </div>
      <p class="hint">同一随机种子 + 同一组参数，每次都生成完全一致的蚁巢。复现码同时携带种子和参数。</p>
    </div>

    <div class="sect">
      <div class="sect-head"><span>锁定甬道</span>{#if lockList.length}<button class="btn sm ghost" onclick={unlockAll} disabled={readOnly}>全部解锁</button>{/if}</div>
      {#if lockList.length === 0}
        <p class="hint">在视图中选中一条甬道，拖动亮色控制点即可改走向，改过的甬道会自动打上锁定标记。</p>
      {:else}
        <div class="lock-list">
          {#each lockList as id (id)}
            <div class="lock-item" class:sel={selected === id}>
              <button class="lock-id mono" onclick={() => { selected = id; scene?.select(id, true); }}>
                <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><rect x="2.4" y="5.2" width="7.2" height="5.4" rx="1.2" stroke="currentColor" stroke-width="1.3"/><path d="M4.2 5.2V4a1.8 1.8 0 013.6 0v1.2" stroke="currentColor" stroke-width="1.3"/></svg>
                {id}
              </button>
              <span class="dim">{locks[id]?.points?.length ?? 0} 点</span>
              <button class="unlock" onclick={() => unlock(id)} disabled={readOnly} title="解锁">✕</button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </aside>

  <!-- CENTER: viewport -->
  <main class="viewport" bind:this={wrapEl}>
    <canvas bind:this={canvasEl}></canvas>

    <div class="vp-top">
      <div class="vp-tools">
        <div class="seg small">
          <button class:on={mode === 'solid'} onclick={() => setMode('solid')}>实体</button>
          <button class:on={mode === 'flat'} onclick={() => setMode('flat')}>透视</button>
          <button class:on={mode === 'xray'} onclick={() => setMode('xray')}>X 光</button>
        </div>
        <div class="seg small">
          {#each SOIL_ORDER as k}
            <button class:on={soil === k} onclick={() => setSoil(k)}>
              <span class="swatch" style="background:{SOIL_PRESETS[k].base};display:inline-block;margin-right:5px;vertical-align:-1px"></span>{SOIL_PRESETS[k].label}
            </button>
          {/each}
        </div>
      </div>
      <div class="vp-tools">
        <button class="tbtn {cutOn ? 'on' : ''}" onclick={toggleCut} title="剖开土层">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2.5 5.5h11M2.5 10.5h11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M5 2.5l2 11M11 2.5l-2 11" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 2"/></svg>
          剖切
        </button>
      </div>
    </div>

    {#if cutOn}
      <div class="cut-slider">
        <span>剖切深度</span>
        <input type="range" min="2" max="98" value={Math.round(cutDepth * 100)} oninput={onCutDepth} />
        <span class="mono">{Math.round(cutDepth * 100)}%</span>
      </div>
    {/if}

    <div class="vp-bottom">
      <div class="cam-group">
        <button class:on={camLabel === '全景透视'} onclick={() => cam('perspective')}>全景</button>
        <button class:on={camLabel === '俯视'} onclick={() => cam('top')}>俯视</button>
        <button class:on={camLabel === '剖切正视'} onclick={() => cam('front')}>剖切正视</button>
      </div>
      <div class="light-group">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.3"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        <input type="range" min="0" max="360" value={lightAz} oninput={onLight} aria-label="方向光方位角" />
      </div>
    </div>

    <div class="vp-hint">
      {#if selected}
        <span class="chip locked">已选 {selected}</span>
        {#if selTunnel?.kind === 'branch'}<span>拖动控制点改走向 · 松开即锁定</span>{/if}
      {:else}
        <span>单击甬道或分室查看详情 · 拖动旋转视角 · 滚轮缩放</span>
      {/if}
      {#if lockList.length}
        <span class="legend"><i class="lg-locked"></i>已锁定 {lockList.length}</span>
      {/if}
    </div>

    {#if busy}<div class="busy"><span class="spinner"></span>生成中…</div>{/if}
  </main>

  <!-- RIGHT: inspector -->
  <aside class="rail right scroll" id="inspector">
    {#if selected && (selTunnel || selChamber)}
      <div class="ins-head">
        <div class="ins-kind">{selTunnel ? (selTunnel.kind === 'main' ? '主甬道' : '分支甬道') : '分室'}</div>
        <div class="ins-id mono">{selected}</div>
        <div class="ins-chips">
          {#if selTunnel?.locked || selChamber?.locked}<span class="chip locked">已锁定</span>{:else}<span class="chip neutral">未锁定</span>{/if}
          {#if selTunnel?.orphan || selChamber?.orphan}<span class="chip neutral">保留自旧参数</span>{/if}
        </div>
      </div>

      <div class="sect">
        <div class="sect-head"><span>参数</span></div>
        {#if selTunnel}
          <div class="kv"><span class="k">所属入口</span><span class="v">E{selTunnel.entrance}</span></div>
          <div class="kv"><span class="k">层级</span><span class="v">{selTunnel.tier ?? '贯通'}</span></div>
          <div class="kv"><span class="k">半径</span><span class="v">{selTunnel.radius} m</span></div>
          <div class="kv"><span class="k">控制点</span><span class="v">{selTunnel.points.length}</span></div>
          <div class="kv"><span class="k">连接分室</span><span class="v">{selChamberOfTunnel?.id || '—'}</span></div>
        {:else if selChamber}
          <div class="kv"><span class="k">类型</span><span class="v" style="color:{CHAMBER_TYPES[selChamber.type].color}">{CHAMBER_TYPES[selChamber.type].label}</span></div>
          <div class="kv"><span class="k">体积</span><span class="v">{fmtVol(selChamber.volume)}</span></div>
          <div class="kv"><span class="k">层级</span><span class="v">{selChamber.tier ?? '—'}</span></div>
          <div class="kv"><span class="k">主轴尺寸</span><span class="v">{selChamber.radii.x.toFixed(2)} × {selChamber.radii.y.toFixed(2)} × {selChamber.radii.z.toFixed(2)}</span></div>
          <div class="kv"><span class="k">所属甬道</span><span class="v">{selChamber.tunnelId}</span></div>
        {/if}
      </div>

      {#if selTunnel}
        <div class="sect">
          <div class="sect-head"><span>编辑</span></div>
          <p class="hint">拖动视口中的控制点改变走向。松开后自动锁定该甬道，并单独重算相连分室。</p>
          <div class="row2">
            {#if selTunnel.locked}
              <button class="btn danger block" onclick={() => unlock(selTunnel.id)} disabled={readOnly}>解锁并重算</button>
            {:else}
              <button class="btn teal block" onclick={lockSelection} disabled={readOnly}>锁定此甬道</button>
            {/if}
            <button class="btn ghost block" onclick={() => { scene?.focusOn(centerOf(selTunnel), 16); }}>聚焦</button>
          </div>
        </div>
      {/if}
      {#if selChamber}
        <div class="sect">
          <div class="sect-head"><span>编辑</span></div>
          <p class="hint">分室的类型与体积由大小自动分配：最大的分室为育幼室，中等为储粮室，较小为菌圃室。锁定其甬道可固定该分室的形态。</p>
          <div class="row2">
            <button class="btn ghost block" onclick={() => { scene?.focusOn(selChamber.center, 13); }}>聚焦</button>
            <button class="btn block" onclick={() => { const t = nest.tunnels.find((x) => x.id === selChamber.tunnelId); if (t) { selected = t.id; scene?.select(t.id, true); } }}>查看甬道</button>
          </div>
        </div>
      {/if}
    {:else}
      <div class="sect">
        <div class="sect-head"><span>场景概览</span></div>
        <div class="count-grid">
          {#each Object.keys(CHAMBER_TYPES) as k}
            <div class="count-cell">
              <span class="count-dot" style="background:{CHAMBER_COLORS[k].toHexString()}"></span>
              <div>
                <div class="count-num">{counts[k]}</div>
                <div class="count-lbl">{CHAMBER_TYPES[k].short}</div>
              </div>
            </div>
          {/each}
        </div>
        <div class="divider"></div>
        <div class="kv"><span class="k">入口</span><span class="v">{nest?.entrances.length ?? 0} 个</span></div>
        <div class="kv"><span class="k">巢深</span><span class="v">{nest?.soil.depth ?? 0} m</span></div>
        <div class="kv"><span class="k">层数</span><span class="v">{params.levels} 层</span></div>
        <div class="kv"><span class="k">总容积</span><span class="v">{fmtVol(nest?.stats.volume ?? 0)}</span></div>
        <div class="kv"><span class="k">锁定甬道</span><span class="v">{lockList.length} 条</span></div>
      </div>

      <div class="sect">
        <div class="sect-head"><span>入口 / 层级分布</span></div>
        <div class="entry-list">
          {#each nest?.entrances ?? [] as e (e.id)}
            <div class="entry-item">
              <span class="entry-id mono">{e.id}</span>
              <span class="dim mono">({e.x.toFixed(1)}, {e.z.toFixed(1)})</span>
              <button class="link" onclick={() => { scene?.focusOn({ x: e.x, y: -e.y * 0, z: e.z }, 22); }}>定位</button>
            </div>
          {/each}
        </div>
        <div class="divider"></div>
        <div class="tier-row">
          {#each nest?.tierYs ?? [] as y, i}
            <div class="tier-pill"><b>{i + 1}</b><span>{y.toFixed(1)}m</span></div>
          {/each}
        </div>
      </div>

      <div class="sect">
        <div class="sect-head"><span>点选提示</span></div>
        <ul class="tips">
          <li>单点甬道：选中后可拖动控制点</li>
          <li>拖动控制点：改走向 → 自动锁定</li>
          <li>改参数 + 重新生成：锁定条原样保留</li>
          <li>点空白处：取消选择</li>
        </ul>
      </div>
    {/if}

    <div class="save-bar">
      {#if dirty}<span class="dirty-dot" title="有未保存改动"></span>{/if}
      <button class="btn primary block" onclick={saveShot} disabled={!nest}>保存镜头</button>
    </div>
  </aside>
</div>

<Modal open={reproOpen} title="复现码" sub="把这段代码发给同事，粘贴到任意镜头的“复现码”里，即可得到完全一致的场景参数与种子。" onclose={() => (reproOpen = false)}>
  <div class="repro">
    <div class="repro-code mono">{reproInput}</div>
    <div class="row2">
      <CopyButton label="复制复现码" text={reproInput} />
      <span class="dim" style="font-size:11px">含种子 {seed} 与 {Object.keys(params).length} 项参数</span>
    </div>
    <div class="hr-label">从同事的复现码还原</div>
    <textarea rows="3" bind:value={reproInput} placeholder="NEST1.eyJ2IjoxLCJzIjoi..." class="mono"></textarea>
    <div class="row2" style="justify-content:flex-end">
      <button class="btn ghost" onclick={() => (reproOpen = false)}>取消</button>
      <button class="btn primary" onclick={applyRepro}>应用并生成</button>
    </div>
  </div>
</Modal>

<style>
  .studio {
    display: grid;
    grid-template-columns: 286px 1fr 296px;
    height: 100%;
    min-height: 0;
    background: var(--bg-0);
  }

  .rail { background: var(--bg-1); min-height: 0; display: flex; flex-direction: column; }
  .rail.left { border-right: 1px solid var(--line-soft); overflow-y: auto; overflow-x: hidden; }
  .rail.right { border-left: 1px solid var(--line-soft); position: relative; overflow-y: auto; overflow-x: hidden; padding-bottom: 70px; }

  .shot-head { padding: 14px 16px 12px; border-bottom: 1px solid var(--line-soft); }
  .shot-kicker { font-size: 10.5px; color: var(--fg-3); letter-spacing: 0.03em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .shot-title { font-size: 15px; font-weight: 640; margin-top: 2px; }
  .shot-meta { display: flex; align-items: center; gap: 8px; margin-top: 7px; font-size: 11px; }

  .sect { padding: 13px 16px; border-bottom: 1px solid var(--line-soft); }
  .sect-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 11px; font-size: 11px; font-weight: 600; letter-spacing: 0.05em; color: var(--fg-1); text-transform: uppercase; }

  .field.param { margin-bottom: 13px; }
  .range-scale { display: flex; justify-content: space-between; font-size: 9.5px; color: var(--fg-3); font-family: var(--mono); margin-top: 1px; }

  .gen { margin-top: 4px; height: 36px; font-size: 13px; }
  .regen-note { display: flex; flex-direction: column; gap: 5px; margin-top: 9px; font-size: 11px; color: var(--fg-2); }
  .regen-note .chip { align-self: flex-start; }
  .gen-stat { display: flex; gap: 6px; margin-top: 9px; font-size: 10.5px; color: var(--fg-3); flex-wrap: wrap; }
  .gen-stat b { color: var(--fg-1); font-family: var(--mono); font-weight: 500; }

  .seed-row { display: flex; gap: 6px; }
  .seed-input { font-size: 13px; letter-spacing: 0.08em; font-weight: 500; }
  .seed-input:disabled { color: var(--amber); opacity: 1; -webkit-text-fill-color: var(--amber); background: var(--bg-0); }
  .lockbtn { border: 1px solid var(--line); background: var(--bg-2); border-radius: 7px; padding: 0 10px; color: var(--fg-3); display: grid; place-items: center; }
  .lockbtn.on { color: var(--amber); border-color: rgba(232,166,60,0.35); background: var(--amber-soft); }
  .seed-actions { display: flex; gap: 6px; margin-top: 8px; }
  .seed-actions .btn { flex: 1; }
  .hint { font-size: 11px; color: var(--fg-3); line-height: 1.6; margin: 9px 0 0; }

  .lock-list { display: flex; flex-direction: column; gap: 4px; }
  .lock-item { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 7px; background: var(--bg-2); border: 1px solid transparent; }
  .lock-item.sel { border-color: rgba(232,166,60,0.4); background: var(--amber-soft); }
  .lock-id { border: 0; background: transparent; color: var(--amber); display: flex; align-items: center; gap: 5px; font-size: 11.5px; padding: 0; flex: 1; text-align: left; }
  .lock-item .dim { font-size: 10px; }
  .unlock { border: 0; background: transparent; color: var(--fg-3); font-size: 11px; padding: 2px 4px; border-radius: 4px; }
  .unlock:hover { color: var(--red); background: var(--red-soft); }

  .viewport { position: relative; min-width: 0; background: radial-gradient(ellipse at 50% 15%, #171b22, #090a0c 70%); overflow: hidden; }
  .viewport canvas { width: 100%; height: 100%; display: block; outline: none; touch-action: none; }

  .vp-top { position: absolute; top: 12px; left: 12px; right: 12px; display: flex; justify-content: space-between; gap: 10px; pointer-events: none; }
  .vp-tools { display: flex; gap: 8px; pointer-events: auto; }
  .vp-tools .seg { background: rgba(18,20,24,0.86); backdrop-filter: blur(8px); border-color: var(--line); box-shadow: 0 4px 16px rgba(0,0,0,0.4); }
  .seg.small button { padding: 5px 10px; font-size: 11.5px; }
  .tbtn { display: inline-flex; align-items: center; gap: 6px; background: rgba(18,20,24,0.86); backdrop-filter: blur(8px); border: 1px solid var(--line); color: var(--fg-2); border-radius: 8px; padding: 6px 11px; font-size: 11.5px; box-shadow: 0 4px 16px rgba(0,0,0,0.4); }
  .tbtn:hover { color: var(--fg-0); }
  .tbtn.on { color: var(--amber); border-color: rgba(232,166,60,0.45); background: rgba(232,166,60,0.14); }

  .cut-slider {
    position: absolute; top: 58px; right: 12px; width: 200px;
    display: flex; align-items: center; gap: 8px;
    background: rgba(18,20,24,0.9); backdrop-filter: blur(8px);
    border: 1px solid var(--line); border-radius: 9px; padding: 7px 11px;
    font-size: 10.5px; color: var(--fg-2);
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  }
  .cut-slider input { flex: 1; }
  .cut-slider .mono { font-size: 10px; color: var(--fg-1); width: 30px; text-align: right; }

  .vp-bottom { position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%); display: flex; gap: 10px; align-items: center; }
  .cam-group { display: flex; background: rgba(18,20,24,0.9); backdrop-filter: blur(8px); border: 1px solid var(--line); border-radius: 9px; padding: 3px; box-shadow: 0 4px 16px rgba(0,0,0,0.45); flex: none; }
  .cam-group button { border: 0; background: transparent; color: var(--fg-2); padding: 5px 13px; border-radius: 7px; font-size: 11.5px; white-space: nowrap; }
  .cam-group button:hover { color: var(--fg-0); }
  .cam-group button.on { background: var(--bg-4); color: var(--fg-0); }
  .light-group { display: flex; align-items: center; gap: 8px; background: rgba(18,20,24,0.9); backdrop-filter: blur(8px); border: 1px solid var(--line); border-radius: 9px; padding: 7px 12px; color: var(--fg-2); box-shadow: 0 4px 16px rgba(0,0,0,0.45); flex: none; }
  .light-group input { width: 76px; }

  .vp-hint { position: absolute; bottom: 62px; left: 50%; transform: translateX(-50%); font-size: 10.5px; color: var(--fg-3); display: flex; gap: 8px; align-items: center; background: rgba(10,11,13,0.68); padding: 3px 10px; border-radius: 999px; white-space: nowrap; max-width: calc(100% - 40px); overflow: hidden; }
  .vp-hint span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .legend { display: inline-flex; align-items: center; gap: 5px; color: var(--amber); padding-left: 8px; border-left: 1px solid var(--line); }
  .lg-locked { width: 8px; height: 8px; border-radius: 2px; background: linear-gradient(180deg, #f0b95c, #c9821f); box-shadow: 0 0 6px rgba(232,166,60,0.6); }

  .busy { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); display: flex; align-items: center; gap: 9px; background: rgba(18,20,24,0.94); border: 1px solid var(--line); padding: 10px 18px; border-radius: 10px; font-size: 12px; box-shadow: var(--shadow); }
  .spinner { width: 13px; height: 13px; border: 2px solid rgba(232,166,60,0.25); border-top-color: var(--amber); border-radius: 50%; animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .ins-head { padding: 15px 16px 12px; border-bottom: 1px solid var(--line-soft); }
  .ins-kind { font-size: 10.5px; color: var(--fg-3); letter-spacing: 0.05em; text-transform: uppercase; }
  .ins-id { font-size: 18px; font-weight: 600; color: var(--amber); letter-spacing: 0.02em; margin-top: 1px; }
  .ins-chips { display: flex; gap: 6px; margin-top: 8px; }

  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }

  .count-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .count-cell { display: flex; align-items: center; gap: 8px; background: var(--bg-2); border: 1px solid var(--line-soft); border-radius: 8px; padding: 8px 9px; }
  .count-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
  .count-num { font-size: 15px; font-weight: 600; line-height: 1.1; font-family: var(--mono); }
  .count-lbl { font-size: 10px; color: var(--fg-3); }

  .entry-list { display: flex; flex-direction: column; gap: 3px; }
  .entry-item { display: flex; align-items: center; gap: 9px; padding: 3px 0; font-size: 11.5px; }
  .entry-id { color: var(--amber); width: 22px; }
  .entry-item .dim { flex: 1; font-size: 10.5px; }
  .link { border: 0; background: transparent; color: var(--fg-3); font-size: 10.5px; padding: 1px 5px; border-radius: 4px; }
  .link:hover { color: var(--fg-0); background: var(--bg-3); }

  .tier-row { display: flex; flex-wrap: wrap; gap: 5px; }
  .tier-pill { display: flex; align-items: baseline; gap: 4px; background: var(--bg-2); border: 1px solid var(--line-soft); border-radius: 6px; padding: 3px 8px; font-size: 10px; color: var(--fg-3); }
  .tier-pill b { color: var(--fg-1); font-family: var(--mono); font-weight: 600; }

  .tips { margin: 0; padding-left: 16px; font-size: 11px; color: var(--fg-3); line-height: 1.8; }

  .save-bar { position: absolute; bottom: 0; left: 0; right: 0; padding: 11px 14px; background: linear-gradient(180deg, rgba(18,19,22,0.4), var(--bg-1) 40%); border-top: 1px solid var(--line-soft); display: flex; align-items: center; gap: 10px; }
  .save-bar .btn { height: 34px; }
  .dirty-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--amber); flex: none; box-shadow: 0 0 8px rgba(232,166,60,0.7); }

  .repro { display: flex; flex-direction: column; gap: 12px; }
  .repro-code { background: var(--bg-0); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; font-size: 11px; color: var(--teal); word-break: break-all; line-height: 1.6; }
  .repro textarea { resize: vertical; }

  @media (max-width: 1280px) {
    .studio { grid-template-columns: 258px 1fr 268px; }
  }

  @media (max-width: 1100px) {
    .studio { grid-template-columns: 236px 1fr 250px; }
    .vp-bottom { gap: 6px; }
    .cam-group button { padding: 5px 9px; font-size: 11px; }
    .light-group { padding: 7px 9px; }
    .light-group input { width: 58px; }
    .vp-hint { display: none; }
  }

  @media (max-width: 900px) {
    /* Dense editor: below this width keep all three panes intact and let the
       stage scroll horizontally rather than hiding production tools. */
    .viewport { min-width: 360px; }
  }
</style>
