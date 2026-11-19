import { createMemo, Show } from 'solid-js';
import { TopViewDrawing } from '../components/TopViewDrawing';
import { bomData, topviewData, selection, selectOnly, viewport } from '../editor/store';
import { createSignal } from 'solid-js';

export function TopViewBoard() {
  const top = createMemo(() => topviewData());
  const bom = createMemo(() => bomData());
  const [zoom, setZoom] = createSignal(1);
  const vp = () => viewport();

  return (
    <div class="drawing-wrap">
      <div class="drawing-toolbar">
        <Show when={top().aisles.some((a) => a.narrow)}>
          <span class="badge badge-rejected">⚠ 通道宽度不足 {top().aisles.filter((a) => a.narrow).length} 处</span>
        </Show>
        <div class="drawing-zoom">
          <button class="icon" title="缩小" onClick={() => setZoom((z) => Math.max(0.5, z - 0.15))}>－</button>
          <span>{Math.round(zoom() * 100)}%</span>
          <button class="icon" title="放大" onClick={() => setZoom((z) => Math.min(2.2, z + 0.15))}>＋</button>
          <button class="icon" title="复位" onClick={() => setZoom(1)}>⟲</button>
        </div>
      </div>
      <div style={{ transform: `scale(${zoom()})`, 'transform-origin': 'top center', display: 'flex', 'justify-content': 'center' }}>
        <TopViewDrawing
          data={top()}
          bom={bom()}
          highlight={selection()}
          title="俯视布置图 · 装箱区通道校核"
          fit={{ w: Math.max(360, vp().w - 120), h: Math.max(320, vp().h - 70) }}
          onRectClick={(uid) => selectOnly(uid)}
        />
      </div>
    </div>
  );
}
