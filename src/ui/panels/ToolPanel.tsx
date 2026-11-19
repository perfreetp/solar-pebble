import { useEditor } from '../../editor/store';
import type { ToolId } from '../../editor/types';

const TOOLS: { id: ToolId; icon: string; name: string; hint: string }[] = [
  { id: 'select', icon: '➤', name: '选择', hint: 'V' },
  { id: 'rect', icon: '▭', name: '矩形', hint: 'R' },
  { id: 'polygon', icon: '⬡', name: '多边形', hint: '双击/回车结束' },
  { id: 'polyline', icon: '𠔥', name: '折线', hint: '双击/回车结束' },
  { id: 'pen', icon: '✎', name: '钢笔', hint: '拖拽出曲线柄' },
  { id: 'pan', icon: '✥', name: '平移', hint: '空格临时平移，滚轮缩放' },
];

export default function ToolPanel() {
  const tool = useEditor((s) => s.settings.tool);
  const setTool = useEditor((s) => s.setTool);
  const settings = useEditor((s) => s.settings);
  const patch = useEditor((s) => s.patchSettings);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const past = useEditor((s) => s.past.length);
  const future = useEditor((s) => s.future.length);
  const zoom = useEditor((s) => s.zoom);
  const setView = useEditor((s) => s.setView);

  return (
    <div className="section">
      <h3>工具</h3>
      <div className="toolgrid">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={tool === t.id ? 'toggled' : ''}
            title={t.hint}
            onClick={() => setTool(t.id)}
          >
            <span className="ico">{t.icon}</span>
            {t.name}
          </button>
        ))}
      </div>

      <div className="divider" />
      <div className="row">
        <button style={{ flex: 1 }} disabled={!past} onClick={undo} title="Ctrl+Z">
          ↶ 撤销
        </button>
        <button style={{ flex: 1 }} disabled={!future} onClick={redo} title="Ctrl+Y">
          ↷ 重做
        </button>
      </div>
      <div className="small muted" style={{ marginTop: 4 }}>
        历史：{past}/{50} 步
      </div>

      <div className="divider" />
      <h3>视图与吸附</h3>
      <div className="col">
        <div className="row">
          <button
            className={settings.gridVisible ? 'toggled' : ''}
            style={{ flex: 1 }}
            onClick={() => patch({ gridVisible: !settings.gridVisible })}
          >
            栅格 {settings.gridVisible ? '开' : '关'}
          </button>
          <button
            className={settings.rulerVisible ? 'toggled' : ''}
            style={{ flex: 1 }}
            onClick={() => patch({ rulerVisible: !settings.rulerVisible })}
          >
            标尺 {settings.rulerVisible ? '开' : '关'}
          </button>
        </div>
        <div className="row">
          <button
            className={settings.snapEnabled ? 'toggled' : ''}
            style={{ flex: 1 }}
            onClick={() => patch({ snapEnabled: !settings.snapEnabled })}
          >
            吸附 {settings.snapEnabled ? '开' : '关'}
          </button>
          <span className="small muted" style={{ whiteSpace: 'nowrap' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button onClick={() => setView(1, { x: 0, y: 0 })} title="复位视图">
            1:1
          </button>
        </div>
        <div>
          <label>吸附阈值 {settings.snapThreshold}px（端点 / 中点 / 网格 / 边线）</label>
          <input
            type="range"
            min={2}
            max={30}
            value={settings.snapThreshold}
            onChange={(e) => patch({ snapThreshold: Number(e.target.value) })}
          />
        </div>
        <div>
          <label>栅格间距 {settings.gridSize}px</label>
          <input
            type="range"
            min={5}
            max={100}
            step={5}
            value={settings.gridSize}
            onChange={(e) => patch({ gridSize: Number(e.target.value) })}
          />
        </div>
      </div>
    </div>
  );
}
