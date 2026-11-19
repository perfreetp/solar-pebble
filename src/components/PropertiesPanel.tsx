import { For, Show, createSignal, createMemo } from 'solid-js';
import type { Category } from '../../shared/types';
import { CATEGORY_LABEL, CATEGORY_COLOR } from '../../shared/types';
import { PART_MAP, MATERIALS, partWeight, partVolumeM3 } from '../../shared/parts';
import { Entity, VersionSummary } from '../../shared/types';
import {
  activeEntity,
  activeUid,
  bomData,
  deleteSelection,
  duplicateSelection,
  entitySize,
  focusSelection,
  interferenceReport,
  rotateSelection,
  selection,
  setEntityColor,
  setEntitySize,
  toggleEntityHidden,
  toggleEntityLock,
  isEditable,
  toggleLayerVisible,
  toggleLayerLocked,
  scene,
  selectOnly,
  setSelection,
  zoomAt,
  viewport,
  camera,
  toast,
  topviewData,
} from '../editor/store';
import { BomTable, InterferenceList, StatCards } from './BomTable';
import { EmptyState, PartThumb } from './PartThumb';
import { bomToCSV, topviewToText, downloadText } from '../lib/export';
import { CATEGORY_LABEL as CL } from '../../shared/types';

function fmt(n: number, d = 0) {
  return n.toLocaleString('zh-CN', { maximumFractionDigits: d, minimumFractionDigits: d });
}

