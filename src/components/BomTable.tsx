import { For, Show } from 'solid-js';
import type { BOMData, InterferencePair } from '../../shared/types';
import { CATEGORY_LABEL, CATEGORY_COLOR } from '../../shared/types';

export function BomTable(props: { bom: BOMData; showFoot?: boolean; compact?: boolean }) {
  return (
    <div style={{ 'overflow-x': 'auto' }} class={props.compact ? 'bom-compact' : undefined}>
      <table class="bom-table">
        <thead>
          <tr>
            <th>#</th>
            <th>零件号</th>
            <th>名称</th>
            <th>规格</th>
            <th>类别</th>
            <th class="num">数量</th>
            <th class="num">单重 kg</th>
            <th class="num">小计 kg</th>
            <th class="num">小计 m³</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.bom.rows}>
            {(r, i) => (
              <tr>
                <td class="num" style={{ color: 'var(--text-faint)' }}>{i() + 1}</td>
                <td class="partno">{r.partNo}</td>
                <td>{r.name}</td>
                <td style={{ color: 'var(--text-dim)', 'font-size': '10.5px' }}>{r.spec}</td>
                <td>
                  <span class="badge" style={{ background: 'transparent', color: CATEGORY_COLOR[r.category], padding: '0 4px' }}>
                    {CATEGORY_LABEL[r.category]}
                  </span>
                </td>
                <td class="num">{r.qty}</td>
                <td class="num">{r.unitWeight.toFixed(2)}</td>
                <td class="num">{r.totalWeight.toFixed(2)}</td>
                <td class="num" style={{ color: 'var(--text-faint)' }}>{r.totalVolume.toFixed(4)}</td>
              </tr>
            )}
          </For>
        </tbody>
        <Show when={props.showFoot !== false}>
          <tfoot>
            <tr>
              <td colspan="5">合计 · {props.bom.totalTypes} 种</td>
              <td class="num">{props.bom.totalParts}</td>
              <td></td>
              <td class="num">{props.bom.totalWeight.toFixed(2)}</td>
              <td class="num">{props.bom.totalVolume.toFixed(4)}</td>
            </tr>
          </tfoot>
        </Show>
      </table>
    </div>
  );
}

export function InterferenceList(props: {
  report: InterferencePair[];
  onPick?: (p: InterferencePair) => void;
  names?: (p: InterferencePair) => [string, string];
}) {
  return (
    <Show
      when={props.report.length}
      fallback={<div class="ok-box">未检测到零件干涉，包围盒检测通过。</div>}
    >
      <div class="issue-list">
        <For each={props.report}>
          {(p, i) => {
            const [a, b] = props.names ? props.names(p) : [p.nameA, p.nameB];
            return (
              <div class="issue-row" style={{ cursor: props.onPick ? 'pointer' : 'default' }} onClick={() => props.onPick?.(p)}>
                <span class="idx">#{String(i() + 1).padStart(2, '0')}</span>
                <span>
                  <b style={{ color: '#f0b3a8' }}>{a}</b> × <b style={{ color: '#f0b3a8' }}>{b}</b>
                </span>
                <span class="occ">重叠 {p.volume.toFixed(5)} m³ · 深 {p.depth.toFixed(0)}mm</span>
              </div>
            );
          }}
        </For>
      </div>
    </Show>
  );
}

export function StatCards(props: {
  stats: { k: string; v: string; unit?: string; tone?: string }[];
}) {
  return (
    <div class="stat-grid">
      <For each={props.stats}>
        {(s) => (
          <div class="stat-card">
            <div class="k">{s.k}</div>
            <div class="v" style={s.tone ? { color: s.tone } : undefined}>
              {s.v}
              <Show when={s.unit}><small>{s.unit}</small></Show>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
