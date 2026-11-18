import { createProject, deleteProject, getSession, listProjects, listShots } from '../store';
import { projectStatus, statusBadgeClass } from '../types';
import { deadlineText, h } from './dom';

/** 界面 1:项目列表 + 客户下单 */
export class ProjectsPage extends HTMLElement {
  connectedCallback(): void { this.render(); }

  private render(): void {
    const session = getSession();
    const projects = listProjects();
    this.textContent = '';

    const page = h('div', { class: 'page' },
      h('h2', {}, '小天体体素建模 · 项目制交付'),
      h('p', { class: 'sub' }, '客户下单建项目 → 制作员按镜头分头建模 → 主管审核 → 打包交付'),
    );

    // 客户下单表单
    if (session.role === 'customer') {
      const nameIn = h('input', { placeholder: '如:灵神星探测任务概念建模' }) as HTMLInputElement;
      const briefIn = h('textarea', { rows: '3', placeholder: '任务背景、目标小天体、外形要求、用途镜头等' }) as HTMLTextAreaElement;
      const deadlineIn = h('input', { type: 'date', value: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10) }) as HTMLInputElement;
      const limitIn = h('input', { type: 'number', value: '60000', min: '1000', step: '1000' }) as HTMLInputElement;
      const facesIn = h('input', { type: 'number', value: '20000', min: '100', step: '100' }) as HTMLInputElement;
      const gridSel = h('select', {},
        h('option', { value: '32' }, '32³(轻量)'),
        h('option', { value: '48' }, '48³(中等)'),
        h('option', { value: '64', selected: true }, '64³(精细)'),
      ) as HTMLSelectElement;
      const err = h('p', { class: 'danger-text' });
      page.append(
        h('div', { class: 'panel' },
          h('h3', {}, '新建项目(客户下单)'),
          h('div', { class: 'form-grid' },
            h('label', { class: 'field' }, '项目名称', nameIn),
            h('label', { class: 'field' }, '截止时间', deadlineIn),
            h('label', { class: 'field' }, '体素上限', limitIn),
            h('label', { class: 'field' }, '减面目标面数', facesIn),
            h('label', { class: 'field' }, '体素网格规格', gridSel),
          ),
          h('div', { style: 'margin:10px 0' },
            h('label', { class: 'field' }, '需求描述', briefIn),
          ),
          err,
          h('button', {
            class: 'accent',
            onclick: () => {
              const name = nameIn.value.trim();
              if (!name) { err.textContent = '请填写项目名称'; return; }
              createProject({
                name, customer: session.userName, brief: briefIn.value.trim(),
                deadline: deadlineIn.value || new Date().toISOString().slice(0, 10),
                voxelLimit: Math.max(1000, +limitIn.value || 60000),
                targetFaces: Math.max(100, +facesIn.value || 20000),
                gridSize: +gridSel.value,
              });
              this.render();
            },
          }, '提交订单,创建项目'),
        ),
      );
    } else {
      page.append(h('p', { class: 'muted' }, `当前角色:${session.role === 'supervisor' ? '主管' : '制作员'}。新建项目请切换到「客户」角色。`));
    }

    // 项目列表
    if (projects.length === 0) {
      page.append(h('div', { class: 'panel empty-tip' }, '暂无项目,请先下单创建。'));
    } else {
      const rows = projects.map(p => {
        const shots = listShots(p.id);
        const st = projectStatus(p, shots);
        const dl = deadlineText(p.deadline);
        return h('tr', {},
          h('td', {}, h('a', { href: `#/project/${p.id}`, style: 'color:var(--accent-2)' }, p.name)),
          h('td', {}, p.customer),
          h('td', { class: dl.overdue && !p.delivered ? 'overdue' : '' }, dl.text),
          h('td', {}, String(p.voxelLimit)),
          h('td', {}, String(p.targetFaces)),
          h('td', {}, `${shots.length} 个`),
          h('td', {}, h('span', { class: `badge ${statusBadgeClass(st)}` }, st)),
          h('td', {}, p.reworkCount > 0 ? h('span', { class: 'warn-text' }, `${p.reworkCount} 次`) : '0'),
          h('td', { class: 'row' },
            h('button', { onclick: () => { location.hash = `#/project/${p.id}`; } }, '打开'),
            h('button', {
              class: 'danger',
              onclick: () => {
                if (confirm(`删除项目「${p.name}」及其全部镜头?`)) { deleteProject(p.id); this.render(); }
              },
            }, '删除'),
          ),
        );
      });
      page.append(
        h('div', { class: 'panel' },
          h('h3', {}, `项目列表(${projects.length})`),
          h('table', {},
            h('tr', {},
              h('th', {}, '项目名称'), h('th', {}, '客户'), h('th', {}, '截止时间'),
              h('th', {}, '体素上限'), h('th', {}, '目标面数'), h('th', {}, '镜头'),
              h('th', {}, '状态'), h('th', {}, '返工'), h('th', {}, '操作'),
            ),
            ...rows,
          ),
        ),
      );
    }
    this.append(page);
  }
}
customElements.define('projects-page', ProjectsPage);
