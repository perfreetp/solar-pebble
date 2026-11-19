import { createMemo, For, Show } from 'solid-js';
import { state, actions } from '../store';
import { TYPES } from '../model';

export default function ParamPanel() {
  const sel = createMemo(() =>
    state.selected.map((id) => state.objects.find((o) => o.id === id)).filter(Boolean)
  );
  const single = createMemo(() => (sel().length === 1 ? sel()[0] : null));

  const num = (v) => Math.round(v * 100) / 100;

  return (
    <div class="panel">
      <h3>参数面板</h3>
      <Show when={!single() && sel().length === 0}>
        <p class="muted">点击画布中的物体查看参数;Shift+点击可多选。</p>
      </Show>

      <Show when={sel().length > 1}>
        <p>已选中 <b>{sel().length}</b> 个物体</p>
        <ul class="mini-list">
          <For each={sel()}>{(o) => <li>{TYPES[o.type].name} @ ({num(o.x)}, {num(o.y)})</li>}</For>
        </ul>
        <p class="muted">可使用工具栏批量旋转 / 复制 / 删除。</p>
      </Show>

      <Show when={single()}>
        {(o) => (
          <div>
            <div class="param-title">
              <span class="swatch" style={{ background: TYPES[o().type].color }} />
              <b>{TYPES[o().type].name}</b>
              <span class="muted">#{o().id.slice(-4)}</span>
            </div>

            <h4>位置与姿态</h4>
            <div class="field-row">
              <label>X (m)</label>
              <input type="number" step="0.5" value={o().x}
                onInput={(e) => actions.updateObject(o().id, { x: +e.currentTarget.value || 0 })} />
            </div>
            <div class="field-row">
              <label>Y (m)</label>
              <input type="number" step="0.5" value={o().y}
                onInput={(e) => actions.updateObject(o().id, { y: +e.currentTarget.value || 0 })} />
            </div>
            <div class="field-row">
              <label>高程 Z (m)</label>
              <input type="number" step="0.5" value={o().z}
                onInput={(e) => actions.updateObject(o().id, { z: +e.currentTarget.value || 0 })} />
            </div>
            <div class="field-row">
              <label>朝向</label>
              <select value={o().rot}
                onChange={(e) => actions.updateObject(o().id, { rot: +e.currentTarget.value })}>
                <option value={0}>0°</option>
                <option value={90}>90°</option>
                <option value={180}>180°</option>
                <option value={270}>270°</option>
              </select>
            </div>

            <h4>设备参数</h4>
            <For each={Object.entries(o().params)}>
              {([k, v]) => (
                <div class="field-row">
                  <label>{k}</label>
                  <input type="text" value={v}
                    onInput={(e) => actions.updateObject(o().id, { params: { ...o().params, [k]: e.currentTarget.value } })} />
                </div>
              )}
            </For>
          </div>
        )}
      </Show>
    </div>
  );
}
