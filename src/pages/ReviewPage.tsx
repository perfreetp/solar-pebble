import { For, Show, createSignal, createResource, createMemo } from 'solid-js';
import type { VersionSummary } from '../../shared/types';
import { STATUS_LABEL } from '../../shared/types';
import { api } from '../lib/api';
import { MiniTopView } from '../components/MiniTopView';
import { VersionDetailModal, statusBadge } from './VersionsPage';
import { UserPill } from '../components/UserPill';

export default function ReviewPage(props: { me: any; users: any[]; onSwitchUser: (id: string) => void; onBack: () => void }) {
  const [list, { refetch }] = createResource(() => api.listVersions('submitted'));
  const [history, { refetch: refetchHistory }] = createResource(() => api.listVersions());
  const [openId, setOpenId] = createSignal<number | null>(null);
  const [filter, setFilter] = createSignal<'submitted' | 'all'>('submitted');

  const rows = createMemo(() => {
    const all = [...(history() ?? [])];
    if (filter() === 'submitted') return all.filter((v) => v.status === 'submitted');
    return all.filter((v) => v.status !== 'draft');
  });

  const pendingCount = () => (history() ?? []).filter((v) => v.status === 'submitted').length;

  return (
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark">◈</span>
          <div><div>主管评审中心</div><div class="brand-sub">{props.me.name} · 生产管理部</div></div>
        </div>
        <button class="ghost" onClick={props.onBack}>← 返回工作台</button>
        <div class="seg" style={{ 'margin-left': '8px' }}>
          <button class={filter() === 'submitted' ? 'on' : ''} onClick={() => setFilter('submitted')}>待评审 {pendingCount() ? <b style={{ color: 'var(--accent)' }}>({pendingCount()})</b> : ''}</button>
          <button class={filter() === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>全部已提交</button>
        </div>
        <div style={{ 'margin-left': 'auto' }}>
          <UserPill me={props.me} users={props.users} onSwitch={props.onSwitchUser} />
        </div>
      </header>
      <div class="page-scroll">
        <Show when={rows().length} fallback={
          <div class="empty-state">
            <div class="big">✓</div>
            没有待评审的方案。<br />
            <span style={{ 'font-size': '11px' }}>工艺员提交方案后会出现在这里。</span>
          </div>
        }>
          <div class="version-list">
            <For each={rows()}>
              {(v) => (
                <div class="version-card" onClick={() => setOpenId(v.id)}>
                  <div class="vc-thumb">
                    <Show when={v.thumb} fallback={<span style={{ color: '#aaa', 'font-size': '11px' }}>—</span>}>
                      <MiniTopView data={v.thumb!} w={114} h={84} />
                    </Show>
                  </div>
                  <div class="vc-main">
                    <div class="vc-title">
                      {v.name} {statusBadge(v.status)}
                      <Show when={v.interference > 0}>
                        <span class="badge badge-rejected">⚠ {v.interference} 处干涉</span>
                      </Show>
                      <Show when={v.interference === 0}>
                        <span class="badge badge-approved">无干涉</span>
                      </Show>
                    </div>
                    <div class="vc-meta">
                      <span>#{v.id}</span>
                      <span>提交 {v.submitted_at ? v.submitted_at.slice(0, 16).replace('T', ' ') : '—'}</span>
                      <span>{v.part_count} 件 · {v.weight.toFixed(1)} kg</span>
                      <span>工艺员 {v.created_by}</span>
                    </div>
                    <Show when={v.review_reason}>
                      <div class="warn-box" style={{ 'margin-top': '8px', padding: '6px 9px' }}>退回原因：{v.review_reason}</div>
                    </Show>
                  </div>
                  <div style={{ 'align-self': 'center' }}>
                    <button class={v.status === 'submitted' ? 'primary' : 'ghost'}>
                      {v.status === 'submitted' ? '评审' : '查看'}
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
      <Show when={openId()}>
        <VersionDetailModal
          id={openId()!}
          me={props.me}
          onClose={() => setOpenId(null)}
          onChanged={() => { refetch(); refetchHistory(); }}
          reviewMode
        />
      </Show>
    </div>
  );
}
