import { createSignal } from 'solid-js';
import type { ViewId } from './types';
import { materialStore } from './materials/materialStore';
import { ModelingView } from './views/ModelingView';
import { BatchesView } from './views/BatchesView';
import { ReviewView } from './views/ReviewView';
import { ReleaseView } from './views/ReleaseView';
import { ToastStack } from './components/Toast';

const NAV: Array<{ id: ViewId; label: string }> = [
  { id: 'model', label: '体素建模' },
  { id: 'batches', label: '素材批次' },
  { id: 'review', label: '复核台' },
  { id: 'release', label: '放行中心' },
];

export default function App() {
  const [view, setView] = createSignal<ViewId>('model');

  return (
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <div class="logo" />
          <div>
            撞击坑科考展馆
            <small>体素建模 · 素材放行控制台</small>
          </div>
        </div>
        <nav class="nav">
          {NAV.map((n) => (
            <button
              class={view() === n.id ? 'active' : ''}
              onClick={() => setView(n.id)}
            >
              {n.label}
              {n.id === 'review' && materialStore.openIssueCount() > 0 && (
                <span class="badge">{materialStore.openIssueCount()}</span>
              )}
            </button>
          ))}
        </nav>
        <div class="env-tag">半米体素 · 本地演示环境</div>
      </header>

      <main class="view-root">
        {view() === 'model' && <ModelingView />}
        {view() === 'batches' && <BatchesView />}
        {view() === 'review' && <ReviewView />}
        {view() === 'release' && <ReleaseView />}
      </main>

      <ToastStack />
    </div>
  );
}
