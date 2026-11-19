import { createMemo } from 'solid-js';
import type { TopViewData } from '../../shared/types';

/** Renders a scaled-down top view into a fixed-size thumbnail box. */
export function MiniTopView(props: { data: TopViewData; w: number; h: number }) {
  const fit = createMemo(() => {
    const d = props.data;
    const bw = Math.max(1, d.maxX - d.minX);
    const bh = Math.max(1, d.maxY - d.minY);
    const s = Math.min((props.w - 12) / bw, (props.h - 12) / bh);
    const ox = (props.w - bw * s) / 2 - d.minX * s;
    const oy = (props.h - bh * s) / 2 - d.minY * s;
    return { s, ox, oy };
  });
  const sx = (x: number) => fit().ox + x * fit().s;
  const sy = (y: number) => fit().oy + y * fit().s;
  return (
    <svg width={props.w} height={props.h} style={{ display: 'block' }}>
      <rect width={props.w} height={props.h} fill="#f6f3ec" />
      {props.data.rects.map((r) => (
        <polygon
          points={r.corners.map((c) => `${sx(c.x)},${sy(c.y)}`).join(' ')}
          fill={r.category === 'tube' ? '#c8d5e2' : r.category === 'board' ? '#e6d6bb' : r.category === 'carton' ? '#dbc8aa' : '#efd9b8'}
          stroke="#7a8590"
          stroke-width="0.6"
        />
      ))}
      {props.data.aisles.filter((a) => a.narrow).map((a) => (
        <rect
          x={Math.min(sx(a.x1), sx(a.x2))}
          y={Math.min(sy(a.y1), sy(a.y2))}
          width={Math.abs((a.x2 - a.x1) * fit().s)}
          height={Math.abs((a.y2 - a.y1) * fit().s)}
          fill="rgba(190,70,52,0.18)"
          stroke="#b8402f"
          stroke-width="0.6"
        />
      ))}
    </svg>
  );
}
