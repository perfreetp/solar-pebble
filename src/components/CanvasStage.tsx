import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import type { Annotation, Pt } from '../types';
import {
  docState, commitHistory, updatePath, appendNode, closePath, addPathFromPen,
  selectOnly, toggleSelection, beginInteraction, endInteraction,
  zoomAt, panBy, addGuide, moveGuide, deleteGuide, deleteSelected,
  undo, redo, selectAll,
} from '../store/docStore';
import { snapPoint } from '../lib/snap';
import { hitTest, screenToDoc, hitGuide, type DragState } from '../lib/hitTest';

interface Props {
  readOnly?: boolean;
  onDrawAnnotation?: (cx: number, cy: number, r: number) => void;
  annotations?: Annotation[];
}

export default function CanvasStage(props: Props) {
  let wrapperEl: HTMLDivElement | undefined;
  let canvasEl: HTMLCanvasElement | undefined;
  let worker: Worker | null = null;
  let drag: DragState | null = null;
  let penPathId: string | null = null;
  let pendingSnap: { target: unknown; smart: unknown[] } | null = null;
  let annDraft: { cx: number; cy: number } | null = null;
  const [annTick, setAnnTick] = createSignal(0);
  let lastScreen: Pt = { x: 0, y: 0 };
  let spaceDown = false;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  onMount(() => {
    worker = new Worker(new URL('../workers/render.worker.ts', import.meta.url), { type: 'module' });
    const offscreen = canvasEl!.transferControlToOffscreen();
    worker.postMessage({ type: 'init', canvas: offscreen, dpr }, [offscreen]);
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrapperEl!);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    onCleanup(() => {
      ro.disconnect();
      worker?.terminate();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    });
  });

  function resize() {
    if (!wrapperEl || !canvasEl) return;
    const rect = wrapperEl.getBoundingClientRect();
    // transferControlToOffscreen 后主线程不能再改 canvas 的 width/height,
    // 只能改 CSS 尺寸;位图尺寸由 worker 在 OffscreenCanvas 上调整
    canvasEl.style.width = `${rect.width}px`;
    canvasEl.style.height = `${rect.height}px`;
    worker?.postMessage({
      type: 'resize',
      width: Math.round(rect.width * dpr),
      height: Math.round(rect.height * dpr),
      cssWidth: rect.width,
      cssHeight: rect.height,
    });
  }

  // 任意信号变化 → 推送渲染状态给 OffscreenCanvas Worker
  createEffect(() => {
    const patch = {
      paths: docState.paths(),
      guides: docState.guides(),
      view: docState.viewTransform(),
      bg: docState.bgImage(),
      bgOpacity: docState.bgOpacity(),
      showGrid: docState.showGrid(),
      selection: [...docState.selection()],
      activePathId: docState.activePathId(),
      hover: docState.hoverInfo(),
      snapTarget: pendingSnap?.target ?? null,
      smartGuides: pendingSnap?.smart ?? [],
      penPreview: penPreviewPts(),
      annotations: props.annotations ?? [],
      reviewAnnotation: annDraft
        ? {
            id: 'draft', kind: 'reject' as const, comment: '', author: '', createdAt: 0,
            cx: annDraft.cx, cy: annDraft.cy,
            r: Math.hypot(lastDoc.x - annDraft.cx, lastDoc.y - annDraft.cy),
            tick: annTick(),
          }
        : null,
      readOnly: !!props.readOnly,
      dpr,
    };
    worker?.postMessage({ type: 'patch', patch });
  });

  const lastDoc: Pt = { x: 0, y: 0 };

  function penPreviewPts(): Pt[] | null {
    if (!penPathId) return null;
    const p = docState.paths().find(x => x.id === penPathId);
    return p ? p.nodes.map(n => ({ ...n })) : null;
  }

  function eventPoint(e: PointerEvent | WheelEvent): Pt {
    const rect = canvasEl!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // ---------- 指针按下 ----------
  function onPointerDown(e: PointerEvent) {
    canvasEl?.setPointerCapture(e.pointerId);
    const sp = eventPoint(e);
    lastScreen = { ...sp };
    const docPt = screenToDoc(sp.x, sp.y, docState.viewTransform());
    lastDoc.x = docPt.x; lastDoc.y = docPt.y;

    if (props.readOnly && props.onDrawAnnotation) {
      annDraft = { cx: docPt.x, cy: docPt.y };
      return;
    }
    if (props.readOnly) return;

    const toolType = docState.tool().type;
    if (toolType === 'pan' || e.button === 1 || spaceDown) {
      drag = { type: 'pan', startDoc: docPt, moved: false, pointerId: e.pointerId };
      return;
    }

    if (toolType === 'guide') {
      const g = hitGuide(docPt, docState.guides(), docState.viewTransform());
      drag = {
        type: 'guide', startDoc: docPt, moved: false, pointerId: e.pointerId,
        guideId: g?.id,
      };
      return;
    }

    if (toolType === 'pen') {
      handlePenDown(docPt, e);
      return;
    }

    // select 工具命中测试
    const hit = hitTest(docPt, docState.paths(), docState.viewTransform());
    if (hit.kind === 'handle') {
      beginInteraction();
      drag = {
        type: 'handle', pathId: hit.pathId, nodeIndex: hit.nodeIndex, which: hit.which,
        startDoc: docPt, moved: false, pointerId: e.pointerId,
      };
      return;
    }
    if (hit.kind === 'node') {
      const p = docState.paths().find(x => x.id === hit.pathId)!;
      // Shift 多选(不进入拖拽)
      if (e.shiftKey) { toggleSelection(hit.pathId); return; }
      if (!docState.selection().has(hit.pathId)) selectOnly(hit.pathId);
      beginInteraction();
      drag = {
        type: 'node', pathId: hit.pathId, nodeIndex: hit.nodeIndex,
        startDoc: docPt, startNodes: p.nodes.map(n => ({ ...n })),
        moved: false, pointerId: e.pointerId,
      };
      return;
    }
    if (hit.kind === 'stroke') {
      const p = docState.paths().find(x => x.id === hit.pathId)!;
      if (p.locked) return;
      if (e.shiftKey) { toggleSelection(hit.pathId); return; }
      if (!docState.selection().has(hit.pathId)) selectOnly(hit.pathId);
      beginInteraction();
      const sel = docState.paths().filter(x => docState.selection().has(x.id) && !x.locked);
      drag = {
        type: 'path', startDoc: docPt, moved: false, pointerId: e.pointerId,
        startNodes: sel.flatMap(x => x.nodes.map(n => ({ ...n }))),
      };
      (drag as DragState & { ids?: string[] }).ids = sel.map(x => x.id);
      return;
    }
    selectOnly(null);
    drag = { type: 'pan', startDoc: docPt, moved: false, pointerId: e.pointerId };
  }

  function handlePenDown(docPt: Pt, e: PointerEvent) {
    if (!penPathId) {
      const p = addPathFromPen(docState.penKind());
      penPathId = p.id;
      appendNode(penPathId, docPt, false);
      return;
    }
    const p = docState.paths().find(x => x.id === penPathId);
    if (!p) { penPathId = null; return; }
    if (!p.closed && p.nodes.length >= 3) {
      const first = p.nodes[0];
      const tol = 10 / docState.viewTransform().scale;
      if (Math.hypot(first.x - docPt.x, first.y - docPt.y) < tol) {
        closePath(penPathId);
        penPathId = null;
        selectOnly(p.id);
        return;
      }
    }
    appendNode(penPathId, docPt, !e.shiftKey);
  }

  // ---------- 指针移动 ----------
  function onPointerMove(e: PointerEvent) {
    const sp = eventPoint(e);
    const docPt = screenToDoc(sp.x, sp.y, docState.viewTransform());
    lastDoc.x = docPt.x; lastDoc.y = docPt.y;

    if (annDraft) { setAnnTick(t => t + 1); return; }

    if (!drag) {
      updateHover(docPt);
      return;
    }
    const d = drag;
    d.moved = true;

    if (d.type === 'pan') {
      panBy(sp.x - lastScreen.x, sp.y - lastScreen.y);
      lastScreen = { ...sp };
      return;
    }

    if (d.type === 'guide') {
      if (!d.guideId) {
        const dx = Math.abs(docPt.x - d.startDoc.x);
        const dy = Math.abs(docPt.y - d.startDoc.y);
        if (dx + dy > 4) {
          const orientation = dx > dy ? 'v' : 'h';
          addGuide(orientation, orientation === 'h' ? docPt.y : docPt.x);
          d.guideId = docState.guides()[docState.guides().length - 1].id;
        }
      } else {
        const g = docState.guides().find(x => x.id === d.guideId);
        if (g) moveGuide(g.id, g.orientation === 'h' ? docPt.y : docPt.x);
      }
      return;
    }

    if (d.type === 'node') {
      const pathId = d.pathId!;
      const nodeIndex = d.nodeIndex!;
      const snapped = snapPoint(
        docPt, docState.paths(), docState.guides(),
        { pathId, index: nodeIndex },
        docState.viewTransform().scale,
      );
      pendingSnap = { target: snapped.target, smart: snapped.smartGuides };
      docState.setHoverInfo({
        pathId, nodeIndex,
        snap: snapped.target ? describeSnap(snapped.target) : undefined,
      });
      const delta = { x: snapped.point.x - d.startDoc.x, y: snapped.point.y - d.startDoc.y };
      const base = d.startNodes![nodeIndex];
      updatePath(pathId, p => {
        p.nodes[nodeIndex] = { x: base.x + delta.x, y: base.y + delta.y };
      });
      return;
    }

    if (d.type === 'handle') {
      const pathId = d.pathId!;
      const nodeIndex = d.nodeIndex!;
      const which = d.which!;
      const p0 = docState.paths().find(x => x.id === pathId)!;
      const node = p0.nodes[nodeIndex];
      const rel = { x: docPt.x - node.x, y: docPt.y - node.y };
      const mirror = { x: -rel.x, y: -rel.y };
      updatePath(pathId, p => {
        if (which === 'in') p.handlesIn[nodeIndex] = { ...rel };
        else p.handlesOut[nodeIndex] = { ...rel };
        if (!e.shiftKey) {
          if (which === 'in') p.handlesOut[nodeIndex] = mirror;
          else p.handlesIn[nodeIndex] = mirror;
        }
      });
      return;
    }

    if (d.type === 'path') {
      const ids = (d as DragState & { ids?: string[] }).ids ?? [];
      const delta = { x: docPt.x - d.startDoc.x, y: docPt.y - d.startDoc.y };
      let cursor = 0;
      ids.forEach(id => {
        const path = docState.paths().find(x => x.id === id);
        if (!path) return;
        const baseSlice = d.startNodes!.slice(cursor, cursor + path.nodes.length);
        updatePath(id, p => {
          p.nodes.forEach((n, i) => {
            n.x = baseSlice[i].x + delta.x;
            n.y = baseSlice[i].y + delta.y;
          });
          p.holes.forEach(ring => ring.forEach(q => { q.x += delta.x; q.y += delta.y; }));
        });
        cursor += path.nodes.length;
      });
    }
  }

  // ---------- 指针抬起 ----------
  function onPointerUp(e: PointerEvent) {
    const sp = eventPoint(e);
    const docPt = screenToDoc(sp.x, sp.y, docState.viewTransform());

    if (annDraft && props.onDrawAnnotation) {
      const r = Math.hypot(docPt.x - annDraft.cx, docPt.y - annDraft.cy);
      if (r > 8) props.onDrawAnnotation(annDraft.cx, annDraft.cy, r);
      annDraft = null;
      return;
    }

    if (drag) {
      if (drag.type === 'guide' && !drag.guideId && !drag.moved) {
        addGuide(e.shiftKey ? 'v' : 'h', e.shiftKey ? docPt.x : docPt.y);
      }
      if (drag.type === 'node' || drag.type === 'handle' || drag.type === 'path') {
        endInteraction();
        if (drag.moved) commitHistory();
      }
      drag = null;
    }
    pendingSnap = null;
    docState.setHoverInfo({});
  }

  function onDblClick() {
    if (penPathId) {
      const p = docState.paths().find(x => x.id === penPathId);
      if (p && p.nodes.length >= 2) {
        // 双击的第二次单击会追加一个与末点几乎重合的节点,先剔除
        const n = p.nodes;
        if (n.length >= 2) {
          const a = n[n.length - 1], b = n[n.length - 2];
          if (Math.hypot(a.x - b.x, a.y - b.y) < 8 / docState.viewTransform().scale) {
            updatePath(penPathId, pp => {
              pp.nodes.pop();
              pp.handlesIn.pop();
              pp.handlesOut.pop();
            });
          }
        }
        closePath(penPathId);
        selectOnly(penPathId);
      }
      penPathId = null;
    }
  }

  function updateHover(docPt: Pt) {
    if (props.readOnly || docState.tool().type !== 'select') {
      docState.setHoverInfo({});
      return;
    }
    const hit = hitTest(docPt, docState.paths(), docState.viewTransform());
    if (hit.kind === 'handle') {
      docState.setHoverInfo({ pathId: hit.pathId, nodeIndex: hit.nodeIndex, handle: hit.which });
      canvasEl!.style.cursor = 'grab';
    } else if (hit.kind === 'node') {
      docState.setHoverInfo({ pathId: hit.pathId, nodeIndex: hit.nodeIndex });
      canvasEl!.style.cursor = 'crosshair';
    } else if (hit.kind === 'stroke') {
      docState.setHoverInfo({ pathId: hit.pathId });
      canvasEl!.style.cursor = 'move';
    } else {
      docState.setHoverInfo({});
      canvasEl!.style.cursor = 'default';
    }
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const sp = eventPoint(e);
    if (e.ctrlKey || e.metaKey) {
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, sp);
    } else {
      panBy(-e.deltaX, -e.deltaY);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    const el = document.activeElement;
    const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    if (e.code === 'Space') { spaceDown = true; if (canvasEl) canvasEl.style.cursor = 'grab'; return; }
    if (typing || props.readOnly) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault(); redo(); return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault(); selectAll(); return;
    }
    if (e.key === 'Escape') {
      penPathId = null;
      selectOnly(null);
      docState.setTool({ type: 'select' });
    }
    if (e.key === 'Enter' && penPathId) onDblClick();
    if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
  }
  function onKeyUp(e: KeyboardEvent) {
    if (e.code === 'Space') {
      spaceDown = false;
      if (canvasEl && docState.tool().type === 'select') canvasEl.style.cursor = 'default';
    }
  }

  function describeSnap(t: unknown): string {
    const type = (t as { type: string }).type;
    if (type === 'node') return '已吸附:节点';
    if (type === 'hguide') return '已吸附:水平参考线';
    if (type === 'vguide') return '已吸附:垂直参考线';
    return '智能对齐';
  }

  // 参考线快捷删除:Ctrl+G 删除指针下参考线
  function onContextMenu(e: MouseEvent) {
    const rect = canvasEl!.getBoundingClientRect();
    const docPt = screenToDoc(e.clientX - rect.left, e.clientY - rect.top, docState.viewTransform());
    const g = hitGuide(docPt, docState.guides(), docState.viewTransform());
    if (g) { e.preventDefault(); deleteGuide(g.id); }
  }

  return (
    <div ref={wrapperEl} class="canvas-stage">
      <canvas
        ref={canvasEl}
        width={1200}
        height={800}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDblClick={onDblClick}
        onWheel={onWheel}
        onContextMenu={onContextMenu}
      />
      <div class="canvas-hud">
        <span>缩放 {Math.round(docState.viewTransform().scale * 100)}%</span>
        {docState.hoverInfo().snap && <span class="snap-badge">{docState.hoverInfo().snap}</span>}
        {docState.tool().type === 'pen' && (
          <span class="pen-hint">钢笔:单击加点 · Shift 加直线点 · 点首节点/双击/回车闭合 · Esc 取消</span>
        )}
        {docState.tool().type === 'guide' && (
          <span class="pen-hint">参考线:拖拽方向决定水平/垂直 · 右键参考线删除</span>
        )}
        {props.readOnly && <span class="pen-hint">审校圈注:在图上拖出圆圈后填写意见</span>}
      </div>
    </div>
  );
}
