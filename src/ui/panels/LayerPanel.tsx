import { useState } from 'react';
import { useEditor } from '../../editor/store';

export default function LayerPanel() {
  const layers = useEditor((s) => s.layers);
  const active = useEditor((s) => s.settings.activeLayerId);
  const toggle = useEditor((s) => s.toggleLayer);
  const setActive = useEditor((s) => s.setActiveLayer);
  const addLayer = useEditor((s) => s.addLayer);
  const removeLayer = useEditor((s) => s.removeLayer);
  const items = useEditor((s) => s.items);
  const [name, setName] = useState('');

  return (
    <div className="section">
      <h3>图层（锁定 / 隐藏）</h3>
      {layers.map((l) => {
        const count = items.filter((i) => i.layerId === l.id).length;
        return (
          <div key={l.id} className={`layer-item ${active === l.id ? 'active' : ''}`}>
            <span className="swatch" style={{ background: l.color }} />
            <span className="name" onClick={() => setActive(l.id)} title="点击设为当前图层">
              {l.name}
              <span className="muted small"> ({count})</span>
            </span>
            <button
              className="icon-btn ghost"
              title={l.visible ? '隐藏' : '显示'}
              onClick={() => toggle(l.id, 'visible')}
            >
              {l.visible ? '👁' : '🚫'}
            </button>
            <button
              className="icon-btn ghost"
              title={l.locked ? '解锁' : '锁定'}
              onClick={() => toggle(l.id, 'locked')}
            >
              {l.locked ? '🔒' : '🔓'}
            </button>
          </div>
        );
      })}
      <div className="row" style={{ marginTop: 8 }}>
        <input
          placeholder="新图层名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              addLayer(name);
              setName('');
            }
          }}
        />
        <button
          onClick={() => {
            addLayer(name);
            setName('');
          }}
        >
          新建
        </button>
        <button
          className="danger"
          disabled={layers.length <= 1}
          title="删除当前图层及其图元"
          onClick={() => removeLayer(active)}
        >
          删除
        </button>
      </div>
    </div>
  );
}
