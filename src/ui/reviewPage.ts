import { decodeVoxels, getProject, getSession, listShots, save, updateProject, updateShot } from '../store';
import { projectStatus, statusBadgeClass, type Project, type Shot } from '../types';
import { deadlineText, fmtDate, h } from './dom';
import { VoxelGrid } from '../voxel/grid';
import { buildMesh } from '../voxel/mesher';
import { decimateMesh } from '../voxel/decimate';
import { createZip, download, meshToOBJ } from '../voxel/exporter';

/** 在 2D canvas 上画体素模型的斜二测投影预览 */
function drawVoxelPreview(canvas: HTMLCanvasElement, grid: VoxelGrid): void {
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const s = grid.size;
  const b = grid.bounds();
  if (!b) {
    ctx.fillStyle = '#5a6475';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('(空模型)', W / 2, H / 2);
    return;
  }
  // 投影:screenX = (x - y)·cos30, screenY = (x + y)·sin30·0.5 - z
  const cos30 = 0.866, sin30 = 0.5;
  const proj = (x: number, y: number, z: number): [number, number] => [
    (x - y) * cos30,
    (x + y) * sin30 * 0.5 - z,
  ];
  const c0 = proj(b.min[0], b.min[1], b.max[2]);
  const c1 = proj(b.max[0], b.max[1], b.min[2]);
  const c2 = proj(b.min[0], b.max[1], b.min[2]);
  const c3 = proj(b.max[0], b.min[1], b.min[2]);
  const minX = Math.min(c0[0], c1[0], c2[0], c3[0]), maxX = Math.max(c0[0], c1[0], c2[0], c3[0]);
  const minY = Math.min(c0[1], c1[1], c2[1], c3[1]), maxY = Math.max(c0[1], c1[1], c2[1], c3[1]);
  const scale = Math.min((W - 20) / (maxX - minX || 1), (H - 20) / (maxY - minY || 1));
  const ox = (W - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = (H - (maxY - minY) * scale) / 2 - minY * scale;
  const px = Math.max(1, scale * 0.9);

  // 只画表面体素,按深度排序(远的先画)
  const surf: { x: number; y: number; z: number; d: number }[] = [];
  for (let z = 0; z < s; z++) for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    if (!grid.get(x, y, z)) continue;
    if (grid.get(x+1,y,z) && grid.get(x-1,y,z) && grid.get(x,y+1,z) &&
        grid.get(x,y-1,z) && grid.get(x,y,z+1) && grid.get(x,y,z-1)) continue;
    surf.push({ x, y, z, d: x + y + z });
  }
  surf.sort((a, bb) => bb.d - a.d);
  for (const v of surf) {
    const [sx, sy] = proj(v.x, v.y, v.z);
    const t = v.z / (s - 1);
    const r = Math.round(82 + t * 100), g = Math.round(69 + t * 96), bl = Math.round(59 + t * 88);
    ctx.fillStyle = `rgb(${r},${g},${bl})`;
    ctx.fillRect(ox + sx * scale, oy + sy * scale, px, px);
  }
}

/** 界面 4:主管审核与打包交付 */
export class ReviewPage extends HTMLElement {
  projectId = '';

  connectedCallback(): void { this.render(); }

  private render(): void {
    this.textContent = '';
    const p = getProject(this.projectId);
    if (!p) {
      this.append(h('div', { class: 'page' }, h('p', { class: 'danger-text' }, '项目不存在。')));
      return;
    }
    const session = getSession();
    const isSupervisor = session.role === 'supervisor';
    const shots = listShots(p.id);
    const st = projectStatus(p, shots);
    const dl = deadlineText(p.deadline);
    const allPassed = shots.length > 0 && shots.every(s => s.status === '已通过');

    const page = h('div', { class: 'page' },
      h('p', {}, h('a', { href: `#/project/${p.id}`, style: 'color:var(--accent-2)' }, `← 返回项目`)),
      h('h2', {}, `审核与交付 · ${p.name}`, ' ', h('span', { class: `badge ${statusBadgeClass(st)}` }, st)),
      h('div', { class: 'stat-grid' },
        h('div', { class: 'stat-card' }, h('div', { class: 'k' }, '截止时间'), h('div', { class: `v ${dl.overdue && !p.delivered ? 'overdue' : ''}` }, dl.text)),
        h('div', { class: 'stat-card' }, h('div', { class: 'k' }, '返工次数'), h('div', { class: `v ${p.reworkCount > 0 ? 'warn-text' : ''}` }, String(p.reworkCount))),
        h('div', { class: 'stat-card' }, h('div', { class: 'k' }, '镜头通过'), h('div', { class: 'v' }, `${shots.filter(s => s.status === '已通过').length} / ${shots.length}`)),
        h('div', { class: 'stat-card' }, h('div', { class: 'k' }, '目标面数'), h('div', { class: 'v' }, String(p.targetFaces))),
        p.delivered && p.deliveredAt
          ? h('div', { class: 'stat-card' }, h('div', { class: 'k' }, '交付时间'), h('div', { class: 'v ok-text' }, fmtDate(p.deliveredAt)))
          : null,
      ),
    );

    if (!isSupervisor) {
      page.append(h('p', { class: 'warn-text' }, '当前不是主管角色,仅可查看。审核与交付操作请切换到「主管」角色。'));
    }

    // 镜头审核卡片
    const cards = shots.map(s => this.shotCard(p, s, isSupervisor));
    page.append(
      h('div', { class: 'panel' },
        h('h3', {}, '镜头审核'),
        shots.length === 0 ? h('p', { class: 'muted' }, '暂无镜头。') : h('div', { class: 'shot-cards' }, ...cards),
      ),
    );

    // 交付区
    const deliverPanel = h('div', { class: 'panel' },
      h('h3', {}, '打包交付'),
      p.delivered
        ? h('p', { class: 'ok-text' }, `✔ 已于 ${fmtDate(p.deliveredAt!)} 交付。`)
        : allPassed
          ? h('p', { class: 'muted' }, '全部镜头已通过审核,可打包交付(含各镜头减面 OBJ 模型与交付清单)。')
          : h('p', { class: 'muted' }, '全部镜头审核通过后才能打包交付。'),
      isSupervisor && !p.delivered
        ? h('button', {
            class: 'accent',
            disabled: !allPassed,
            onclick: () => this.deliver(p, shots),
          }, '打包并交付(下载 ZIP)')
        : null,
    );
    page.append(deliverPanel);
    this.append(page);
  }

