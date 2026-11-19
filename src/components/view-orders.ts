import { CATALOG, KIND_LABEL } from '../catalog';
import { store } from '../store';
import { toast } from '../toast';
import type { ComponentKind, Job } from '../types';
import { sharedCss } from './shared-css';

const pageCss = `
  .page { padding: 18px 24px; height: 100%; overflow: auto; }
  .page-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .page-head h2 { margin: 0; font-size: 18px; }
  .page-head p { margin: 4px 0 0; color: var(--muted); font-size: 12.5px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
    box-shadow: var(--shadow); overflow: hidden; }
  .snapshot { display: flex; flex-wrap: wrap; gap: 6px; }
  .snapshot .chip { background: #f0f5fc; color: var(--primary-dark); border-radius: 6px;
    padding: 2px 8px; font-size: 12px; }
  .master-tag { font-size: 12px; }
  .assign-row { display: flex; gap: 8px; align-items: center; }
  textarea { resize: vertical; min-height: 84px; }
  .timeline { font-size: 12px; color: var(--muted); line-height: 1.8; margin: 0; padding-left: 16px; }
`;

/** 界面二：前台接单（录入需求）+ 派工给师傅 */
export class ViewOrders extends HTMLElement {
  private unsub: (() => void) | null = null;

  connectedCallback(): void {
    this.render();
    this.unsub = store.subscribe(() => this.render());
  }
  disconnectedCallback(): void { this.unsub?.(); }

