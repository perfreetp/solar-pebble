import { createShot, deleteShot, getProject, getSession, listShots, updateShot } from '../store';
import { projectStatus, statusBadgeClass } from '../types';
import { deadlineText, fmtDate, h } from './dom';

/** 界面 2:项目详情 — 镜头任务拆分与分配 */
export class ProjectDetailPage extends HTMLElement {
  projectId = '';

  connectedCallback(): void { this.render(); }

  private render(): void {
    this.textContent = '';
    const p = getProject(this.projectId);
    if (!p) {
      this.append(h('div', { class: 'page' }, h('p', { class: 'danger-text' }, '项目不存在。'), h('a', { href: '#/projects' }, '返回列表')));
      return;
    }
    const session = getSession();
    const shots = listShots(p.id);
    const st = projectStatus(p, shots);
    const dl = deadlineText(p.deadline);

    const page = h('div', { class: 'page' },
      h('p', {}, h('a', { href: '#/projects', style: 'color:var(--accent-2)' }, '← 返回项目列表')),
      h('h2', {}, p.name, ' ', h('span', { class: `badge ${statusBadgeClass(st)}` }, st)),
      h('p', { class: 'sub' }, p.brief || '(无需求描述)'),
      h('div', { class: 'stat-grid' },
        h('div', { class: 'stat-card' }, h('div', { class: 'k' }, '客户'), h('div', { class: 'v' }, p.customer)),
        h('div', { class: 'stat-card' }, h('div', { class: 'k' }, '截止时间'), h('div', { class: `v ${dl.overdue && !p.delivered ? 'overdue' : ''}` }, dl.text)),
        h('div', { class: 'stat-card' }, h('div', { class: 'k' }, '体素上限'), h('div', { class: 'v' }, String(p.voxelLimit))),
        h('div', { class: 'stat-card' }, h('div', { class: 'k' }, '目标面数'), h('div', { class: 'v' }, String(p.targetFaces))),
        h('div', { class: 'stat-card' }, h('div', { class: 'k' }, '网格规格'), h('div', { class: 'v' }, `${p.gridSize}³`)),
        h('div', { class: 'stat-card' }, h('div', { class: 'k' }, '返工次数'), h('div', { class: `v ${p.reworkCount > 0 ? 'warn-text' : ''}` }, String(p.reworkCount))),
      ),
    );

    // 添加镜头(客户/主管)
    if (session.role !== 'worker') {
      const nameIn = h('input', { placeholder: '如:全景环绕镜头 / 表面特写镜头' }) as HTMLInputElement;
      const assigneeIn = h('input', { placeholder: '制作员姓名', value: '' }) as HTMLInputElement;
      page.append(
        h('div', { class: 'panel' },
          h('h3', {}, '拆分镜头任务'),
          h('div', { class: 'row' },
            nameIn, assigneeIn,
            h('button', {
              class: 'primary',
              onclick: () => {
                const name = nameIn.value.trim();
                if (!name) return;
                createShot(p.id, name, assigneeIn.value.trim() || '未分配');
                this.render();
              },
            }, '添加镜头'),
          ),
        ),
      );
    }

    // 镜头列表
    const rows = shots.map(s => {
      const canEdit = session.role !== 'customer';
      const canSubmit = session.role === 'worker' && (s.status === '未开始' || s.status === '制作中' || s.status === '退回修改');
      return h('tr', {},
        h('td', {}, s.name),
        h('td', {}, s.assignee),
        h('td', {}, h('span', { class: `badge ${statusBadgeClass(s.status)}` }, s.status)),
        h('td', { class: s.voxelCount > p.voxelLimit ? 'danger-text' : '' }, `${s.voxelCount} / ${p.voxelLimit}`),
        h('td', {}, s.reviewComment ? h('span', { class: 'danger-text' }, s.reviewComment) : h('span', { class: 'muted' }, '—')),
        h('td', { class: 'muted' }, fmtDate(s.updatedAt)),
        h('td', { class: 'row' },
          canEdit ? h('button', { class: 'primary', onclick: () => { location.hash = `#/editor/${s.id}`; } }, '进入建模') : null,
          canSubmit ? h('button', {
            onclick: () => {
              s.status = '待审核';
              updateShot(s);
              this.render();
            },
          }, '提交审核') : null,
          session.role !== 'worker' ? h('button', {
            class: 'danger',
            onclick: () => {
              if (confirm(`删除镜头「${s.name}」?体素数据将一并删除。`)) { deleteShot(s.id); this.render(); }
            },
          }, '删除') : null,
        ),
      );
    });

    page.append(
      h('div', { class: 'panel' },
        h('h3', {}, `镜头任务(${shots.length})`),
        shots.length === 0
          ? h('p', { class: 'muted' }, '暂无镜头,请先拆分任务。')
          : h('table', {},
              h('tr', {},
                h('th', {}, '镜头'), h('th', {}, '制作员'), h('th', {}, '状态'),
                h('th', {}, '体素量'), h('th', {}, '审核意见'), h('th', {}, '更新时间'), h('th', {}, '操作'),
              ),
              ...rows,
            ),
      ),
      h('div', { class: 'row' },
        h('button', { class: 'accent', onclick: () => { location.hash = `#/review/${p.id}`; } }, '前往审核与交付 →'),
        session.role === 'supervisor' ? null : h('span', { class: 'muted' }, '(审核与交付由主管操作)'),
      ),
    );
    this.append(page);
  }
}
customElements.define('project-detail-page', ProjectDetailPage);
