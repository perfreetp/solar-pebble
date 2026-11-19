import { For, type JSX } from 'solid-js';
import { LAYER_METAS } from '../layers';
import { appStore } from '../store';

/** 左侧图层面板：单独开关、透明度、叠放顺序调整 */
export function LayerPanel(): JSX.Element {
  const sorted = () =>
    [...LAYER_METAS].sort(
      (a, b) => appStore.state.layerStates[a.id].zOrder - appStore.state.layerStates[b.id].zOrder,
    );

  return (
    <div class="panel">
      <div class="panel-title">图层控制</div>
      <div class="layer-list">
        <For each={sorted()}>
          {(meta, idx) => {
            const st = () => appStore.state.layerStates[meta.id];
            return (
              <div class="layer-item" classList={{ 'is-off': !st().visible }}>
                <div class="layer-row">
                  <span class="layer-swatch" style={{ background: meta.color }} />
                  <label class="layer-name">
                    <input
                      type="checkbox"
                      checked={st().visible}
                      onChange={() => appStore.toggleLayer(meta.id)}
                    />
                    {meta.name}
                  </label>
                  <span class="layer-kind">{meta.kind === 'point' ? '点' : meta.kind === 'line' ? '线' : '面'}</span>
                </div>
                <div class="layer-row layer-controls">
                  <span class="opacity-label">透明度</span>
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.05"
                    value={st().opacity}
                    onInput={(e) => appStore.setLayerOpacity(meta.id, Number(e.currentTarget.value))}
                    disabled={!st().visible}
                  />
                  <span class="opacity-val">{Math.round(st().opacity * 100)}%</span>
                </div>
                <div class="layer-row layer-order">
                  <button
                    class="btn-mini"
                    disabled={idx() === 0}
                    title="上移（更靠近上层）"
                    onClick={() => appStore.moveLayer(meta.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    class="btn-mini"
                    disabled={idx() === LAYER_METAS.length - 1}
                    title="下移"
                    onClick={() => appStore.moveLayer(meta.id, 1)}
                  >
                    ↓
                  </button>
                  <span class="order-hint">叠放层级 {st().zOrder + 1}</span>
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