export function PropertiesPanel() {
  const ent = () => activeEntity();
  const def = () => (ent() ? PART_MAP[ent()!.defId] : null);
  const size = () => (ent() && def() ? entitySize(ent()!, def()!) : null);
  const editable = () => (activeUid() ? isEditable(activeUid()!) : false);

  const weight = createMemo(() => (def() && ent() ? partWeight(def()!, size() ?? undefined) : 0));
  const volume = createMemo(() => (size() ? partVolumeM3(size()!) : 0));

  return (
    <div class="panel-scroll">
      <Show
        when={ent() && def()}
        fallback={
          <Show when={selection().length > 1} fallback={<PropertiesEmpty />}>
            <MultiSelectPanel />
          </Show>
        }
      >
        <div class="section">
          <div class="section-head" style={{ cursor: 'default' }}>
            <PartThumb def={def()!} size={22} />
            零件属性
            <span style={{ 'margin-left': 'auto', 'text-transform': 'none', 'letter-spacing': 0 }}>
              <Show when={!editable()} fallback={<span class="badge" style={{ background: '#26323d', color: '#93a6b8' }}>可编辑</span>}>
                <span class="badge badge-rejected">只读</span>
              </Show>
            </span>
          </div>
          <div class="section-body">
            <div class="prop-row">
              <label>名称</label>
              <div>
                <div style={{ 'font-size': '13px' }}>{def()!.name}</div>
                <div style={{ 'font-family': 'var(--mono)', 'font-size': '10.5px', color: 'var(--text-faint)' }}>{def()!.partNo}</div>
              </div>
            </div>
            <div class="prop-row"><label>类别</label>
              <span>
                <span class="tree-dot" style={{ display: 'inline-block', background: CATEGORY_COLOR[def()!.category], 'margin-right': '6px' }} />
                {CATEGORY_LABEL[def()!.category]}
              </span>
            </div>
            <div class="prop-row"><label>规格</label><span style={{ 'font-family': 'var(--mono)', 'font-size': '11.5px' }}>{def()!.spec}</span></div>
            <div class="prop-row"><label>材质</label>
              <span style={{ 'font-size': '11.5px' }}>{MATERIALS.find((m) => m.id === def()!.material)?.name ?? def()!.material}</span>
            </div>
            <div class="prop-row"><label>单件重量</label><span style={{ 'font-family': 'var(--mono)' }}>{weight().toFixed(2)} kg</span></div>
            <div class="prop-row"><label>包围体积</label><span style={{ 'font-family': 'var(--mono)' }}>{volume().toFixed(4)} m³</span></div>
            <Show when={def()!.note}><div class="hint-inline">📌 {def()!.note}</div></Show>
          </div>
        </div>

        <div class="section">
          <div class="section-head" style={{ cursor: 'default' }}>尺寸（mm）<span style={{ 'margin-left': 'auto', 'font-family': 'var(--mono)', color: 'var(--text-faint)', 'text-transform': 'none' }}>×{fmt(size()!.w)}×{fmt(size()!.d)}×{fmt(size()!.h)}</span></div>
          <div class="section-body">
            <div class="size-grid">
              <div class="size-field">
                <span>W 长</span>
                <input type="number" value={Math.round(size()!.w)} disabled={!editable()} onChange={(e) => setEntitySize(ent()!.uid, { w: +e.currentTarget.value })} />
              </div>
              <div class="size-field">
                <span>D 宽</span>
                <input type="number" value={Math.round(size()!.d)} disabled={!editable()} onChange={(e) => setEntitySize(ent()!.uid, { d: +e.currentTarget.value })} />
              </div>
              <div class="size-field">
                <span>H 高</span>
                <input type="number" value={Math.round(size()!.h)} disabled={!editable()} onChange={(e) => setEntitySize(ent()!.uid, { h: +e.currentTarget.value })} />
              </div>
            </div>
            <div class="hint-inline">修改尺寸会同步更新重量与物料清单；连接件与管件的插接点位置随包围盒变化。</div>
          </div>
        </div>

        <div class="section">
          <div class="section-head" style={{ cursor: 'default' }}>材质色</div>
          <div class="section-body">
            <div class="chip-row">
              <For each={colorSwatches(def()!.category)}>
                {(c) => (
                  <button
                    class={`chip ${(ent()!.color ?? def()!.color) === c ? 'on' : ''}`}
                    style={{ padding: '3px 5px' }}
                    disabled={!editable()}
                    onClick={() => setEntityColor(ent()!.uid, c)}
                    title={c}
                  >
                    <span style={{ display: 'inline-block', width: '14px', height: '14px', 'border-radius': '3px', background: c, 'vertical-align': 'middle' }} />
                  </button>
                )}
              </For>
            </div>
            <div class="prop-row">
              <label>自定义</label>
              <input type="color" value={ent()!.color ?? def()!.color} disabled={!editable()} onInput={(e) => setEntityColor(ent()!.uid, e.currentTarget.value)} />
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-head" style={{ cursor: 'default' }}>位置 / 姿态</div>
          <div class="section-body">
            <div class="size-grid">
              <div class="size-field"><span>X mm</span><input type="number" value={Math.round(ent()!.pos.x)} disabled={!editable()} onChange={(e) => setPos(ent()!.uid, 'x', +e.currentTarget.value)} /></div>
              <div class="size-field"><span>Y mm</span><input type="number" value={Math.round(ent()!.pos.y)} disabled={!editable()} onChange={(e) => setPos(ent()!.uid, 'y', +e.currentTarget.value)} /></div>
              <div class="size-field"><span>Z mm</span><input type="number" value={Math.round(ent()!.pos.z)} disabled={!editable()} onChange={(e) => setPos(ent()!.uid, 'z', +e.currentTarget.value)} /></div>
            </div>
            <div class="prop-row">
              <label>转角</label>
              <div style={{ display: 'flex', gap: '6px', 'align-items': 'center' }}>
                <input type="number" step="15" value={Math.round(ent()!.rot || 0)} disabled={!editable()} onChange={(e) => setRot(ent()!.uid, +e.currentTarget.value)} />
                <button class="icon" disabled={!editable()} title="逆时针 15°" onClick={() => rotateSelection(-15)}>⟲</button>
                <button class="icon" disabled={!editable()} title="顺时针 15°" onClick={() => rotateSelection(15)}>⟳</button>
              </div>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-head" style={{ cursor: 'default' }}>操作</div>
          <div class="section-body" style={{ display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '6px' }}>
            <button onClick={() => focusSelection()} title="镜头聚焦">⌖ 聚焦</button>
            <button onClick={() => duplicateSelection()} disabled={!editable()}>⧉ 复制</button>
            <button onClick={() => toggleEntityLock(ent()!.uid)}>{ent()!.locked ? '🔒 已锁定' : '🔓 锁定'}</button>
            <button onClick={() => toggleEntityHidden(ent()!.uid)}>{ent()!.hidden ? '隐藏中' : '隐藏'}</button>
            <button class="danger" style={{ 'grid-column': 'span 2' }} onClick={() => deleteSelection()} disabled={!editable()}>删除选中件</button>
          </div>
        </div>
      </Show>
    </div>
  );
}

