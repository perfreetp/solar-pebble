import { For, Show, createMemo } from 'solid-js';
import type { BOMData, TopViewData } from '../../shared/types';
import { CATEGORY_LABEL } from '../../shared/types';

const CAT_TONE: Record<string, { fill: string; stroke: string; label: string }> = {
  tube: { fill: '#e8eef4', stroke: '#3f566c', label: '钢管件' },
  connector: { fill: '#fbeedb', stroke: '#a2702f', label: '连接件' },
  board: { fill: '#f5ebd9', stroke: '#8a6a42', label: '床板' },
  carton: { fill: '#efe3cf', stroke: '#7d6141', label: '包装箱' },
  hardware: { fill: '#eceef1', stroke: '#6b7684', label: '五金' },
};
const LEGEND: { key: string; label: string }[] = [
  { key: 'tube', label: '钢管床架件' },
  { key: 'connector', label: '注塑连接件' },
  { key: 'board', label: '床板 / 板材' },
  { key: 'carton', label: '包装箱' },
];

/**
 * Technical top-view layout drawing (wireframe). Parts are drawn in z order so the
 * assembly reads as an orthographic layout rather than an opaque render.
 */
export function TopViewDrawing(props: {
  data: TopViewData;
  bom?: BOMData;
  title?: string;
  scale?: number;
  /** When given, the drawing auto-fits into this box (px). */
  fit?: { w: number; h: number };
  minAisle?: number;
  highlight?: string[];
  onRectClick?: (uid: string) => void;
  compact?: boolean;
  showTitleBlock?: boolean;
}) {
  const d = () => props.data;
  const titleBlock = () => ((props.showTitleBlock ?? true) && !props.compact) ? 104 : 0;
  const M = props.compact ? 16 : 40;

  const fitted = createMemo(() => {
    const bw = Math.max(1, d().maxX - d().minX);
    const bd = Math.max(1, d().maxY - d().minY);
    let scale = props.scale ?? 0.26;
    if (props.fit) {
      scale = Math.min(
        (props.fit.w - M * 2 - (props.compact ? 0 : 30)) / bw,
        (props.fit.h - M * 2 - titleBlock() - 40) / bd,
      );
      scale = Math.max(0.02, Math.min(scale, 0.9));
    }
    const w = bw * scale + M * 2 + 20;
    const h = bd * scale + M * 2 + titleBlock() + (props.compact ? 0 : 26);
    return { scale, w, h, bw, bd };
  });

  const ox = () => M + 20 - d().minX * fitted().scale;
  const oy = () => M - d().minY * fitted().scale;
  const sx = (x: number) => ox() + x * fitted().scale;
  const sy = (y: number) => oy() + y * fitted().scale;

  // sort by elevation, so upper parts draw above lower ones
  const rectsSorted = createMemo(() => d().rects.slice().sort((a, b) => a.z + a.h - (b.z + b.h)));
  const narrowAisles = createMemo(() => d().aisles.filter((a) => a.narrow));

  // A part is "hidden" when a higher part's footprint covers it — draw it dashed.
  const hiddenSet = createMemo(() => {
    const set = new Set<string>();
    const all = d().rects;
    for (const r of all) {
      const top = r.z + r.h;
      const cx = r.x + r.w / 2;
      const cy = r.y + r.d / 2;
      for (const o of all) {
        if (o === r) continue;
        if (o.z + o.h <= top + 0.5) continue;
        // point-in-polygon on the covering part
        const pts = o.corners;
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
          if (yi > cy !== yj > cy && cx < ((xj - xi) * (cy - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
        }
        if (inside) { set.add(r.uid); break; }
      }
    }
    return set;
  });

  return (
    <div
      class="drawing-sheet"
      style={{ width: `${fitted().w}px`, height: `${fitted().h}px`, flex: 'none' }}
    >
      <svg width={fitted().w} height={fitted().h} style={{ display: 'block' }}>
        <defs>
          <pattern
            id="kdgrid"
            width={String(500 * fitted().scale)}
            height={String(500 * fitted().scale)}
            patternUnits="userSpaceOnUse"
            x={ox()}
            y={oy()}
          >
            <path
              d={`M ${500 * fitted().scale} 0 L 0 0 0 ${500 * fitted().scale}`}
              fill="none"
              stroke="#e4ddcd"
              stroke-width="1"
            />
          </pattern>
          <marker id="kd-ar" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto-start-reverse">
            <path d="M0,1.2 L6.5,4 L0,6.8" fill="none" stroke="#6a7480" stroke-width="1.1" />
          </marker>
          <marker id="kd-ar-red" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto-start-reverse">
            <path d="M0,1.2 L6.5,4 L0,6.8" fill="none" stroke="#b8402f" stroke-width="1.1" />
          </marker>
        </defs>

        <rect width={fitted().w} height={fitted().h} fill="#fcfbf7" />
        <rect x={M} y={M} width={fitted().w - M * 2} height={fitted().h - titleBlock() - M * 2} fill="url(#kdgrid)" opacity="0.7" />
        <rect
          x={M} y={M} width={fitted().w - M * 2} height={fitted().h - titleBlock() - M * 2}
          fill="none" stroke="#c9c1ae" stroke-width="1"
        />

        {/* aisle zones (under parts) */}
        <For each={d().aisles}>
          {(a, i) => {
            const isOuter = i() >= d().aisles.length - 2;
            const x = Math.min(sx(a.x1), sx(a.x2));
            const y = Math.min(sy(a.y1), sy(a.y2));
            const w = Math.abs((a.x2 - a.x1) * fitted().scale);
            const h = Math.abs((a.y2 - a.y1) * fitted().scale);
            const tone = a.narrow ? { fill: 'rgba(191,72,52,0.12)', stroke: '#b8402f' } : isOuter ? { fill: 'rgba(88,138,186,0.07)', stroke: '#6f97bb' } : { fill: 'rgba(90,160,110,0.08)', stroke: '#5f9472' };
            return (
              <g>
                <rect
                  x={x} y={y} width={w} height={h}
                  fill={tone.fill}
                  stroke={tone.stroke}
                  stroke-width={a.narrow ? 1.2 : 0.9}
                  stroke-dasharray={isOuter ? '6 4' : undefined}
                />
                <Show when={!props.compact && !isOuter}>
                  <text
                    x={x + w / 2}
                    y={y + 11}
                    text-anchor="middle"
                    font-size="9.5"
                    font-family="'Cascadia Mono', ui-monospace, monospace"
                    fill={a.narrow ? '#a3321f' : '#4f6b58'}
                    font-weight={a.narrow ? '700' : '500'}
                  >
                    通道 {Math.round(a.width)}
                  </text>
                </Show>
              </g>
            );
          }}
        </For>

        {/* part footprints, wireframe */}
        <For each={rectsSorted()}>
          {(r) => {
            const tone = CAT_TONE[r.category] ?? { fill: '#eeeeee', stroke: '#777', label: '' };
            const hi = props.highlight?.includes(r.uid);
            const covered = hiddenSet().has(r.uid);
            const pts = r.corners.map((c) => `${sx(c.x)},${sy(c.y)}`).join(' ');
            const bw = Math.min(r.w, r.d) * fitted().scale;
            const bl = Math.max(r.w, r.d) * fitted().scale;
            return (
              <g style={{ cursor: props.onRectClick ? 'pointer' : 'default' }} onClick={() => props.onRectClick?.(r.uid)}>
                <polygon
                  points={pts}
                  fill={covered ? 'none' : tone.fill}
                  fill-opacity={props.compact ? 0.85 : 0.6}
                  stroke={hi ? '#c98a1f' : covered ? '#98a2ad' : tone.stroke}
                  stroke-width={hi ? 2.2 : covered ? 0.8 : 1.05}
                  stroke-dasharray={covered && !hi ? '3 2' : undefined}
                />
                <Show when={!props.compact && !covered && bw > 7 && bl > 26}>
                  <text
                    x={sx((r.corners[0].x + r.corners[2].x) / 2)}
                    y={sy((r.corners[0].y + r.corners[2].y) / 2) + 3}
                    text-anchor="middle"
                    font-size="8.5"
                    fill="#4a5560"
                    font-family="'Segoe UI', sans-serif"
                  >
                    {r.partNo}
                  </text>
                </Show>
              </g>
            );
          }}
        </For>

        {/* overall dimensions */}
        <g font-family="'Cascadia Mono', monospace" font-size="9.5" fill="#606a75">
          <line
            x1={sx(d().minX)} y1={fitted().h - titleBlock() - M + 12}
            x2={sx(d().maxX)} y2={fitted().h - titleBlock() - M + 12}
            stroke="#6a7480" stroke-width="0.9" marker-start="url(#kd-ar)" marker-end="url(#kd-ar)"
          />
          <text x={(sx(d().minX) + sx(d().maxX)) / 2} y={fitted().h - titleBlock() - M + 8} text-anchor="middle">
            {Math.round(d().maxX - d().minX)} mm
          </text>
          <line
            x1={sx(d().minX) - 18} y1={sy(d().minY)}
            x2={sx(d().minX) - 18} y2={sy(d().maxY)}
            stroke="#6a7480" stroke-width="0.9" marker-start="url(#kd-ar)" marker-end="url(#kd-ar)"
          />
          <text
            x={sx(d().minX) - 22}
            y={(sy(d().minY) + sy(d().maxY)) / 2}
            text-anchor="middle"
            transform={`rotate(-90 ${sx(d().minX) - 22} ${(sy(d().minY) + sy(d().maxY)) / 2})`}
          >
            {Math.round(d().maxY - d().minY)} mm
          </text>
        </g>

        {/* narrow-aisle callout */}
        <Show when={!props.compact && narrowAisles().length > 0}>
          <g transform={`translate(${fitted().w - M - 176}, ${M + 6})`}>
            <rect width="176" height="44" rx="3" fill="#fdf3f0" stroke="#c8614d" stroke-width="1" />
            <text x="10" y="18" font-size="10.5" fill="#a3321f" font-weight="700">
              通道宽度不足 {narrowAisles().length} 处
            </text>
            <text x="10" y="33" font-size="9" fill="#7a453a" font-family="'Cascadia Mono', monospace">
              {narrowAisles().map((a) => `${Math.round(a.width)}`).join(' / ')} mm ＜ 要求 {props.minAisle ?? 800}
            </text>
          </g>
        </Show>

        {/* title block */}
        <Show when={titleBlock() > 0}>
          <g transform={`translate(${M}, ${fitted().h - titleBlock() - M + 26})`}>
            <rect width={fitted().w - M * 2} height={titleBlock() - 26} fill="#fcfbf7" stroke="#b6ad9b" stroke-width="1" />
            <line x1={(fitted().w - M * 2) * 0.5} y1="0" x2={(fitted().w - M * 2) * 0.5} y2={titleBlock() - 26} stroke="#cfc7b5" />
            <line x1={(fitted().w - M * 2) * 0.78} y1="0" x2={(fitted().w - M * 2) * 0.78} y2={titleBlock() - 26} stroke="#cfc7b5" />
            <text x="12" y="21" font-size="12.5" fill="#2c3640" font-weight="700">{props.title ?? '俯视布置图（线框）'}</text>
            <text x="12" y="38" font-size="9" fill="#7a8390" font-family="'Cascadia Mono', monospace">
              比例 1:{Math.max(2, Math.round(1 / fitted().scale))} · 单位 mm · 正投影
            </text>
            <Show when={props.bom}>
              <text x="12" y="54" font-size="9" fill="#7a8390" font-family="'Cascadia Mono', monospace">
                件数 {props.bom!.totalParts} · 类型 {props.bom!.totalTypes} · 总重 {props.bom!.totalWeight.toFixed(1)} kg · 体积 {props.bom!.totalVolume.toFixed(3)} m³
              </text>
            </Show>
            <text x={(fitted().w - M * 2) * 0.5 + 12} y="19" font-size="9" fill="#7a8390">通道校核</text>
            <text x={(fitted().w - M * 2) * 0.5 + 12} y="34" font-size="10" fill="#2c3640" font-family="'Cascadia Mono', monospace">
              主通道 ≥ {props.minAisle ?? 800} mm
            </text>
            <text x={(fitted().w - M * 2) * 0.5 + 12} y="49" font-size="9" fill={narrowAisles().length ? '#a3321f' : '#3f7a56'}>
              {narrowAisles().length ? `⚠ ${narrowAisles().length} 处不达标` : '✓ 全部达标'}
            </text>
            <g transform={`translate(${(fitted().w - M * 2) * 0.78 + 12}, 10)`}>
              <For each={LEGEND}>
                {(l, i) => (
                  <g transform={`translate(0, ${i() * 11})`}>
                    <rect width="8" height="8" fill={CAT_TONE[l.key].fill} stroke={CAT_TONE[l.key].stroke} stroke-width="0.8" />
                    <text x="12" y="7.5" font-size="8" fill="#5a636e">{l.label}</text>
                  </g>
                )}
              </For>
            </g>
          </g>
        </Show>
      </svg>
    </div>
  );
}
