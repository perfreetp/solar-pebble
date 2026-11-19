import { createMemo, For, Show } from 'solid-js';
import { materialStore } from '../materials/materialStore';
import { summarizeIssues } from '../materials/checkRules';
import {
  BatchStatusTag,
  IssueStatusTag,
  ItemStatusTag,
  toast,
} from '../components/Toast';
import type { MaterialBatch } from '../types';

export function ReviewView() {
  const reviewable = createMemo(() =>
    materialStore
      .batches()
      .filter((b) => b.status === 'pending_review' || b.status === 'checking'),
  );

  const active = createMemo(() => materialStore.activeBatch());

  return (
    <div class="two-col">
      <div class="col-scroll">
        <section class="panel" style={{ 'margin-bottom': '12px' }}>
          <div class="panel-h">
            待复核批次
            <span class="sub">{reviewable().length} 批</span>
          </div>
        </section>
        <Show
          when={reviewable().length > 0}
          fallback={<div class="empty panel" style={{ padding: '30px' }}>没有待复核批次</div>}
        >
          <For each={reviewable()}>
            {(b) => {
              const s = summarizeIssues(b.items);
              return (
                <div
                  class="batch-card"
                  classList={{ selected: materialStore.activeBatchId() === b.id }}
                  onClick={() => materialStore.setActiveBatchId(b.id)}
                >
                  <div class="top">
                    <span class="supplier">{b.supplier}</span>
                    <BatchStatusTag status={b.status} />
                  </div>
                  <div class="metrics">
                    <span class="status-rejected">严重 {s.severe}</span>
                    <span class="status-pending">提示 {s.notice}</span>
                    <span>待处理 {s.open}</span>
                  </div>
                </div>
              );
            }}
          </For>
        </Show>
      </div>

      <section class="panel" style={{ display: 'flex', 'flex-direction': 'column', 'min-height': 0 }}>
        <Show
          when={active()}
          fallback={<div class="empty">选择左侧批次开始逐条复核</div>}
        >
          {(batch) => <ReviewBoard batch={batch()} />}
        </Show>
      </section>
    </div>
  );
}

function ReviewBoard(props: { batch: MaterialBatch }) {
  // 始终通过 props.batch 取值,批次对象被 store 整体替换后才能拿到新引用
  const b = () => props.batch;
  const summary = createMemo(() => summarizeIssues(b().items));
  const progress = createMemo(() => {
    const total = b().items.reduce((n, i) => n + i.issues.length, 0);
    const decided = b().items.reduce(
      (n, i) => n + i.issues.filter((x) => x.status !== 'open').length,
      0,
    );
    return total === 0 ? 100 : Math.round((decided / total) * 100);
  });

  function review(itemId: string, issueId: string, accept: boolean) {
    materialStore.reviewIssue(b().id, itemId, issueId, accept);
    toast(accept ? '问题已确认并记录复核人' : '问题已驳回,将随批次退回供应方', accept ? 'good' : 'warn');
  }

  return (
    <>
      <div class="panel-h">
        <div>
          逐条复核 · {b().supplier}
          <span class="sub" style={{ 'margin-left': '10px' }}>
            复核进度 {progress()}%
          </span>
        </div>
        <BatchStatusTag status={b().status} />
      </div>
      <div style={{ padding: '10px 16px', 'border-bottom': '1px solid var(--border)' }}>
        <div
          style={{
            height: '6px',
            'border-radius': '3px',
            background: 'var(--bg-inset)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progress()}%`,
              background: 'var(--accent)',
              transition: 'width .25s',
            }}
          />
        </div>
        <div class="toolbar-row" style={{ margin: '10px 0 0' }}>
          <span class="muted" style={{ 'font-size': '12px' }}>
            严重问题 {summary().severe} 条 · 提示问题 {summary().notice} 条 · 剩余待处理 {summary().open} 条
          </span>
        </div>
      </div>

      <div class="col-scroll panel-b">
        <Show when={b().status === 'checking'}>
          <div class="empty">自动检查尚未完成,问题清单生成后即可复核…</div>
        </Show>
        <For each={b().items}>
          {(item) => (
            <div class="item-block">
              <div class="head">
                <span class="fname mono">{item.name}</span>
                <span class="tag gray">.{item.ext}</span>
                <ItemStatusTag status={item.status} />
                <span class="spacer" />
                <Show when={item.issues.some((i) => i.status === 'open')}>
                  <button
                    class="tiny"
                    onClick={() => {
                      materialStore.reviewAllOpen(b().id, item.id, true);
                      toast(`已确认「${item.name}」全部待处理问题`, 'good');
                    }}
                  >
                    全部确认
                  </button>
                  <button
                    class="tiny danger"
                    onClick={() => {
                      materialStore.reviewAllOpen(b().id, item.id, false);
                      toast(`已驳回「${item.name}」的问题`, 'warn');
                    }}
                  >
                    全部驳回
                  </button>
                </Show>
              </div>
              <div class="body">
                <Show
                  when={item.issues.length > 0}
                  fallback={<div class="tag ok">自动检查通过,无问题</div>}
                >
                  <For each={item.issues}>
                    {(iss) => (
                      <div class={`issue-card ${iss.level}`}>
                        <div class="head">
                          <span class={`tag ${iss.level}`}>
                            {iss.level === 'severe' ? '严重' : '提示'}
                          </span>
                          <span class="rule">{iss.rule}</span>
                          <IssueStatusTag status={iss.status} />
                          <Show when={iss.reviewer}>
                            <span class="muted" style={{ 'font-size': '12px' }}>
                              {iss.reviewer}
                            </span>
                          </Show>
                        </div>
                        <div class="msg">{iss.message}</div>
                        <div class="actions">
                          <Show
                            when={iss.status === 'open'}
                            fallback={
                              <span class="muted" style={{ 'font-size': '12px' }}>
                                该问题已完成复核
                              </span>
                            }
                          >
                            <button class="tiny primary" onClick={() => review(item.id, iss.id, true)}>
                              确认(问题成立/可接受)
                            </button>
                            <button class="tiny danger" onClick={() => review(item.id, iss.id, false)}>
                              驳回(退回供应方)
                            </button>
                          </Show>
                        </div>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>
    </>
  );
}
