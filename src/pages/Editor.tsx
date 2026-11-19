import { For, Show, createSignal, createMemo, onMount, onCleanup } from 'solid-js';
import Canvas from '../editor/Canvas';
import { PartLibrary, HierarchyTree } from '../components/LeftPanels';
import { PropertiesPanel, StatsPanel } from '../components/PropertiesPanel';
import { TopViewBoard } from './TopViewBoard';
import { UserPill } from '../components/UserPill';
import { BomTable, InterferenceList } from '../components/BomTable';
import {
  bomData,
  camera,
  canRedo,
  canUndo,
  clearSelection,
  deleteSelection,
  dirtySinceSave,
  duplicateSelection,
  focusSelection,
  interferenceReport,
  markSaved,
  redo,
  resetScene,
  rotateSelection,
  scene,
  selection,
  setDirtySinceSave,
  setSelection,
  setView,
  snapAngle,
  setSnapAngle,
  snapGrid,
  setSnapGrid,
  snapPorts,
  setSnapPorts,
  toast,
  undo,
  view,
  viewport,
  zoomAt,
  replaceScene,
} from '../editor/store';
import { api } from '../lib/api';
import { bomToCSV, downloadText } from '../lib/export';
import type { VersionSummary } from '../../shared/types';
import { STATUS_LABEL } from '../../shared/types';

type LeftTab = 'library' | 'tree';
type RightTab = 'props' | 'stats';

export default function Editor(props: { me: any; users: any[]; onSwitchUser: (id: string) => void; onOpenReview: () => void; onOpenVersions: () => void }) {
  const [leftTab, setLeftTab] = createSignal<LeftTab>('tree');
  const [rightTab, setRightTab] = createSignal<RightTab>('props');
  const [showSave, setShowSave] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  const bom = createMemo(() => bomData());
  const report = createMemo(() => interferenceReport());
  const selCount = () => selection().length;

  function exportBom() {
    downloadText(`${scene.projectCode || 'KD'}-BOM.csv`, bomToCSV(bom(), { project: scene.project, version: '当前工作稿' }), 'text/csv;charset=utf-8');
    toast('物料清单已导出为 CSV', 'ok');
  }

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); }
      else if (e.key === 'Escape') { clearSelection(); }
      else if (e.key === 'f' || e.key === 'F') { focusSelection(); }
      else if (e.key === 'r' || e.key === 'R') { rotateSelection(e.shiftKey ? -15 : 15); }
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  return (
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark">
            <svg width="15" height="15" viewBox="0 0 32 32">
              <path d="M16 5 27 11v10L16 27 5 21V11z" fill="none" stroke="#e7a94a" stroke-width="1.8" />
              <path d="M5 11l11 6 11-6M16 17v10" stroke="#e7a94a" stroke-width="1.2" opacity=".65" />
            </svg>
          </span>
          <div>
            <div>床架三维布置工作台</div>
            <div class="brand-sub">拆装式钢管床架 · 拼装工艺</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px', 'align-items': 'center' }}>
          <button class="ghost" disabled={!canUndo()} onClick={undo} title="撤销 Ctrl+Z">↶ 撤销</button>
          <button class="ghost" disabled={!canRedo()} onClick={redo} title="重做 Ctrl+Y">↷ 重做</button>
          <span class="toolbar-sep" />
          <button class="ghost" onClick={() => setShowSave(true)} disabled={busy()}>保存版本</button>
          <button class="ghost" onClick={props.onOpenVersions}>版本历史</button>
          <button class="ghost" onClick={props.onOpenReview}>评审中心</button>
          <span class="toolbar-sep" />
          <button class="ghost" onClick={exportBom} title="导出物料清单 CSV">⭳ BOM</button>
        </div>

        <div style={{ 'margin-left': 'auto', display: 'flex', gap: '10px', 'align-items': 'center' }}>
          <div class="seg" title="吸附设置">
            <button class={snapGrid() ? 'on' : ''} onClick={() => setSnapGrid((v) => !v)} title="网格吸附 10mm">网格</button>
            <button class={snapAngle() ? 'on' : ''} onClick={() => setSnapAngle((v) => !v)} title="转角吸附 15°">转角15°</button>
            <button class={snapPorts() ? 'on' : ''} onClick={() => setSnapPorts((v) => !v)} title="插接点吸附">插接</button>
          </div>
          <UserPill me={props.me} users={props.users} onSwitch={props.onSwitchUser} />
        </div>
      </header>

      <div class="workspace">
        <aside class="panel panel-left">
          <div class="panel-tabs">
            <button class={`panel-tab ${leftTab() === 'tree' ? 'active' : ''}`} onClick={() => setLeftTab('tree')}>层级树</button>
            <button class={`panel-tab ${leftTab() === 'library' ? 'active' : ''}`} onClick={() => setLeftTab('library')}>零件库</button>
          </div>
          <Show when={leftTab() === 'tree'} fallback={<PartLibrary />}>
            <HierarchyTree />
          </Show>
        </aside>

        <main class="viewport-wrap">
          <div style={{ position: 'absolute', inset: 0, visibility: view() === 'iso' ? 'visible' : 'hidden' }}>
            <Canvas />
          </div>
          <Show when={view() === 'top'}>
            <TopViewBoard />
          </Show>
          <div class="view-toggle">
            <button class={view() === 'iso' ? 'on' : ''} onClick={() => setView('iso')}>等轴测</button>
            <button class={view() === 'top' ? 'on' : ''} onClick={() => setView('top')}>俯视出图</button>
          </div>
          <Show when={view() === 'iso'}>
            <div style={{ position: 'absolute', right: '12px', bottom: '12px', display: 'flex', gap: '5px' }}>
              <button class="ghost" style={{ 'font-size': '11px' }} onClick={() => { const vp = viewport(); zoomAt(vp.w / 2, vp.h / 2, 1.2); }}>＋</button>
              <button class="ghost" style={{ 'font-size': '11px' }} onClick={() => { const vp = viewport(); zoomAt(vp.w / 2, vp.h / 2, 1 / 1.2); }}>－</button>
              <button class="ghost" style={{ 'font-size': '11px' }} onClick={focusSelection} disabled={!selCount()}>聚焦</button>
            </div>
          </Show>
        </main>

        <aside class="panel panel-right">
          <div class="panel-tabs">
            <button class={`panel-tab ${rightTab() === 'props' ? 'active' : ''}`} onClick={() => setRightTab('props')}>属性</button>
            <button class={`panel-tab ${rightTab() === 'stats' ? 'active' : ''}`} onClick={() => setRightTab('stats')}>统计 / BOM</button>
          </div>
          <Show when={rightTab() === 'props'} fallback={<StatsPanel />}>
            <PropertiesPanel />
          </Show>
        </aside>
      </div>

      <footer class="statusbar">
        <span class="sb-item">
          <span class="sb-dot" style={{ background: dirtySinceSave() ? 'var(--accent)' : 'var(--green)' }} />
          {dirtySinceSave() ? '有未保存修改' : '已同步'}
        </span>
        <span class="sb-item">选中 <b>{selCount()}</b> 件</span>
        <span class="sb-item">场景 <b>{scene.entities.length}</b> 件</span>
        <span class="sb-right">
          <span class="sb-item">干涉 <b style={{ color: report().length ? 'var(--red)' : 'inherit' }}>{report().length}</b></span>
          <span class="sb-item">总重 <b>{bom().totalWeight.toFixed(1)}</b> kg</span>
          <span class="sb-item">缩放 <b>{Math.round(camera().zoom * 100)}%</b></span>
          <span class="sb-item" style={{ opacity: 0.6 }}>{scene.project} · {scene.projectCode}</span>
        </span>
      </footer>

      <Show when={showSave()}>
        <SaveDialog
          me={props.me}
          onClose={() => setShowSave(false)}
          onSaved={() => { setShowSave(false); markSaved(); }}
        />
      </Show>
    </div>
  );
}

