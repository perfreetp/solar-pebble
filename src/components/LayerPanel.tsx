import { For } from 'solid-js';
import {
  docState, selectOnly, toggleSelection, togglePathVisible, togglePathLocked,
  renamePath, reorderPath, duplicateSelected, deleteSelected,
} from '../store/docStore';

export default function LayerPanel() {
  const paths = () => [...docState.paths()].reverse(); // 上层在列表顶部

  return (
    <aside class="layer-panel">
      <div class="panel-head">
        <h3>图层 ({docState.paths().length})</h3>
        <div class="row-actions">
          <button onClick={duplicateSelected} disabled={!docState.selection().size} title="复制选中">⧉</button>
          <button onClick={deleteSelected} disabled={!docState.selection().size} title="删除选中">🗑</button>
        </div>
      </div>
      <ul class="layer-list">
        <For each={paths()}>
          {(p) => (
            <li classList={{ selected: docState.selection().has(p.id), locked: p.locked }}
              onClick={e => e.shiftKey ? toggleSelection(p.id) : selectOnly(p.id)}>
              <span class={`kind-dot ${p.kind}`} title={p.kind === 'vein' ? '翅脉' : '斑纹'} />
              <input
                class="layer-name"
                value={p.name}
                onClick={e => e.stopPropagation()}
                onInput={e => renamePath(p.id, e.currentTarget.value)}
              />
              <span class="node-count">{p.nodes.length}点{p.holes.length ? `◌${p.holes.length}` : ''}</span>
              <button class="icon-btn" title={p.visible ? '隐藏' : '显示'}
                onClick={e => { e.stopPropagation(); togglePathVisible(p.id); }}>
                {p.visible ? '👁' : '🚫'}
              </button>
              <button class="icon-btn" title={p.locked ? '解锁' : '锁定'}
                onClick={e => { e.stopPropagation(); togglePathLocked(p.id); }}>
                {p.locked ? '🔒' : '🔓'}
              </button>
              <span class="order-btns">
                <button class="icon-btn" title="上移一层"
                  onClick={e => { e.stopPropagation(); reorderPath(p.id, 'up'); }}>▲</button>
                <button class="icon-btn" title="下移一层"
                  onClick={e => { e.stopPropagation(); reorderPath(p.id, 'down'); }}>▼</button>
              </span>
            </li>
          )}
        </For>
      </ul>
      <div class="panel-foot">
        <label class="slider-row">
          底图不透明度
          <input type="range" min="0" max="1" step="0.05"
            value={docState.bgOpacity()}
            onInput={e => docState.setBgOpacity(parseFloat(e.currentTarget.value))} />
        </label>
        <label class="check-row">
          <input type="checkbox" checked={docState.showGrid()}
            onChange={e => docState.setShowGrid(e.currentTarget.checked)} />
          显示网格
        </label>
      </div>
    </aside>
  );
}
