import { createSignal, For, Show } from 'solid-js';
import {
  templates, deleteTemplate, presets, savePreset, deletePreset, newPresetId,
} from '../store/store';
import type { ExportPreset } from '../types';

function blankPreset(): ExportPreset {
  return {
    id: newPresetId(), name: '新预设', veinColor: '#14352a', patternFill: '#8a5a25',
    patternOpacity: 0.8, strokeWidth: 2, splitLayers: true, includeBg: false,
  };
}

export default function AdminView() {
  const [editing, setEditing] = createSignal<ExportPreset | null>(null);
  const [tab, setTab] = createSignal<'templates' | 'presets'>('templates');

  function edit(p: ExportPreset) { setEditing({ ...p }); }
  function save() {
    const p = editing();
    if (!p) return;
    if (!p.name.trim()) { alert('预设名称不能为空'); return; }
    savePreset(p);
    setEditing(null);
  }

  return (
    <div class="view admin-view">
      <div class="admin-tabs">
        <button classList={{ active: tab() === 'templates' }} onClick={() => setTab('templates')}>翅脉模板库</button>
        <button classList={{ active: tab() === 'presets' }} onClick={() => setTab('presets')}>导出预设</button>
      </div>

      <Show when={tab() === 'templates'}>
        <section class="admin-section">
          <h3>模板库({templates().length})</h3>
          <p class="muted">描图台保存的同科翅脉模板,插画师可在同科标本上一键套用再修改。</p>
          <table class="data-table">
            <thead><tr><th>模板名</th><th>适用科</th><th>翅脉数</th><th>创建时间</th><th>操作</th></tr></thead>
            <tbody>
              <For each={templates()} fallback={<tr><td colspan="5" class="empty">暂无模板</td></tr>}>
                {tpl => (
                  <tr>
                    <td>{tpl.name}</td>
                    <td>{tpl.family}</td>
                    <td>{tpl.paths.length}</td>
                    <td>{new Date(tpl.createdAt).toLocaleString()}</td>
                    <td><button class="danger" onClick={() => {
                      if (confirm(`确认删除模板「${tpl.name}」?`)) deleteTemplate(tpl.id);
                    }}>删除</button></td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </section>
      </Show>

      <Show when={tab() === 'presets'}>
        <section class="admin-section">
          <div class="section-head">
            <h3>导出预设({presets().length})</h3>
            <button class="primary" onClick={() => setEditing(blankPreset())}>＋ 新建预设</button>
          </div>
          <table class="data-table">
            <thead><tr><th>名称</th><th>翅脉色</th><th>斑纹填充</th><th>不透明度</th><th>线宽</th><th>分层</th><th>含底图</th><th>操作</th></tr></thead>
            <tbody>
              <For each={presets()}>
                {p => (
                  <tr>
                    <td>{p.name}</td>
                    <td><span class="color-chip" style={{ background: p.veinColor }} />{p.veinColor}</td>
                    <td><span class="color-chip" style={{ background: p.patternFill }} />{p.patternFill}</td>
                    <td>{Math.round(p.patternOpacity * 100)}%</td>
                    <td>{p.strokeWidth}</td>
                    <td>{p.splitLayers ? '每路径一层' : '合并'}</td>
                    <td>{p.includeBg ? '是' : '否'}</td>
                    <td>
                      <button onClick={() => edit(p)}>编辑</button>
                      <button class="danger" onClick={() => {
                        if (confirm(`删除预设「${p.name}」?`)) deletePreset(p.id);
                      }}>删除</button>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </section>
      </Show>

      <Show when={editing()}>
        {p => (
          <div class="modal-mask" onClick={() => setEditing(null)}>
            <div class="modal preset-editor" onClick={e => e.stopPropagation()}>
              <h3>编辑导出预设</h3>
              <label>名称 <input value={p().name}
                onInput={e => setEditing({ ...p(), name: e.currentTarget.value })} /></label>
              <div class="form-grid">
                <label>翅脉颜色 <input type="color" value={p().veinColor}
                  onInput={e => setEditing({ ...p(), veinColor: e.currentTarget.value })} /></label>
                <label>斑纹填充 <input type="color" value={p().patternFill}
                  onInput={e => setEditing({ ...p(), patternFill: e.currentTarget.value })} /></label>
                <label>斑纹不透明度
                  <input type="range" min="0.1" max="1" step="0.05" value={p().patternOpacity}
                    onInput={e => setEditing({ ...p(), patternOpacity: parseFloat(e.currentTarget.value) })} />
                </label>
                <label>描边线宽
                  <input type="number" min="0.5" max="8" step="0.1" value={p().strokeWidth}
                    onInput={e => setEditing({ ...p(), strokeWidth: parseFloat(e.currentTarget.value) })} />
                </label>
              </div>
              <label class="check-row">
                <input type="checkbox" checked={p().splitLayers}
                  onChange={e => setEditing({ ...p(), splitLayers: e.currentTarget.checked })} />
                每条路径导出为独立命名图层(Inkscape 兼容)
              </label>
              <label class="check-row">
                <input type="checkbox" checked={p().includeBg}
                  onChange={e => setEditing({ ...p(), includeBg: e.currentTarget.checked })} />
                SVG 内嵌标本底图
              </label>
              <div class="modal-actions">
                <button class="ghost" onClick={() => setEditing(null)}>取消</button>
                <button class="primary" onClick={save}>保存预设</button>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}
