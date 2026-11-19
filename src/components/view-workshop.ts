import { store } from '../store';
import { toast } from '../toast';
import type { Job } from '../types';
import { sharedCss } from './shared-css';

const pageCss = `
  .page { padding: 18px 24px; height: 100%; overflow: auto; }
  .page-head h2 { margin: 0 0 4px; font-size: 18px; }
  .page-head p { margin: 0 0 16px; color: var(--muted); font-size: 12.5px; }
  .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
    box-shadow: var(--shadow); overflow: hidden; }
  .card-head { padding: 12px 16px; font-weight: 600; border-bottom: 1px solid var(--border);
    display: flex; justify-content: space-between; align-items: center; }
  .job-item { padding: 14px 16px; border-bottom: 1px solid var(--border); }
  .job-item:last-child { border-bottom: none; }
  .job-title { font-weight: 600; margin-bottom: 4px; display: flex; justify-content: space-between; gap: 8px; }
  .job-meta { font-size: 12px; color: var(--muted); line-height: 1.7; margin-bottom: 10px; }
  .job-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .empty { color: var(--muted); font-size: 12.5px; text-align: center; padding: 26px 0; }
  select { min-width: 130px; }
`;

/** 界面三：师傅工作台（领取后制作、提交/返工）+ 质检抽查（通过/打回） */
export class ViewWorkshop extends HTMLElement {
  private unsub: (() => void) | null = null;

  connectedCallback(): void {
    this.render();
    this.unsub = store.subscribe(() => this.render());
  }
  disconnectedCallback(): void { this.unsub?.(); }

  private render(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    // 师傅视角：已分派 + 已打回；质检视角：待质检
    const masterJobs = store.jobs.filter((j) =>
      j.status === 'assigned' || j.status === 'rejected');
    const qcJobs = store.jobs.filter((j) => j.status === 'submitted');
    root.innerHTML = `
      <style>${sharedCss}${pageCss}</style>
      <div class="page">
        <div class="page-head">
          <h2>师傅工作台 · 质检抽查</h2>
          <p>左侧为师傅的制作任务与返工单，右侧为待质检工单；抽查不合格需填写意见后打回。</p>
        </div>
        <div class="columns">
          <section class="card">
            <div class="card-head">师傅制作任务 <span class="stat-pill">${masterJobs.length} 单</span></div>
            <div>
              ${masterJobs.length === 0 ? `<div class="empty">暂无制作任务</div>`
                : masterJobs.map((j) => this.masterCard(j)).join('')}
            </div>
          </section>
          <section class="card">
            <div class="card-head">质检待抽查 <span class="stat-pill">${qcJobs.length} 单</span></div>
            <div>
              ${qcJobs.length === 0 ? `<div class="empty">暂无待质检工单</div>`
                : qcJobs.map((j) => this.qcCard(j)).join('')}
            </div>
          </section>
        </div>
      </div>`;

    root.querySelectorAll<HTMLElement>('[data-submit]').forEach((b) =>
      b.addEventListener('click', () => {
        store.submitJob(b.dataset.submit!);
        toast('已提交，等待质检抽查');
      }));
    root.querySelectorAll<HTMLElement>('[data-resubmit]').forEach((b) =>
      b.addEventListener('click', () => {
        store.resubmitJob(b.dataset.resubmit!);
        toast('返工完成，已重新提交质检');
      }));
    root.querySelectorAll<HTMLElement>('[data-pass]').forEach((b) =>
      b.addEventListener('click', () => this.openQcModal(b.dataset.pass!, true)));
    root.querySelectorAll<HTMLElement>('[data-reject]').forEach((b) =>
      b.addEventListener('click', () => this.openQcModal(b.dataset.reject!, false)));
  }

  private masterCard(j: Job): string {
    return `
      <div class="job-item">
        <div class="job-title">
          <span>${j.title}</span>
          <span class="badge ${j.status}">${store.statusLabel(j.status)}</span>
        </div>
        <div class="job-meta">
          ${j.code} · ${store.masterName(j.master)}<br>
          ${escapeHtml(j.requirement)}<br>
          ${j.reworkCount > 0 ? `返工 <b style="color:var(--danger)">${j.reworkCount}</b> 次 · 上次意见：${escapeHtml(j.qcNote ?? '')}` : '首次制作'}
        </div>
        <div class="job-actions">
          ${j.status === 'rejected'
            ? `<button class="primary" data-resubmit="${j.id}">返工完成，重新提交</button>`
            : `<button class="primary" data-submit="${j.id}">制作完成，提交质检</button>`}
        </div>
      </div>`;
  }

  private qcCard(j: Job): string {
    return `
      <div class="job-item">
        <div class="job-title">
          <span>${j.title}</span>
          <span class="badge submitted">待质检</span>
        </div>
        <div class="job-meta">
          ${j.code} · 师傅：${store.masterName(j.master)} · 已提交 ${1 + j.reworkCount} 次
        </div>
        <div class="job-actions">
          <button data-pass="${j.id}">抽查合格</button>
          <button class="danger" data-reject="${j.id}">不合格，打回</button>
        </div>
      </div>`;
  }

  private openQcModal(jobId: string, pass: boolean): void {
    const job = store.jobs.find((j) => j.id === jobId);
    if (!job) return;
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal">
        <h3>质检${pass ? '合格确认' : '打回单'} · ${job.code}</h3>
        <p style="color:var(--muted);font-size:12.5px;">
          工单：${escapeHtml(job.title)}<br>师傅：${store.masterName(job.master)}
          ${pass ? '' : '<br>打回后工单回到师傅工作台，需返工后重新提交。'}
        </p>
        <div class="field">
          <label>${pass ? '质检备注（可选）' : '不合格原因 / 整改要求（必填）'}</label>
          <textarea id="qc-note" placeholder="${pass ? '抽查项与结论…' : '如：枯木固定不牢、苔藓覆盖不足、水盆渗漏…'}"></textarea>
        </div>
        <div class="modal-actions">
          <button data-close>取消</button>
          <button class="${pass ? 'primary' : 'danger'}" data-ok>${pass ? '确认合格入库' : '确认打回'}</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    mask.querySelector('[data-close]')!.addEventListener('click', () => mask.remove());
    mask.addEventListener('click', (e) => { if (e.target === mask) mask.remove(); });
    mask.querySelector('[data-ok]')!.addEventListener('click', () => {
      const note = (mask.querySelector('#qc-note') as HTMLTextAreaElement).value.trim();
      if (!pass && !note) { toast('打回必须填写整改要求', 'error'); return; }
      store.reviewJob(jobId, pass, note || (pass ? '抽查合格' : ''));
      mask.remove();
      toast(pass ? '质检通过，工单入库' : '已打回师傅返工', pass ? 'info' : 'error');
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}
