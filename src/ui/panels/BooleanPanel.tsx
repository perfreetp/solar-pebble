import { useEditor } from '../../editor/store';
import type { BoolOp } from '../../editor/types';

const OPS: { id: BoolOp; name: string; symbol: string }[] = [
  { id: 'unite', name: '并集', symbol: '∪' },
  { id: 'subtract', name: '差集', symbol: '−' },
  { id: 'intersect', name: '交集', symbol: '∩' },
  { id: 'xor', name: '异或', symbol: '⊕' },
];

export default function BooleanPanel() {
  const selection = useEditor((s) => s.selection);
  const doBool = useEditor((s) => s.boolean);
  const group = useEditor((s) => s.groupSelection);
  const ungroup = useEditor((s) => s.ungroupSelection);
  const duplicate = useEditor((s) => s.duplicateSelection);
  const del = useEditor((s) => s.deleteSelection);
  const items = useEditor((s) => s.items);
  const hasGroup = items.some((i) => selection.includes(i.id) && i.groupId);

  return (
    <div className="section">
      <h3>路径布尔运算</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        选中 ≥2 个图元后运算，结果仍为可编辑的多边形路径（折线按线宽转面参与运算）。
      </p>
      <div className="booleans">
        {OPS.map((op) => (
          <button
            key={op.id}
            disabled={selection.length < 2}
            onClick={() => doBool(op.id)}
            title={op.name}
          >
            <span style={{ fontSize: 15, fontWeight: 700 }}>{op.symbol}</span> {op.name}
          </button>
        ))}
      </div>

      <div className="divider" />
      <h3>成组变换</h3>
      <div className="row">
        <button style={{ flex: 1 }} disabled={selection.length < 2} onClick={group} title="Ctrl+G">
          成组
        </button>
        <button style={{ flex: 1 }} disabled={!hasGroup} onClick={ungroup}>
          解组
        </button>
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <button style={{ flex: 1 }} disabled={!selection.length} onClick={duplicate} title="Ctrl+D">
          复制
        </button>
        <button style={{ flex: 1 }} className="danger" disabled={!selection.length} onClick={del}>
          删除
        </button>
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>
        提示：选中后拖动平移、拖角点缩放、顶部黄圆点旋转；粉色小点是可编辑顶点。
      </p>
    </div>
  );
}
