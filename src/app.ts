import { Store } from './ui/store';
import { Studio } from './studio';
import './ui/app-shell';
import './ui/param-panel';
import './ui/layer-panel';
import './ui/map-canvas';
import './ui/creek-inspector';
import './ui/lock-panel';
import './ui/archive-panel';
import './ui/compare-view';
import './ui/report-view';
import type { MapCanvas } from './ui/map-canvas';
import type { AppShell } from './ui/app-shell';
import type { ParamPanel } from './ui/param-panel';
import type { LayerPanel } from './ui/layer-panel';
import type { CreekInspector } from './ui/creek-inspector';
import type { LockPanel } from './ui/lock-panel';
import type { ArchivePanel } from './ui/archive-panel';
import type { CompareView } from './ui/compare-view';
import type { ReportView } from './ui/report-view';
import { generateNetwork, captureLockFor } from './core/generator';
import { buildCreekCsv, buildCreekGeoJson, buildSurveyReport } from './core/doc';
import type { CreekRenderer } from './render/renderer';
import { refreshDerived } from './core/generator';
import { fromPayload, toPayload } from './core/serialize';
import type { Network, NetworkParams, CreekLock } from './core/types';
import type { BasemapRef } from './core/archive-types';

const store = new Store();
const studio = new Studio();

/* ------------------------------------------------------------------ *
 * 视图挂载
 * ------------------------------------------------------------------ */

const shell = document.getElementById('shell') as AppShell;
shell.setup(store);

const body = document.getElementById('body') as HTMLElement;

// 工作台结构 (light DOM, app-shell 的 slot 承接)
body.innerHTML = `
  <div class="workspace">
    <aside class="rail rail-left">
      <param-panel id="params"></param-panel>
      <layer-panel id="layers"></layer-panel>
    </aside>
    <section class="stage">
      <div class="stage-tools">
        <button class="primary" id="btn-generate">生成网络</button>
        <button id="btn-regenerate" title="按当前参数与锁定段整体重生成">按锁定重生成</button>
        <button id="btn-fit">全图</button>
        <button id="btn-snapshot">导出图片</button>
        <span class="spacer"></span>
        <button id="btn-version">存为版本</button>
      </div>
      <map-canvas id="map"></map-canvas>
      <div class="stage-foot">
        <span class="hint">滚轮缩放 · 拖动平移 · 双击全图 · 按住 Shift 拖动临时平移</span>
        <span class="spacer"></span>
        <span class="chip" id="lock-summary">锁定 0 段</span>
      </div>
    </section>
    <aside class="rail rail-right">
      <creek-inspector id="inspector"></creek-inspector>
      <lock-panel id="locks"></lock-panel>
    </aside>
  </div>
  <archive-panel id="archive" hidden></archive-panel>
  <compare-view id="compare" hidden></compare-view>
  <report-view id="report" hidden></report-view>
`;

const paramsEl = document.getElementById('params') as ParamPanel;
const layersEl = document.getElementById('layers') as LayerPanel;
const mapEl = document.getElementById('map') as MapCanvas;
const inspectorEl = document.getElementById('inspector') as CreekInspector;
const locksEl = document.getElementById('locks') as LockPanel;
const archiveEl = document.getElementById('archive') as ArchivePanel;
const compareEl = document.getElementById('compare') as CompareView;
const reportEl = document.getElementById('report') as ReportView;

paramsEl.setup(store);
layersEl.setup(store);
inspectorEl.setup(store);
locksEl.setup(store);
archiveEl.setup(store, studio);
compareEl.setup(store, studio);
reportEl.setup(store, studio);
void mapEl.setup(store);

/* ------------------------------------------------------------------ *
 * 生成与重生成
 * ------------------------------------------------------------------ */

let generateTimer = 0;

