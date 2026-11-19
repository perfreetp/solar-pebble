<script>
  import { hslToHex, rgbToHsl, contrastRatio } from '../color.js';
  import { cellColor } from '../generator.js';

  let { app, store } = $props();

  const spec = $derived(store.variants[store.activeVariant] || null);

  const found = $derived.by(() => {
    if (!spec) return null;
    if (store.selection.spotId) {
      for (const wing of spec.wings) {
        const spot = wing.spots.find((s) => s.id === store.selection.spotId);
        if (spot) {
          const cell = wing.cells.find((c) => c.id === spot.cellId);
          return { kind: 'spot', wing, spot, cell };
        }
      }
    }
    if (store.selection.cellId) {
      for (const wing of spec.wings) {
        const cell = wing.cells.find((c) => c.id === store.selection.cellId);
        if (cell) return { kind: 'cell', wing, cell };
      }
    }
    return null;
  });

  const currentColor = $derived.by(() => {
    if (!found) return null;
    if (found.kind === 'cell') return cellColor(spec, found.wing, found.cell);
    return found.spot.color;
  });

  const locked = $derived(found?.kind === 'cell' ? app.isCellLocked(found.cell.id) : false);

  const wingLabel = (k) => ({ 'fore-right': '前翅·右', 'fore-left': '前翅·左', 'hind-right': '后翅·右', 'hind-left': '后翅·左' })[k] || k;
  const bandLabel = (cell) => {
    if (cell.margin) return '外缘带';
    return ['基部', '中区', '外区', '缘区'][cell.bandIndex] || `第 ${cell.bandIndex + 1} 带`;
  };

  const contrastWithBase = $derived.by(() => {
    if (!found || found.kind !== 'spot' || !found.cell) return null;
    return contrastRatio(found.spot.color, cellColor(spec, found.wing, found.cell));
  });

  function setHue(h, s, l) {
    if (!found || found.kind !== 'cell') return;
    app.setCellColor(found.cell.id, [h, s, l]);
  }

  function onPick(e) {
    const rgb = e.target.value;
    const hex = rgb.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const [h, s, l] = rgbToHsl(r, g, b);
    setHue(h, s, l);
  }

  function nudgeSpot(dx, dy) {
    if (found?.kind !== 'spot') return;
    app.moveSpot(found.spot.id, dx, dy);
  }

  function scaleSpot(f) {
    if (found?.kind !== 'spot') return;
    app.resizeSpot(found.spot.id, f);
  }

  const presetColors = $derived.by(() => {
    if (!spec) return [];
    const pal = spec.wings[0].palette;
    return [...pal.tones, pal.spotLight, pal.spotDark, pal.accent];
  });

  const step = $derived(store.view.scale > 0 ? 1 / store.view.scale * 3 : 0.5);
</script>

