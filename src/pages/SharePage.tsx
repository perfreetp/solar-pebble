import { For, Show, createResource, createSignal, createMemo, onMount, onCleanup } from 'solid-js';
import { TopViewDrawing } from '../components/TopViewDrawing';
import { BomTable, StatCards } from '../components/BomTable';
import { fetchShare } from '../lib/api';
import type { VersionDetail } from '../../shared/types';

/** Public, read-only customer view: top-view drawing + BOM only. */
export default function SharePage(props: { token: string }) {
  const [data] = createResource(() => fetchShare(props.token));
  const [zoom, setZoom] = createSignal(0.26);
  const [box, setBox] = createSignal({ w: 900, h: 700 });
  let bodyRef!: HTMLDivElement;
  onMount(() => {
    const ro = new ResizeObserver(() => {
      const r = bodyRef.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
    });
    if (bodyRef) ro.observe(bodyRef);
    onCleanup(() => ro.disconnect());
  });

  return (
    <div style={{ height: '100%', display: 'flex', 'flex-direction': 'column', background: 'var(--bg)' }}>
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark">
            <svg width="15" height="15" viewBox="0 0 32 32">
              <path d="M16 5 27 11v10L16 27 5 21V11z" fill="none" stroke="#e7a94a" stroke-width="1.8" />
              <path d="M5 11l11 6 11-6M16 17v10" stroke="#e7a94a" stroke-width="1.2" opacity=".65" />
            </svg>
          </span>
          <div><div>床架方案 · 只读预览</div><div class="brand-sub">客户视图 · 仅俯视布置与物料清单</div></div>
        </div>
        <Show when={data()}>
          <div style={{ 'margin-left': 'auto', display: 'flex', 'align-items': 'center', gap: '10px' }}>
            <span class="badge badge-approved">✓ 主管已评审通过</span>
            <span style={{ 'font-size': '11px', color: 'var(--text-faint)' }}>
              {data()!.project} · {data()!.name}
            </span>
          </div>
        </Show>
      </header>

      <Show
        when={!data.loading}
        fallback={<div class="center-load"><div class="spinner" /><div style={{ 'margin-top': '12px', color: 'var(--text-faint)' }}>加载方案…</div></div>}
      >
        <Show
          when={data()}
          fallback={
            <div class="center-load" style={{ 'flex-direction': 'column', gap: '10px' }}>
              <div class="empty-state"><div class="big">🔗</div>{String(data.error?.message ?? '链接无效或已失效')}</div>
            </div>
          }
        >
          <div style={{ flex: 1, display: 'grid', 'grid-template-columns': '1fr 340px', 'min-height': '0' }}>
            <div style={{ position: 'relative', background: '#e9e5db', 'overflow': 'auto' }}>
              <div style={{ position: 'absolute', left: '14px', top: '14px', display: 'flex', gap: '5px', 'z-index': 4 }}>
                <button class="ghost" style={{ 'font-size': '12px' }} onClick={() => setZoom((z) => Math.max(0.14, z - 0.04))}>－</button>
                <span class="badge badge-draft" style={{ 'font-family': 'var(--mono)' }}>{Math.round(zoom() * 100)}%</span>
                <button class="ghost" style={{ 'font-size': '12px' }} onClick={() => setZoom((z) => Math.min(0.5, z + 0.04))}>＋</button>
              </div>
              <div ref={bodyRef} style={{ 'min-height': '100%', display: 'grid', 'place-items': 'center', padding: '56px 20px 20px' }}>
                <TopViewDrawing data={data()!.topview} bom={data()!.bom} fit={{ w: Math.max(360, box().w - 70), h: Math.max(320, box().h - 110) }} title={`${data()!.project} 俯视布置`} />
              </div>
            </div>

            <aside class="panel" style={{ 'border-left': '1px solid var(--line)', overflow: 'auto' }}>
              <div style={{ padding: '14px' }}>
                <div style={{ 'font-size': '13px', 'font-weight': 620, 'margin-bottom': '4px' }}>{data()!.project}</div>
                <div style={{ 'font-size': '11px', color: 'var(--text-faint)', 'margin-bottom': '14px' }}>
                  方案 {data()!.name} · 评审通过 {data()!.reviewed_at?.slice(0, 10)}
                </div>
                <StatCards stats={[
                  { k: '件数', v: String(data()!.bom.totalParts), unit: '件' },
                  { k: '重量', v: data()!.bom.totalWeight.toFixed(1), unit: 'kg' },
                  { k: '体积', v: data()!.bom.totalVolume.toFixed(3), unit: 'm³' },
                  { k: '类别', v: String(data()!.bom.byCategory.length), unit: '类' },
                ]} />
                <div style={{ 'margin-top': '18px' }}>
                  <div class="section-head" style={{ background: 'none', padding: '0 0 8px' }}>分类小计</div>
                  <For each={data()!.bom.byCategory}>
                    {(c) => (
                      <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'font-size': '11.5px', padding: '3px 0' }}>
                        <span class="tree-dot" style={{ background: c.category === 'tube' ? '#79a7c9' : c.category === 'connector' ? '#e59a4a' : c.category === 'board' ? '#c9a173' : c.category === 'carton' ? '#b98b5e' : '#8f9bb0' }} />
                        <span style={{ flex: 1, color: 'var(--text-dim)' }}>{c.label}</span>
                        <span style={{ 'font-family': 'var(--mono)' }}>{c.qty} 件</span>
                        <span style={{ 'font-family': 'var(--mono)', color: 'var(--text-faint)', width: '58px', 'text-align': 'right' }}>{c.weight.toFixed(1)} kg</span>
                      </div>
                    )}
                  </For>
                </div>
                <div class="hint-inline" style={{ 'margin-top': '16px', 'border-top': '1px solid var(--line)', 'padding-top': '12px' }}>
                  本页为只读视图，数据来自主管评审通过的版本快照；如有疑问请联系对接工艺员。
                </div>
              </div>
            </aside>
          </div>

          <div style={{ 'border-top': '1px solid var(--line)', background: 'var(--panel)', 'max-height': '38%', overflow: 'auto', padding: '14px 16px 18px', 'flex-shrink': 0 }}>
            <div class="section-head" style={{ background: 'none', padding: '0 0 8px' }}>
              物料清单 · 共 {data()!.bom.totalTypes} 种 {data()!.bom.totalParts} 件 · 总重 {data()!.bom.totalWeight.toFixed(1)} kg · 总体积 {data()!.bom.totalVolume.toFixed(3)} m³
            </div>
            <BomTable bom={data()!.bom} />
          </div>
        </Show>
      </Show>
    </div>
  );
}
