import { createMemo, createSignal, For, Show } from 'solid-js';
import CanvasStage from '../components/CanvasStage';
import { submissions, addAnnotation, removeAnnotation, reviewSubmission, currentUser } from '../store/store';
import { loadPaths, docState } from '../store/docStore';
import type { AnnotationKind, Submission } from '../types';

export default function ReviewView() {
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const [kind, setKind] = createSignal<AnnotationKind>('reject');
  const [comment, setComment] = createSignal('');
  const [filter, setFilter] = createSignal<'all' | 'pending' | 'approved' | 'rejected'>('pending');

  const list = createMemo(() =>
    filter() === 'all' ? submissions() : submissions().filter(s => s.status === filter()));

  const active = createMemo<Submission | null>(
    () => submissions().find(s => s.id === activeId()) ?? null);

  function openSub(sub: Submission) {
    setActiveId(sub.id);
    loadPaths(sub.snapshot.paths, sub.snapshot.guides);
    docState.setBgOpacity(sub.snapshot.bgOpacity);
  }

  function handleDraw(cx: number, cy: number, r: number) {
    if (!active()) return;
    addAnnotation(active()!.id, {
      kind: kind(), comment: comment() || (kind() === 'reject' ? '此处脉序存疑' : '确认无误'),
      cx, cy, r,
    });
    setComment('');
  }

  function verdict(status: 'approved' | 'rejected') {
    if (!active()) return;
    if (status === 'rejected' && !active()!.annotations.some(a => a.kind === 'reject')) {
      alert('驳回前请先在图上圈注至少一处问题');
      return;
    }
    reviewSubmission(active()!.id, status, currentUser().name);
    alert(status === 'approved' ? '已通过,排版组可下载 SVG' : '已驳回,退回插画师修改');
  }

  return (
    <div class="view review-view">
      <aside class="review-list">
        <div class="panel-head"><h3>待审稿 ({submissions().filter(s => s.status === 'pending').length})</h3></div>
        <div class="filter-row">
          {(['pending', 'approved', 'rejected', 'all'] as const).map(f =>
            <button classList={{ active: filter() === f }} onClick={() => setFilter(f)}>
              {f === 'pending' ? '待审' : f === 'approved' ? '通过' : f === 'rejected' ? '驳回' : '全部'}
            </button>)}
        </div>
        <For each={list()} fallback={<p class="empty">没有{filter() === 'pending' ? '待审' : ''}稿件</p>}>
          {sub => (
            <div classList={{ 'sub-card': true, active: activeId() === sub.id, [sub.status]: true }}
              onClick={() => openSub(sub)}>
              <div class="sub-title">{sub.specimenCode} · {sub.species.split(' ')[0]}</div>
              <div class="muted">{sub.family}</div>
              <div class="sub-meta">
                插画师 {sub.illustrator} · {new Date(sub.submittedAt).toLocaleString()}
              </div>
              <span class={`status-badge ${sub.status}`}>
                {sub.status === 'pending' ? '待审' : sub.status === 'approved' ? '已通过' : '已驳回'}
              </span>
            </div>
          )}
        </For>
      </aside>

      <main class="review-main">
        <Show when={active()} fallback={<div class="placeholder">从左侧选择一份稿件开始审校</div>}>
          {sub => (
            <>
              <div class="review-toolbar">
                <label>圈注类型
                  <select value={kind()} onChange={e => setKind(e.currentTarget.value as AnnotationKind)}>
                    <option value="reject">驳回圈(红)</option>
                    <option value="approve">通过圈(绿)</option>
                  </select>
                </label>
                <input class="comment-input" placeholder="圈注意见(拖圈后附带)"
                  value={comment()} onInput={e => setComment(e.currentTarget.value)} />
                <button class="primary" onClick={() => verdict('approved')}>✓ 通过</button>
                <button class="danger" onClick={() => verdict('rejected')}>✕ 驳回</button>
              </div>
              <CanvasStage readOnly annotations={sub().annotations} onDrawAnnotation={handleDraw} />
              <div class="annotation-list">
                <h4>圈注记录 ({sub().annotations.length})</h4>
                <For each={sub().annotations} fallback={<span class="muted">暂无圈注。在画布上拖拽即可画圈。</span>}>
                  {ann => (
                    <div class={`ann-row ${ann.kind}`}>
                      <span class="ann-dot" />
                      <span>{ann.kind === 'reject' ? '驳回' : '通过'} · {ann.comment}</span>
                      <span class="muted">{ann.author} · {new Date(ann.createdAt).toLocaleTimeString()}</span>
                      <button onClick={() => removeAnnotation(sub().id, ann.id)}>删除</button>
                    </div>
                  )}
                </For>
              </div>
            </>
          )}
        </Show>
      </main>
    </div>
  );
}
