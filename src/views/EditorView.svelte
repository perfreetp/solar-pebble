<script>
  import { editor } from '../lib/stores/editor.svelte.js';
  import { versions } from '../lib/stores/versions.js';
  import {
    paintVoxel, eraseVoxel, floodFill, connectedComponent, boxKeys,
    translateVoxels, copyVoxels, pasteVoxels, boundsOf, key, parseKey,
    inBounds, voxelCount, GRID_SIZE
  } from '../lib/voxel.js';
  import { TEMPLATES } from '../lib/templates.js';
  import { exportGLB } from '../lib/exporter.js';
  import VoxelViewport from '../components/VoxelViewport.svelte';

  const s = editor.s;
  let engineRef = null;
  let toast = $state('');
  let showExport = $state(false);
  let showSubmit = $state(false);
  let exportQuality = $state(0.6);
  let exportScope = $state('all'); // all | selection
  let exporting = $state(false);
  let exportInfo = $state(null);
  let submitName = $state('');
  let submitNote = $state('');

  const tools = [
    { id: 'brush', icon: '🖌️', label: '画笔' },
    { id: 'eraser', icon: '🧽', label: '橡皮' },
    { id: 'fill', icon: '🪣', label: '填充' },
    { id: 'select', icon: '⬚', label: '框选' }
  ];

  const layers = Array.from({ length: GRID_SIZE }, (_, i) => i);

  function flash(msg) {
    toast = msg;
    setTimeout(() => { if (toast === msg) toast = ''; }, 2200);
  }

  const lockCfg = () => (s.layerLockEnabled ? { enabled: true, layer: s.activeLayer } : null);

  // ------------------------------------------------------------- 工具回调
  function onPaint(hit, next, _evt, isStroke = false) {
    if (!isStroke) editor.commit();
    const target = hit ? faceAdjacent(hit) : next;
    if (!target || !inBounds(target.x, target.y, target.z)) return;
    const changed = paintVoxel(s.voxels, target.x, target.y, target.z, s.color, {
      mirror: s.mirror, layerLock: lockCfg()
    });
    if (changed.length) {
      editor.rememberColor(s.color);
      bump();
    }
  }

  function onErase(hit, isStroke = false) {
    if (!hit) return;
    if (!isStroke) editor.commit();
    const changed = eraseVoxel(s.voxels, hit.x, hit.y, hit.z, { mirror: s.mirror, layerLock: lockCfg() });
    if (changed.length) bump();
  }

  function onFill(cell) {
    editor.commit();
    const changed = floodFill(s.voxels, cell.x, cell.y, cell.z, s.color, { layerLock: lockCfg() });
    if (changed.length) {
      editor.rememberColor(s.color);
      bump();
    }
  }

  function faceAdjacent(hit) {
    if (!hit.face) return hit;
    return { x: hit.x + hit.face[0], y: hit.y + hit.face[1], z: hit.z + hit.face[2] };
  }

  function onSelectConnected(seedKey) {
    const comp = connectedComponent(s.voxels, seedKey);
    editor.setSelection(comp);
    flash(`已选中连通体素团 ${comp.length} 个,可在右侧合并导出`);
  }

  function onMarquee(min, max) {
    const keys = boxKeys(min, max, { occupiedOnly: true, voxels: s.voxels });
    editor.setSelection(keys);
    flash(`框选到 ${keys.length} 个体素`);
  }

  function bump() {
    // $state 深响应:重新赋一个 Map 触发视口同步
    s.voxels = new Map(s.voxels);
  }

  // ------------------------------------------------------------- 选区操作
  function copySelection() {
    if (!s.selection.length) return flash('先框选或点选一块体素');
    editor.commit();
    s.clipboard = copyVoxels(s.voxels, s.selection);
    const { min } = boundsOf(s.selection);
    s.pasteOrigin = { ...min };
    flash(`已复制 ${s.selection.length} 个体素`);
  }

  function pasteClipboard() {
    if (!s.clipboard) return flash('剪贴板是空的');
    editor.commit();
    const placed = pasteVoxels(s.voxels, s.clipboard, s.pasteOrigin);
    editor.setSelection(placed);
    bump();
    flash(`粘贴 ${placed.length} 个体素,可用方向键/按钮整体平移`);
  }

  function nudge(dx, dy, dz) {
    if (!s.selection.length) return flash('没有选中的体素');
    editor.commit();
    const result = translateVoxels(s.voxels, s.selection, { x: dx, y: dy, z: dz });
    if (!result) {
      flash('平移会越界或与其他体素冲突,已撤销');
      editor.undo();
      return;
    }
    s.voxels = result.voxels;
    editor.setSelection(result.newKeys);
    bump();
  }

  function deleteSelection() {
    if (!s.selection.length) return;
    editor.commit();
    for (const k of s.selection) s.voxels.delete(k);
    editor.setSelection([]);
    bump();
  }

  function clearSelection() {
    editor.setSelection([]);
    engineRef?.hideMarquee();
  }

  // ------------------------------------------------------------- 键盘
  function onKey(e) {
    if (e.key === 'Escape') { showSubmit = false; showExport = false; return; }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.ctrlKey && e.key === 'z' && !e.shiftKey) return editor.undo();
    if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'Z')) return editor.redo();
    if (!s.selection.length) return;
    const step = e.shiftKey ? 4 : 1;
    if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-step, 0, 0); }
    if (e.key === 'ArrowRight') { e.preventDefault(); nudge(step, 0, 0); }
    if (e.key === 'ArrowUp') { e.preventDefault(); nudge(0, step, 0); }
    if (e.key === 'ArrowDown') { e.preventDefault(); nudge(0, -step, 0); }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); }
  }

  // ------------------------------------------------------------- 模板/清空/提交/导出
  function loadTpl(id) {
    editor.loadTemplate(id);
    editor.setSelection([]);
    flash('模板已载入,可以继续修改');
  }

  function openExport() {
    if (!voxelCount(s.voxels)) return flash('模型还是空的,先堆一只虫子吧');
    exportInfo = null;
    showExport = true;
  }

  async function doExport() {
    exporting = true;
    try {
      const only = exportScope === 'selection' && s.selection.length ? new Set(s.selection) : null;
      const info = await exportGLB(s.voxels, only, exportQuality, `${s.projectName || 'voxel-bug'}.glb`);
      exportInfo = info;
      flash('GLB 已下载,可拖进游戏引擎');
    } catch (e) {
      console.error(e);
      flash('导出失败:' + e.message);
    } finally {
      exporting = false;
    }
  }

  function submitVersion() {
    if (!voxelCount(s.voxels)) return flash('空模型不能提交');
    versions.submit(s.voxels, submitName || `${s.projectName} v${versions.data.versions.length + 1}`, submitNote);
    showSubmit = false;
    submitName = ''; submitNote = '';
    flash('新版本已提交,可到「版本审核」界面查看');
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="editor">
  <!-- 左侧工具栏 -->
  <aside class="panel side">
    <h2>工具</h2>
    <div class="tool-grid">
      {#each tools as t (t.id)}
        <button class:active={s.tool === t.id} onclick={() => (s.tool = t.id)}>
          <span class="tool-icon">{t.icon}</span>{t.label}
        </button>
      {/each}
    </div>

    <h3>视角</h3>
    <div class="row">
      <button class:active={s.cameraMode === 'perspective'} onclick={() => (s.cameraMode = 'perspective')}>透视</button>
      <button class:active={s.cameraMode === 'ortho'} onclick={() => (s.cameraMode = 'ortho')}>正交</button>
    </div>
    <label class="check"><input type="checkbox" bind:checked={s.showGrid} /> 显示网格线</label>
    <label class="check"><input type="checkbox" bind:checked={s.mirror} /> X 轴镜像对称落笔</label>

    <h3>历史</h3>
    <div class="row">
      <button onclick={() => editor.undo()} disabled={!editor.canUndo()}>↩ 撤销</button>
      <button onclick={() => editor.redo()} disabled={!editor.canRedo()}>重做 ↪</button>
    </div>

    <h3>昆虫模板</h3>
    <div class="col">
      {#each TEMPLATES as tpl (tpl.id)}
        <button onclick={() => loadTpl(tpl.id)}>🐛 载入{tpl.name}</button>
      {/each}
      <button onclick={() => confirm('确定清空整个网格?') && editor.clearAll()}>🗑 清空网格</button>
    </div>
  </aside>

  <!-- 中间视口 -->
  <section class="stage panel">
    <div class="stage-head">
      <input class="name-input" bind:value={s.projectName} />
      <span class="tag muted">体素数 {voxelCount(s.voxels)}</span>
      {#if s.selection.length}<span class="tag">已选 {s.selection.length}</span>{/if}
      {#if s.layerLockEnabled}<span class="tag warn">🔒 只编辑第 {s.activeLayer} 层</span>{/if}
      {#if s.mirror}<span class="tag ok">🪞 镜像开</span>{/if}
    </div>
    <div class="canvas-wrap">
      <VoxelViewport
        bind:voxels={s.voxels}
        interactive={true}
        showGrid={s.showGrid}
        cameraMode={s.cameraMode}
        hiddenLayers={s.hiddenLayers}
        activeLayer={s.activeLayer}
        layerLocked={s.layerLockEnabled}
        selection={s.selection}
        tool={s.tool}
        registerEngine={(e) => (engineRef = e)}
        {onPaint} {onErase} {onFill} {onMarquee} {onSelectConnected}
      />
      {#if toast}<div class="toast">{toast}</div>{/if}
    </div>
    <div class="stage-foot row">
      <button class="primary" onclick={() => (showSubmit = true)}>📤 提交新版本</button>
      <button class="accent" onclick={openExport}>📦 导出 GLB</button>
      <span class="muted hint">拖动旋转 · 滚轮缩放 · 右键平移 · 方向键平移选区(Shift×4) · Delete 删除选区</span>
    </div>
  </section>

  <!-- 右侧面板:颜色 / 层 / 选区 -->
  <aside class="panel side right">
    <h2>颜色</h2>
    <div class="row">
      <input type="color" bind:value={s.color} />
      <span class="muted">当前色 {s.color}</span>
    </div>
    <h3>最近使用</h3>
    <div class="palette">
      {#each s.palette as c, i (c + i)}
        <button class="swatch" class:active={s.color === c} style="background:{c}" onclick={() => (s.color = c)} title={c}></button>
      {/each}
    </div>

    <h2 style="margin-top:14px">分层编辑</h2>
    <label class="check">
      <input type="checkbox" bind:checked={s.layerLockEnabled} />
      锁定到当前层(只改这一层)
    </label>
    <div class="layer-controls row">
      <button onclick={() => (s.activeLayer = Math.max(0, s.activeLayer - 1))}>◀ 上一层</button>
      <strong>第 {s.activeLayer} 层 (Y)</strong>
      <button onclick={() => (s.activeLayer = Math.min(GRID_SIZE - 1, s.activeLayer + 1))}>下一层 ▶</button>
    </div>
    <div class="layer-list">
      {#each layers as y (y)}
        <div class="layer-item" class:current={y === s.activeLayer} class:locked={s.layerLockEnabled && y !== s.activeLayer}>
          <button class="icon" onclick={() => (s.activeLayer = y)}>Y{y}</button>
          <button class="icon" title="隐藏/显示该层" onclick={() => editor.toggleLayerHidden(y)}>
            {s.hiddenLayers.includes(y) ? '🚫' : '👁'}
          </button>
        </div>
      {/each}
    </div>

    <h2 style="margin-top:14px">框选 / 剪贴板</h2>
    <div class="col">
      <button onclick={copySelection} disabled={!s.selection.length}>📋 复制选区</button>
      <button onclick={pasteClipboard} disabled={!s.clipboard}>📥 粘贴</button>
      <div class="row nudge">
        <button onclick={() => nudge(-1, 0, 0)}>←</button>
        <button onclick={() => nudge(1, 0, 0)}>→</button>
        <button onclick={() => nudge(0, 1, 0)}>↑</button>
        <button onclick={() => nudge(0, -1, 0)}>↓</button>
        <button onclick={() => nudge(0, 0, -1)}>前</button>
        <button onclick={() => nudge(0, 0, 1)}>后</button>
      </div>
      <button onclick={deleteSelection} disabled={!s.selection.length}>删除选区</button>
      <button onclick={clearSelection} disabled={!s.selection.length}>取消选择</button>
    </div>
  </aside>
</div>

<!-- 提交弹窗 -->
{#if showSubmit}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal-mask" role="presentation" onclick={() => (showSubmit = false)}>
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="modal panel" role="dialog" aria-modal="true" aria-label="提交新版本" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <h2>提交新版本</h2>
      <p class="muted">每次提交都会保存一份完整快照,审核人可在画面上点位置写批注。</p>
      <input placeholder="版本名称,如:独角仙 v2" bind:value={submitName} />
      <textarea rows="3" placeholder="这一版改了什么?(可选)" bind:value={submitNote}></textarea>
      <div class="row end">
        <button onclick={() => (showSubmit = false)}>取消</button>
        <button class="primary" onclick={submitVersion}>确认提交</button>
      </div>
    </div>
  </div>
{/if}

<!-- 导出弹窗 -->
{#if showExport}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal-mask" role="presentation" onclick={() => (showExport = false)}>
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="modal panel" role="dialog" aria-modal="true" aria-label="导出 GLB" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <h2>导出 GLB(游戏引擎用)</h2>
      <label class="check">
        <input type="radio" value="all" bind:group={exportScope} /> 合并整个模型为一个网格
      </label>
      <label class="check">
        <input type="radio" value="selection" bind:group={exportScope} disabled={!s.selection.length} />
        只合并当前选中的连通团({s.selection.length} 个体素)
      </label>
      <h3 style="margin-top:10px">减面比例(质量)</h3>
      <div class="row">
        <input type="range" min="0.25" max="1" step="0.05" bind:value={exportQuality} />
        <strong>{Math.round(exportQuality * 100)}%</strong>
      </div>
      <p class="muted">100% 保留全部表面;越低共面合并 + Quadric 简化越激进,三角面越少。</p>
      {#if exportInfo}
        <p class="tag ok">导出 {exportInfo.beforeTris} → {Math.round(exportInfo.afterTris)} 个三角面</p>
      {/if}
      <div class="row end">
        <button onclick={() => (showExport = false)}>关闭</button>
        <button class="accent" onclick={doExport} disabled={exporting}>
          {exporting ? '导出中…' : '下载 .glb'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .editor { display: grid; grid-template-columns: 210px 1fr 250px; gap: 12px; height: 100%; min-height: 0; }
  .side { padding: 12px; overflow-y: auto; }
  .tool-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
  .tool-grid button { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 10px 4px; }
  .tool-icon { font-size: 20px; }
  .check { display: flex; align-items: center; gap: 7px; margin: 7px 0; }
  .stage { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .stage-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
  .name-input { max-width: 220px; font-weight: 700; }
  .canvas-wrap { flex: 1; position: relative; min-height: 0; padding: 10px; }
  .stage-foot { padding: 10px 12px; border-top: 1px solid var(--line); }
  .hint { font-size: 12px; }
  .toast {
    position: absolute; top: 22px; left: 50%; transform: translateX(-50%);
    background: rgba(36,52,71,.9); color: #fff; padding: 8px 16px;
    border-radius: 999px; font-size: 13px; z-index: 5;
  }
  .palette { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
  .layer-controls { justify-content: space-between; margin: 8px 0; }
  .layer-list { max-height: 180px; overflow-y: auto; border: 1px solid var(--line); border-radius: 10px; }
  .layer-item { display: flex; justify-content: space-between; align-items: center; padding: 2px 6px; border-bottom: 1px solid #eef2f6; }
  .layer-item.current { background: #eef6f4; }
  .layer-item.locked { opacity: .55; }
  .nudge button { flex: 1; }
  .modal-mask {
    position: fixed; inset: 0; background: rgba(24,40,56,.45);
    display: flex; align-items: center; justify-content: center; z-index: 50;
  }
  .modal { width: min(460px, 92vw); padding: 20px; display: flex; flex-direction: column; gap: 10px; }
  .end { justify-content: flex-end; }
</style>
