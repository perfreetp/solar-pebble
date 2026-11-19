import { useState } from 'react';
import EditorView from './EditorView';
import JobsBoard from './JobsBoard';
import QcView from './QcView';
import NewJobModal from './NewJobModal';
import { useEditor } from '../editor/store';

type Tab = 'editor' | 'jobs' | 'qc';

export default function App() {
  const [tab, setTab] = useState<Tab>('editor');
  const [showNewJob, setShowNewJob] = useState(false);
  const jobs = useEditor((s) => s.jobs);
  const currentJobId = useEditor((s) => s.currentJobId);
  const current = jobs.find((j) => j.id === currentJobId);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">站房采样管线矢量编辑器</span>
        <nav className="tabs">
          <button className={tab === 'editor' ? 'active' : ''} onClick={() => setTab('editor')}>
            画布编辑
          </button>
          <button className={tab === 'jobs' ? 'active' : ''} onClick={() => setTab('jobs')}>
            工单与看板
          </button>
          <button className={tab === 'qc' ? 'active' : ''} onClick={() => setTab('qc')}>
            质检抽查
          </button>
        </nav>
        <div style={{ flex: 1 }} />
        {current && (
          <span className="muted small">
            当前工单 <b>{current.code}</b> · {current.station} ·{' '}
            <span className={`tag ${current.status}`}>{statusLabel(current.status)}</span>
          </span>
        )}
        {tab === 'jobs' && (
          <button className="primary" onClick={() => setShowNewJob(true)}>
            ＋ 前台接单
          </button>
        )}
      </header>

      {tab === 'editor' && <EditorView />}
      {tab === 'jobs' && <JobsBoard onOpenEditor={() => setTab('editor')} />}
      {tab === 'qc' && <QcView onOpenEditor={() => setTab('editor')} />}

      {showNewJob && <NewJobModal onClose={() => setShowNewJob(false)} />}
    </div>
  );
}

export function statusLabel(s: string): string {
  return (
    {
      intake: '待派工',
      assigned: '已派工',
      in_progress: '绘制中',
      submitted: '待质检',
      returned: '已打回',
      approved: '已通过',
    } as Record<string, string>
  )[s] ?? s;
}
