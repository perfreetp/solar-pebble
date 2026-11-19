import { onCleanup, onMount, createSignal, createEffect, Show, getOwner, runWithOwner } from "solid-js";
import { Application } from 'pixi.js';
import { IsoRenderer, type RenderState } from './pixi';
import {
  addEntity,
  camera,
  clearSelection,
  drag,
  dropHint,
  endDrag,
  fitToScene,
  gizmoHandles,
  gizmoHover,
  hoverUid,
  interferingUids,
  isEditable,
  isSelected,
  panBy,
  pickAt,
  scene,
  screenToGround,
  selectOnly,
  selection,
  setCamera,
  setDrag,
  setDropHint,
  setGizmoHover,
  setHoverUid,
  setViewport,
  snapHint,
  startDrag,
  toggleSelect,
  toast,
  toasts,
  updateDrag,
  viewport,
  zoomAt,
} from './store';
import { PART_MAP } from '../../shared/parts';

function hitGizmo(g: NonNullable<ReturnType<typeof gizmoHandles>>, x: number, y: number): string | null {
  const near = (px: number, py: number, r: number) => Math.hypot(x - px, y - py) <= r;
  const nearSeg = (ax: number, ay: number, bx: number, by: number) => {
    if (near(ax, ay, 7)) return true;
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    let t = ((x - ax) * dx + (y - ay) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(x - (ax + dx * t), y - (ay + dy * t)) <= 8;
  };
  if (nearSeg(g.z.x, g.z.y, g.center.x, g.center.y)) return 'z';
  if (nearSeg(g.axis.x, g.axis.y, g.center.x, g.center.y)) return 'x';
  if (nearSeg(g.axisY.x, g.axisY.y, g.center.x, g.center.y)) return 'y';
  if (Math.abs(Math.hypot(x - g.rotate.x, y - g.rotate.y) - g.rotate.r) <= 8) return 'rot';
  return null;
}

export default function Canvas(props: { onContext?: (e: MouseEvent) => void }) {
  let host!: HTMLDivElement;
  let app: Application | null = null;
  let renderer: IsoRenderer | null = null;
  const [ready, setReady] = createSignal(false);
  const [cursor, setCursor] = createSignal('default');
  let panning: { x: number; y: number } | null = null;
  let raf = 0;
  let lastPick = { x: 0, y: 0, uid: null as string | null };

  function collectState(): RenderState {
    const d = drag();
    return {
      scene,
      selection: selection(),
      hover: hoverUid(),
      camera: camera(),
      gizmo: gizmoHandles(),
      gizmoHover: gizmoHover(),
      snapHint: snapHint(),
      interfering: interferingUids(),
      marquee: d.marquee,
      dragging: d.mode === 'move' || d.mode === 'axis' || d.mode === 'rotate',
      showPorts: true,
      showGrid: true,
      drop: dropHint(),
    };
  }

  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      renderer?.render(collectState());
    });
  }

  onMount(() => {
    // Async init loses Solid's owner; capture it so onCleanup still registers.
    const owner = getOwner();
    const init = async () => {
      app = new Application();
      await app.init({
        background: '#101720',
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
        resizeTo: host,
        preference: 'webgl',
      });
      host.appendChild(app.canvas);
      renderer = new IsoRenderer(app);
      setReady(true);
      const rect = host.getBoundingClientRect();
      setViewport({ w: rect.width, h: rect.height });
      setCamera({ x: rect.width / 2 - 500, y: rect.height / 2 + 140, zoom: 0.26 });
      requestAnimationFrame(() => fitToScene());

      const ro = new ResizeObserver(() => {
        const r = host.getBoundingClientRect();
        setViewport({ w: r.width, h: r.height });
        schedule();
      });
      ro.observe(host);

      // Demand-driven rendering: redraw only when editor state changes.
      createEffect(() => {
        // touch every signal that affects the picture
        selection();
        hoverUid();
        camera();
        gizmoHover();
        snapHint();
        interferingUids();
        dropHint();
        drag();
        // and a couple of structural counters so adding/removing parts redraws
        scene.entities.length;
        scene.layers;
        for (const e of scene.entities) { e.pos.x; e.pos.y; e.pos.z; e.rot; e.size; e.color; e.hidden; e.locked; }
        schedule();
      });

      onCleanup(() => {
        ro.disconnect();
        cancelAnimationFrame(raf);
        renderer?.destroy();
        renderer = null;
        app = null;
      });
    };
    runWithOwner(owner, () => { void init(); });
  });

  const toLocal = (e: { clientX: number; clientY: number }) => {
    const r = host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function onPointerDown(e: PointerEvent) {
    if (e.button === 2) return;
    const p = toLocal(e);
    host.setPointerCapture(e.pointerId);

    if (e.button === 1 || (e.altKey && e.button === 0)) {
      panning = { x: p.x, y: p.y };
      setCursor('grabbing');
      return;
    }

    // Gizmo handles take priority only when a selection already exists and the
    // press is clearly on a handle (not on a body that happens to be underneath).
    const g = gizmoHandles();
    if (g && selection().length && selection().every(isEditable)) {
      const hit = hitGizmo(g, p.x, p.y);
      if (hit === 'rot') {
        const ang = Math.atan2(p.y - g.center.y, p.x - g.center.x);
        startDrag('rotate', p.x, p.y, { startAngle: ang });
        return;
      }
      if (hit) {
        startDrag('axis', p.x, p.y, { axis: hit as 'x' | 'y' | 'z' });
        return;
      }
    }

    const hits = pickAt(p.x, p.y);
    if (hits.length) {
      const top = hits[0];
      let pick = top;
      // Clicking the same spot cycles deeper, to reach parts hidden behind others.
      if (lastPick.uid && Math.hypot(p.x - lastPick.x, p.y - lastPick.y) < 4 && hits.includes(lastPick.uid)) {
        const idx = hits.indexOf(lastPick.uid);
        pick = hits[(idx + 1) % hits.length];
      }
      const sameAgain = lastPick.uid === pick && Math.hypot(p.x - lastPick.x, p.y - lastPick.y) < 4;
      lastPick = { x: p.x, y: p.y, uid: pick };

      if (e.shiftKey || e.ctrlKey) {
        toggleSelect(pick);
      } else if (!isSelected(pick) || sameAgain) {
        selectOnly(pick);
      }
      if (hits.length > 1) {
        const idx = hits.indexOf(pick);
        toast(`此处叠放 ${hits.length} 个零件 · 已选中第 ${idx + 1} 个${idx < hits.length - 1 ? '，再次点击可穿透下一件' : ''}`, 'info');
      }
      if (isEditable(pick)) {
        startDrag('pending', p.x, p.y);
      } else {
        setCursor('not-allowed');
      }
      schedule();
      return;
    }
    if (!e.shiftKey) clearSelection();
    startDrag('marquee', p.x, p.y);
    schedule();
  }

  function onPointerMove(e: PointerEvent) {
    const p = toLocal(e);
    if (panning) {
      panBy(p.x - panning.x, p.y - panning.y);
      panning = { x: p.x, y: p.y };
      schedule();
      return;
    }
    const d = drag();
    if (d.mode === 'pending') {
      if (Math.hypot(p.x - d.startScreen.x, p.y - d.startScreen.y) > 4) {
        setDrag({ ...d, mode: 'move' });
        updateDrag(p.x, p.y);
      }
      return;
    }
    if (d.mode !== 'none') {
      updateDrag(p.x, p.y);
      schedule();
      return;
    }
    const g = gizmoHandles();
    if (g && selection().length) {
      const hit = hitGizmo(g, p.x, p.y);
      if (hit !== gizmoHover()) {
        setGizmoHover(hit);
        setCursor(hit ? 'pointer' : 'default');
        schedule();
        return;
      }
      if (hit) {
        setCursor('pointer');
        return;
      }
    }
    const hits = pickAt(p.x, p.y);
    const h = hits[0] ?? null;
    if (h !== hoverUid()) {
      setHoverUid(h);
      schedule();
    }
    setCursor(h ? 'pointer' : 'default');
  }

  function onPointerUp(e: PointerEvent) {
    if (panning) {
      panning = null;
      setCursor('default');
      return;
    }
    endDrag();
    try { host.releasePointerCapture(e.pointerId); } catch {}
    schedule();
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const p = toLocal(e);
    if (e.shiftKey) {
      panBy(-e.deltaY, 0);
    } else {
      zoomAt(p.x, p.y, e.deltaY < 0 ? 1.1 : 1 / 1.1);
    }
    schedule();
  }

  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('application/x-kd-part')) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    const p = toLocal(e);
    const g = screenToGround(p.x, p.y, 0);
    setDropHint({ x: g.x, y: g.y, z: 0, on: null });
    schedule();
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    const defId = e.dataTransfer?.getData('application/x-kd-part');
    setDropHint(null);
    if (!defId || !PART_MAP[defId]) return;
    const p = toLocal(e);
    const g = screenToGround(p.x, p.y, 0);
    addEntity(defId, g);
    schedule();
  }

  return (
    <div
      ref={host}
      class="canvas-host"
      style={{ cursor: cursor() }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerUp}
      onWheel={onWheel}
      onContextMenu={(e) => { e.preventDefault(); props.onContext?.(e); }}
      onDragOver={onDragOver}
      onDragLeave={() => { setDropHint(null); schedule(); }}
      onDrop={onDrop}
    >
      <Show when={!ready()}>
        <div class="canvas-loading">正在初始化三维画布…</div>
      </Show>
      <div class="canvas-badge">
        <span>等轴测投影</span>
        <span class="dot" />
        <span>深度排序 · 穿透选择</span>
      </div>
      <Show when={selection().length > 0}>
        <div class="canvas-hint">
          拖动 X / Y 轴平移 · Z 轴升降 · 外圈旋转（15° 吸附）｜ 滚轮缩放 · 中键/Alt 平移
        </div>
      </Show>
      <div class="toast-stack">
        {toasts().map((t) => (
          <div class={`toast toast-${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}
