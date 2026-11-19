import { createMemo, For, Show } from 'solid-js';
import { state, actions } from '../store';
import { downloadCSV } from '../geometry';

export default function ScorePanel() {
  const subs = createMemo(() => [...state.submissions].reverse());

  // 错题汇总:按点位统计未覆盖次数
  const missSummary = createMemo(() => {
    const map = new Map();
    for (const s of state.submissions) {
      for (const label of s.missedLabels) map.set(label, (map.get(label) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  });

  // 学员成绩汇总(取最新一次)
  const studentSummary = createMemo(() => {
    const map = new Map();
    for (const s of state.submissions) map.set(s.student, s);
    return [...map.values()];
  });

  function exportGrades() {
    const rows = [['学员', '提交时间', '自动评分', '复核得分', '覆盖', '未覆盖点位', '评语']];
    for (const s of state.submissions) {
      rows.push([s.student, s.time, s.autoScore, s.finalScore ?? '', `${s.coveredCount}/${s.total}`, s.missedLabels.join('、'), s.comment]);
    }
    downloadCSV('成绩汇总.csv', rows);
  }

  return (
    <div class="panel">
      <h3>成绩与复核</h3>

      <Show when={state.role !== 'teacher'}>
        <p class="muted">学员视角:此处只读展示自己的成绩,请到左侧「点位任务」提交作业。</p>
        <ul class="mini-list">
          <For each={state.submissions.filter((s) => s.student === (state.studentName.trim() || '未命名学员'))}>
            {(s) => <li>{s.time} · 自动 {s.autoScore} 分{s.reviewed ? ` · 复核 ${s.finalScore} 分` : ' · 待复核'}</li>}
          </For>
        </ul>
      </Show>

      <Show when={state.role === 'teacher'}>
        <Show when={!subs().length}><p class="muted">还没有学员提交作业。</p></Show>

        <For each={subs()}>
          {(s) => (
            <div class="sub-card" classList={{ reviewed: s.reviewed }}>
              <div class="sub-head">
                <b>{s.student}</b>
                <span class="muted">{s.time}</span>
              </div>
              <div class="sub-body">
                <span>自动评分 <b>{s.autoScore}</b></span>
                <span>覆盖 {s.coveredCount}/{s.total}</span>
                <Show when={s.missedLabels.length}>
                  <span class="miss">未覆盖:{s.missedLabels.join('、')}</span>
                </Show>
              </div>
              <div class="sub-actions">
                <button onClick={() => actions.enterReview(s)}>查看布置</button>
                <input
                  type="number" min="0" max="100" placeholder="复核分"
                  value={s.finalScore ?? s.autoScore}
                  onInput={(e) => actions.reviewSubmission(s.id, { finalScore: Math.max(0, Math.min(100, +e.currentTarget.value || 0)) })}
                />
                <input
                  type="text" placeholder="评语"
                  value={s.comment}
                  onInput={(e) => actions.reviewSubmission(s.id, { comment: e.currentTarget.value })}
                />
                <button class="primary" onClick={() => actions.reviewSubmission(s.id, {
                  reviewed: true,
                  finalScore: s.finalScore ?? s.autoScore,
                })}>确认复核</button>
                <button class="link" onClick={() => actions.removeSubmission(s.id)}>删除</button>
              </div>
            </div>
          )}
        </For>

        <Show when={state.submissions.length}>
          <h4>成绩汇总(最新一次)</h4>
          <table class="table">
            <thead><tr><th>学员</th><th>自动</th><th>复核</th></tr></thead>
            <tbody>
              <For each={studentSummary()}>
                {(s) => (
                  <tr>
                    <td>{s.student}</td>
                    <td>{s.autoScore}</td>
                    <td>{s.reviewed ? s.finalScore : '待复核'}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>

          <h4>错题汇总(未覆盖点位排行)</h4>
          <Show when={!missSummary().length}><p class="muted">暂无错题。</p></Show>
          <table class="table">
            <thead><tr><th>点位</th><th>未覆盖次数</th></tr></thead>
            <tbody>
              <For each={missSummary()}>
                {([label, count]) => <tr><td>{label}</td><td>{count}</td></tr>}
              </For>
            </tbody>
          </table>

          <button class="primary block" onClick={exportGrades}>导出成绩 CSV</button>
        </Show>
      </Show>
    </div>
  );
}