function SaveDialog(props: { me: any; onClose: () => void; onSaved: () => void }) {
  const defaultName = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `V${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  };
  const [name, setName] = createSignal(defaultName());
  const [note, setNote] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);
  const bom = createMemo(() => bomData());
  const report = createMemo(() => interferenceReport());

  async function save(submit = false) {
    if (!name().trim()) { setErr('请填写版本名称'); return; }
    setBusy(true);
    setErr(null);
    try {
      const v = await api.createVersion({ name: name().trim(), note: note(), scene: JSON.parse(JSON.stringify(scene)) });
      if (submit) {
        await api.submitVersion(v.id);
        toast(`版本「${name()}」已保存并提交主管评审`, 'ok');
      } else {
        toast(`版本「${name()}」已保存为草稿`, 'ok');
      }
      props.onSaved();
      setSelection([]);
      (window as any).__lastSavedVersion = v.id;
    } catch (e: any) {
      setErr(e.message ?? '保存失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div class="modal">
        <div class="modal-head">保存方案版本<span class="x"><button class="icon" onClick={props.onClose}>✕</button></span></div>
        <div class="modal-body">
          <div class="prop-row"><label>版本名称</label><input value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder="如 V20261120-01" /></div>
          <div class="prop-row" style={{ 'align-items': 'start' }}>
            <label style={{ 'padding-top': '5px' }}>变更说明</label>
            <textarea value={note()} onInput={(e) => setNote(e.currentTarget.value)} placeholder="本次调整内容，如：床腿加高 20mm、重新排布装箱…" />
          </div>
          <div class="stat-card" style={{ display: 'flex', gap: '22px', 'font-size': '11.5px' }}>
            <span>零件 <b style={{ 'font-family': 'var(--mono)' }}>{bom().totalParts}</b> 件</span>
            <span>总重 <b style={{ 'font-family': 'var(--mono)' }}>{bom().totalWeight.toFixed(1)}</b> kg</span>
            <span>干涉 <b style={{ 'font-family': 'var(--mono)', color: report().length ? 'var(--red)' : 'var(--green)' }}>{report().length}</b> 处</span>
          </div>
          <Show when={report().length}>
            <div class="warn-box">当前方案存在 {report().length} 处包围盒干涉，建议先处理再提交评审。保存草稿不受影响。</div>
          </Show>
          <Show when={err()}>
            <div class="warn-box">{err()}</div>
          </Show>
        </div>
        <div class="modal-foot">
          <button class="ghost" onClick={props.onClose}>取消</button>
          <button onClick={() => save(false)} disabled={busy()}>{busy() ? '保存中…' : '保存为草稿'}</button>
          <button class="primary" onClick={() => save(true)} disabled={busy()}>保存并提交评审</button>
        </div>
      </div>
    </div>
  );
}
