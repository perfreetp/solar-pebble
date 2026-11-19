import { store } from '../store';
import { sharedCss } from './shared-css';
import type { JobStatus } from '../types';

const pageCss = `
  .page { padding: 18px 24px; height: 100%; overflow: auto; }
  .page-head h2 { margin: 0 0 4px; font-size: 18px; }
  .page-head p { margin: 0 0 18px; color: var(--muted); font-size: 12.5px; }
  .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 18px; }
  .kpi { background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
    box-shadow: var(--shadow); padding: 16px 18px; }
  .kpi .num { font-size: 30px; font-weight: 700; line-height: 1.2; }
  .kpi .lbl { font-size: 12.5px; color: var(--muted); margin-top: 4px; }
  .kpi.primary .num { color: var(--primary); }
  .kpi.ok .num { color: var(--ok); }
  .kpi.warn .num { color: var(--warn); }
  .kpi.danger .num { color: var(--danger); }
  .grid2 { display: grid; grid-template-columns: 1.2fr 1fr; gap: 16px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
    box-shadow: var(--shadow); overflow: hidden; }
  .card-head { padding: 12px 16px; font-weight: 600; border-bottom: 1px solid var(--border); }
  .card-body { padding: 16px; }
  .bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; font-size: 13px; }
  .bar-row .name { width: 72px; flex: none; }
  .bar-track { flex: 1; height: 18px; background: #eef1f5; border-radius: 999px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 999px; transition: width .4s ease; }
  .bar-val { width: 118px; flex: none; font-size: 12px; color: var(--muted); text-align: right; }
  .status-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 18px; }
  .status-cell { border: 1px solid var(--border); border-radius: 8px; padding: 12px; text-align: center; }
  .status-cell .n { font-size: 22px; font-weight: 700; }
  .status-cell .t { font-size: 11.5px; color: var(--muted); margin-top: 2px; }
  .rework-list { font-size: 12.5px; line-height: 1.9; }
  .rework-list .code { color: var(--muted); margin-right: 6px; }
  .empty { color: var(--muted); font-size: 12.5px; text-align: center; padding: 26px 0; }
`;

const STATUS_COLORS: Record<JobStatus, string> = {
  pending: '#8aa0ad', assigned: '#2f7ed8', submitted: '#f5a623',
  rejected: '#e5484d', done: '#35a86b'
};

/** 界面四：完成量看板与返工率统计 */
export class ViewBoard extends HTMLElement {
  private unsub: (() => void) | null = null;

  connectedCallback(): void {
    this.render();
    this.unsub = store.subscribe(() => this.render());
  }
  disconnectedCallback(): void { this.unsub?.(); }

  private render(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    const stats = store.stats();
    const statusOrder: JobStatus[] = ['pending', 'assigned', 'submitted', 'rejected', 'done'];
    const reworked = store.jobs.filter((j) => j.reworkCount > 0)
      .sort((a, b) => b.reworkCount - a.reworkCount);

    root.innerHTML = `
      <style>${sharedCss}${pageCss}</style>
      <div class="page">
        <div class="page-head">
          <h2>完成量看板</h2>
          <p>按工单全生命周期统计完成量、返工率，并拆分到每位师傅。</p>
        </div>

        <div class="kpi-row">
          <div class="kpi primary"><div class="num">${stats.total}</div><div class="lbl">工单总量</div></div>
          <div class="kpi ok"><div class="num">${stats.done}</div><div class="lbl">已完成（入库）</div></div>
          <div class="kpi warn"><div class="num">${(stats.completionRate * 100).toFixed(0)}%</div><div class="lbl">整体完成率</div></div>
          <div class="kpi danger"><div class="num">${(stats.reworkRate * 100).toFixed(0)}%</div><div class="lbl">返工率（发生过打回的工单占比）</div></div>
        </div>

        <div class="status-grid">
          ${statusOrder.map((s) => `
            <div class="status-cell">
              <div class="n" style="color:${STATUS_COLORS[s]}">${store.jobs.filter((j) => j.status === s).length}</div>
              <div class="t">${store.statusLabel(s)}</div>
            </div>`).join('')}
        </div>

        <div class="grid2">
          <section class="card">
            <div class="card-head">各师傅完成情况</div>
            <div class="card-body">
              ${stats.byMaster.every((m) => m.total === 0)
                ? `<div class="empty">暂无派工数据</div>`
                : stats.byMaster.map((m) => {
                  const rate = m.total ? m.done / m.total : 0;
                  return `
                    <div class="bar-row">
                      <span class="name">${m.name}</span>
                      <div class="bar-track">
                        <div class="bar-fill" style="width:${(rate * 100).toFixed(1)}%;background:${STATUS_COLORS.done};"></div>
                      </div>
                      <span class="bar-val">完成 ${m.done}/${m.total} · 返工 ${m.rework} 次</span>
                    </div>`;
                }).join('')}
            </div>
          </section>

          <section class="card">
            <div class="card-head">返工工单明细</div>
            <div class="card-body">
              ${reworked.length === 0
                ? `<div class="empty">暂无返工工单，质量稳定 🎉</div>`
                : `<div class="rework-list">${reworked.map((j) => `
                    <div>
                      <span class="code">${j.code}</span>
                      <b>${j.title}</b>
                      <span style="color:var(--danger);margin-left:6px;">打回 ${j.reworkCount} 次</span>
                      <br><span class="code">最近意见：${escapeHtml(j.qcNote ?? '—')}</span>
                    </div>`).join('')}</div>`}
            </div>
          </section>
        </div>
      </div>`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}
