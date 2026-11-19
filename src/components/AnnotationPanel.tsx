import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { appStore } from '../store';

const STATUS_TEXT = { open: '待处理', resolved: '已处理', rejected: '已驳回' } as const;
const STATUS_CLASS = { open: 'st-open', resolved: 'st-resolved', rejected: 'st-rejected' } as const;

/** 右侧批注面板：打点批注列表 + 制作方逐条回复（已处理/驳回） */
export function AnnotationPanel(): JSX.Element {
  const annotations = () => appStore.annotations();
  const [replyTo, setReplyTo] = createSignal<string | null>(null);
  const [replyText, setReplyText] = createSignal('');

  const counts = createMemo(() => {
    const c = { open: 0, resolved: 0, rejected: 0 };
    for (const a of annotations()) c[a.status]++;
    return c;
  });

  const submitReply = (annotationId: string, action: 'resolved' | 'rejected') => {
    const text = replyText().trim();
    if (!text) return;
    appStore.replyAnnotation(annotationId, action, text);
    setReplyTo(null);
    setReplyText('');
  };

  return (
    <div class="panel annotation-panel">
      <div class="panel-title">
        审片批注
        <span class="anno-counts">
          <span class="st-open">{counts().open} 待处理</span>
          <span class="st-resolved">{counts().resolved} 已处理</span>
          <span class="st-rejected">{counts().rejected} 驳回</span>
        </span>
      </div>
      <Show
        when={annotations().length > 0}
        fallback={<div class="empty-hint">暂无批注。开启「打点批注」后在图上点击即可挂批注。</div>}
      >
        <div class="anno-list">
          <For each={annotations()}>
            {(ann) => (
              <div
                class="anno-item"
                classList={{ active: appStore.state.activeAnnotationId === ann.id }}
                onClick={() => appStore.setActiveAnnotation(ann.id)}
              >
                <div class="anno-head">
                  <span class={`anno-status ${STATUS_CLASS[ann.status]}`}>
                    {STATUS_TEXT[ann.status]}
                  </span>
                  <span class="anno-author">{ann.author}</span>
                  <span class="anno-time">{ann.createdAt}</span>
                </div>
                <div class="anno-content">{ann.content}</div>
                <div class="anno-meta">
                  锚点 ({ann.x.toFixed(1)}, {ann.y.toFixed(1)})
                  {ann.featureId ? ` · 关联要素 ${ann.featureId}` : ' · 空白批注'}
                </div>
                <Show when={ann.replies.length > 0}>
                  <div class="reply-list">
                    <For each={ann.replies}>
                      {(rep) => (
                        <div class="reply-item">
                          <div class="reply-head">
                            <strong>{rep.author}</strong>
                            <span class={`anno-status ${rep.action === 'resolved' ? 'st-resolved' : 'st-rejected'}`}>
                              {rep.action === 'resolved' ? '已处理' : '驳回'}
                            </span>
                            <span class="anno-time">{rep.createdAt}</span>
                          </div>
                          <div class="reply-content">{rep.content}</div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={ann.status === 'open'}>
                  <Show
                    when={replyTo() === ann.id}
                    fallback={
                      <button class="btn-small" onClick={() => setReplyTo(ann.id)}>
                        制作方回复
                      </button>
                    }
                  >
                    <textarea
                      class="reply-input"
                      rows="2"
                      placeholder="填写处置说明…"
                      value={replyText()}
                      onInput={(e) => setReplyText(e.currentTarget.value)}
                    />
                    <div class="reply-actions">
                      <button
                        class="btn-small btn-ok"
                        disabled={!replyText().trim()}
                        onClick={() => submitReply(ann.id, 'resolved')}
                      >
                        标记已处理
                      </button>
                      <button
                        class="btn-small btn-danger"
                        disabled={!replyText().trim()}
                        onClick={() => submitReply(ann.id, 'rejected')}
                      >
                        驳回
                      </button>
                      <button class="btn-small" onClick={() => setReplyTo(null)}>
                        取消
                      </button>
                    </div>
                  </Show>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
