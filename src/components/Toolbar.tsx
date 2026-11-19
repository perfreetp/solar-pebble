import { docState, undo, redo, zoomAt, resetView } from '../store/docStore';

interface Props {
  onBoolean: (op: 'union' | 'difference' | 'intersection') => void;
  onCut: () => void;
  onAlign: (a: 'left' | 'centerX' | 'top' | 'centerY' | 'distX' | 'distY') => void;
  onExport: () => void;
  onSubmit: () => void;
  onTemplate: () => void;
  toast: (msg: string) => void;
}

export default function Toolbar(props: Props) {
  const t = () => docState.tool().type;
  const selCount = () => docState.selection().size;

  return (
    <div class="toolbar">
      <div class="tool-group">
        <button classList={{ active: t() === 'select' }} title="选择/节点编辑 (V)"
          onClick={() => docState.setTool({ type: 'select' })}>➤ 选择</button>
        <button classList={{ active: t() === 'pen' }} title="钢笔 (P)"
          onClick={() => docState.setTool({ type: 'pen' })}>✒ 钢笔</button>
        <button classList={{ active: t() === 'pan' }} title="平移 (H 或空格)"
          onClick={() => docState.setTool({ type: 'pan' })}>✋ 平移</button>
        <button classList={{ active: t() === 'guide' }} title="参考线"
          onClick={() => docState.setTool({ type: 'guide' })}>┼ 参考线</button>
      </div>

      <div class="tool-group">
        <button classList={{ active: docState.penKind() === 'vein' }}
          onClick={() => docState.setPenKind('vein')} title="钢笔绘制翅脉">翅脉</button>
        <button classList={{ active: docState.penKind() === 'pattern' }}
          onClick={() => docState.setPenKind('pattern')} title="钢笔绘制斑纹块">斑纹</button>
      </div>

      <div class="tool-group">
        <button onClick={undo} disabled={!docState.historyInfo().undo}
          title={`撤销 (${docState.historyInfo().undo}/${80})`}>↶ 撤销</button>
        <button onClick={redo} disabled={!docState.historyInfo().redo}
          title={`重做 (${docState.historyInfo().redo})`}>↷ 重做</button>
      </div>

      <div class="tool-group">
        <span class="group-label">对齐</span>
        <button aria-label="左对齐" disabled={selCount() < 2} onClick={() => props.onAlign('left')} title="左对齐">⇤</button>
        <button aria-label="水平居中对齐" disabled={selCount() < 2} onClick={() => props.onAlign('centerX')} title="水平居中对齐">↔</button>
        <button aria-label="顶对齐" disabled={selCount() < 2} onClick={() => props.onAlign('top')} title="顶对齐">⤒</button>
        <button aria-label="垂直居中对齐" disabled={selCount() < 2} onClick={() => props.onAlign('centerY')} title="垂直居中对齐">↕</button>
        <button aria-label="横向等间距分布" disabled={selCount() < 3} onClick={() => props.onAlign('distX')} title="横向等间距">⇋</button>
        <button aria-label="纵向等间距分布" disabled={selCount() < 3} onClick={() => props.onAlign('distY')} title="纵向等间距">⇵</button>
      </div>

      <div class="tool-group">
        <span class="group-label">布尔(两条闭合路径)</span>
        <button disabled={selCount() < 2} onClick={() => props.onBoolean('union')}>∪ 并集</button>
        <button disabled={selCount() < 2} onClick={() => props.onBoolean('difference')}>− 差集</button>
        <button disabled={selCount() < 2} onClick={() => props.onBoolean('intersection')}>∩ 交集</button>
        <button onClick={props.onCut} title="选中斑纹块,与全部翅脉相交处切镂空">◌ 斑纹镂空</button>
      </div>

      <div class="tool-group">
        <button onClick={() => zoomAt(1.2, { x: 300, y: 300 })}>＋</button>
        <button onClick={() => zoomAt(1 / 1.2, { x: 300, y: 300 })}>－</button>
        <button onClick={resetView}>1:1</button>
      </div>

      <div class="tool-group spacer">
        <button class="ghost" onClick={props.onTemplate}>📋 模板库</button>
        <button class="ghost" onClick={props.onExport}>⤓ 导出 SVG</button>
        <button class="primary" onClick={props.onSubmit}>提交审校</button>
      </div>
    </div>
  );
}
