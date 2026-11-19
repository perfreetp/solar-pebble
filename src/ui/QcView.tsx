import { useState } from 'react';
import { useEditor } from '../editor/store';
import { statusLabel } from './App';
import type { Job } from '../editor/types';

export default function QcView({ onOpenEditor }: { onOpenEditor: () => void }) {
  const jobs = useEditor((s) => s.jobs);
  const workers = useEditor((s) => s.workers);
  const qcDecision = useEditor((s) => s.qcDecision);
  const openJob = useEditor((s) => s.openJob);
  const [note, setNote] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<Job | null>(null);

  const pending = jobs.filter((j) => j.status === 'submitted');
  const reviewed = jobs.filter((j) => j.qcHistory.length > 0);

  const decide = (job: Job, pass: boolean) => {
    const text = note[job.id]?.trim();
    if (!pass && !text) {
      alert('打回必须写明返工原因。');
      return;
    }
    qcDecision(job.id, pass, text || '质检通过，可交付。');
    setNote((n) => ({ ...n, [job.id]: '' }));
  };

  return (
    <div className="jobs-layout">
      <div>
        <h3 style={{ margin: '0 0 8px' }}>待质检抽查（{pending.length}）</h3>
        {!pending.length && <p className="muted">暂无待质检工单。</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          {pending.map((j) => {
            const hasConflict = !!j.doc?.items.some((i) => i.conflict);
            const assignee = workers.find((w) => w.id === j.assignee);
            return (
              <div key={j.id} className="kpi" style={{ borderColor: hasConflict ? '#ef9a9a' : 'var(--border)' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <b>{j.code} · {j.station}</b>
                  <span className={`tag ${j.status}`}>{statusLabel(j.status)}</span>
                </div>
                <div className="small muted" style={{ margin: '6px 0' }}>
                  客户：{j.customer} ｜ 绘制：{assignee?.name ?? '—'} ｜ 图元：{j.doc?.items.length ?? 0}
                </div>
                <div className="small" style={{ background: '#f7f8fa', padding: 8, borderRadius: 6 }}>
                  客户要求：{j.requirements}
                </div>
                {hasConflict && (
                  <div style={{ color: 'var(--danger)', fontWeight: 600, margin: '6px 0', fontSize: 12 }}>
                    ⚠ 画布仍存在管线压盖标识牌的版面冲突
                  </div>
                )}
                <textarea
                  placeholder="质检意见；打回时必填返工原因，如：排空管未按图例使用红色虚线、标识牌被管线压盖……"
                  value={note[j.id] ?? ''}
                  onChange={(e) => setNote((n) => ({ ...n, [j.id]: e.target.value }))}
                />
                <div className="row" style={{ marginTop: 8 }}>
                  <button
                    onClick={() => {
                      openJob(j.id);
                      onOpenEditor();
                    }}
                  >
                    打开画布核对
                  </button>
                  <button className="danger" style={{ flex: 1 }} onClick={() => decide(j, false)}>
                    打回返工
                  </button>
                  <button className="primary" style={{ flex: 1 }} onClick={() => decide(j, true)}>
                    抽查通过
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h3 style={{ margin: '0 0 8px' }}>质检历史</h3>
        <div className="scrollbox">
          <table>
            <thead>
              <tr>
                <th>工单</th>
                <th>站房</th>
                <th>当前状态</th>
                <th>打回次数</th>
                <th>最近质检</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reviewed.map((j) => {
                const last = j.qcHistory[j.qcHistory.length - 1];
                return (
                  <tr key={j.id} className="clickable" onClick={() => setDetail(j)}>
                    <td>{j.code}</td>
                    <td>{j.station}</td>
                    <td><span className={`tag ${j.status}`}>{statusLabel(j.status)}</span></td>
                    <td>{j.reworkCount}</td>
                    <td>
                      <span style={{ color: last.passed ? 'var(--ok)' : 'var(--danger)', fontWeight: 600 }}>
                        {last.passed ? '通过' : '打回'}
                      </span>
                      <span className="muted"> · {last.reviewer}</span>
                    </td>
                    <td>详情</td>
                  </tr>
                );
              })}
              {!reviewed.length && (
                <tr><td colSpan={6} className="muted">暂无记录</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detail && (
        <div className="modal-mask" onClick={() => setDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{detail.code} 质检记录</h2>
            <div className="col">
              {detail.qcHistory.map((h, i) => (
                <div key={i} className="kpi">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <b style={{ color: h.passed ? 'var(--ok)' : 'var(--danger)' }}>
                      {h.passed ? '✓ 抽查通过' : '✗ 打回返工'}
                    </b>
                    <span className="muted small">{new Date(h.at).toLocaleString('zh-CN')} · {h.reviewer}</span>
                  </div>
                  <div className="small" style={{ marginTop: 6 }}>{h.note}</div>
                </div>
              ))}
              <button onClick={() => setDetail(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