function doGenerate(reason: 'params' | 'manual' | 'locks'): void {
  const s = store.get();
  store.set({ generating: true });
  const run = () => {
    const locks = reason === 'params' || reason === 'manual' ? s.locks : store.get().locks;
    const net = generateNetwork(store.get().params, { locks });
    const locked = new Set(store.get().lockedIds);
    if (reason !== 'locks') {
      // 重新生成后仍保留原锁定集合
    }
    store.set({
      network: net,
      lockReport: net.lockReport,
      locks: mergeLocks(store.get().locks, net),
      lockedIds: locked,
      generating: false,
      selectedCreekId: locked.size && net.creeks.some((c) => c.id === store.get().selectedCreekId) ? store.get().selectedCreekId : null,
    });
    if (net.lockReport.length) {
      const bad = net.lockReport.filter((r) => !r.ok);
      if (bad.length) store.toast(`${net.lockReport.length} 段锁定已接回新网络; ${bad.length} 段被标记为孤段`, 'warn');
      else store.toast(`${net.lockReport.length} 段锁定段形态不变, 已接回新网络`, 'ok');
    }
  };
  // 让 UI 先显示 "生成中"
  window.setTimeout(run, 0);
}

/**
 * 锁定记录在重生成后保持不变 —— 它们是局部坐标定义, 与程序化几何无关。
 * 只有父沟已消失的锁定段才会在结果里显示为孤段 (orphans)。
 */
function mergeLocks(existing: CreekLock[], _net: Network): CreekLock[] {
  return existing;
}

/* 参数变化后延迟重生成 (滑块的连续输入做防抖) */
store.subscribe((_s, patch) => {
  if ('params' in patch) {
    window.clearTimeout(generateTimer);
    generateTimer = window.setTimeout(() => doGenerate('params'), 260);
  }
});

