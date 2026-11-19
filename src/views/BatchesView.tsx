import { createMemo, createSignal, For, Show } from 'solid-js';
import { materialStore } from '../materials/materialStore';
import { summarizeIssues } from '../materials/checkRules';
import { BatchStatusTag, ItemStatusTag, toast } from '../components/Toast';
import type { IncomingFile } from '../materials/checkRules';
import type { MaterialBatch } from '../types';

export function BatchesView() {
  const [supplier, setSupplier] = createSignal('');
  const [picked, setPicked] = createSignal<IncomingFile[]>([]);
  const [dragOver, setDragOver] = createSignal(false);

  const active = createMemo(() => materialStore.activeBatch());

  function ingestFiles(list: FileList | File[]) {
    const files = [...list].map((f) => ({ name: f.name, sizeKb: f.size / 1024 }));
    setPicked((p) => [...p, ...files]);
  }

  function addMockRow() {
    const n = picked().length + 1;
    setPicked((p) => [
      ...p,
      { name: `topsoil_probe_${String(n).padStart(2, '0')}.png`, sizeKb: 2200 + n * 137 },
    ]);
  }

  function submit() {
    if (picked().length === 0) {
      toast('请先选择或拖入素材文件', 'warn');
      return;
    }
    const batch = materialStore.ingestBatch(supplier(), picked());
    toast(`批次 ${batch.id.slice(-6)} 已登记,${batch.items.length} 个素材开始自动检查`, 'good');
    setPicked([]);
    setSupplier('');
  }

  return (
    <div class="two-col">
      {/* 左:批次列表 + 导入 */}
      <div class="col-scroll">
        <section class="panel" style={{ 'margin-bottom': '14px' }}>
          <div class="panel-h">新批次导入</div>
          <div class="panel-b">
            <div class="field">
              <label>供应方名称</label>
              <input
                type="text"
                placeholder="例如:戈壁地质素材供应站"
                value={supplier()}
                onInput={(e) => setSupplier(e.currentTarget.value)}
              />
            </div>
            <div
              class="dropzone"
              classList={{ drag: dragOver() }}
              onClick={() => document.getElementById('batch-file-input')?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer && e.dataTransfer.files.length) {
                  ingestFiles(e.dataTransfer.files);
                }
              }}
            >
              拖入素材文件,或点击选择
              <div class="muted" style={{ 'font-size': '12px', 'margin-top': '6px' }}>
                支持 png/jpg/ktx2/glb/obj/csv/json/pdf 等
              </div>
              <input
                id="batch-file-input"
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  if (e.currentTarget.files) ingestFiles(e.currentTarget.files);
                  e.currentTarget.value = '';
                }}
              />
            </div>
            <Show when={picked().length > 0}>
              <div class="file-pick-list">
                <For each={picked()}>
                  {(f) => (
                    <div>
                      <span class="mono">{f.name}</span> · {f.sizeKb.toFixed(0)} KB
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <div class="toolbar-row" style={{ margin: '10px 0 0' }}>
              <button class="tiny ghost" onClick={addMockRow}>
                + 模拟添加一行
              </button>
              <span class="spacer" />
              <button class="primary tiny" onClick={submit}>
                登记并自动检查 ({picked().length})
              </button>
            </div>
          </div>
        </section>

        <For each={materialStore.batches()}>
          {(b) => {
            const s = summarizeIssues(b.items);
            return (
              <div
                class="batch-card"
                classList={{ selected: materialStore.activeBatchId() === b.id }}
                onClick={() => materialStore.setActiveBatchId(b.id)}
              >
                <div class="top">
                  <span class="supplier">{b.supplier}</span>
                  <BatchStatusTag status={b.status} />
                </div>
                <div class="muted" style={{ 'font-size': '12px' }}>
                  {new Date(b.arrivedAt).toLocaleString('zh-CN')} · {b.items.length} 个素材
                </div>
                <div class="metrics">
                  <span class="status-rejected">严重 {s.severe}</span>
                  <span class="status-pending">提示 {s.notice}</span>
                  <span>待处理 {s.open}</span>
                </div>
              </div>
            );
          }}
        </For>
      </div>

      {/* 右:批次详情 */}
      <section class="panel" style={{ display: 'flex', 'flex-direction': 'column', 'min-height': 0 }}>
        <Show
          when={active()}
          fallback={<div class="empty">选择左侧批次查看自动检查结果</div>}
        >
          {(batch) => <BatchDetail batch={batch()} />}
        </Show>
      </section>
    </div>
  );
}

function BatchDetail(props: { batch: MaterialBatch }) {
  const b = () => props.batch;
  const summary = createMemo(() => summarizeIssues(b().items));
  return (
    <>
      <div class="panel-h">
        <div>
          批次 {b().id.slice(-8)}
          <span class="sub" style={{ 'margin-left': '10px' }}>
            {b().supplier}
          </span>
        </div>
        <BatchStatusTag status={b().status} />
      </div>
      <div class="panel-b" style={{ 'border-bottom': '1px solid var(--border)' }}>
        <div class="stat-grid">
          <div class="stat-card">
            <b class="status-rejected">{summary().severe}</b>
            <span>严重问题(阻断放行)</span>
          </div>
          <div class="stat-card">
            <b class="status-pending">{summary().notice}</b>
            <span>提示问题(需人工确认)</span>
          </div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>素材</th>
              <th>类型</th>
              <th>层归属</th>
              <th>大小</th>
              <th>问题</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <For each={b().items}>
              {(item) => (
                <tr>
                  <td>
                    <div class="mono">{item.name}</div>
                    <div class="muted" style={{ 'font-size': '11px' }}>{item.checksum.slice(0, 24)}…</div>
                  </td>
                  <td class="nowrap">.{item.ext}</td>
                  <td class="nowrap">
                    {item.declaredLayer === 'unspecified' ? (
                      <span class="tag severe">未识别</span>
                    ) : (
                      <span class="tag gray">{item.declaredLayer}</span>
                    )}
                  </td>
                  <td class="nowrap">{(item.sizeKb / 1024).toFixed(2)} MB</td>
                  <td>
                    <span class="tag severe">{item.issues.filter((i) => i.level === 'severe').length} 严重</span>{' '}
                    <span class="tag notice">{item.issues.filter((i) => i.level === 'notice').length} 提示</span>
                  </td>
                  <td><ItemStatusTag status={item.status} /></td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <Show when={b().status === 'checking'}>
          <div class="empty">自动检查流水线运行中,稍候将进入待复核…</div>
        </Show>
      </div>
    </>
  );
}
