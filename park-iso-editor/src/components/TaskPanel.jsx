import { createMemo, createSignal, For, Show } from 'solid-js';
import { state, setState, actions } from '../store';
import { TYPES, TYPE_KEYS } from '../model';
import { computeCoverage } from '../geometry';

export default function TaskPanel(props) {
  const [placingType, setPlacingType] = createSignal('station');
  const [lastResult, setLastResult] = createSignal(null);

  const liveCoverage = createMemo(() => computeCoverage(state.objects, state.task.points));

  function startPlacing() {
    if (state.taskPlacing) setState('taskPlacing', null);
    else setState('taskPlacing', placingType());
  }

  function submit() {
    if (!state.task.points.length) { alert('老师还没有布置点位任务'); return; }
    const sub = actions.submitAssignment();
    setLastResult(sub);
  }

  const mySubs = createMemo(() =>
    state.submissions.filter((s) => s.student === (state.studentName.trim() || '未命名学员'))
  );

  return (
    <div class="panel">
      <h3>点位任务</h3>
      <Show when={state.role === 'teacher'}>
        <div class="field-row">
          <label>任务名称</label>
          <input type="text" value={state.task.title}
            onInput={(e) => setState('task', 'title', e.currentTarget.value)} />
        </div>
        <div class="field-row">
          <label>点位类型</label>
          <select value={placingType()} onChange={(e) => setPlacingType(e.currentTarget.value)}>
            <For each={TYPE_KEYS}>{(k) => <option value={k}>{TYPES[k].name}</option>}</For>
          </select>
        </div>
        <div class="btn-row">
          <button class="primary" classList={{ danger: !!state.taskPlacing }} onClick={startPlacing}>
            {state.taskPlacing ? '取消放置' : '在画布上加点'}
          </button>
          <button onClick={() => actions.clearTaskPoints()} disabled={!state.task.points.length}>清空点位</button>
        </div>
      </Show>

      <Show when={state.task.points.length === 0}>
        <p class="muted">{state.role === 'teacher' ? '选择点位类型后点击「在画布上加点」,再点击场地放置任务点位。' : '等待老师布置点位任务。'}</p>
      </Show>

      <ul class="task-list">
        <For each={state.task.points}>
          {(p) => (
            <li classList={{ covered: liveCoverage().covered.includes(p.id) }}>
              <div class="task-head">
                <b>{p.label}</b>
                <span class="tag">{TYPES[p.type].name}</span>
                <Show when={state.role !== 'teacher'}>
                  <span class="cov">{liveCoverage().covered.includes(p.id) ? '✓ 已覆盖' : '✗ 未覆盖'}</span>
                </Show>
                <Show when={state.role === 'teacher'}>
                  <button class="link" onClick={() => actions.removeTaskPoint(p.id)}>删除</button>
                </Show>
              </div>
              <Show when={state.role === 'teacher'}>
                <div class="task-edit">
                  <label>名称</label>
                  <input type="text" value={p.label}
                    onInput={(e) => actions.updateTaskPoint(p.id, { label: e.currentTarget.value })} />
                  <label>半径</label>
                  <input type="number" min="0.5" step="0.5" value={p.radius}
                    onInput={(e) => actions.updateTaskPoint(p.id, { radius: Math.max(0.5, +e.currentTarget.value || 0.5) })} />
                  <label>X</label>
                  <input type="number" step="0.5" value={p.x}
                    onInput={(e) => actions.updateTaskPoint(p.id, { x: +e.currentTarget.value || 0 })} />
                  <label>Y</label>
                  <input type="number" step="0.5" value={p.y}
                    onInput={(e) => actions.updateTaskPoint(p.id, { y: +e.currentTarget.value || 0 })} />
                </div>
              </Show>
            </li>
          )}
        </For>
      </ul>

      <Show when={state.role === 'student'}>
        <div class="coverage-bar">
          <div class="coverage-fill" style={{ width: `${liveCoverage().score}%` }} />
          <span>实时覆盖率 {liveCoverage().score}%({liveCoverage().covered.length}/{liveCoverage().total})</span>
        </div>
        <button class="primary block" onClick={submit} disabled={!!state.review}>提交作业</button>

        <Show when={lastResult()}>
          {(r) => (
            <div class="result-box">
              <b>自动评分:{r().autoScore} 分</b>
              <Show when={r().missedLabels.length}>
                <p>未覆盖点位:{r().missedLabels.join('、')}</p>
              </Show>
              <Show when={!r().missedLabels.length}><p>全部点位已覆盖 🎉</p></Show>
            </div>
          )}
        </Show>

        <Show when={mySubs().length}>
          <h4>我的提交记录</h4>
          <ul class="mini-list">
            <For each={mySubs()}>
              {(s) => (
                <li>
                  {s.time} · 自动 {s.autoScore} 分
                  {s.reviewed ? ` · 老师复核 ${s.finalScore} 分${s.comment ? ':「' + s.comment + '」' : ''}` : ' · 待复核'}
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>

      <Show when={state.role === 'teacher'}>
        <p class="muted">学员提交后,到右侧「成绩」页复核打分。</p>
        <button class="link" onClick={() => props.onShowScores?.()}>前往成绩复核 →</button>
      </Show>
    </div>
  );
}
