<script>
  import { onMount, onDestroy } from 'svelte';
  import { VoxelEngine } from '../lib/voxelEngine.js';

  let {
    voxels = $bindable(null),
    interactive = true,
    readonly = false,
    showGrid = true,
    cameraMode = 'perspective',
    hiddenLayers = [],
    activeLayer = 0,
    layerLocked = false,
    selection = [],
    diffAdded = [],
    diffRemoved = [],
    annotations = [],
    tool = 'brush',
    onPaint, onErase, onFill, onMarquee, onSelectConnected, onEmptyTap, onAnnotationClick,
    registerEngine
  } = $props();

  let canvas;
  let engine;
  let marquee = $state(null);
  let ready = $state(false);
  let resizeObserver;
  let bootTimer;

  onMount(() => {
    let cancelled = false;
    const boot = () => {
      if (cancelled || engine) return;
      // 容器没有布局尺寸时再等一帧
      const rect = canvas.parentElement.getBoundingClientRect();
      if (rect.width < 50 || rect.height < 50) return requestAnimationFrame(boot);
      engine = new VoxelEngine(canvas, {
        interactive,
        readonly,
        tool,
        onPaint: (...a) => onPaint?.(...a),
        onErase: (...a) => onErase?.(...a),
        onFill: (...a) => onFill?.(...a),
        onMarquee: (min, max) => { marquee = { min, max }; onMarquee?.(min, max); },
        onSelectConnected: (...a) => onSelectConnected?.(...a),
        onEmptyTap: (...a) => onEmptyTap?.(...a)
      });
      engine.engine.resize();
      registerEngine?.(engine);
      engine.setVoxels(voxels ?? new Map());
      engine.setGridVisible(showGrid);
      engine.setCameraMode(cameraMode);
      engine.setHiddenLayers(hiddenLayers);
      engine.setActiveLayer(activeLayer, layerLocked);
      engine.setLayerPlane(activeLayer, layerLocked);
      engine.setSelection(selection);
      engine.setDiff(diffAdded, diffRemoved);
      engine.setAnnotations(annotations, (a) => onAnnotationClick?.(a));
      ready = true;
    };
    requestAnimationFrame(boot);
    // 无头浏览器/极端时序下 rAF 可能不及时,定时兜底直到容器就绪
    const fallback = setInterval(() => {
      if (engine || cancelled) { clearInterval(fallback); return; }
      boot();
    }, 60);
    bootTimer = fallback;

    // 容器尺寸变化(面板折叠、窗口缩放)时同步画布分辨率
    const ro = new ResizeObserver(() => engine?.engine.resize());
    ro.observe(canvas.parentElement);
    resizeObserver = ro;

    return () => {
      cancelled = true;
      clearInterval(fallback);
      ro.disconnect();
      engine?.dispose();
      engine = null;
    };
  });

  // 引擎就绪后,各 $effect 自动重放一次,把最新 props 同步进去
  $effect(() => { if (ready && engine && voxels) engine.setVoxels(voxels); });
  $effect(() => { if (ready && engine) engine.setGridVisible(showGrid); });
  $effect(() => { if (ready && engine) engine.setCameraMode(cameraMode); });
  $effect(() => { if (ready && engine) engine.setHiddenLayers(hiddenLayers); });
  $effect(() => { if (ready && engine) { engine.setActiveLayer(activeLayer, layerLocked); engine.setLayerPlane(activeLayer, layerLocked); } });
  $effect(() => { if (ready && engine) engine.setSelection(selection); });
  $effect(() => { if (ready && engine) engine.setDiff(diffAdded, diffRemoved); });
  $effect(() => { if (ready && engine) engine.setAnnotations(annotations, (a) => onAnnotationClick?.(a)); });
  $effect(() => { if (ready && engine) engine.setTool(tool); });
</script>

<div class="viewport">
  <canvas bind:this={canvas}></canvas>
  {#if marquee && tool === 'select'}
    <div class="marquee-hint">
      框选区域:X {marquee.min.x}~{marquee.max.x} · Y {marquee.min.y}~{marquee.max.y} · Z {marquee.min.z}~{marquee.max.z}
    </div>
  {/if}
</div>

<style>
  .viewport { position: relative; width: 100%; height: 100%; border-radius: var(--radius); overflow: hidden; background: #eef4f9; }
  canvas { width: 100%; height: 100%; outline: none; touch-action: none; }
  .marquee-hint {
    position: absolute; left: 12px; bottom: 12px;
    background: rgba(36,52,71,.85); color: #fff;
    padding: 6px 12px; border-radius: 999px; font-size: 12px;
  }
</style>