  private shotCard(p: Project, s: Shot, isSupervisor: boolean): HTMLElement {
    const grid = new VoxelGrid(p.gridSize, decodeVoxels(s.voxelData, p.gridSize));
    const canvas = h('canvas', { width: '300', height: '200' }) as HTMLCanvasElement;
    drawVoxelPreview(canvas, grid);
    const over = s.voxelCount > p.voxelLimit;

    const commentArea = h('textarea', { rows: '2', placeholder: '退回原因 / 问题说明(必填)', style: 'width:100%;display:none' }) as HTMLTextAreaElement;
    const confirmRow = h('div', { class: 'row', style: 'display:none;margin-top:6px' });
    const err = h('span', { class: 'danger-text', style: 'font-size:12px' });

    const card = h('div', { class: 'shot-card' },
      h('h4', {}, s.name, h('span', { class: `badge ${statusBadgeClass(s.status)}` }, s.status)),
      canvas,
      h('div', { class: 'kv' }, h('span', { class: 'k' }, '制作员'), h('span', {}, s.assignee)),
      h('div', { class: 'kv' }, h('span', { class: 'k' }, '体素量'),
        h('span', { class: over ? 'danger-text' : '' }, `${s.voxelCount} / ${p.voxelLimit}${over ? '(超限)' : ''}`)),
      h('div', { class: 'kv' }, h('span', { class: 'k' }, '更新时间'), h('span', { class: 'muted' }, fmtDate(s.updatedAt))),
      s.reviewComment ? h('div', { class: 'comment-box' }, `主管意见:${s.reviewComment}`) : null,
      isSupervisor && s.status === '待审核'
        ? h('div', { class: 'row', style: 'margin-top:8px' },
            h('button', {
              class: 'ok',
              onclick: () => {
                s.status = '已通过';
                s.reviewComment = '';
                updateShot(s);
                this.render();
              },
            }, '✔ 通过'),
            h('button', {
              class: 'danger',
              onclick: () => {
                commentArea.style.display = '';
                confirmRow.style.display = '';
              },
            }, '✘ 退回'),
          )
        : null,
      commentArea,
      h('div', { style: 'margin-top:4px' }, confirmRow, err),
    );

    confirmRow.append(
      h('button', {
        class: 'danger',
        onclick: () => {
          const text = commentArea.value.trim();
          if (!text) { err.textContent = '退回时必须写明问题'; return; }
          s.status = '退回修改';
          s.reviewComment = text;
          updateShot(s);
          p.reworkCount += 1;
          updateProject(p);
          this.render();
        },
      }, '确认退回'),
      h('button', { onclick: () => { commentArea.style.display = 'none'; confirmRow.style.display = 'none'; } }, '取消'),
    );
    return card;
  }

  /** 打包:每个镜头合并减面导出 OBJ + 交付清单 → ZIP */
  private deliver(p: Project, shots: Shot[]): void {
    const files = [];
    for (const s of shots) {
      const grid = new VoxelGrid(p.gridSize, decodeVoxels(s.voxelData, p.gridSize));
      const mesh = buildMesh(grid);
      const dec = decimateMesh(mesh.positions, mesh.indices, p.targetFaces);
      const obj = meshToOBJ(s.name.replace(/\s+/g, '_'), dec.positions, dec.indices);
      files.push({ name: `models/${s.name.replace(/[\\/:*?"<>|\s]+/g, '_')}.obj`, content: obj });
    }
    const manifest = {
      项目: p.name, 客户: p.customer, 需求: p.brief,
      截止时间: p.deadline, 交付时间: new Date().toISOString(),
      返工次数: p.reworkCount, 体素上限: p.voxelLimit, 目标面数: p.targetFaces,
      镜头: shots.map(s => ({ 名称: s.name, 制作员: s.assignee, 体素量: s.voxelCount })),
    };
    files.push({ name: '交付清单.json', content: JSON.stringify(manifest, null, 2) });
    download(`${p.name.replace(/[\\/:*?"<>|]/g, '_')}_交付包.zip`, createZip(files));
    p.delivered = true;
    p.deliveredAt = Date.now();
    updateProject(p);
    save();
    this.render();
  }
}
customElements.define('review-page', ReviewPage);
