import { createSignal, onMount, onCleanup, Show, For } from 'solid-js';
import { state, setState, actions } from './store';
import Canvas from './components/Canvas';
import Palette from './components/Palette';
import ParamPanel from './components/ParamPanel';
import TaskPanel from './components/TaskPanel';
import ScorePanel from './components/ScorePanel';
import BomPanel from './components/BomPanel';

const CAMERAS = [
  { label: '轴测·东北', angle: 0 },
  { label: '轴测·东南', angle: 1 },
  { label: '轴测·西南', angle: 2 },
  { label: '轴测·西北', angle: 3 },
];

export default function App() {
  const [tab, setTab] = createSignal('param');

  function onKey(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    if (state.review) return;
    if (e.key === 'Delete' || e.key === 'Backspace') actions.deleteSelected();
    else if (e.key === 'r' || e.key === 'R') actions.rotateSelected();
    else if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault(); actions.duplicateSelected(); }
    else if (e.key === 'Escape') actions.setSelection([]);
  }
  onMount(() => window.addEventListener('keydown', onKey));
  onCleanup(() => window.removeEventListener('keydown', onKey));

  return (
    <div class="app">
      <header class="topbar">
        <div class="brand">园区监测微站与巡检路线轴测布置编辑器</div>

        <div class="group">
          <span class="group-label">镜头</span>
          <For each={CAMERAS}>
            {(c) => (
              <button
                classList={{ active: !state.camera.top && state.camera.angle === c.angle }}
                onClick={() => actions.setCamera(c.angle, false)}
              >{c.label}</button>
            )}
          </For>
          <button
            classList={{ active: state.camera.top }}
            onClick={() => actions.setCamera(state.camera.angle, true)}
          >俯视图</button>
        </div>

        <div class="group">
          <span class="group-label">编辑</span>
          <button onClick={() => actions.rotateSelected()} disabled={!state.selected.length || !!state.review} title="快捷键 R">旋转90°</button>
          <button onClick={() => actions.duplicateSelected()} disabled={!state.selected.length || !!state.review} title="快捷键 Ctrl+D">批量复制</button>
          <button onClick={() => actions.deleteSelected()} disabled={!state.selected.length || !!state.review} title="快捷键 Delete">删除</button>
        </div>

        <div class="spacer" />

        <Show when={state.review}>
          <div class="review-banner">
            正在复核 <b>{state.review.student}</b> 的作业
            <button onClick={() => actions.exitReview()}>退出复核</button>
          </div>
        </Show>

        <div class="group">
          <span class="group-label">角色</span>
          <button classList={{ active: state.role === 'teacher' }} onClick={() => actions.setRole('teacher')}>老师</button>
          <button classList={{ active: state.role === 'student' }} onClick={() => actions.setRole('student')}>学员</button>
          <Show when={state.role === 'student'}>
            <input
              class="name-input"
              placeholder="学员姓名"
              value={state.studentName}
              onInput={(e) => setState('studentName', e.currentTarget.value)}
            />
          </Show>
        </div>
      </header>

      <div class="main">
        <aside class="side left">
          <Palette />
          <TaskPanel onShowScores={() => setTab('score')} />
        </aside>

        <main class="center">
          <Canvas />
        </main>

        <aside class="side right">
          <div class="tabs">
            <button classList={{ active: tab() === 'param' }} onClick={() => setTab('param')}>参数</button>
            <button classList={{ active: tab() === 'bom' }} onClick={() => setTab('bom')}>物料清单</button>
            <button classList={{ active: tab() === 'score' }} onClick={() => setTab('score')}>成绩</button>
          </div>
          <Show when={tab() === 'param'}><ParamPanel /></Show>
          <Show when={tab() === 'bom'}><BomPanel /></Show>
          <Show when={tab() === 'score'}><ScorePanel /></Show>
        </aside>
      </div>

      <footer class="statusbar">
        <span>左键拖动平移 · 滚轮缩放 · 点击拾取物体 · 拖动手柄沿轴移动 · Shift+点击多选 · R 旋转 · Ctrl+D 复制 · Delete 删除</span>
        <span>场地 {state.site.w}×{state.site.d} m · 高程 {state.site.elevation} m · 物体 {state.objects.length} 个 · 点位 {state.task.points.length} 个</span>
      </footer>
    </div>
  );
}
