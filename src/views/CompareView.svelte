<script>
  import { versions } from '../lib/stores/versions.js';
  import VoxelViewport from '../components/VoxelViewport.svelte';

  let data = $state(versions.data);
  $effect(() => versions.subscribe((d) => (data = d)));

  const list = $derived(data.versions);
  let idA = $state(null);
  let idB = $state(null);
  let showGrid = $state(false);
  let cameraMode = $state('perspective');

  // 首次拿到版本后,默认选中最后两个;已有选择但指向已删除版本时也校正
  $effect(() => {
    if (!list.length) return;
    if (!list.some((v) => v.id === idA)) idA = list.at(-2)?.id ?? list[0].id;
    if (!list.some((v) => v.id === idB)) idB = list.at(-1).id;
  });

  const vA = $derived(list.find((v) => v.id === idA) ?? list.at(-2) ?? list.at(0));
  const vB = $derived(list.find((v) => v.id === idB) ?? list.at(-1));
  const diff = $derived(vA && vB ? versions.diff(vA.id, vB.id) : null);

  function swap() {
    const t = idA; idA = idB; idB = t;
  }
</script>

<div class="compare">
  <div class="toolbar panel">
    <div class="row picker">
      <label>左版本
        <select bind:value={idA}>
          {#each list as v (v.id)}<option value={v.id}>v{v.no} {v.name}</option>{/each}
        </select>
      </label>
      <button class="icon" onclick={swap} title="交换左右">⇄</button>
      <label>右版本
        <select bind:value={idB}>
          {#each list as v (v.id)}<option value={v.id}>v{v.no} {v.name}</option>{/each}
        </select>
      </label>
      <button class:active={cameraMode === 'perspective'} onclick={() => (cameraMode = 'perspective')}>透视</button>
      <button class:active={cameraMode === 'ortho'} onclick={() => (cameraMode = 'ortho')}>正交</button>
      <button onclick={() => (showGrid = !showGrid)}>{showGrid ? '隐藏网格' : '显示网格'}</button>
    </div>
    {#if diff}
      <div class="row legend">
        <span class="tag ok">🟢 新增 / 改色 {diff.added.length} 格</span>
        <span class="tag warn">🔴 删除 {diff.removed.length} 格</span>
        <span class="tag muted">两视口均叠加差异标记,可分别旋转查看</span>
      </div>
    {/if}
  </div>

  <div class="pair">
    <div class="pane panel">
      <header><strong>⬅ {vA ? `v${vA.no} ${vA.name}` : ''}</strong><span class="muted">{vA?.note}</span></header>
      <div class="canvas-wrap">
        {#if vA}
          <VoxelViewport
            voxels={vA.voxels}
            interactive={false}
            readonly={true}
            showGrid={showGrid}
            cameraMode={cameraMode}
            diffAdded={diff?.added ?? []}
            diffRemoved={diff?.removed ?? []}
          />
        {/if}
      </div>
    </div>
    <div class="pane panel">
      <header><strong>➡ {vB ? `v${vB.no} ${vB.name}` : ''}</strong><span class="muted">{vB?.note}</span></header>
      <div class="canvas-wrap">
        {#if vB}
          <VoxelViewport
            voxels={vB.voxels}
            interactive={false}
            readonly={true}
            showGrid={showGrid}
            cameraMode={cameraMode}
            diffAdded={diff?.added ?? []}
            diffRemoved={diff?.removed ?? []}
          />
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .compare { display: flex; flex-direction: column; gap: 12px; height: 100%; min-height: 0; }
  .toolbar { padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; }
  .picker { flex-wrap: wrap; }
  .picker label { display: flex; align-items: center; gap: 6px; }
  .legend { font-size: 12px; }
  .pair { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .pane header { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--line); }
  .canvas-wrap { flex: 1; min-height: 0; padding: 10px; }
</style>