function PropertiesEmpty() {
  return (
    <div>
      <EmptyState
        icon="▣"
        title="未选中零件"
        hint="在场景中点击零件，或在左侧层级树点击条目。\n同一处再次点击可穿透选中被遮挡的零件。"
      />
      <div class="section">
        <div class="section-head" style={{ cursor: 'default' }}>图层面板</div>
        <div class="section-body">
          <For each={Object.keys(scene.layers) as Category[]}>
            {(cat) => (
              <div style={{ display: 'flex', 'align-items': 'center', gap: '7px', 'font-size': '11.5px' }}>
                <span class="tree-dot" style={{ background: CATEGORY_COLOR[cat], opacity: scene.layers[cat].visible ? 1 : 0.3 }} />
                <span style={{ flex: 1, opacity: scene.layers[cat].visible ? 1 : 0.5 }}>{CL[cat]}</span>
                <button class={`icon ${scene.layers[cat].visible ? '' : 'on'}`} title="显示/隐藏" onClick={() => toggleLayerVisible(cat)}>{scene.layers[cat].visible ? '◉' : '○'}</button>
                <button class={`icon ${scene.layers[cat].locked ? 'on' : ''}`} title="锁定/解锁" onClick={() => toggleLayerLocked(cat)}>{scene.layers[cat].locked ? '🔒' : '🔓'}</button>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

function MultiSelectPanel() {
  const sel = () => selection().map((u) => scene.entities.find((e) => e.uid === u)).filter(Boolean) as Entity[];
  const totalWeight = () => sel().reduce((s, e) => {
    const d = PART_MAP[e.defId];
    return s + (d ? partWeight(d, e.size ?? d.size) : 0);
  }, 0);
  return (
    <div class="section">
      <div class="section-head" style={{ cursor: 'default' }}>多选 · {selection().length} 个构件</div>
      <div class="section-body">
        <div class="prop-row"><label>总重</label><span style={{ 'font-family': 'var(--mono)' }}>{totalWeight().toFixed(2)} kg</span></div>
        <div style={{ display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '6px', 'margin-top': '4px' }}>
          <button onClick={() => focusSelection()}>⌖ 框选聚焦</button>
          <button onClick={() => duplicateSelection()}>⧉ 复制组件</button>
          <button onClick={() => rotateSelection(-15)}>⟲ 逆时针 15°</button>
          <button onClick={() => rotateSelection(15)}>⟳ 顺时针 15°</button>
          <button class="danger" style={{ 'grid-column': 'span 2' }} onClick={() => deleteSelection()}>删除选中件</button>
        </div>
        <div class="hint-inline" style={{ 'margin-top': '6px' }}>拖动三轴手柄可整体平移；松手后整组按整体包围盒吸附地面或下方件。</div>
      </div>
    </div>
  );
}

const SWATCHES: Record<Category, string[]> = {
  tube: ['#5d7186', '#4d5f72', '#66798d', '#8a99a9', '#2f3a46', '#c9cfd6', '#7c4a3a', '#3b5a72'],
  connector: ['#d98a3d', '#e29a4c', '#394656', '#8a8f96', '#c9a173', '#5b4a3a'],
  board: ['#c9a173', '#b8895c', '#d8bd97', '#8a6a42', '#e6d3b3', '#6b4f34'],
  carton: ['#b98b5e', '#c39668', '#a97c4f', '#cbb08a'],
  hardware: ['#9aa6b5', '#7d8896', '#b7c0ca', '#5c6672'],
};

function colorSwatches(cat: Category) {
  return SWATCHES[cat] ?? ['#7d8896'];
}

// small local mutators that snapshot for undo
import { produce } from 'solid-js/store';
import { setScene, setDirtySinceSave } from '../editor/store';

function setPos(uid: string, axis: 'x' | 'y' | 'z', v: number) {
  const idx = scene.entities.findIndex((e) => e.uid === uid);
  if (idx < 0) return;
  setScene('entities', idx, 'pos', axis, Math.max(axis === 'z' ? 0 : -100000, v));
  setDirtySinceSave(true);
}
function setRot(uid: string, v: number) {
  const idx = scene.entities.findIndex((e) => e.uid === uid);
  if (idx < 0) return;
  setScene('entities', idx, 'rot', v);
  setDirtySinceSave(true);
}

export function StatsPanel() {
  const bom = createMemo(() => bomData());
  const report = createMemo(() => interferenceReport());
  const top = createMemo(() => topviewData());
  const narrow = createMemo(() => top().aisles.filter((a) => a.narrow));

  function exportBom() {
    const meta = { project: scene.project, version: '当前工作稿' };
    downloadText(`${scene.projectCode || 'KD'}-BOM.csv`, bomToCSV(bom(), meta), 'text/csv;charset=utf-8');
    toast('BOM 已导出', 'ok');
  }
  function exportTopview() {
    const meta = { project: scene.project, version: '当前工作稿' };
    downloadText(`${scene.projectCode || 'KD'}-俯视布置.txt`, topviewToText(top(), meta));
    toast('俯视布置说明已导出', 'ok');
  }

  return (
    <div class="panel-scroll" style={{ padding: '11px', display: 'flex', 'flex-direction': 'column', gap: '13px' }}>
      <StatCards
        stats={[
          { k: '零件总数', v: String(bom().totalParts), unit: '件' },
          { k: '总重量', v: bom().totalWeight.toFixed(1), unit: 'kg' },
          { k: '总体积', v: bom().totalVolume.toFixed(3), unit: 'm³' },
          { k: '干涉', v: String(report().length), unit: '处', tone: report().length ? 'var(--red)' : 'var(--green)' },
        ]}
      />
      <div>
        <div class="section-head" style={{ background: 'none', padding: '4px 0' }}>按类别统计</div>
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '5px' }}>
          <For each={bom().byCategory}>
            {(c) => (
              <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'font-size': '11.5px' }}>
                <span class="tree-dot" style={{ background: CATEGORY_COLOR[c.category] }} />
                <span style={{ flex: 1, color: 'var(--text-dim)' }}>{c.label}</span>
                <span style={{ 'font-family': 'var(--mono)' }}>{c.qty} 件</span>
                <span style={{ 'font-family': 'var(--mono)', color: 'var(--text-faint)', width: '62px', 'text-align': 'right' }}>{c.weight.toFixed(1)} kg</span>
              </div>
            )}
          </For>
        </div>
      </div>
      <div>
        <div class="section-head" style={{ background: 'none', padding: '4px 0', 'justify-content': 'space-between' }}>
          通道检查（俯视）
          <button class="icon" style={{ 'font-size': '10px' }} title="导出俯视布置说明" onClick={exportTopview}>⭳ 导出</button>
        </div>
        <Show when={narrow().length} fallback={<div class="ok-box">所有主通道宽度达标（≥800 mm）。</div>}>
          <div class="issue-list">
            <For each={narrow()}>
              {(a) => (
                <div class="issue-row">
                  <span class="idx">!</span>
                  <span>{a.dir === 'v' ? '纵向' : '横向'}通道偏窄</span>
                  <span class="occ">{Math.round(a.width)} mm</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
      <div>
        <div class="section-head" style={{ background: 'none', padding: '4px 0' }}>干涉检测</div>
        <InterferenceList
          report={report()}
          onPick={(p) => { setSelection([p.a, p.b]); }}
          names={(p) => {
            const a = PART_MAP[scene.entities.find((e) => e.uid === p.a)?.defId ?? '']?.name ?? p.nameA;
            const b = PART_MAP[scene.entities.find((e) => e.uid === p.b)?.defId ?? '']?.name ?? p.nameB;
            return [a, b];
          }}
        />
      </div>
      <div>
        <div class="section-head" style={{ background: 'none', padding: '4px 0', 'justify-content': 'space-between' }}>
          物料清单（BOM）
          <div style={{ display: 'flex', gap: '4px' }}>
            <button class="icon" style={{ 'font-size': '10px' }} title="导出 BOM CSV" onClick={exportBom}>⭳ CSV</button>
          </div>
        </div>
        <BomTable bom={bom()} compact />
      </div>
    </div>
  );
}
