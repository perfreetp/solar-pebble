<script>
  import { onMount, onDestroy } from 'svelte';
  import { WingRenderer } from '../render/webgpu.js';
  import { Canvas2DRenderer } from '../render/canvasFallback.js';
  import { buildScene, artboardToWing, findSpot } from '../scene.js';
  import { artboardBounds, cellColor } from '../generator.js';
  import { pointInPolygon } from '../geometry.js';

  let {
    store = $bindable(),
    app,
    onpick = () => {},
    compact = false
  } = $props();

  let host = $state(null);
  let canvasEl = $state(null);
  let renderer = $state(null);
  let drag = $state(null);
  let cursor = $state('default');
  let ready = $state(false);

  const spec = $derived(store.variants[store.activeVariant] || null);

  // ---- scene (rebuilt whenever the specimen or overrides change) ----
  const selectionInfo = $derived({
    cellId: store.selection.cellId,
    spotId: store.selection.spotId,
    hoverCellId: store.hover.cellId,
    hoverSpotId: store.hover.spotId
  });

  const scene = $derived.by(() => {
    if (!spec) return null;
    const layers = store.layers;
    const wingFilter = null;
    const s = buildScene(spec, {
      selection: true,
      selectionInfo,
      showSecondary: layers.veins
    });
    // drop groups whose user layer is hidden
    const map = { shape: ['fill', 'band', 'outline'], cells: ['cells'], veins: ['veins'], spots: ['spots'], detail: ['detail'] };
    const hidden = new Set();
    for (const [grp, keys] of Object.entries(map)) if (!layers[grp]) for (const k of keys) hidden.add(k);
    for (const k of hidden) s[k] = null;
    if (!layers.veins) s.overlay = s.overlay ? { ...s.overlay } : s.overlay;
    return s;
  });

  // ---- mount renderer ----
  onMount(async () => {
    const webgpu = new WingRenderer(canvasEl, { backgroundColor: [0.055, 0.06, 0.05, 1] });
    webgpu.onLost = () => {
      app.toast('GPU 设备丢失，切换到 Canvas2D 渲染', 'warn');
      fallback();
    };
    let ok = false;
    try {
      ok = await webgpu.init();
    } catch {
      ok = false;
    }
    if (ok) {
      renderer = webgpu;
      app.setRendererBackend('webgpu');
    } else {
      webgpu.destroy?.();
      const c2d = new Canvas2DRenderer(canvasEl, { backgroundColor: '#0e0f0c', artboardColor: '#1b1e1a' });
      await c2d.init();
      renderer = c2d;
      app.setRendererBackend('canvas2d');
    }
    ready = true;
    renderer.resize?.();
    // Auto-fit only while the viewport keeps changing shape because the page
    // is still laying itself out. Once we have fitted at a stable size, or the
    // maker has panned/zoomed, the view belongs to them.
    let fittedAt = null;
    let userMoved = false;
    const tryFit = () => {
      if (userMoved) return;
      const r = host?.getBoundingClientRect();
      if (!r || r.width < 40 || r.height < 40) return;
      const sig = `${Math.round(r.width)}x${Math.round(r.height)}`;
      if (fittedAt === sig) return;
      fittedAt = sig;
      fitView();
    };
    requestAnimationFrame(() => requestAnimationFrame(tryFit));
    const ro = new ResizeObserver(() => {
      renderer?.resize?.();
      tryFit();
    });
    ro.observe(host);
    const stopAuto = () => (userMoved = true);
    host.addEventListener('wheel', stopAuto, { passive: true });
    host.addEventListener('pointerdown', stopAuto);
    return () => {
      ro.disconnect();
      host.removeEventListener('wheel', stopAuto);
      host.removeEventListener('pointerdown', stopAuto);
    };
  });

  function fallback() {
    renderer?.destroy?.();
    const c2d = new Canvas2DRenderer(canvasEl, { backgroundColor: '#0e0f0c', artboardColor: '#1b1e1a' });
    c2d.init();
    c2d.setScene(sceneRef);
    c2d.setVisibleLayers([]);
    renderer = c2d;
    app.setRendererBackend('canvas2d');
  }

  let sceneRef = null;
  $effect(() => {
    const s = scene;
    sceneRef = s;
    if (!renderer || !s) return;
    renderer.setScene(s);
    renderer.requestDraw?.();
  });

  $effect(() => {
    if (!renderer) return;
    renderer.resize?.();
  });

  $effect(() => {
    const t = store.fitToken;
    if (t > 0 && ready) fitView();
  });

  // ---- view ----
  function fitView() {
    const rect = host?.getBoundingClientRect();
    if (!rect || !spec) return;
    const b = artboardBounds(spec);
    const pad = 26;
    const scale = Math.min((rect.width - pad * 2) / Math.max(1, b.width), (rect.height - pad * 2) / Math.max(1, b.height));
    const s = Math.max(0.4, Math.min(scale, 18));
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    setView({ scale: s, tx: rect.width / 2 - cx * s, ty: rect.height / 2 - cy * s });
  }

  function setView(v) {
    app.setView(v);
    renderer?.setView?.(v);
  }

  export function zoomBy(factor, anchor) {
    const rect = host.getBoundingClientRect();
    const ax = anchor?.x ?? rect.width / 2;
    const ay = anchor?.y ?? rect.height / 2;
    const v = store.view;
    const s = Math.max(0.25, Math.min(60, v.scale * factor));
    const k = s / v.scale;
    setView({ scale: s, tx: ax - (ax - v.tx) * k, ty: ay - (ay - v.ty) * k });
  }

  export function fit() {
    fitView();
  }

  function toArtboard(clientX, clientY) {
    const rect = host.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const v = store.view;
    return [(x - v.tx) / v.scale, (y - v.ty) / v.scale];
  }

  // ---- hit testing ----
  function hitTest(pt, opts = {}) {
    if (!spec) return null;
    const spotPick = opts.spots !== false;
    // spots first (they sit on top), then cells
    if (spotPick) {
      let best = null;
      for (const wing of spec.wings) {
        const m = wing.transform;
        for (const spot of wing.spots) {
          const cx = m.a * spot.x + m.c * spot.y + m.e;
          const cy = m.b * spot.x + m.d * spot.y + m.f;
          const rx = Math.abs(m.a) * spot.rx * 1.25 + 0.25;
          const ry = Math.abs(m.d) * spot.ry * 1.25 + 0.25;
          const d = Math.hypot(pt[0] - cx, pt[1] - cy);
          if (d < Math.max(rx, ry) && (!best || d < best.d)) best = { kind: 'spot', wing, spot, d };
        }
      }
      if (best) return best;
    }
    for (const wing of spec.wings) {
      const local = artboardToWing(wing, pt);
      for (const cell of wing.cells) {
        if (pointInPolygon(local[0], local[1], cell.poly)) return { kind: 'cell', wing, cell, local };
      }
    }
    return null;
  }

  let lastHoverKey = '';
  let hoverRaf = 0;
  function onPointerMove(e) {
    if (drag) {
      if (drag.mode === 'pan') {
        setView({ scale: store.view.scale, tx: drag.startTx + (e.clientX - drag.startX), ty: drag.startTy + (e.clientY - drag.startY) });
      } else if (drag.mode === 'spot') {
        const pt = toArtboard(e.clientX, e.clientY);
        const wing = drag.wing;
        const target = artboardToWing(wing, pt);
        const dx = target[0] - drag.lastLocal[0];
        const dy = target[1] - drag.lastLocal[1];
        drag.lastLocal = target;
        app.moveSpot(drag.spotId, dx, dy);
      } else if (drag.mode === 'spotResize') {
        const pt = toArtboard(e.clientX, e.clientY);
        const m = drag.wing.transform;
        const cx = m.a * drag.center[0] + m.c * drag.center[1] + m.e;
        const cy = m.b * drag.center[0] + m.d * drag.center[1] + m.f;
        const dist = Math.max(0.6, Math.hypot(pt[0] - cx, pt[1] - cy));
        const k = dist / drag.startDist;
        if (Math.abs(k - drag.lastK) > 0.004) {
          app.resizeSpot(drag.spotId, k / drag.lastK);
          drag.lastK = k;
        }
      }
      return;
    }
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      const pt = toArtboard(e.clientX, e.clientY);
      const hit = hitTest(pt);
      const key = hit ? `${hit.kind}:${hit.kind === 'cell' ? hit.cell.id : hit.spot.id}` : '';
      if (key === lastHoverKey) return;
      lastHoverKey = key;
      if (!hit) {
        app.setHover(null);
        cursor = 'default';
      } else if (hit.kind === 'spot') {
        app.setHover({ spotId: hit.spot.id });
        cursor = 'grab';
      } else {
        app.setHover({ cellId: hit.cell.id });
        cursor = 'pointer';
      }
    });
  }

  function onPointerDown(e) {
    if (e.button === 1 || (e.button === 0 && (store.tool === 'pan' || e.spaceKey || e.altKey))) {
      drag = { mode: 'pan', startX: e.clientX, startY: e.clientY, startTx: store.view.tx, startTy: store.view.ty };
      canvasEl.setPointerCapture?.(e.pointerId);
      cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    const pt = toArtboard(e.clientX, e.clientY);
    if (store.tool === 'pickColor') {
      const hit = hitTest(pt, { spots: false });
      if (hit?.kind === 'cell') {
        const col = cellColor(spec, hit.wing, hit.cell);
        app.setSelection({ cellId: hit.cell.id, wing: hit.wing.key });
        onpick({ kind: 'cell', cell: hit.cell, wing: hit.wing, color: col });
      }
      return;
    }
    // selected-spot handle first
    if (store.selection.spotId) {
      const found = findSpot(spec, store.selection.spotId);
      if (found) {
        const { wing, spot } = found;
        const m = wing.transform;
        const cx = m.a * spot.x + m.c * spot.y + m.e;
        const cy = m.b * spot.x + m.d * spot.y + m.f;
        const r = Math.max(2.4, Math.abs(m.a) * spot.rx * 1.25);
        const hx = cx + Math.max(6, r * 2.1);
        const hy = cy;
        if (Math.hypot(pt[0] - hx, pt[1] - hy) < 4.5) {
          drag = { mode: 'spotResize', spotId: spot.id, wing, center: [spot.x, spot.y], startDist: Math.hypot(pt[0] - cx, pt[1] - cy), lastK: 1 };
          canvasEl.setPointerCapture?.(e.pointerId);
          cursor = 'ew-resize';
          return;
        }
      }
    }
    const hit = hitTest(pt);
    if (!hit) {
      app.setSelection(null);
      return;
    }
    if (hit.kind === 'spot') {
      app.setSelection({ cellId: hit.spot.cellId, spotId: hit.spot.id, wing: hit.wing.key });
      onpick({ kind: 'spot', spot: hit.spot, wing: hit.wing });
      drag = { mode: 'spot', spotId: hit.spot.id, wing: hit.wing, lastLocal: artboardToWing(hit.wing, pt) };
      canvasEl.setPointerCapture?.(e.pointerId);
      cursor = 'grabbing';
    } else {
      app.setSelection({ cellId: hit.cell.id, wing: hit.wing.key });
      onpick({ kind: 'cell', cell: hit.cell, wing: hit.wing, color: cellColor(spec, hit.wing, hit.cell) });
    }
  }

  function onPointerUp(e) {
    if (drag) {
      if (drag.mode === 'spot' || drag.mode === 'spotResize') {
        app.pushLog(`调整斑点 ${drag.spotId.split('-').slice(-1)[0]} 的位置/大小`);
      }
      drag = null;
      canvasEl.releasePointerCapture?.(e.pointerId);
      cursor = 'default';
    }
  }

  function onWheel(e) {
    e.preventDefault();
    const rect = host.getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * 0.0016);
    zoomBy(factor, { x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  function onDblClick() {
    fitView();
  }

  $effect(() => {
    if (!renderer) return;
    renderer.setView?.({
      scale: store.view.scale,
      tx: store.view.tx,
      ty: store.view.ty
    });
  });

  // Keyboard: space to pan, F fit
  function isTyping(el) {
    const tag = el?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable;
  }

  function onKeyDown(e) {
    if (isTyping(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) app.redo();
      else app.undo();
      return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      app.redo();
      return;
    }
    if (mod && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      app.setSelection(null);
      return;
    }
    if (e.code === 'Space' && !e.repeat) {
      app.setSpaceKey(true);
      cursor = 'grab';
    }
    if (e.key === 'f' || e.key === 'F') fitView();
    if (e.key === 'l' || e.key === 'L') {
      if (store.selection.cellId) {
        const locked = app.toggleCellLock(store.selection.cellId);
        app.toast(locked ? '已锁定该翅室' : '已解锁该翅室', 'ok');
      }
      return;
    }
    if (e.key === '1' || e.key === '2' || e.key === '3') {
      app.setTool(['select', 'pan', 'pickColor'][Number(e.key) - 1]);
    }
    if (e.key === 'Escape' && drag) {
      drag = null;
      cursor = 'default';
    }
  }
  function onKeyUp(e) {
    if (e.code === 'Space') {
      app.setSpaceKey(false);
      cursor = 'default';
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  });

  onDestroy(() => {
    renderer?.destroy?.();
  });
</script>

<div class="viewport" bind:this={host} class:compact>
  <canvas
    bind:this={canvasEl}
    style:cursor
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onwheel={onWheel}
    ondblclick={onDblClick}
    oncontextmenu={(e) => e.preventDefault()}
  ></canvas>

  <div class="hud tl">
    <span class="badge" class:gpu={store.rendererBackend === 'webgpu'}>
      {store.rendererBackend === 'webgpu' ? 'WebGPU' : store.rendererBackend === 'canvas2d' ? 'Canvas2D' : '初始化…'}
    </span>
    <span class="zoom mono">{store.zoom.toFixed(2)}×</span>
  </div>

  <div class="hud br">
    <button class="ghost mini" onclick={() => zoomBy(1 / 1.25)} title="缩小">−</button>
    <button class="ghost mini" onclick={() => zoomBy(1.25)} title="放大">＋</button>
    <button class="ghost mini" onclick={fitView} title="适应窗口 (F)">⤢</button>
  </div>

  {#if store.tool === 'pan' || store.spaceKey}
    <div class="hint">拖动平移 · 滚轮缩放</div>
  {/if}
</div>

<style>
  .viewport {
    position: relative;
    width: 100%;
    height: 100%;
    background: #0e0f0c;
    overflow: hidden;
    border-radius: var(--radius);
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
  }
  .hud {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 6px;
    pointer-events: none;
  }
  .hud > * { pointer-events: auto; }
  .tl { top: 10px; left: 10px; }
  .br { bottom: 10px; right: 10px; }
  .badge {
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 3px 7px;
    border-radius: 999px;
    background: #ffffff10;
    color: var(--ink-3);
    border: 1px solid #ffffff14;
  }
  .badge.gpu { color: #a9d99a; border-color: #7fb06944; background: #7fb06914; }
  .zoom {
    font-size: 11px;
    color: var(--ink-3);
    background: #0b0d0a99;
    padding: 3px 7px;
    border-radius: 5px;
  }
  .mini {
    width: 26px;
    height: 26px;
    padding: 0;
    display: grid;
    place-items: center;
    background: #0b0d0acc;
    backdrop-filter: blur(6px);
    font-size: 13px;
    line-height: 1;
  }
  .hint {
    position: absolute;
    bottom: 10px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 11px;
    color: var(--ink-3);
    background: #0b0d0acc;
    padding: 4px 10px;
    border-radius: 999px;
    pointer-events: none;
  }
</style>
