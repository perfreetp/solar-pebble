// 项目页：展项条目列表、截止时间、退回上限、审核/打包交付
import { BaseComponent, toast } from './base';
import { store } from '../core/store';
import {
  LAYER_GROUP_LABELS, STATUS_LABELS, type EntryStatus, type Project,
} from '../core/types';

export class ProjectPage extends BaseComponent {
  protected render(): string {
    const now = Date.now();
    const rows = store.projects
      .map((p) => {
        const deadlineMs = new Date(p.deadline).getTime();
        const days = Math.ceil((deadlineMs - now) / 86400000);
        const overdue = days < 0 && p.status !== 'delivered';
        const dueText = p.deadline.slice(0, 10) +
          (p.status === 'delivered' ? '' : overdue ? `（逾期 ${-days} 天）` : `（剩 ${days} 天）`);
        const voxelCount = p.layers.reduce((n, l) => n + l.voxels.size, 0);
        return `
          <tr data-id="${p.id}">
            <td><b>${p.code}</b></td>
            <td>${p.name}</td>
            <td>${p.owner}</td>
            <td class="${overdue ? 'overdue' : ''}">${dueText}</td>
            <td><span class="tag ${p.status}">${STATUS_LABELS[p.status]}</span></td>
            <td>${p.returns}/${p.maxReturns}${p.status === 'locked' ? ' 🔒' : ''}</td>
            <td>${voxelCount}</td>
            <td class="actions">
              <button data-act="open" ${p.status === 'locked' || p.status === 'delivered' ? 'disabled' : ''}>打开建模</button>
              <button data-act="preview">成品预览</button>
            </td>
          </tr>`;
      })
      .join('');

    return `
      <style>${this.css()}</style>
      <header class="topbar">
        <div class="brand">🚀 运载火箭体素建模工作台</div>
        <div class="sub">展项条目 · 截止与退回管控 · WebGPU 体素建模</div>
      </header>
      <main class="content">
        <div class="panel">
          <div class="panel-head">
            <h2>展项条目</h2>
            <button class="primary" id="newBtn">＋ 新建条目</button>
          </div>
          <table class="grid">
            <thead>
              <tr>
                <th>编号</th><th>展项名称</th><th>负责人</th><th>截止时间</th>
                <th>状态</th><th>退回次数</th><th>体素数</th><th>操作</th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="8" class="empty">暂无条目，点击右上角新建</td></tr>'}</tbody>
          </table>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>分组约定</h2></div>
          <div class="groups">
            ${Object.entries(LAYER_GROUP_LABELS).map(([k, v]) => `<span class="chip">${v}（${k}）</span>`).join('')}
          </div>
          <p class="hint">每个条目最多退回 <b>2</b> 次，达到上限自动锁定；主管审核通过后可打包交付给展陈方。</p>
        </div>
      </main>
    `;
  }

  protected afterRender(): void {
    this.$('#newBtn')?.addEventListener('click', () => this.openCreateDialog());
    this.shadow.querySelectorAll('tr[data-id]').forEach((tr) => {
      const id = (tr as HTMLElement).dataset.id!;
      tr.querySelector('[data-act="open"]')?.addEventListener('click', () => {
        store.openProject(id);
        this.dispatch('editor');
      });
      tr.querySelector('[data-act="preview"]')?.addEventListener('click', () => {
        store.openProject(id);
        this.dispatch('preview');
      });
    });
  }

  private dispatch(route: 'editor' | 'preview'): void {
    this.dispatchEvent(new CustomEvent('navigate', { bubbles: true, composed: true, detail: route }));
  }

  private openCreateDialog(): void {
    const dlg = document.createElement('dialog');
    const defaultDeadline = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    dlg.innerHTML = `
      <div class="dialog-head">新建展项条目</div>
      <div class="dialog-body">
        <div class="form-row"><label>展项名称</label><input id="f-name" placeholder="例如：长征八号演示火箭" /></div>
        <div class="form-row"><label>负责人</label><input id="f-owner" placeholder="制作员姓名" /></div>
        <div class="form-row"><label>截止时间</label><input id="f-deadline" type="date" value="${defaultDeadline}" /></div>
      </div>
      <div class="dialog-foot">
        <button id="f-cancel">取消</button>
        <button class="primary" id="f-ok">创建并进入建模</button>
      </div>`;
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector<HTMLButtonElement>('#f-cancel')!.onclick = () => dlg.close();
    dlg.querySelector<HTMLButtonElement>('#f-ok')!.onclick = () => {
      const name = dlg.querySelector<HTMLInputElement>('#f-name')!.value.trim();
      const owner = dlg.querySelector<HTMLInputElement>('#f-owner')!.value.trim() || '未指派';
      const deadline = dlg.querySelector<HTMLInputElement>('#f-deadline')!.value;
      if (!name) { toast('请填写展项名称'); return; }
      store.createProject(name, owner, deadline);
      dlg.close();
      this.dispatch('editor');
    };
    dlg.addEventListener('close', () => dlg.remove());
  }

  private css(): string {
    return `
      :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
      .topbar { padding: 18px 26px 14px; border-bottom: 1px solid var(--border); background: var(--bg-panel); }
      .brand { font-size: 18px; font-weight: 700; }
      .sub { color: var(--text-dim); margin-top: 4px; font-size: 12px; }
      .content { padding: 20px 26px; overflow: auto; display: flex; flex-direction: column; gap: 18px; }
      .panel { background: var(--bg-panel); border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; }
      .panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
      h2 { margin: 0; font-size: 15px; }
      table.grid { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--border); font-size: 12px; }
      th { color: var(--text-dim); font-weight: 600; }
      td.overdue { color: var(--danger); font-weight: 600; }
      td.actions { display: flex; gap: 8px; }
      .empty { text-align: center; color: var(--text-dim); padding: 28px; }
      .chip { display: inline-block; padding: 4px 12px; margin-right: 8px; border: 1px solid var(--border);
        border-radius: 14px; color: var(--text-dim); font-size: 12px; }
      .hint { color: var(--text-dim); font-size: 12px; }
      .form-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
      .form-row label { width: 72px; color: var(--text-dim); }
      .form-row input { flex: 1; }
    `;
  }
}

export function statusFlowLabel(s: EntryStatus): string {
  return STATUS_LABELS[s];
}

export type { Project };