<aside class="panel">
  {#if !found}
    <div class="empty">
      <div class="icon">◎</div>
      <h3>未选中对象</h3>
      <p>用<b>选择工具</b>点击翅室或斑点。<br />点翅室可以改色或锁定;点住斑点可以直接拖动。</p>
      <div class="tips">
        <div><kbd>滚轮</kbd> 缩放</div>
        <div><kbd>空格</kbd>+拖动 平移</div>
        <div><kbd>F</kbd> 适应窗口</div>
        <div><kbd>双击</kbd> 重置视图</div>
      </div>
    </div>
  {:else if found.kind === 'cell'}
    <div class="head">
      <div>
        <span class="kicker">翅室</span>
        <h3>{wingLabel(found.wing.key)} · {bandLabel(found.cell)}</h3>
        <span class="id mono">{found.cell.id}</span>
      </div>
      <span class="chip" class:locked>{locked ? '已锁定' : '可编辑'}</span>
    </div>

    <section>
      <h4>填色</h4>
      <div class="color-row">
        <div class="preview" style:background={hslToHex(...currentColor)}></div>
        <label class="picker">
          <input type="color" value={hslToHex(...currentColor)} oninput={onPick} disabled={locked} />
          <span>{hslToHex(...currentColor)}</span>
        </label>
      </div>
      <div class="swatches">
        {#each presetColors as c, i}
          <button
            class="sw preset-swatch"
            style:background={hslToHex(c[0], c[1], c[2])}
            onclick={(e) => { e.preventDefault(); e.stopPropagation(); setHue(c[0], c[1], c[2]); }}
            disabled={locked}
            title={`色相 ${Math.round(c[0])}° / 饱和 ${Math.round(c[1] * 100)}% / 明度 ${Math.round(c[2] * 100)}%`}
          ></button>
        {/each}
      </div>
      {#if locked}
        <p class="note">此翅室已锁定,颜色会在重算时保留。解锁后可继续改色。</p>
      {/if}
    </section>

    <section>
      <h4>操作</h4>
      <div class="btn-col">
        <button class:primary={!locked} onclick={() => app.toggleCellLock(found.cell.id)}>
          {locked ? '解锁翅室' : '锁定翅室'}
        </button>
        <button class="ghost" onclick={() => app.resetCell(found.cell.id)} disabled={!found.cell.edited && !locked}>还原此翅室</button>
      </div>
      <p class="note small">锁定或手改过的翅室在按参数重算时保留;其余翅室按新参数重新计算。</p>
    </section>

    <section>
      <h4>信息</h4>
      <dl class="facts">
        <dt>所属翅</dt><dd>{wingLabel(found.wing.key)}</dd>
        <dt>径向带</dt><dd>第 {found.cell.bandIndex + 1} 带{found.cell.margin ? '（外缘）' : ''}</dd>
        <dt>面积</dt><dd class="mono">{found.cell.area.toFixed(3)} u²</dd>
        <dt>状态</dt><dd>{found.cell.color ? '已手改' : '自动配色'}{locked ? ' · 锁定' : ''}</dd>
      </dl>
    </section>
  {:else}
    <div class="head">
      <div>
        <span class="kicker">斑点</span>
        <h3>{wingLabel(found.wing.key)}</h3>
        <span class="id mono">{found.spot.id}</span>
      </div>
      <span class="chip">{found.spot.edited ? '已移动' : '原位'}</span>
    </div>

    <section>
      <h4>位置与大小</h4>
      <div class="pad">
        <button class="ghost" onclick={() => nudgeSpot(-step, 0)}>←</button>
        <button class="ghost" onclick={() => nudgeSpot(0, -step)}>↑</button>
        <button class="ghost" onclick={() => nudgeSpot(0, step)}>↓</button>
        <button class="ghost" onclick={() => nudgeSpot(step, 0)}>→</button>
      </div>
      <div class="size-row">
        <button class="ghost" onclick={() => scaleSpot(0.9)}>缩小</button>
        <span class="mono">{((found.spot.rx * 2 * 100) / 44).toFixed(1)}% 翅宽</span>
        <button class="ghost" onclick={() => scaleSpot(1.1)}>放大</button>
      </div>
      <p class="note small">也可以直接在画布上拖动斑点;拖右侧白色圆点改大小。</p>
      <button class="ghost full" onclick={() => app.resetSpot(found.spot.id)} disabled={!found.spot.edited}>还原位置与大小</button>
    </section>

    <section>
      <h4>颜色与对比</h4>
      <div class="color-row">
        <div class="preview" style:background={hslToHex(...found.spot.color)}></div>
        <div class="meta">
          <div>{found.spot.accent ? '强调斑' : found.spot.color[2] > 0.55 ? '浅斑' : '深斑'}</div>
          <div class="small dim">与底色对比 <b class="mono" class:low={contrastWithBase < 1.7}>{contrastWithBase.toFixed(2)}:1</b></div>
        </div>
      </div>
      <p class="note small">斑点颜色跟随「配色」参数。若要更强的对比,可选中所在翅室改色。</p>
    </section>
  {/if}
</aside>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 0;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow-y: auto;
    min-height: 0;
  }
  .empty { padding: 22px 18px; text-align: center; }
  .empty .icon { font-size: 26px; color: var(--ink-3); opacity: 0.5; margin-bottom: 4px; }
  .empty h3 { font-size: 13px; margin: 0 0 8px; font-weight: 600; }
  .empty p { font-size: 12px; color: var(--ink-3); line-height: 1.6; margin: 0 0 16px; }
  .empty b { color: var(--ink-2); }
  .tips { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; text-align: left; font-size: 11px; color: var(--ink-3); }
  kbd {
    font-family: inherit;
    background: var(--bg-2);
    border: 1px solid var(--line-2);
    border-bottom-width: 2px;
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 10px;
    color: var(--ink-2);
  }

  .head {
    padding: 14px 16px 12px;
    border-bottom: 1px solid var(--line);
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 10px;
  }
  .kicker { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-3); }
  .head h3 { font-size: 14px; margin: 3px 0 2px; font-weight: 600; }
  .id { font-size: 10px; color: var(--ink-3); }
  .chip {
    font-size: 10px;
    padding: 3px 8px;
    border-radius: 999px;
    background: var(--panel-2);
    border: 1px solid var(--line-2);
    white-space: nowrap;
    color: var(--ink-2);
  }
  .chip.locked { color: #f0cd85; border-color: #d9a44155; background: #d9a44118; }

  section { padding: 13px 16px; border-bottom: 1px solid var(--line); }
  section:last-child { border-bottom: none; }
  h4 {
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-3);
    margin: 0 0 10px;
    font-weight: 600;
  }
  .color-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .preview { width: 44px; height: 44px; border-radius: 8px; border: 1px solid #0006; flex-shrink: 0; box-shadow: inset 0 1px 0 #fff2; }
  .picker { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 11px; color: var(--ink-2); }
  .picker input { width: 26px; height: 26px; padding: 0; border: 1px solid var(--line-2); border-radius: 6px; background: none; cursor: pointer; }
  .picker input::-webkit-color-swatch-wrapper { padding: 2px; }
  .picker input::-webkit-color-swatch { border: none; border-radius: 4px; }
  .meta { font-size: 12px; display: flex; flex-direction: column; gap: 3px; }
  .meta b.low { color: var(--warn); }
  .swatches { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }
  .sw { height: 24px; padding: 0; border-radius: 5px; border: 1px solid #0005; }
  .sw:hover:not(:disabled) { outline: 2px solid var(--accent); outline-offset: 1px; }
  .note { font-size: 11px; color: var(--ink-3); line-height: 1.55; margin: 10px 0 0; }
  .btn-col { display: flex; flex-direction: column; gap: 6px; }
  .full { width: 100%; }
  .pad { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-bottom: 8px; }
  .pad button { padding: 5px 0; }
  .size-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; color: var(--ink-2); margin-bottom: 4px; }
  .size-row button { flex: 1; }
  .facts { display: grid; grid-template-columns: auto 1fr; gap: 5px 12px; margin: 0; font-size: 11px; }
  .facts dt { color: var(--ink-3); }
  .facts dd { margin: 0; text-align: right; color: var(--ink-2); }
</style>
