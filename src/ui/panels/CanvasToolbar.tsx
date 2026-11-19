import { useEditor } from '../../editor/store';
import { buildLayerManifest, downloadText, exportSVG } from '../../editor/exportSvg';
import type { Matrix, VecPath } from '../../editor/types';

export default function CanvasToolbar() {
  const items = useEditor((s) => s.items);
  const layers = useEditor((s) => s.layers);
  const groups = useEditor((s) => s.groups);
  const job = useEditor((s) => s.jobs.find((j) => j.id === s.currentJobId));
  const submitJob = useEditor((s) => s.submitJob);
  const currentJobId = useEditor((s) => s.currentJobId);

  const groupTx = (item: VecPath): Matrix | null =>
    item.groupId ? groups.find((g) => g.id === item.groupId)?.transform ?? null : null;

  const onSvg = () => {
    const svg = exportSVG(items, layers, groupTx, { width: 1200, height: 800 });
    downloadText(`${job?.code ?? 'drawing'}.svg`, svg, 'image/svg+xml');
  };

  const onManifest = () => {
    const manifest = buildLayerManifest(items, layers);
    downloadText(
      `${job?.code ?? 'drawing'}-图层清单.json`,
      JSON.stringify(
        { job: job?.code, station: job?.station, exportedAt: new Date().toISOString(), layers: manifest },
        null,
        2,
      ),
      'application/json',
    );
  };

  const canSubmit = !!currentJobId && (job?.status === 'in_progress' || job?.status === 'returned' || job?.status === 'assigned');
  const hasConflict = items.some((i) => i.conflict);

  return (
    <div
      style={{
        position: 'absolute',
        top: 10,
        left: 10,
        zIndex: 4,
        display: 'flex',
        gap: '8px',
        background: 'rgba(255,255,255,.92)',
        padding: 8,
        borderRadius: 10,
        boxShadow: '0 2px 10px rgba(16,24,40,.1)',
      }}
    >
      <button onClick={onSvg} disabled={!items.length}>
        ⬇ 导出 SVG
      </button>
      <button onClick={onManifest} disabled={!items.length}>
        📋 导出图层清单
      </button>
      <div style={{ width: 1, background: 'var(--border)' }} />
      <button
        className="primary"
        disabled={!canSubmit}
        title={hasConflict ? '仍有版面冲突，建议先调整' : '提交质检抽查'}
        onClick={() => currentJobId && submitJob(currentJobId)}
      >
        提交质检{hasConflict ? '（存在冲突）' : ''}
      </button>
    </div>
  );
}