document.getElementById('btn-generate')!.addEventListener('click', () => doGenerate('manual'));
document.getElementById('btn-regenerate')!.addEventListener('click', () => {
  const s = store.get();
  if (!s.locks.length) {
    store.toast('当前没有锁定段, 将按参数整体重生成', 'info');
  }
  doGenerate('params');
});
document.getElementById('btn-fit')!.addEventListener('click', () => mapEl.fit());
document.getElementById('btn-snapshot')!.addEventListener('click', async () => {
  const blob = await mapEl.snapshot();
  if (!blob) {
    store.toast('当前无可用画面', 'warn');
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `潮沟网络-${store.get().network?.fingerprint ?? 'x'}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  store.toast('已导出当前视图', 'ok');
});
document.getElementById('btn-version')!.addEventListener('click', () => saveVersion());

function saveVersion(): void {
  const s = store.get();
  if (!s.network) {
    store.toast('请先生成网络', 'warn');
    return;
  }
  let archiveId = s.activeArchiveId;
  if (!archiveId) {
    const rec = studio.createArchive({
      name: s.archiveName.trim() || '潮沟网络调查成果',
      region: s.region.trim() || '未指定区域',
      year: Number(s.observedAt.slice(0, 4)) || new Date().getFullYear(),
      surveyor: s.surveyor.trim(),
      observedAt: s.observedAt,
      network: s.network,
      basemap: s.basemap,
      lockCount: s.locks.length,
      status: 'draft',
    });
    archiveId = rec.id;
    store.set({ activeArchiveId: rec.id });
  }
  const n = studio.listVersions(archiveId).length + 1;
  studio.saveVersion(archiveId, `版本 ${n} · ${s.network.fingerprint}`, s.network);
  store.toast(`已存为版本 ${n}`, 'ok');
}

/* ------------------------------------------------------------------ *
 * 锁定
 * ------------------------------------------------------------------ */

function toggleLock(creekId: string): void {
  const s = store.get();
  if (!s.network) return;
  const creek = s.network.creeks.find((c) => c.id === creekId);
  if (!creek) return;
  const locked = new Set(s.lockedIds);
  let locks = s.locks;
  if (locked.has(creekId)) {
    locked.delete(creekId);
    locks = locks.filter((l) => l.creekId !== creekId);
    store.toast('已解锁', 'info');
  } else {
    const lock = captureLockFor(s.network.creeks, creek, new Date().toISOString());
    locks = [...locks.filter((l) => l.creekId !== creekId), lock];
    locked.add(creekId);
    store.toast('已锁定 · 改走向后形态不变', 'ok');
  }
  store.set({ locks, lockedIds: locked });
  if (s.activeArchiveId) {
    studio.replaceLocks(s.activeArchiveId, locks);
  }
}

/* ------------------------------------------------------------------ *
 * 面板间事件
 * ------------------------------------------------------------------ */

window.addEventListener('toggle-lock', ((e: CustomEvent) => toggleLock(e.detail.creekId)) as EventListener);
window.addEventListener('locks-changed', () => updateLockSummary());
window.addEventListener('store-version', () => saveVersion());
window.addEventListener('basemap-import', () => importBasemap());
window.addEventListener('params-commit', () => doGenerate('manual'));

window.addEventListener('view-change', ((e: CustomEvent) => {
  setView(e.detail.view);
}) as EventListener);

type ViewId = 'workspace' | 'compare' | 'archive' | 'report';

/** 视图路由: 只根据 store 里的 view 同步 DOM, 因此程序化改 store 也会正确切换 */
function applyView(view: ViewId): void {
  const ws = body.querySelector('.workspace') as HTMLElement | null;
  if (ws) ws.style.display = view === 'workspace' ? 'grid' : 'none';
  archiveEl.hidden = view !== 'archive';
  compareEl.hidden = view !== 'compare';
  reportEl.hidden = view !== 'report';
  if (view === 'workspace') requestAnimationFrame(() => mapEl.fit());
  if (view === 'archive') archiveEl.setAttribute('data-refresh', String(Date.now()));
  if (view === 'compare') compareEl.setAttribute('data-refresh', String(Date.now()));
  if (view === 'report') reportEl.setAttribute('data-refresh', String(Date.now()));
}

function setView(view: ViewId): void {
  store.set({ view });
}

/* ------------------------------------------------------------------ *
 * 档案载入 / 比对 / 报告
 * ------------------------------------------------------------------ */

window.addEventListener('archive-load', ((e: CustomEvent) => {
  const id = e.detail.id as string;
  const rec = studio.getArchive(id);
  if (!rec) return;
  const params = rec.params as unknown as NetworkParams;
  const versions = studio.listVersions(id);
  const locks = studio.listLocks(id).map((l) => studio.toCreekLock(l));
  store.set({
    params,
    locks,
    lockedIds: new Set(locks.map((l) => l.creekId)),
    region: rec.region,
    surveyor: rec.surveyor,
    observedAt: rec.observedAt,
    archiveName: rec.name,
    activeArchiveId: id,
  });
  if (versions.length) {
    // 载入最近版本的可编辑几何
    const latest = versions[0];
    const net = fromPayload(latest.payload);
    store.set({ network: net, lockReport: [], selectedCreekId: null });
  } else {
    const net = generateNetwork(params, { locks });
    store.set({ network: net, lockReport: net.lockReport });
  }
  setView('workspace');
  paramsEl.sync();
  store.toast(`已载入 ${rec.code}`, 'ok');
}) as EventListener);

window.addEventListener('archive-compare', ((e: CustomEvent) => {
  const id = e.detail.id as string;
  const rec = studio.getArchive(id);
  if (!rec) return;
  const versions = studio.listVersions(id);
  if (!versions.length) {
    const net = generateNetwork(rec.params as unknown as NetworkParams);
    store.set({ compareNetwork: net, compareVersionId: null });
  } else {
    store.set({ compareVersionId: versions[0].id, compareNetwork: fromPayload(versions[0].payload) });
  }
  store.set({ activeArchiveId: id });
  if (!store.get().network) doGenerate('manual');
  setView('compare');
}) as EventListener);

window.addEventListener('archive-report', ((e: CustomEvent) => {
  const id = e.detail.id as string;
  const rec = studio.getArchive(id);
  if (!rec) return;
  store.set({
    region: rec.region,
    surveyor: rec.surveyor,
    observedAt: rec.observedAt,
    archiveName: rec.name,
    activeArchiveId: id,
  });
  const versions = studio.listVersions(id);
  if (versions.length && !store.get().network) {
    store.set({ network: fromPayload(versions[0].payload) });
  }
  setView('report');
}) as EventListener);

window.addEventListener('db-export', () => {
  const data = JSON.stringify(studio.exportAll(), null, 1);
  downloadText(data, `潮沟档案库-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  store.toast('档案库已导出', 'ok');
});

window.addEventListener('db-import', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const db = JSON.parse(text);
      studio.importAll(db);
      store.toast('档案库已导入', 'ok');
      archiveEl.setAttribute('data-refresh', String(Date.now()));
    } catch (e) {
      store.toast(`导入失败: ${(e as Error).message}`, 'error');
    }
  };
  input.click();
});

