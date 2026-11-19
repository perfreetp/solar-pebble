import { createSignal, For, Show } from 'solid-js';
import CanvasStage from '../components/CanvasStage';
import Toolbar from '../components/Toolbar';
import LayerPanel from '../components/LayerPanel';
import {
  docState, applyBoolean, cutHoles, alignSelected, submitDoc, clearDoc,
  loadPaths, loadSpecimen,
} from '../store/docStore';
import {
  templates, saveTemplate, applyTemplate, presets, currentUser,
} from '../store/store';
import { generateSpecimenBitmap } from '../lib/specimenImage';
import { exportLayeredSVG, downloadSVG } from '../lib/svgExport';
import type { BooleanOp } from '../types';

const SPECIMENS = [
  { code: 'SP-0001', family: '凤蝶科 Papilionidae', species: '金凤蝶 Papilio machaon', seed: 11, hint: 0 },
  { code: 'SP-0007', family: '凤蝶科 Papilionidae', species: '柑橘凤蝶 Papilio xuthus', seed: 23, hint: 0 },
  { code: 'SP-0112', family: '天牛科 Cerambycidae', species: '星天牛 Anoplophora chinensis', seed: 47, hint: 1 },
  { code: 'SP-0208', family: '蜻蜓科 Libellulidae', species: '黄蜻 Pantala flavescens', seed: 61, hint: 1 },
];

export default function StudioView() {
  const [toastMsg, setToastMsg] = createSignal('');
  const [showTpl, setShowTpl] = createSignal(false);
  const [showExport, setShowExport] = createSignal(false);
  const [tplName, setTplName] = createSignal('');
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  function toast(msg: string) {
    setToastMsg(msg);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setToastMsg(''), 2600);
  }

  async function switchSpecimen(code: string) {
    const sp = SPECIMENS.find(s => s.code === code)!;
    const bitmap = await generateSpecimenBitmap(sp.seed, sp.hint);
    loadSpecimen({ code: sp.code, family: sp.family, species: sp.species }, bitmap);
    toast(`已载入标本底图:${sp.code}`);
  }

  function onBoolean(op: BooleanOp) {
    const r = applyBoolean(op);
    toast(r.ok ? `${op === 'union' ? '并集' : op === 'difference' ? '差集' : '交集'}运算完成` : r.msg);
  }
  function onCut() {
    const r = cutHoles();
    toast(r.ok ? '已按翅脉切出镂空(fill-rule: evenodd)' : r.msg);
  }
  function onAlign(a: Parameters<typeof alignSelected>[0]) {
    alignSelected(a);
    toast('对齐/分布已应用');
  }

  function onSaveTemplate() {
    const veins = docState.paths().filter(p => p.kind === 'vein');
    if (!veins.length) { toast('当前没有可保存的翅脉路径'); return; }
    const name = tplName() || `${docState.specimen().family} 模板`;
    saveTemplate(name, docState.specimen().family, docState.paths());
    setTplName('');
    toast(`模板「${name}」已入库`);
  }

  function onUseTemplate(id: string) {
    const tpl = templates().find(t => t.id === id);
    if (!tpl) return;
    const newPaths = applyTemplate(tpl);
    loadPaths([...docState.paths(), ...newPaths]);
    setShowTpl(false);
    toast(`已套用模板「${tpl.name}」,可继续修改`);
  }

  function onExport(presetId: string) {
    const preset = presets().find(p => p.id === presetId) ?? presets()[0];
    const svg = exportLayeredSVG(docState.paths(), preset, {
      specimenCode: docState.specimen().code,
      species: docState.specimen().species,
    });
    downloadSVG(svg, `${docState.specimen().code}_${preset.name}.svg`);
    setShowExport(false);
    toast('分层 SVG 已导出下载');
  }

  function onSubmit() {
    if (!docState.paths().length) { toast('空白文档不能提交'); return; }
    const sub = submitDoc(currentUser().name);
    toast(`已提交审校,受理号 ${sub.id.slice(-6)}`);
  }

  return (
    <div class="view studio-view">
      <div class="specimen-bar">
        <label>标本
          <select onChange={e => switchSpecimen(e.currentTarget.value)}>
            <For each={SPECIMENS}>{sp => <option value={sp.code}>{sp.code} · {sp.species}</option>}</For>
          </select>
        </label>
        <span class="specimen-meta">{docState.specimen().family}</span>
        <button class="ghost" onClick={() => { clearDoc(); toast('已新建空白文档(历史可撤销)'); }}>＋ 新建文档</button>
        <span class="spacer" />
        <span class="history-pill">
          历史栈 {docState.historyInfo().undo} 步撤销 / {docState.historyInfo().redo} 步重做(上限 80)
        </span>
      </div>

      <Toolbar
        onBoolean={onBoolean} onCut={onCut} onAlign={onAlign}
        onExport={() => setShowExport(true)} onSubmit={onSubmit}
        onTemplate={() => setShowTpl(true)} toast={toast}
      />

      <div class="workspace">
        <LayerPanel />
        <CanvasStage />
      </div>

      <Show when={toastMsg()}><div class="toast">{toastMsg()}</div></Show>

      {/* 模板库抽屉 */}
      <Show when={showTpl()}>
        <div class="modal-mask" onClick={() => setShowTpl(false)}>
          <div class="modal" onClick={e => e.stopPropagation()}>
            <h3>翅脉模板库(同科套用)</h3>
            <div class="tpl-save-row">
              <input placeholder="模板名称,如:凤蝶科标准脉序" value={tplName()}
                onInput={e => setTplName(e.currentTarget.value)} />
              <button class="primary" onClick={onSaveTemplate}>把当前翅脉存为模板</button>
            </div>
            <For each={templates()} fallback={<p class="empty">暂无模板。先在画布上描绘翅脉,再保存为模板。</p>}>
              {tpl => (
                <div class="tpl-row">
                  <div>
                    <strong>{tpl.name}</strong>
                    <span class="muted">{tpl.family} · {tpl.paths.length} 条翅脉 · {new Date(tpl.createdAt).toLocaleDateString()}</span>
                  </div>
                  <button onClick={() => onUseTemplate(tpl.id)} disabled={tpl.family !== docState.specimen().family}
                    title={tpl.family !== docState.specimen().family ? '仅同科标本可套用' : ''}>
                    {tpl.family === docState.specimen().family ? '套用到当前文档' : '异科不可用'}
                  </button>
                </div>
              )}
            </For>
            <button class="ghost modal-close" onClick={() => setShowTpl(false)}>关闭</button>
          </div>
        </div>
      </Show>

      {/* 导出预设抽屉 */}
      <Show when={showExport()}>
        <div class="modal-mask" onClick={() => setShowExport(false)}>
          <div class="modal" onClick={e => e.stopPropagation()}>
            <h3>导出分层 SVG</h3>
            <p class="muted">输出 Inkscape 兼容的命名图层:标本底图 / 斑纹(evenodd 镂空) / 翅脉</p>
            <For each={presets()}>{preset => (
              <div class="tpl-row">
                <div>
                  <strong>{preset.name}</strong>
                  <span class="muted">
                    脉色 {preset.veinColor} · 斑纹 {preset.patternFill} · 线宽 {preset.strokeWidth}
                    · {preset.splitLayers ? '每路径独立图层' : '合并图层'}
                  </span>
                </div>
                <button class="primary" onClick={() => onExport(preset.id)}>导出</button>
              </div>
            )}</For>
            <button class="ghost modal-close" onClick={() => setShowExport(false)}>关闭</button>
          </div>
        </div>
      </Show>
    </div>
  );
}
