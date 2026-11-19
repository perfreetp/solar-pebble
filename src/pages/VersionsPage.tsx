import { For, Show, createSignal, createResource, createMemo } from 'solid-js';
import type { VersionDetail, VersionStatus, VersionSummary } from '../../shared/types';
import { STATUS_LABEL } from '../../shared/types';
import { api } from '../lib/api';
import { TopViewDrawing } from '../components/TopViewDrawing';
import { BomTable, InterferenceList, StatCards } from '../components/BomTable';
import { replaceScene, toast } from '../editor/store';
import { MiniTopView } from '../components/MiniTopView';
import { UserPill } from '../components/UserPill';

const TABS: { id: 'all' | VersionStatus; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'draft', label: '草稿' },
  { id: 'submitted', label: '待评审' },
  { id: 'approved', label: '已通过' },
  { id: 'rejected', label: '已退回' },
];

export function statusBadge(s: VersionStatus) {
  return <span class={`badge badge-${s}`}>{STATUS_LABEL[s]}</span>;
}

export default function VersionsPage(props: { me: any; users?: any[]; onSwitchUser?: (id: string) => void; onBack: () => void; initialId?: number | null }) {
  const [tab, setTab] = createSignal<'all' | VersionStatus>('all');
  const [list, { refetch }] = createResource(() => api.listVersions());
  const [openId, setOpenId] = createSignal<number | null>(props.initialId ?? null);
  const filtered = createMemo(() => (list() ?? []).filter((v) => tab() === 'all' || v.status === tab()));

  return (
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark" style={{ 'font-size': '13px' }}>▤</span>
          <div><div>版本历史</div><div class="brand-sub">方案版本 · 提交流转</div></div>
        </div>
        <button class="ghost" onClick={props.onBack}>← 返回工作台</button>
        <div class="seg" style={{ 'margin-left': '8px' }}>
          <For each={TABS}>{(t) => <button class={tab() === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>}</For>
        </div>
        <div style={{ 'margin-left': 'auto' }}>
          <Show when={props.users?.length}>
            <UserPill me={props.me} users={props.users!} onSwitch={props.onSwitchUser!} />
          </Show>
        </div>
      </header>
      <div class="page-scroll">
        <Show when={!list.loading} fallback={<div class="center-load"><div class="spinner" /></div>}>
          <Show when={filtered().length} fallback={<div class="empty-state"><div class="big">▤</div>暂无版本记录，回到工作台保存一个方案吧。</div>}>
            <div class="version-list">
              <For each={filtered()}>
                {(v) => (
                  <div class="version-card" onClick={() => setOpenId(v.id)}>
                    <div class="vc-thumb">
                      <Show when={v.thumb} fallback={<span style={{ color: '#aaa', 'font-size': '11px' }}>无缩略图</span>}>
                        <MiniTopView data={v.thumb!} w={114} h={84} />
                      </Show>
                    </div>
                    <div class="vc-main">
                      <div class="vc-title">{v.name} {statusBadge(v.status)}
                        <Show when={v.interference > 0}><span class="badge badge-rejected">{v.interference} 处干涉</span></Show>
                      </div>
                      <div class="vc-meta">
                        <span>#{v.id}</span>
                        <span>创建 {v.created_at.slice(0, 16).replace('T', ' ')}</span>
                        <span>{v.part_count} 件 · {v.weight.toFixed(1)} kg</span>
                        <Show when={v.reviewer}><span>评审人 {v.reviewer}</span></Show>
                      </div>
                      <Show when={v.review_reason}>
                        <div class="warn-box" style={{ 'margin-top': '8px', padding: '6px 9px' }}>退回原因：{v.review_reason}</div>
                      </Show>
                    </div>
                    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px', 'align-self': 'center' }}>
                      <button class="ghost" onClick={(e) => { e.stopPropagation(); setOpenId(v.id); }}>查看</button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
      <Show when={openId()}>
        <VersionDetailModal id={openId()!} me={props.me} onClose={() => setOpenId(null)} onChanged={() => refetch()} onRestore={(detail) => { replaceScene(detail.scene); props.onBack(); }} />
      </Show>
    </div>
  );
}

export function VersionDetailModal(props: {
  id: number;
  me: any;
  onClose: () => void;
  onChanged?: () => void;
  onRestore?: (d: VersionDetail) => void;
  reviewMode?: boolean;
}) {
  const [detail, { refetch }] = createResource(() => api.getVersion(props.id));
  const [reason, setReason] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);
  const [shareUrl, setShareUrl] = createSignal<string | null>(null);

  const isDesigner = () => props.me.role === 'designer';
  const isSupervisor = () => props.me.role === 'supervisor';
  const d = () => detail();

  async function doSubmit() {
    setBusy(true); setErr(null);
    try {
      await api.submitVersion(props.id);
      toast('已提交主管评审', 'ok');
      refetch(); props.onChanged?.();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function doReview(decision: 'approve' | 'reject') {
    if (decision === 'reject' && !reason().trim()) { setErr('退回必须填写原因'); return; }
    setBusy(true); setErr(null);
    try {
      await api.reviewVersion(props.id, decision, reason());
      toast(decision === 'approve' ? '已通过评审' : '已退回修改', decision === 'approve' ? 'ok' : 'warn');
      refetch(); props.onChanged?.();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function doShare() {
    try {
      const { token } = await api.share(props.id);
      setShareUrl(`${location.origin}/share/${token}`);
      refetch(); props.onChanged?.();
    } catch (e: any) { setErr(e.message); }
  }
  async function copyShare() {
    const u = shareUrl();
    if (!u) return;
    try { await navigator.clipboard.writeText(u); toast('只读链接已复制', 'ok'); } catch { toast('复制失败，请手动选择链接', 'warn'); }
  }

  return (
    <div class="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div class="modal wide" style={{ height: 'min(880px, 92vh)' }}>
        <div class="modal-head">
          <Show when={d()} fallback={<span>加载中…</span>}>
            <span>{d()!.name}</span>
            <span style={{ 'margin-left': '10px' }}>{statusBadge(d()!.status)}</span>
            <span class="x"><button class="icon" onClick={props.onClose}>✕</button></span>
          </Show>
        </div>
        <Show when={d()} fallback={<div class="center-load"><div class="spinner" /></div>}>
          <div class="modal-body" style={{ flex: 1, 'min-height': 0 }}>
            <div class="split-2">
              <div style={{ position: 'relative', background: '#e9e5db', 'border-radius': '6px', display: 'grid', 'place-items': 'center', padding: '14px', overflow: 'auto', 'min-height': '360px', 'max-height': '470px' }}>
                <Show when={d()!.thumb}>
                  <TopViewDrawing data={d()!.thumb!} bom={d()!.bom} fit={{ w: 400, h: 330 }} title="俯视布置图" showTitleBlock={false} />
                </Show>
              </div>
              <div style={{ display: 'flex', 'flex-direction': 'column', gap: '12px' }}>
                <StatCards stats={[
                  { k: '零件总数', v: String(d()!.bom.totalParts), unit: '件' },
                  { k: '总重', v: d()!.bom.totalWeight.toFixed(1), unit: 'kg' },
                  { k: '总体积', v: d()!.bom.totalVolume.toFixed(3), unit: 'm³' },
                  { k: '干涉', v: String(d()!.report.length), unit: '处', tone: d()!.report.length ? 'var(--red)' : 'var(--green)' },
                ]} />
                <div>
                  <div class="section-head" style={{ background: 'none', padding: '0 0 5px' }}>干涉报告</div>
                  <InterferenceList report={d()!.report} />
                </div>
                <div>
                  <div class="section-head" style={{ background: 'none', padding: '0 0 5px' }}>版本信息</div>
                  <dl class="kv">
                    <dt>版本号</dt><dd>#{d()!.id}</dd>
                    <dt>创建</dt><dd>{d()!.created_at.slice(0, 16).replace('T', ' ')}</dd>
                    <Show when={d()!.submitted_at}><dt>提交</dt><dd>{d()!.submitted_at!.slice(0, 16).replace('T', ' ')}</dd></Show>
                    <Show when={d()!.reviewer}><dt>评审人</dt><dd>{d()!.reviewer}</dd></Show>
                    <Show when={d()!.note}><dt>说明</dt><dd>{d()!.note}</dd></Show>
                  </dl>
                </div>
                <Show when={d()!.review_reason}>
                  <div class="warn-box">退回原因：{d()!.review_reason}</div>
                </Show>
              </div>
            </div>
            <div>
              <div class="section-head" style={{ background: 'none', padding: '0 0 5px' }}>物料清单</div>
              <BomTable bom={d()!.bom} />
            </div>
            <Show when={err()}><div class="warn-box">{err()}</div></Show>
            <Show when={shareUrl()}>
              <div class="ok-box">
                客户只读链接已生成：
                <div class="share-link-box" style={{ 'margin-top': '6px' }}>
                  <input readonly value={shareUrl()!} onFocus={(e) => e.currentTarget.select()} />
                  <button onClick={copyShare}>复制</button>
                </div>
              </div>
            </Show>
          </div>
          <div class="modal-foot" style={{ 'justify-content': 'space-between' }}>
            <div style={{ display: 'flex', gap: '7px' }}>
              <Show when={isSupervisor() && d()!.status === 'approved'}>
                <Show when={!shareUrl()} fallback={<button class="ghost" onClick={copyShare}>复制链接</button>}>
                  <button onClick={doShare}>生成客户只读链接</button>
                </Show>
              </Show>
              <Show when={isDesigner() && (d()!.status === 'draft' || d()!.status === 'rejected')}>
                <button onClick={() => props.onRestore?.(d()!)}>载入编辑</button>
              </Show>
            </div>
            <div style={{ display: 'flex', gap: '7px' }}>
              <Show when={isDesigner() && (d()!.status === 'draft' || d()!.status === 'rejected')}>
                <button class="primary" onClick={doSubmit} disabled={busy()}>提交评审</button>
              </Show>
              <Show when={isSupervisor() && d()!.status === 'submitted'}>
                <input placeholder="退回原因（必填）" value={reason()} onInput={(e) => setReason(e.currentTarget.value)} style={{ width: '200px' }} />
                <button class="danger" onClick={() => doReview('reject')} disabled={busy()}>退回</button>
                <button class="primary" onClick={() => doReview('approve')} disabled={busy()}>通过</button>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