/* ------------------------------------------------------------------ *
 * 航拍底图导入
 * ------------------------------------------------------------------ */

async function importBasemap(): Promise<void> {
  const s = store.get();
  if (!s.network) {
    store.toast('请先生成网络, 以便按网络范围配准底图', 'warn');
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const b = s.network!.bounds;
      // 默认铺满网络范围, 用户可在档案中调整
      const ref: BasemapRef = {
        name: file.name,
        src: '',
        world: { ...b },
        pixel: { width: bitmap.width, height: bitmap.height },
        opacity: 0.72,
        flightCode: file.name.replace(/\.[^.]+$/, ''),
      };
      // 缩略图 data URL 供档案展示
      const thumb = document.createElement('canvas');
      thumb.width = 96;
      thumb.height = Math.max(1, Math.round((bitmap.height / bitmap.width) * 96));
      thumb.getContext('2d')?.drawImage(bitmap, 0, 0, thumb.width, thumb.height);
      ref.src = thumb.toDataURL('image/jpeg', 0.7);
      store.set({ basemap: ref, basemapImage: bitmap, showBasemap: true });
      store.toast(`已导入底图 ${file.name} (${bitmap.width}×${bitmap.height})`, 'ok');
    } catch (e) {
      store.toast(`底图读取失败: ${(e as Error).message}`, 'error');
    }
  };
  input.click();
}

/* ------------------------------------------------------------------ *
 * 工具函数与快捷键
 * ------------------------------------------------------------------ */

function downloadText(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function updateLockSummary(): void {
  const el = document.getElementById('lock-summary');
  if (!el) return;
  const n = store.get().locks.length;
  el.textContent = n ? `锁定 ${n} 段` : '锁定 0 段';
  el.className = n ? 'chip warn' : 'chip';
}

store.subscribe((_s, patch) => {
  if ('locks' in patch) updateLockSummary();
  if ('view' in patch) applyView(_s.view);
});

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (target && /input|textarea|select/i.test(target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === 'g') doGenerate('manual');
  else if (k === 'f') mapEl.fit();
  else if (k === 'v') setView('workspace');
  else if (k === 'c') setView('compare');
  else if (k === 'a') setView('archive');
  else if (k === 'r') setView('report');
  else if (k === '1') store.set({ tool: 'pan' });
  else if (k === '2') store.set({ tool: 'inspect' });
  else if (k === '3') store.set({ tool: 'edit' });
  else if (k === '4') store.set({ tool: 'lock' });
  else if (k === 'escape') store.set({ selectedCreekId: null });
});

/* 首次生成 */
applyView(store.get().view);
updateLockSummary();
doGenerate('manual');

// 便于调试与端到端测试
declare global {
  interface Window {
    __creek: {
      store: typeof store;
      studio: Studio;
      generate: () => void;
      toPayload: typeof toPayload;
      refreshDerived: typeof refreshDerived;
      buildCreekCsv: typeof buildCreekCsv;
      buildCreekGeoJson: typeof buildCreekGeoJson;
      buildSurveyReport: typeof buildSurveyReport;
    };
    __captureLockFor: typeof captureLockFor;
    __mapRenderer: CreekRenderer | null;
  }
}
window.__creek = {
  store,
  studio,
  generate: () => doGenerate('manual'),
  toPayload,
  refreshDerived,
  buildCreekCsv,
  buildCreekGeoJson,
  buildSurveyReport,
};
window.__captureLockFor = captureLockFor;
window.__mapRenderer = null;
