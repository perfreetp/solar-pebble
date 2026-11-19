import { createMemo, createSignal, For, Show } from 'solid-js';
import { materialStore } from '../materials/materialStore';
import { batchIsReleasable, summarizeIssues } from '../materials/checkRules';
import { BatchStatusTag, toast } from '../components/Toast';
import type { MaterialBatch } from '../types';

export function ReleaseView() {
  const [reason, setReason] = createSignal('');
  const active = createMemo(() => materialStore.activeBatch());

  const released = createMemo(() =>
    materialStore.batches().filter((b) => b.status === 'released'),
  );
  const returned = createMemo(() =>
    materialStore.batches().filter((b) => b.status === 'returned'),
  );

  function doRelease(b: MaterialBatch) {
    if (!batchIsReleasable(b.items)) {
      toast('放行闸门未通过:仍有未复核问题或未驳回的严重项', 'bad');
      return;
    }
    const ok = materialStore.releaseBatch(b.id);
    if (ok) toast(`批次 ${b.id.slice(-6)} 已整批放行,素材进入展馆资产库`, 'good');
  }

  function doReturn(b: MaterialBatch) {
    if (!reason().trim()) {
      toast('请填写退回原因,将随工单发送给供应方', 'warn');
      return;
    }
    materialStore.returnBatch(b.id, reason().trim());
    toast(`批次 ${b.id.slice(-6)} 已退回供应方:${reason().trim()}`, 'warn');
    setReason('');
  }

  return (
    <div class="two-col">
      <div class="col-scroll">
        <section class="panel" style={{ 'margin-bottom': '12px' }}>
          <div class="panel-h">
            放行闸门
            <span class="sub">达标判定</span>
          </div>
          <div class="panel-b muted" style={{ 'font-size': '12px' }}>
            整批满足以下全部条件才可放行:
            <ol style={{ 'padding-left': '18px', margin: '8px 0 0' }}>
              <li>每条问题都经过复核,无「待处理」项</li>
              <li>不存在被驳回的严重问题</li>
              <li>无素材条目处于驳回状态</li>
            </ol>
            含驳回项的批次整批退回供应方,随附退回工单。
          </div>
        </section>

        <div class="panel-h" style={{ padding: '4px 4px 8px' }}>已放行 ({released().length})</div>
        <For each={released()}>
          {(b) => (
            <div class="batch-card" onClick={() => materialStore.setActiveBatchId(b.id)}>
              <div class="top">
                <span class="supplier">{b.supplier}</span>
                <BatchStatusTag status={b.status} />
              </div>
              <div class="metrics">
                <span>{b.items.length} 个素材</span>
                <Show when={b.releasedAt}>
                  <span>{new Date(b.releasedAt!).toLocaleString('zh-CN')}</span>
                </Show>
              </div>
            </div>
          )}
        </For>

        <div class="panel-h" style={{ padding: '14px 4px 8px' }}>已退回 ({returned().length})</div>
        <For each={returned()}>
          {(b) => (
            <div class="batch-card" onClick={() => materialStore.setActiveBatchId(b.id)}>
              <div class="top">
                <span class="supplier">{b.supplier}</span>
                <BatchStatusTag status={b.status} />
              </div>
              <div class="muted" style={{ 'font-size': '12px', 'margin-top': '6px' }}>
                退回原因:{b.returnReason}
              </div>
            </div>
          )}
        </For>
      </div>

      <section class="panel" style={{ display: 'flex', 'flex-direction': 'column', 'min-height': 0 }}>
        <Show
          when={active()}
          fallback={<div class="empty">选择批次执行放行或退回</div>}
        >
          {(batch) => {
            const b = batch();
            const summary = summarizeIssues(b.items);
            const releasable = createMemo(() => batchIsReleasable(b.items));
            const hasRejected = createMemo(
              () =>
                b.items.some((i) => i.status === 'rejected') ||
                b.items.some((i) => i.issues.some((x) => x.status === 'rejected')),
            );
            return (
              <>
                <div class="panel-h">
                  <div>
                    批次 {b.id.slice(-8)} · {b.supplier}
                  </div>
                  <BatchStatusTag status={b.status} />
                </div>
                <div class="col-scroll panel-b">
                  <div class="stat-grid" style={{ 'margin-bottom': '14px' }}>
                    <div class="stat-card">
                      <b>{b.items.length}</b>
                      <span>素材条目</span>
                    </div>
                    <div class="stat-card">
                      <b class={summary.open > 0 ? 'status-pending' : 'status-approved'}>
                        {summary.open}
                      </b>
                      <span>待处理问题</span>
                    </div>
                    <div class="stat-card">
                      <b class="status-rejected">{summary.severe}</b>
                      <span>严重问题</span>
                    </div>
                    <div class="stat-card">
                      <b class="status-pending">{summary.notice}</b>
                      <span>提示问题</span>
                    </div>
                  </div>

                  <div
                    class="issue-card"
                    classList={{
                      severe: !releasable() && b.status !== 'released' && b.status !== 'returned',
                      notice: releasable(),
                    }}
                  >
                    <div class="head">
                      <span class={`tag ${releasable() ? 'ok' : 'severe'}`}>
                        {releasable() ? '闸门通过' : '闸门未通过'}
                      </span>
                    </div>
                    <div class="msg">
                      <Show
                        when={releasable()}
                        fallback={
                          <ul style={{ margin: 0, 'padding-left': '18px' }}>
                            <li>{summary.open} 条问题尚未复核</li>
                            <li>严重问题被驳回将直接阻断放行</li>
                            <li>驳回条目需整批退回供应方整改后重新提交</li>
                          </ul>
                        }
                      >
                        全部问题复核完毕且无驳回严重项,批次达到展馆放行标准。
                      </Show>
                    </div>
                  </div>

                  <Show when={b.status === 'pending_review' || b.status === 'checking'}>
                    <div class="toolbar-row" style={{ margin: '14px 0' }}>
                      <button class="primary" disabled={!releasable()} onClick={() => doRelease(b)}>
                        整批放行
                      </button>
                    </div>

                    <div class="field">
                      <label>退回工单原因(发给供应方)</label>
                      <textarea
                        rows={3}
                        placeholder="例如:第 2、5 项纹理命名不符合规范且层归属无法识别,请整改后重新提交"
                        value={reason()}
                        onInput={(e) => setReason(e.currentTarget.value)}
                      />
                    </div>
                    <button
                      class="danger"
                      style={{ width: '100%' }}
                      disabled={!hasRejected() && !reason()}
                      onClick={() => doReturn(b)}
                    >
                      整批退回供应方
                    </button>
                  </Show>

                  <Show when={b.status === 'released'}>
                    <div class="issue-card notice">
                      <div class="msg" style={{ margin: 0 }}>
                        该批次已于 {b.releasedAt && new Date(b.releasedAt).toLocaleString('zh-CN')}{' '}
                        放行,素材进入展馆资产库,可在体素建模中按层挂接使用。
                      </div>
                    </div>
                  </Show>
                  <Show when={b.status === 'returned'}>
                    <div class="issue-card severe">
                      <div class="msg" style={{ margin: 0 }}>
                        已退回供应方。工单原因:{b.returnReason}
                      </div>
                    </div>
                  </Show>
                </div>
              </>
            );
          }}
        </Show>
      </section>
    </div>
  );
}
