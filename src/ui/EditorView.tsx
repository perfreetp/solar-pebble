import { useEffect, useRef } from 'react';
import { PixiStage } from '../editor/PixiStage';
import { useEditor } from '../editor/store';
import ToolPanel from './panels/ToolPanel';
import LayerPanel from './panels/LayerPanel';
import StylePanel from './panels/StylePanel';
import BooleanPanel from './panels/BooleanPanel';
import CanvasToolbar from './panels/CanvasToolbar';

export default function EditorView() {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<PixiStage | null>(null);
  const conflictCount = useEditor((s) => s.items.filter((i) => i.conflict).length);
  const job = useEditor((s) => s.jobs.find((j) => j.id === s.currentJobId));

  useEffect(() => {
    if (!hostRef.current) return;
    const stage = new PixiStage(hostRef.current);
    stageRef.current = stage;
    return () => stage.destroy();
  }, []);

  // 全局快捷键：撤销/重做/删除/复制
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const s = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        s.undo();
      } else if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        s.redo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection.length) {
        e.preventDefault();
        s.deleteSelection();
      } else if (mod && e.key.toLowerCase() === 'd' && s.selection.length) {
        e.preventDefault();
        s.duplicateSelection();
      } else if (mod && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        s.groupSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="workspace">
      <aside className="panel">
        <ToolPanel />
        <div className="divider" />
        <LayerPanel />
      </aside>

      <main className="canvas-wrap">
        <CanvasToolbar />
        <div ref={hostRef} className="canvas-host" />
        {conflictCount > 0 && (
          <div className="conflict-banner">
            ⚠ 检测到 {conflictCount} 处版面冲突（管线压盖标识牌），请调整后再提交质检
          </div>
        )}
        {!job && (
          <div className="conflict-banner" style={{ background: '#e3f2fd', borderColor: '#90caf9', color: '#1565c0' }}>
            尚未打开工单，请到「工单与看板」选择或新建工单
          </div>
        )}
      </main>

      <aside className="panel right">
        <BooleanPanel />
        <div className="divider" />
        <StylePanel />
      </aside>
    </div>
  );
}
