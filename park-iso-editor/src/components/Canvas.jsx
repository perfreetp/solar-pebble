import { createMemo, createEffect, createSignal, onMount, For, Show } from 'solid-js';
import { select, pointer, zoom, zoomIdentity } from 'd3';
import 'd3-transition';
import { state, setState, actions } from '../store';
import { makeProjector, groundCirclePath, ptsStr } from '../iso';
import { effDims, validatePositions, computeCoverage } from '../geometry';
import { TYPES } from '../model';
import { IsoObject, Gizmo } from './Shapes';

const snap05 = (v) => Math.round(v * 2) / 2;

export default function Canvas() {
  let svgRef;
  const [viewT, setViewT] = createSignal(zoomIdentity);
  const [dragInvalid, setDragInvalid] = createSignal(false);
  const [movingIds, setMovingIds] = createSignal([]);

  const projector = createMemo(() => makeProjector(state.camera));
  const objects = () => (state.review ? state.review.objects : state.objects);
  const sortedObjects = createMemo(() => {
    const p = projector();
    return [...objects()].sort((a, b) => p.depth(a.x, a.y, a.z) - p.depth(b.x, b.y, b.z));
  });

  // 点位覆盖(学员实时反馈 / 老师复核)
  const coverage = createMemo(() => {
    if (state.review) {
      return { covered: state.review.covered, missed: state.review.missed, score: 0, total: 0 };
    }
    return computeCoverage(state.objects, state.task.points);
  });

  const selectedObj = createMemo(() =>
    state.selected.length === 1 && !state.review
      ? state.objects.find((o) => o.id === state.selected[0])
      : null
  );

  // ---------- 网格与场地 ----------
  const gridLines = createMemo(() => {
    const p = projector();
    const { w, d, elevation } = state.site;
    const lines = [];
    for (let x = -w / 2; x <= w / 2 + 1e-6; x += 5) {
      lines.push({ pts: [p.project(x, -d / 2, elevation), p.project(x, d / 2, elevation)], major: true });
    }
    for (let y = -d / 2; y <= d / 2 + 1e-6; y += 5) {
      lines.push({ pts: [p.project(-w / 2, y, elevation), p.project(w / 2, y, elevation)], major: true });
    }
    for (let x = -w / 2 + 1; x < w / 2; x += 1) {
      if (x % 5 === 0) continue;
      lines.push({ pts: [p.project(x, -d / 2, elevation), p.project(x, d / 2, elevation)], major: false });
    }
    for (let y = -d / 2 + 1; y < d / 2; y += 1) {
      if (y % 5 === 0) continue;
      lines.push({ pts: [p.project(-w / 2, y, elevation), p.project(w / 2, y, elevation)], major: false });
    }
    return lines;
  });

  const siteOutline = createMemo(() => {
    const p = projector();
    const { w, d, elevation } = state.site;
    return ptsStr([
      p.project(-w / 2, -d / 2, elevation), p.project(w / 2, -d / 2, elevation),
      p.project(w / 2, d / 2, elevation), p.project(-w / 2, d / 2, elevation),
    ]);
  });

  // ---------- 坐标换算 ----------
  function svgPoint(e) {
    const pt = pointer(e, svgRef);
    return viewT().invert(pt);
  }

  // ---------- 拖拽(物体 XY / 单轴) ----------
  let drag = null;

  function beginDrag(e, mode, axis) {
    if (state.review) return;
    const ids = [...state.selected];
    if (!ids.length) return;
    const starts = {};
    for (const id of ids) {
      const o = state.objects.find((x) => x.id === id);
      if (o) starts[id] = { x: o.x, y: o.y, z: o.z, rot: o.rot, type: o.type };
    }
    drag = { mode, axis, startPt: svgPoint(e), starts, ids, invalid: false };
    setMovingIds(ids);
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd, { once: true });
  }

  function onDragMove(e) {
    if (!drag) return;
    const p = projector();
    const pt = svgPoint(e);
    const next = {};

    if (drag.mode === 'xy') {
      const first = drag.starts[drag.ids[0]];
      const g0 = p.unprojectGround(drag.startPt[0], drag.startPt[1], first.z);
      const g1 = p.unprojectGround(pt[0], pt[1], first.z);
      const dx = snap05(g1[0] - g0[0]);
      const dy = snap05(g1[1] - g0[1]);
      for (const id of drag.ids) {
        const s = drag.starts[id];
        next[id] = { ...s, x: s.x + dx, y: s.y + dy };
      }
    } else {
      const dir = p.axisDir(drag.axis);
      const delta = snap05((pt[0] - drag.startPt[0]) * dir[0] + (pt[1] - drag.startPt[1]) * dir[1]);
      for (const id of drag.ids) {
        const s = drag.starts[id];
        const n = { ...s };
        if (drag.axis === 'x') n.x = s.x + delta;
        else if (drag.axis === 'y') n.y = s.y + delta;
        else n.z = Math.max(0, s.z + delta);
        next[id] = n;
      }
    }

    const ok = validatePositions(next, state.objects, drag.ids, state.site);
    drag.invalid = !ok;
    setDragInvalid(!ok);
    for (const id of drag.ids) {
      const n = next[id];
      setState('objects', (o) => o.id === id, { x: n.x, y: n.y, z: n.z });
    }
  }

  function onDragEnd() {
    window.removeEventListener('pointermove', onDragMove);
    if (!drag) return;
    if (drag.invalid) {
      // 越界/碰撞:推回原位
      for (const id of drag.ids) {
        const s = drag.starts[id];
        setState('objects', (o) => o.id === id, { x: s.x, y: s.y, z: s.z });
      }
    } else if (state.snapGround) {
      // 贴地吸附:底座落回设定高程
      for (const id of drag.ids) {
        setState('objects', (o) => o.id === id, 'z', state.site.elevation);
      }
    }
    drag = null;
    setDragInvalid(false);
    setMovingIds([]);
  }

  function onObjPointerDown(e, obj) {
    if (state.review) return;
    if (state.taskPlacing) return; // 放置点位时让背景 handler 处理
    e.stopPropagation();
    if (e.shiftKey) {
      actions.toggleSelect(obj.id);
      return;
    }
    if (!state.selected.includes(obj.id)) actions.setSelection([obj.id]);
    // 等 selection 生效后再开始拖
    queueMicrotask(() => beginDrag(e, 'xy'));
  }

  function onAxisDown(e, axis) {
    if (state.review || state.taskPlacing) return;
    e.stopPropagation();
    e.preventDefault();
    beginDrag(e, 'axis', axis);
  }

  // ---------- 任务点位拖拽(老师) ----------
  let ptDrag = null;
  function onTaskPointDown(e, pt) {
    if (state.role !== 'teacher' || state.review || state.taskPlacing) return;
    e.stopPropagation();
    ptDrag = { id: pt.id, startPt: svgPoint(e), sx: pt.x, sy: pt.y };
    window.addEventListener('pointermove', onPtMove);
    window.addEventListener('pointerup', onPtEnd, { once: true });
  }
  function onPtMove(e) {
    if (!ptDrag) return;
    const p = projector();
    const pt = svgPoint(e);
    const g0 = p.unprojectGround(ptDrag.startPt[0], ptDrag.startPt[1], state.site.elevation);
    const g1 = p.unprojectGround(pt[0], pt[1], state.site.elevation);
    const nx = snap05(ptDrag.sx + g1[0] - g0[0]);
    const ny = snap05(ptDrag.sy + g1[1] - g0[1]);
    const { w, d } = state.site;
    actions.updateTaskPoint(ptDrag.id, {
      x: Math.max(-w / 2, Math.min(w / 2, nx)),
      y: Math.max(-d / 2, Math.min(d / 2, ny)),
    });
  }
  function onPtEnd() {
    window.removeEventListener('pointermove', onPtMove);
    ptDrag = null;
  }

  // ---------- 背景点击:取消选择 / 放置任务点位 ----------
  let downPt = null;
  function onBgPointerDown(e) {
    downPt = [e.clientX, e.clientY];
  }
  function onBgPointerUp(e) {
    if (!downPt) return;
    const moved = Math.hypot(e.clientX - downPt[0], e.clientY - downPt[1]);
    downPt = null;
    if (moved > 4) return;
    if (state.review) return;
    if (state.taskPlacing && state.role === 'teacher') {
      const p = projector();
      const [sx, sy] = svgPoint(e);
      const [gx, gy] = p.unprojectGround(sx, sy, state.site.elevation);
      const { w, d } = state.site;
      if (Math.abs(gx) <= w / 2 && Math.abs(gy) <= d / 2) {
        actions.addTaskPoint(state.taskPlacing, gx, gy);
      }
      setState('taskPlacing', null);
      return;
    }
    if (!e.shiftKey) actions.setSelection([]);
  }

  // ---------- 缩放平移 + 初始取景 ----------
  let zmRef = null;
  let svgSel = null;

  function fitView(animate = false) {
    if (!zmRef || !svgSel) return;
    const p = projector();
    const { w, d } = state.site;
    const corners = [
      p.project(-w / 2, -d / 2, 0), p.project(w / 2, -d / 2, 0),
      p.project(w / 2, d / 2, 0), p.project(-w / 2, d / 2, 0),
      p.project(0, 0, 6),
    ];
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    const bw = Math.max(...xs) - Math.min(...xs);
    const bh = Math.max(...ys) - Math.min(...ys);
    const vw = svgRef.clientWidth || 900;
    const vh = svgRef.clientHeight || 600;
    const k = Math.min(vw / (bw * 1.25), vh / (bh * 1.25));
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    const t = zoomIdentity.translate(vw / 2 - k * cx, vh / 2 - k * cy).scale(k);
    if (animate) svgSel.transition().duration(350).call(zmRef.transform, t);
    else svgSel.call(zmRef.transform, t);
  }

  onMount(() => {
    const zm = zoom()
      .scaleExtent([0.25, 5])
      .filter((e) => {
        if (e.type === 'wheel') return true;
        if (e.target.closest && e.target.closest('.obj,.gizmo,.task-point')) return false;
        return e.button === 0;
      })
      .on('zoom', (ev) => setViewT(ev.transform));
    zmRef = zm;
    svgSel = select(svgRef);
    svgSel.call(zm);
    fitView();
  });

  // 切换镜头时重新取景
  createEffect(() => {
    state.camera.angle;
    state.camera.top;
    fitView(true);
  });

  const pointColor = (pt) => {
    if (coverage().covered.includes(pt.id)) return '#22c55e';
    if (state.review || state.role === 'student') return '#e5484d';
    return '#f59e0b';
  };

  return (
    <svg
      ref={svgRef}
      class="canvas"
      onPointerDown={onBgPointerDown}
      onPointerUp={onBgPointerUp}
    >
      <g transform={viewT().toString()}>
        {/* 场地 */}
        <polygon points={siteOutline()} fill="rgba(79,142,247,0.06)" stroke="#4f8ef7" stroke-width="0.18" />
        <For each={gridLines()}>
          {(l) => (
            <line
              x1={l.pts[0][0]} y1={l.pts[0][1]} x2={l.pts[1][0]} y2={l.pts[1][1]}
              stroke={l.major ? 'rgba(148,163,184,0.35)' : 'rgba(148,163,184,0.12)'}
              stroke-width={l.major ? 0.08 : 0.04}
            />
          )}
        </For>

        {/* 任务点位 */}
        <For each={state.task.points}>
          {(pt) => (
            <g class="task-point" onPointerDown={(e) => onTaskPointDown(e, pt)} style={{ cursor: state.role === 'teacher' && !state.review ? 'move' : 'default' }}>
              <path
                d={groundCirclePath(projector().project, pt.x, pt.y, pt.radius, state.site.elevation + 0.02)}
                fill={pointColor(pt) + '22'}
                stroke={pointColor(pt)}
                stroke-width="0.14"
                stroke-dasharray="0.6 0.35"
              />
              <circle
                cx={projector().project(pt.x, pt.y, state.site.elevation)[0]}
                cy={projector().project(pt.x, pt.y, state.site.elevation)[1]}
                r="0.45" fill={pointColor(pt)} stroke="#fff" stroke-width="0.12"
              />
              <text
                x={projector().project(pt.x, pt.y, state.site.elevation)[0]}
                y={projector().project(pt.x, pt.y, state.site.elevation)[1] - 1}
                text-anchor="middle" class="task-label"
              >
                {pt.label}·{TYPES[pt.type].name}
              </text>
            </g>
          )}
        </For>

        {/* 物体(按深度排序) */}
        <For each={sortedObjects()}>
          {(o) => (
            <IsoObject
              obj={o}
              projector={projector()}
              selected={!state.review && state.selected.includes(o.id)}
              invalid={dragInvalid() && movingIds().includes(o.id)}
              onPointerDown={onObjPointerDown}
            />
          )}
        </For>

        {/* 三轴手柄 */}
        <Show when={selectedObj()}>
          {(obj) => <Gizmo obj={obj()} projector={projector()} onAxisDown={onAxisDown} />}
        </Show>
      </g>

      {/* 放置点位提示 */}
      <Show when={state.taskPlacing}>
        <text x="50%" y="24" text-anchor="middle" class="placing-hint">
          点击场地放置「{TYPES[state.taskPlacing]?.name}」点位(再次点击按钮取消)
        </text>
      </Show>
    </svg>
  );
}