  private render(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${sharedCss}${pageCss}</style>
      <div class="page">
        <div class="page-head">
          <div>
            <h2>前台接单 · 派工调度</h2>
            <p>录入展陈需求并对当前三维场景快照下单，再分派给对应工种的师傅。</p>
          </div>
          <button class="primary" id="new-order">＋ 新建工单</button>
        </div>
        <div class="card">
          <table>
            <thead><tr>
              <th>工单号</th><th>标题</th><th>场景物料</th><th>负责师傅</th>
              <th>状态</th><th>打回</th><th>操作</th>
            </tr></thead>
            <tbody>
              ${store.jobs.length === 0 ? `<tr><td colspan="7" class="empty" style="padding:28px;">暂无工单，点击右上角「新建工单」</td></tr>`
                : store.jobs.map((j) => this.rowHtml(j)).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
    root.querySelector('#new-order')!.addEventListener('click', () => this.openCreateModal());
    root.querySelectorAll<HTMLElement>('[data-assign]').forEach((b) =>
      b.addEventListener('click', () => this.openAssignModal(b.dataset.assign!)));
    root.querySelectorAll<HTMLElement>('[data-detail]').forEach((b) =>
      b.addEventListener('click', () => this.openDetailModal(b.dataset.detail!)));
  }

  private rowHtml(j: Job): string {
    const counts = this.snapshotCounts(j.sceneSnapshot);
    return `
      <tr>
        <td><b>${j.code}</b><br><small style="color:var(--muted)">${fmtTime(j.createdAt)}</small></td>
        <td style="max-width:180px;">${j.title}<br><small style="color:var(--muted);">${escapeHtml(j.requirement.slice(0, 40))}${j.requirement.length > 40 ? '…' : ''}</small></td>
        <td><div class="snapshot">${[...counts.entries()].map(([k, n]) =>
          `<span class="chip">${KIND_LABEL[k]} ×${n}</span>`).join('')}</div></td>
        <td class="master-tag">${j.master ? store.masterName(j.master) : '<span style="color:var(--warn)">未分派</span>'}</td>
        <td><span class="badge ${j.status}">${store.statusLabel(j.status)}</span></td>
        <td>${j.reworkCount > 0 ? `<b style="color:var(--danger)">${j.reworkCount} 次</b>` : '—'}</td>
        <td>
          ${j.status === 'pending'
            ? `<button class="primary" data-assign="${j.id}">分派</button>`
            : `<button data-detail="${j.id}">详情</button>`}
        </td>
      </tr>`;
  }

  private snapshotCounts(json: string): Map<ComponentKind, number> {
    const map = new Map<ComponentKind, number>();
    try {
      for (const c of JSON.parse(json) as { kind: ComponentKind }[]) {
        map.set(c.kind, (map.get(c.kind) ?? 0) + 1);
      }
    } catch { /* 快照损坏时忽略 */ }
    return map;
  }

  private openCreateModal(): void {
    if (store.components.length === 0) {
      toast('当前场景为空，请先在编辑器中布置构件', 'error');
      return;
    }
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal">
        <h3>新建工单</h3>
        <div class="field"><label>工单标题</label>
          <input id="m-title" placeholder="如：热带雨林主题 2 号展箱造景" value="昆虫生态展箱造景工单">
        </div>
        <div class="field"><label>展陈需求说明</label>
          <textarea id="m-req" placeholder="记录虫种、温湿度、造景风格、交付时间等要求…"></textarea>
        </div>
        <div class="field"><label>随单场景物料快照（取自当前编辑器）</label>
          <div class="snapshot">${CATALOG.map((c) => {
            const n = store.components.filter((x) => x.kind === c.kind).length;
            return n ? `<span class="chip">${c.label} ×${n}</span>` : '';
          }).join('')}</div>
        </div>
        <div class="modal-actions">
          <button data-close>取消</button>
          <button class="primary" data-ok>创建并进入待分派</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    mask.querySelector('[data-close]')!.addEventListener('click', () => mask.remove());
    mask.addEventListener('click', (e) => { if (e.target === mask) mask.remove(); });
    mask.querySelector('[data-ok]')!.addEventListener('click', () => {
      const title = (mask.querySelector('#m-title') as HTMLInputElement).value.trim();
      const requirement = (mask.querySelector('#m-req') as HTMLTextAreaElement).value.trim();
      if (!title) { toast('请填写工单标题', 'error'); return; }
      store.createJob(title, requirement || '（无附加要求）');
      mask.remove();
      toast('工单已创建，等待分派');
    });
  }

  private openAssignModal(jobId: string): void {
    const job = store.jobs.find((j) => j.id === jobId);
    if (!job) return;
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal">
        <h3>分派工单 · ${job.code}</h3>
        <p style="color:var(--muted);font-size:12.5px;">${escapeHtml(job.title)} — ${escapeHtml(job.requirement)}</p>
        <div class="field"><label>选择负责师傅</label>
          <select id="m-master">
            ${store.masters.map((m) => `<option value="${m.id}">${m.name}（${m.role}）</option>`).join('')}
          </select>
        </div>
        <div class="modal-actions">
          <button data-close>取消</button>
          <button class="primary" data-ok>确认分派</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    mask.querySelector('[data-close]')!.addEventListener('click', () => mask.remove());
    mask.addEventListener('click', (e) => { if (e.target === mask) mask.remove(); });
    mask.querySelector('[data-ok]')!.addEventListener('click', () => {
      const masterId = (mask.querySelector('#m-master') as HTMLSelectElement).value;
      store.assignJob(jobId, masterId);
      mask.remove();
      toast(`已分派给${store.masterName(masterId)}`);
    });
  }

  private openDetailModal(jobId: string): void {
    const job = store.jobs.find((j) => j.id === jobId);
    if (!job) return;
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal">
        <h3>${job.code} · 工单详情</h3>
        <p><b>${escapeHtml(job.title)}</b></p>
        <p style="color:var(--muted);font-size:12.5px;line-height:1.7;">${escapeHtml(job.requirement)}</p>
        <p>状态：<span class="badge ${job.status}">${store.statusLabel(job.status)}</span>
           师傅：${store.masterName(job.master)} · 打回 ${job.reworkCount} 次</p>
        ${job.qcNote ? `<p style="font-size:12.5px;">最近质检意见：<b style="color:var(--danger)">${escapeHtml(job.qcNote)}</b></p>` : ''}
        <div class="field"><label>流转记录</label>
          <ul class="timeline">${job.timeline.map((t) => `<li>${fmtTime(t.t)} — ${escapeHtml(t.text)}</li>`).join('')}</ul>
        </div>
        <div class="modal-actions"><button data-close class="primary">关闭</button></div>
      </div>`;
    document.body.appendChild(mask);
    mask.querySelector('[data-close]')!.addEventListener('click', () => mask.remove());
    mask.addEventListener('click', (e) => { if (e.target === mask) mask.remove(); });
  }
}

function fmtTime(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}
