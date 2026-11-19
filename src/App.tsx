import { createEffect, createMemo, createSignal, Show, type JSX } from 'solid-js';
import { appStore } from './store';
import { MapCanvas } from './components/MapCanvas';
import { LayerPanel } from './components/LayerPanel';
import { PropertyCard } from './components/PropertyCard';
import { AnnotationPanel } from './components/AnnotationPanel';
import { VersionBar } from './components/VersionBar';
import { CompareView } from './components/CompareView';
import type { CameraState } from './types';

export function App(): JSX.Element {
  const [cam, setCam] = createSignal<CameraState | undefined>(undefined);
  const [stats, setStats] = createSignal({ tiles: 0, cells: 0, features: 0, offscreen: true });
  const [draft, setDraft] = createSignal<{ x: number; y: number } | null>(null);
  const [draftText, setDraftText] = createSignal('');
  const [rightTab, setRightTab] = createSignal<'prop' | 'anno'>('anno');

  const features = createMemo(() => appStore.activeFeatures());
  const layerStates = createMemo(() => appStore.state.layerStates);
  const versionKey = createMemo(() => appStore.state.activeVersionId);
  const diffById = createMemo(() =>
    appStore.state.compareMode ? appStore.currentDiffMap() : null,
  );

  const confirmDraft = () => {
    const d = draft();
    const text = draftText().trim();
    if (d && text) {
      // 若当前悬停/选中了要素，批注自动关联该要素
      const featureId = appStore.state.hoveredId ?? appStore.state.selectedIds[0] ?? null;
      appStore.addAnnotation(featureId, d.x, d.y, text);
      setRightTab('anno');
    }
    setDraft(null);
    setDraftText('');
  };

  const featureCount = () => features().length;

  // 选中要素后自动切到属性卡标签，确保用户立刻看到结果
  createEffect(() => {
    if (appStore.state.selectedIds.length > 0) setRightTab('prop');
  });

  return (
    <div class="app-shell">
      <VersionBar />
      <Show
        when={!appStore.state.compareMode}
        fallback={
          <div class="main-area compare-main">
            <CompareView />
          </div>
        }
      >
        <div class="main-area">
          <aside class="sidebar sidebar-left">
            <LayerPanel />
          </aside>

          <main class="canvas-wrap">
            <div class="canvas-toolbar">
              <button
                class="btn-small"
                classList={{ 'btn-primary': appStore.state.annotationMode }}
                onClick={() => appStore.setAnnotationMode(!appStore.state.annotationMode)}
                title="开启后在图上点击即可打点挂批注"
              >
                {appStore.state.annotationMode ? '⏹ 退出批注打点' : '✎ 打点批注'}
              </button>
              <span class="toolbar-hint">
                滚轮缩放 · 拖拽平移 · Shift 拖拽框选多选 · Ctrl/⌘ 点击加选
              </span>
              <Show when={appStore.state.annotationMode}>
                <span class="anno-banner">批注模式：点击图上位置放置批注锚点</span>
              </Show>
            </div>
            <div class="canvas-host">
              <MapCanvas
                versionId={() => appStore.state.activeVersionId}
                features={features}
                layerStates={layerStates}
                versionKey={versionKey}
                diffById={diffById}
                cameraSignal={() => undefined}
                onCamera={(c) => setCam(c)}
                onStats={setStats}
                annotationMode={() => appStore.state.annotationMode}
                onDraftAnnotation={(w) => {
                  setDraft(w);
                  setDraftText('');
                }}
              />
              <div class="lod-badge">
                LOD {cam()?.lod ?? 0} · {(cam()?.scale ?? 1).toFixed(3)} 像素/米 · {featureCount().toLocaleString()} 要素
              </div>
            </div>

            <Show when={draft()}>
              <div class="modal-mask" onClick={() => setDraft(null)}>
                <div class="modal" onClick={(e) => e.stopPropagation()}>
                  <div class="modal-title">
                    新建批注（{draft()!.x.toFixed(1)}m, {draft()!.y.toFixed(1)}m）
                  </div>
                  <textarea
                    class="form-input"
                    rows="4"
                    placeholder="填写审片意见，例如：该避雷塔距加注区安全距离不足…"
                    value={draftText()}
                    onInput={(e) => setDraftText(e.currentTarget.value)}
                    autofocus
                  />
                  <div class="popover-actions">
                    <button class="btn-small btn-primary" disabled={!draftText().trim()} onClick={confirmDraft}>
                      提交批注
                    </button>
                    <button class="btn-small" onClick={() => setDraft(null)}>
                      取消
                    </button>
                  </div>
                </div>
              </div>
            </Show>
          </main>

          <aside class="sidebar sidebar-right">
            <div class="tab-row">
              <button
                class="tab-btn"
                classList={{ active: rightTab() === 'prop' }}
                onClick={() => setRightTab('prop')}
              >
                属性卡{appStore.state.selectedIds.length ? ` (${appStore.state.selectedIds.length})` : ''}
              </button>
              <button
                class="tab-btn"
                classList={{ active: rightTab() === 'anno' }}
                onClick={() => setRightTab('anno')}
              >
                批注({appStore.annotations().length})
              </button>
            </div>
            <Show when={rightTab() === 'prop'}>
              <PropertyCard />
              <Show when={appStore.state.selectedIds.length === 0}>
                <div class="empty-hint">点击图上要素查看属性，支持框选 / Ctrl 加选多选。</div>
              </Show>
            </Show>
            <Show when={rightTab() === 'anno'}>
              <AnnotationPanel />
            </Show>
          </aside>
        </div>
      </Show>

      <footer class="status-bar">
        <span>瓦片缓存 {stats().tiles} 张</span>
        <span>空间索引网格 {stats().cells} 格</span>
        <span>已索引要素 {stats().features.toLocaleString()}</span>
        <span>渲染后端：{stats().offscreen ? 'OffscreenCanvas 离屏' : 'Canvas 兜底'}</span>
        <span class="spacer" />
        <span>当前版本：{appStore.activeVersion().label}</span>
        <span>相机 scale={cam()?.scale.toFixed(3) ?? '—'}</span>
      </footer>
    </div>
  );
}
