import { createMemo, For, Show } from 'solid-js';
import { state } from '../store';
import { TYPES } from '../model';
import { computeBOM, downloadCSV } from '../geometry';

export default function BomPanel() {
  const bom = createMemo(() => computeBOM(state.objects, state.site));

  function exportCSV() {
    const b = bom();
    const rows = [
      ['物料清单与占地面积'],
      ['场地尺寸', `${state.site.w} × ${state.site.d} m`, '场地面积', b.siteArea.toFixed(1) + ' m²'],
      [],
      ['类型', '数量', '单台占地(m²)', '占地小计(m²)', '主要参数'],
    ];
    for (const r of b.rows) {
      rows.push([r.name, r.count, r.unitFoot.toFixed(2), r.foot.toFixed(2),
        Object.entries(r.params).map(([k, v]) => `${k}:${v}`).join(';')]);
    }
    rows.push([]);
    rows.push(['总占地面积(m²)', b.totalFoot.toFixed(2)]);
    rows.push(['场地利用率', b.usage.toFixed(1) + '%']);
    rows.push([]);
    rows.push(['明细', '类型', 'X(m)', 'Y(m)', '高程(m)', '朝向(°)']);
    for (const o of state.objects) {
      rows.push([o.id, TYPES[o.type].name, o.x, o.y, o.z, o.rot]);
    }
    downloadCSV('物料清单与占地面积.csv', rows);
  }

  return (
    <div class="panel">
      <h3>物料清单</h3>
      <Show when={!bom().rows.length}><p class="muted">画布中还没有设备。</p></Show>

      <Show when={bom().rows.length}>
        <table class="table">
          <thead>
            <tr><th>类型</th><th>数量</th><th>单台占地</th><th>小计</th></tr>
          </thead>
          <tbody>
            <For each={bom().rows}>
              {(r) => (
                <tr>
                  <td><span class="swatch sm" style={{ background: TYPES[r.type].color }} />{r.name}</td>
                  <td>{r.count}</td>
                  <td>{r.unitFoot.toFixed(2)} m²</td>
                  <td>{r.foot.toFixed(2)} m²</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>

        <div class="stat-grid">
          <div class="stat"><span>总占地面积</span><b>{bom().totalFoot.toFixed(1)} m²</b></div>
          <div class="stat"><span>场地面积</span><b>{bom().siteArea.toFixed(0)} m²</b></div>
          <div class="stat"><span>场地利用率</span><b>{bom().usage.toFixed(1)}%</b></div>
        </div>

        <button class="primary block" onClick={exportCSV} disabled={!state.camera.top}
          title={state.camera.top ? '' : '请切换到俯视图后导出'}>
          导出物料清单与占地面积 CSV
        </button>
        <Show when={!state.camera.top}>
          <p class="muted">按教学要求,请切换到「俯视图」后再导出。</p>
        </Show>
      </Show>
    </div>
  );
}
