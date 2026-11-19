import { For, Show, createSignal, createMemo } from 'solid-js';
import type { Category, LayerId } from '../../shared/types';
import { CATEGORY_LABEL, CATEGORY_COLOR } from '../../shared/types';
import { PARTS, PART_MAP, MATERIALS, partWeight } from '../../shared/parts';
import { PartThumb } from '../components/PartThumb';
import {
  addEntity,
  focusEntity,
  scene,
  selectOnly,
  selection,
  setHoverUid,
  setSelection,
  toggleLayerLocked,
  toggleLayerVisible,
  camera,
  viewport,
} from '../editor/store';

const ORDER: Category[] = ['tube', 'connector', 'board', 'carton', 'hardware'];

export function PartLibrary() {
  const grouped = createMemo(() =>
    ORDER.map((cat) => ({
      cat,
      parts: PARTS.filter((p) => p.category === cat),
      count: scene.entities.filter((e) => PART_MAP[e.defId]?.category === cat).length,
    })),
  );
  const [q, setQ] = createSignal('');

  const filtered = createMemo(() => {
    const s = q().trim().toLowerCase();
    if (!s) return grouped();
    return grouped()
      .map((g) => ({ ...g, parts: g.parts.filter((p) => `${p.name}${p.partNo}${p.spec}`.toLowerCase().includes(s)) }))
      .filter((g) => g.parts.length);
  });

  function placeAtCenter(defId: string) {
    // place near scene centre on ground
    const vp = viewport();
    const cam = camera();
    const z = Math.max(Math.min(vp.w, vp.h) / 4000, 0.2);
    const sx = vp.w / 2 - cam.x;
    const sy = vp.h / 2 - cam.y;
    const k = sx / cam.zoom / (2 * Math.cos(Math.PI / 6));
    const v = sy / cam.zoom;
    addEntity(defId, { x: v + k, y: v - k });
  }

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', 'min-height': '0', flex: 1 }}>
      <div style={{ padding: '9px 11px', 'border-bottom': '1px solid var(--line-soft)' }}>
        <input placeholder="搜索零件号 / 名称…" value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
      </div>
      <div class="panel-scroll">
        <div class="hint-inline" style={{ padding: '8px 11px 2px' }}>
          拖拽零件到场景放置，或点击 <span class="kbd">+</span> 放到视图中心。
        </div>
        <For each={filtered()}>
          {(g) => (
            <div>
              <div class="lib-group-label">
                <span class="swatch" style={{ background: CATEGORY_COLOR[g.cat] }} />
                {CATEGORY_LABEL[g.cat]}
                <span style={{ 'margin-left': 'auto', 'font-family': 'var(--mono)', opacity: 0.6 }}>{g.parts.length}</span>
              </div>
              <For each={g.parts}>
                {(def) => (
                  <div
                    class="part-card"
                    draggable={true}
                    onDragStart={(e) => {
                      e.dataTransfer?.setData('application/x-kd-part', def.id);
                      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onMouseEnter={() => setHoverUid(null)}
                    onClick={() => placeAtCenter(def.id)}
                    title={`${def.name} · ${def.spec}\n单重 ${partWeight(def).toFixed(2)} kg · 密度 ${def.density} g/cm³`}
                  >
                    <div class="part-thumb"><PartThumb def={def} /></div>
                    <div class="part-info">
                      <div class="part-name">{def.name}</div>
                      <div class="part-meta">{def.partNo} · {def.spec}</div>
                    </div>
                    <button
                      class="icon part-add"
                      title="放置到视图中心"
                      onClick={(e) => { e.stopPropagation(); placeAtCenter(def.id); }}
                    >
                      +
                    </button>
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

export function HierarchyTree() {
  const [open, setOpen] = createSignal<Record<string, boolean>>({ tube: true, connector: true, board: true, carton: true, hardware: true });

  const groups = createMemo(() =>
    ORDER.map((cat) => ({
      cat,
      label: CATEGORY_LABEL[cat],
      color: CATEGORY_COLOR[cat],
      items: scene.entities
        .map((e, i) => ({ e, i }))
        .filter(({ e }) => PART_MAP[e.defId]?.category === cat),
    })),
  );

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', flex: 1, 'min-height': 0 }}>
      <div class="panel-scroll">
        <div class="tree">
          <For each={groups()}>
            {(g) => {
              const layer = () => scene.layers[g.cat as LayerId];
              const openNow = () => open()[g.cat] !== false;
              return (
                <div>
                  <div
                    class="tree-node"
                    style={{ 'font-weight': 600, padding: '5px 10px 5px 6px' }}
                    onClick={() => setOpen((o) => ({ ...o, [g.cat]: !openNow() }))}
                  >
                    <span class="tree-caret">{openNow() ? '▾' : '▸'}</span>
                    <span class="tree-dot" style={{ background: g.color, opacity: layer().visible ? 1 : 0.3 }} />
                    <span class="t-label" style={{ opacity: layer().visible ? 1 : 0.5 }}>{g.label}</span>
                    <span class="t-count">{g.items.length}</span>
                    <span class="t-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        class={`icon ${layer().visible ? '' : 'on'}`}
                        title={layer().visible ? '隐藏图层' : '显示图层'}
                        onClick={() => toggleLayerVisible(g.cat as LayerId)}
                      >
                        {layer().visible ? '◉' : '○'}
                      </button>
                      <button
                        class={`icon ${layer().locked ? 'on' : ''}`}
                        title={layer().locked ? '解锁图层' : '锁定图层'}
                        onClick={() => toggleLayerLocked(g.cat as LayerId)}
                      >
                        {layer().locked ? '🔒' : '🔓'}
                      </button>
                    </span>
                  </div>
                  <Show when={openNow()}>
                    <For each={g.items}>
                      {({ e, i }) => {
                        const def = PART_MAP[e.defId];
                        const sel = () => selection().includes(e.uid);
                        return (
                          <div
                            class={`tree-node ${sel() ? 'selected' : ''}`}
                            style={{ 'padding-left': '28px' }}
                            onClick={() => { selectOnly(e.uid); focusEntity(e.uid); }}
                            onMouseEnter={() => setHoverUid(e.uid)}
                            onMouseLeave={() => setHoverUid(null)}
                          >
                            <span class="tree-dot" style={{ background: e.color ?? def.color, opacity: e.hidden ? 0.25 : 1 }} />
                            <span class="t-label" style={{ opacity: e.hidden ? 0.4 : 1, 'font-size': '11.5px' }}>
                              {def.name}
                              <span style={{ color: 'var(--text-faint)', 'margin-left': '5px', 'font-family': 'var(--mono)', 'font-size': '10px' }}>
                                {def.partNo}
                              </span>
                            </span>
                            <Show when={e.locked}><span style={{ 'font-size': '9px' }}>🔒</span></Show>
                            <span class="t-actions" onClick={(ev) => ev.stopPropagation()}>
                              <button
                                class="icon"
                                style={{ 'font-size': '10px' }}
                                title="聚焦镜头"
                                onClick={() => { selectOnly(e.uid); focusEntity(e.uid); }}
                              >
                                ⌖
                              </button>
                            </span>
                          </div>
                        );
                      }}
                    </For>
                    <Show when={!g.items.length}>
                      <div style={{ padding: '4px 0 6px 30px', 'font-size': '11px', color: 'var(--text-faint)' }}>（空）</div>
                    </Show>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '6px', padding: '8px 10px', 'border-top': '1px solid var(--line-soft)' }}>
        <button class="ghost" style={{ flex: 1, 'font-size': '11px' }} onClick={() => setSelection([])}>取消选择</button>
      </div>
    </div>
  );
}
