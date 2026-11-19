import { useMemo, useState } from 'react';
import { useEditor } from '../editor/store';
import { statusLabel } from './App';
import type { Job, JobStatus } from '../editor/types';

const COLUMNS: { key: JobStatus; title: string }[] = [
  { key: 'intake', title: '待派工' },
  { key: 'assigned', title: '已派工' },
  { key: 'in_progress', title: '绘制中' },
  { key: 'submitted', title: '待质检' },
  { key: 'returned', title: '返工中' },
  { key: 'approved', title: '已完成' },
];

export default function JobsBoard({ onOpenEditor }: { onOpenEditor: () => void }) {
  const jobs = useEditor((s) => s.jobs);
  const workers = useEditor((s) => s.workers);
  const assignJob = useEditor((s) => s.assignJob);
  const openJob = useEditor((s) => s.openJob);
  const newBlankDoc = useEditor((s) => s.newBlankDoc);
  const currentJobId = useEditor((s) => s.currentJobId);
  const [assignFor, setAssignFor] = useState<string | null>(null);

  const stats = useMemo(() => buildStats(jobs, workers), [jobs, workers]);
  const designers = workers.filter((w) => w.role === 'designer');

  return (
    <div className="jobs-layout">
      <div className="grid4">
        <Kpi num={jobs.length} label="工单总数" />
        <Kpi num={jobs.filter((j) => j.status === 'approved').length} label="已完成" />
        <Kpi num={jobs.filter((j) => j.status === 'submitted').length} label="待质检" />
        <Kpi
          num={`${jobs.length ? Math.round((jobs.reduce((a, j) => a + j.reworkCount, 0) / Math.max(1, jobs.filter((j) => j.status !== 'intake').length)) * 100) : 0}%`}
          label="平均返工率（打回次数/已派工单数）"
        />
      </div>

      <div className="grid4" style={{ alignItems: 'start' }}>
        <div className="kpi" style={{ gridColumn: 'span 1' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--muted)' }}>师傅完成量 / 返工率</h3>
          <table>
            <thead>
              <tr>
                <th>师傅</th>
                <th>完成</th>
                <th>在制</th>
                <th>打回</th>
                <th>返工率</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.done}</td>
                  <td>{r.wip}</td>
                  <td>{r.reworks}</td>
                  <td>
                    <div className="swatch-row">
                      <div className="bar" style={{ width: 70 }}>
                        <i style={{ width: `${Math.min(100, r.rate)}%`, background: r.rate > 40 ? 'var(--danger)' : 'var(--primary)' }} />
                      </div>
                      {r.rate}%
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ gridColumn: 'span 3', display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, alignItems: 'start' }}>
          {COLUMNS.map((col) => {
            const list = jobs.filter((j) => j.status === col.key);
            return (
              <div key={col.key} style={{ background: '#fafbfc', border: '1px solid var(--border)', borderRadius: 10, padding: 8, minHeight: 120 }}>
                <div className="small" style={{ fontWeight: 700, marginBottom: 8 }}>
                  {col.title} <span className="muted">({list.length})</span>
                </div>
                {list.map((j) => (
                  <JobCard
                    key={j.id}
                    job={j}
                    active={j.id === currentJobId}
                    workers={workers}
                    onAssign={() => setAssignFor(j.id)}
                    onOpen={() => {
                      openJob(j.id);
                      if (!j.doc) newBlankDoc(j.id);
                      onOpenEditor();
                    }}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {assignFor && (
        <div className="modal-mask" onClick={() => setAssignFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>分派师傅</h2>
            <div className="col">
              {designers.map((w) => (
                <button
                  key={w.id}
                  onClick={() => {
                    assignJob(assignFor, w.id);
                    setAssignFor(null);
                  }}
                >
                  {w.name}
                </button>
              ))}
              <button onClick={() => setAssignFor(null)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function JobCard({
  job,
  active,
  workers,
  onAssign,
  onOpen,
}: {
  job: Job;
  active: boolean;
  workers: { id: string; name: string }[];
  onAssign: () => void;
  onOpen: () => void;
}) {
  const assignee = workers.find((w) => w.id === job.assignee);
  return (
    <div
      style={{
        background: '#fff',
        border: active ? '1.5px solid var(--primary)' : '1px solid var(--border)',
        borderRadius: 8,
        padding: 8,
        marginBottom: 8,
      }}
    >
      <div style={{ fontWeight: 700 }}>{job.code}</div>
      <div className="small">{job.station}</div>
      <div className="small muted" style={{ margin: '4px 0' }}>
        客户：{job.customer}
      </div>
      <div className="small">
        负责人：{assignee?.name ?? <span style={{ color: 'var(--warn)' }}>未分派</span>}
        {job.reworkCount > 0 && <span className="tag returned" style={{ marginLeft: 6 }}>返工 {job.reworkCount}</span>}
      </div>
      <div style={{ marginTop: 6 }} className="small muted">
        <span className={`tag ${job.status}`}>{statusLabel(job.status)}</span>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        {job.status === 'intake' ? (
          <button className="primary" style={{ flex: 1 }} onClick={onAssign}>
            派工
          </button>
        ) : (
          <button style={{ flex: 1 }} onClick={onOpen}>
            {job.doc ? '打开画布' : '开始绘制'}
          </button>
        )}
      </div>
    </div>
  );
}

function Kpi({ num, label }: { num: number | string; label: string }) {
  return (
    <div className="kpi">
      <div className="num">{num}</div>
      <div className="lbl">{label}</div>
    </div>
  );
}

function buildStats(jobs: Job[], workers: { id: string; name: string; role: string }[]) {
  return workers
    .filter((w) => w.role === 'designer')
    .map((w) => {
      const mine = jobs.filter((j) => j.assignee === w.id);
      const done = mine.filter((j) => j.status === 'approved').length;
      const wip = mine.filter((j) => ['assigned', 'in_progress', 'returned', 'submitted'].includes(j.status)).length;
      const reworks = mine.reduce((a, j) => a + j.reworkCount, 0);
      const handled = mine.filter((j) => j.status !== 'intake').length;
      const rate = handled ? Math.round((reworks / handled) * 100) : 0;
      return { id: w.id, name: w.name, done, wip, reworks, rate };
    });
}
