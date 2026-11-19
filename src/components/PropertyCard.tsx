import { For, Show, type JSX } from 'solid-js';
import { LAYER_MAP } from '../layers';
import { appStore } from '../store';
import type { Feature } from '../types';

/** 右侧属性卡：支持多选，逐个切换查看 */
export function PropertyCard(): JSX.Element {
  const features = (): Feature[] => {
    const v = appStore.activeVersion();
    return appStore.state.selectedIds
      .map((id) => v.features[id])
      .filter((f): f is Feature => Boolean(f));
  };

  return (
    <Show when={features().length > 0}>
      <div class="panel property-card">
        <div class="panel-title">
          属性卡
          <span class="badge">{features().length} 项已选</span>
          <button class="btn-mini close-btn" onClick={() => appStore.clearSelection()}>
            ×
          </button>
        </div>
        <For each={features()}>
          {(f) => {
            const meta = LAYER_MAP[f.layerId];
            return (
              <div class="prop-block">
                <div class="prop-head">
                  <span class="layer-swatch" style={{ background: meta.color }} />
                  <strong>{f.props.name}</strong>
                  <button
                    class="btn-mini"
                    title="从选择中移除"
                    onClick={() => appStore.toggleSelection(f.id)}
                  >
                    −
                  </button>
                </div>
                <table class="prop-table">
                  <tbody>
                    <tr>
                      <td>要素 ID</td>
                      <td>{f.id}</td>
                    </tr>
                    <tr>
                      <td>所属图层</td>
                      <td>{meta.name}</td>
                    </tr>
                    <tr>
                      <td>编号</td>
                      <td>{f.props.code}</td>
                    </tr>
                    <tr>
                      <td>规格</td>
                      <td>{f.props.spec ?? '—'}</td>
                    </tr>
                    <tr>
                      <td>状态</td>
                      <td>{f.props.status}</td>
                    </tr>
                    <tr>
                      <td>责任单位</td>
                      <td>{f.props.owner}</td>
                    </tr>
                    <tr>
                      <td>更新日期</td>
                      <td>{f.props.updatedAt}</td>
                    </tr>
                    <tr>
                      <td>几何类型</td>
                      <td>
                        {f.geom.kind === 'point'
                          ? `点 (${f.geom.x.toFixed(1)}, ${f.geom.y.toFixed(1)})`
                          : f.geom.kind === 'line'
                            ? `折线 ${f.geom.coords.length} 顶点`
                            : `多边形 ${f.geom.ring.length} 顶点`}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          }}
        </For>
      </div>
    </Show>
  );
}
