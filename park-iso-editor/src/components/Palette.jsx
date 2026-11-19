import { For } from 'solid-js';
import { state, setState, actions } from '../store';
import { TYPES, TYPE_KEYS } from '../model';

function setSnap(v) {
  setState('snapGround', v);
  if (v) setState('objects', () => true, 'z', state.site.elevation);
}

export default function Palette() {
  return (
    <div class="panel">
      <h3>设备库</h3>
      <div class="palette-grid">
        <For each={TYPE_KEYS}>
          {(key) => (
            <button class="palette-item" onClick={() => actions.addObject(key)} disabled={!!state.review}>
              <span class="swatch" style={{ background: TYPES[key].color }} />
              <span>{TYPES[key].name}</span>
              <span class="dims">{TYPES[key].w}×{TYPES[key].d}×{TYPES[key].h}m</span>
            </button>
          )}
        </For>
      </div>

      <h3>场地设置</h3>
      <div class="field-row">
        <label>长 (m)</label>
        <input type="number" min="10" max="200" value={state.site.w}
          onInput={(e) => actions.setSite({ w: Math.max(10, +e.currentTarget.value || 10) })} />
      </div>
      <div class="field-row">
        <label>宽 (m)</label>
        <input type="number" min="10" max="200" value={state.site.d}
          onInput={(e) => actions.setSite({ d: Math.max(10, +e.currentTarget.value || 10) })} />
      </div>
      <div class="field-row">
        <label>地面高程 (m)</label>
        <input type="number" step="0.5" value={state.site.elevation}
          onInput={(e) => actions.setSite({ elevation: +e.currentTarget.value || 0 })} />
      </div>
      <div class="field-row">
        <label>贴地吸附</label>
        <input type="checkbox" checked={state.snapGround}
          onChange={(e) => setSnap(e.currentTarget.checked)} />
      </div>
    </div>
  );
}
