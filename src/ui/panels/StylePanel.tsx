import { useEditor } from '../../editor/store';
import type { ItemStyle } from '../../editor/types';

export default function StylePanel() {
  const items = useEditor((s) => s.items);
  const selection = useEditor((s) => s.selection);
  const updateItem = useEditor((s) => s.updateItem);
  const templates = useEditor((s) => s.templates);
  const applyTemplate = useEditor((s) => s.applyTemplate);
  const snapshot = useEditor((s) => s.snapshot);

  const selected = items.filter((i) => selection.includes(i.id));
  const first = selected[0];

  const patchStyle = (patch: Partial<ItemStyle>) => {
    if (!selected.length) return;
    snapshot();
    selected.forEach((it) => updateItem(it.id, { style: { ...it.style, ...patch } }));
  };

  return (
    <div className="section">
      <h3>图例模板批量套用</h3>
      <div className="col">
        {templates.map((t) => {
          const applicable = selected.some((i) => t.appliesTo.includes(i.type));
          return (
            <button
              key={t.id}
              disabled={!selected.length || !applicable}
              onClick={() => applyTemplate(t.id, selection)}
              title={applicable ? '套用到全部选中图元' : '该模板不适用于选中类型'}
              style={{ textAlign: 'left', display: 'flex', gap: 8, alignItems: 'center' }}
            >
              <span
                style={{
                  width: 26,
                  height: 18,
                  borderRadius: 4,
                  background: t.style.fill,
                  border: `2px ${t.style.dash.length ? 'dashed' : 'solid'} ${t.style.stroke}`,
                }}
              />
              <span style={{ flex: 1 }}>{t.name}</span>
              <span className="muted small">线宽 {t.style.strokeWidth}</span>
            </button>
          );
        })}
        {!selected.length && <p className="small muted">先在画布上选择一个或多个图元。</p>}
      </div>

      <div className="divider" />
      <h3>线宽与填充</h3>
      {first ? (
        <div className="col">
          <div className="small muted">
            已选 {selected.length} 个图元（修改会同步到全部选中项）
          </div>
          <div>
            <label>线宽 {first.style.strokeWidth}px</label>
            <input
              type="range"
              min={0.5}
              max={12}
              step={0.5}
              value={first.style.strokeWidth}
              onChange={(e) => patchStyle({ strokeWidth: Number(e.target.value) })}
            />
          </div>
          <div>
            <label>填充透明度 {Math.round(first.style.opacity * 100)}%</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={first.style.opacity}
              onChange={(e) => patchStyle({ opacity: Number(e.target.value) })}
            />
          </div>
          <div className="row">
            <div style={{ flex: 1 }}>
              <label>描边色</label>
              <input
                type="color"
                value={first.style.stroke}
                onChange={(e) => patchStyle({ stroke: e.target.value })}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label>填充色</label>
              <input
                type="color"
                value={first.style.fill}
                onChange={(e) => patchStyle({ fill: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label>线型</label>
            <div className="row">
              <button
                className={!first.style.dash.length ? 'toggled' : ''}
                style={{ flex: 1 }}
                onClick={() => patchStyle({ dash: [] })}
              >
                实线
              </button>
              <button
                className={first.style.dash.length ? 'toggled' : ''}
                style={{ flex: 1 }}
                onClick={() => patchStyle({ dash: [8, 5] })}
              >
                虚线
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p className="small muted">未选中图元。</p>
      )}
    </div>
  );
}
