import { createMemo, For, Show } from 'solid-js';
import { TYPES } from '../model';
import { effDims } from '../geometry';
import { ptsStr } from '../iso';

export function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

// 盒体 5 个面(顶面 + 4 侧面),返回点串
function boxFaces(project, x, y, z, w, d, h) {
  const hw = w / 2, hd = d / 2;
  const p = (dx, dy, dz) => project(x + dx, y + dy, z + dz);
  return {
    top: [p(-hw, -hd, h), p(hw, -hd, h), p(hw, hd, h), p(-hw, hd, h)],
    base: [p(-hw, -hd, 0), p(hw, -hd, 0), p(hw, hd, 0), p(-hw, hd, 0)],
    sides: [
      { n: [0, -1], pts: [p(-hw, -hd, 0), p(hw, -hd, 0), p(hw, -hd, h), p(-hw, -hd, h)] },
      { n: [1, 0], pts: [p(hw, -hd, 0), p(hw, hd, 0), p(hw, hd, h), p(hw, -hd, h)] },
      { n: [0, 1], pts: [p(hw, hd, 0), p(-hw, hd, 0), p(-hw, hd, h), p(hw, hd, h)] },
      { n: [-1, 0], pts: [p(-hw, hd, 0), p(-hw, -hd, 0), p(-hw, -hd, h), p(-hw, hd, h)] },
    ],
  };
}

function Box(props) {
  const faces = createMemo(() =>
    boxFaces(props.projector.project, props.x, props.y, props.z, props.w, props.d, props.h)
  );
  const visible = createMemo(() =>
    faces().sides.filter((s) => props.projector.normalVisible(s.n[0], s.n[1]))
  );
  return (
    <>
      <Show when={!props.projector.top}>
        <For each={visible()}>
          {(s, i) => (
            <polygon
              points={ptsStr(s.pts)}
              fill={shade(props.color, i() === 0 ? 0.72 : 0.55)}
              stroke={shade(props.color, 0.4)}
              stroke-width="0.06"
            />
          )}
        </For>
      </Show>
      <polygon
        points={ptsStr(faces().top)}
        fill={shade(props.color, props.projector.top ? 0.9 : 1)}
        stroke={shade(props.color, 0.4)}
        stroke-width="0.06"
      />
    </>
  );
}

// 单个物体(含类型装饰、选中/越界态)
export function IsoObject(props) {
  const t = () => TYPES[props.obj.type];
  const dm = () => effDims(props.obj);
  const color = () => (props.invalid ? '#e5484d' : t().color);
  const proj = () => props.projector;
  const o = () => props.obj;

  const baseOutline = createMemo(() => {
    const { w, d } = dm();
    return ptsStr(boxFaces(proj().project, o().x, o().y, o().z + 0.03, w, d, 0).top);
  });

  const labelPos = createMemo(() =>
    proj().project(o().x, o().y, o().z + t().h + (o().type === 'station' ? 1.6 : 0.7))
  );

  return (
    <g
      class="obj"
      classList={{ selected: props.selected, invalid: props.invalid }}
      onPointerDown={(e) => props.onPointerDown(e, o())}
    >
      {/* 透明底座扩大拾取区域 */}
      <polygon points={baseOutline()} fill="transparent" stroke="none" style={{ cursor: 'pointer' }} />

      <Box projector={proj()} x={o().x} y={o().y} z={o().z} w={dm().w} d={dm().d} h={t().h} color={color()} />

      {/* 类型装饰 */}
      <Show when={o().type === 'station'}>
        <Box projector={proj()} x={o().x} y={o().y} z={o().z + t().h} w={dm().w + 0.4} d={dm().d + 0.4} h={0.22} color={shade(color(), 0.45)} />
        <Box projector={proj()} x={o().x + dm().w / 2 - 0.4} y={o().y} z={o().z + t().h} w={0.12} d={0.12} h={1.1} color={shade(color(), 0.5)} />
      </Show>
      <Show when={o().type === 'probe'}>
        <Box projector={proj()} x={o().x} y={o().y} z={o().z + t().h} w={0.7} d={0.7} h={0.45} color={shade(color(), 0.8)} />
      </Show>
      <Show when={o().type === 'cabinet'}>
        <Box projector={proj()} x={o().x} y={o().y} z={o().z + t().h} w={dm().w * 0.7} d={dm().d * 0.7} h={0.08} color={shade(color(), 0.5)} />
      </Show>

      {/* 选中:底座虚线框 */}
      <Show when={props.selected}>
        <polygon points={baseOutline()} fill="rgba(34,211,238,0.12)" stroke="#22d3ee" stroke-width="0.14" stroke-dasharray="0.5 0.3" />
      </Show>
      {/* 越界/碰撞:红色警示 */}
      <Show when={props.invalid}>
        <polygon points={baseOutline()} fill="rgba(229,72,77,0.25)" stroke="#e5484d" stroke-width="0.2" />
      </Show>

      <Show when={props.selected || o().type !== 'fence'}>
        <text
          x={labelPos()[0]}
          y={labelPos()[1]}
          text-anchor="middle"
          class="obj-label"
          classList={{ 'obj-label-invalid': props.invalid }}
        >
          {props.invalid ? '⚠ 越界/碰撞' : t().name}
        </text>
      </Show>
    </g>
  );
}

// 三轴变换手柄
export function Gizmo(props) {
  const proj2 = () => props.projector;
  const anchor = createMemo(() => {
    const o = props.obj;
    const h = TYPES[o.type].h;
    return proj2().project(o.x, o.y, o.z + h + 0.9);
  });
  const LEN = 4.2;
  const axes = createMemo(() => {
    const list = [
      { k: 'x', color: '#ef4444', label: 'X' },
      { k: 'y', color: '#22c55e', label: 'Y' },
    ];
    if (!proj2().top) list.push({ k: 'z', color: '#3b82f6', label: 'Z' });
    return list.map((a) => {
      const dir = proj2().axisDir(a.k);
      return { ...a, x2: anchor()[0] + dir[0] * LEN, y2: anchor()[1] + dir[1] * LEN };
    });
  });

  return (
    <g class="gizmo">
      <For each={axes()}>
        {(a) => (
          <g onPointerDown={(e) => props.onAxisDown(e, a.k)} style={{ cursor: 'grab' }}>
            <line x1={anchor()[0]} y1={anchor()[1]} x2={a.x2} y2={a.y2} stroke="transparent" stroke-width="1.6" />
            <line x1={anchor()[0]} y1={anchor()[1]} x2={a.x2} y2={a.y2} stroke={a.color} stroke-width="0.28" />
            <circle cx={a.x2} cy={a.y2} r="0.55" fill={a.color} stroke="#fff" stroke-width="0.12" />
            <text x={a.x2} y={a.y2 - 0.9} text-anchor="middle" class="gizmo-label" fill={a.color}>{a.label}</text>
          </g>
        )}
      </For>
      <circle cx={anchor()[0]} cy={anchor()[1]} r="0.4" fill="#fff" stroke="#334155" stroke-width="0.12" />
    </g>
  );
}
