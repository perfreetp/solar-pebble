import { BaseElement, defineElement, htmlEscape } from './base';
import { TOKENS, PANEL } from './styles';
import type { Store } from './store';
import { captureLockFor } from '../core/generator';

export class LockPanel extends BaseElement {
  private store!: Store;
  private unsubscribe: (() => void) | null = null;

  setup(store: Store): void {
    this.store = store;
    this.unsubscribe?.();
    this.unsubscribe = store.subscribe((_s, patch) => {
      if ('locks' in patch || 'lockedIds' in patch || 'lockReport' in patch || 'network' in patch) this.invalidate();
    });
  }

  protected override onUnmount(): void {
    this.unsubscribe?.();
  }

  protected render(): void {
    const s = this.store.get();
    this.useStyles(TOKENS + PANEL + /* css */ `
      :host { display: block; }
      .lock-item {
        display: flex; align-items: center; gap: 7px; padding: 6px 8px;
        border: 1px solid var(--line-soft); border-radius: var(--radius-sm);
        background: var(--bg-0); margin-bottom: 5px;
      }
      .lock-item:hover { border-color: var(--line); }
      .lock-id { font-family: var(--mono); font-size: 11.5px; color: var(--fg-dim); word-break: break-all; flex: 1; }
      .warn { color: var(--warn); }
      .ok { color: var(--ok); }
      .empty { color: var(--fg-mute); font-size: 12px; line-height: 1.6; }
      .report { margin-top: 8px; display: flex; flex-direction: column; gap: 3px; font-size: 11px; }
      .report-row { display: flex; gap: 6px; align-items: center; color: var(--fg-mute); }
      .report-row .mono { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .actions { display: flex; gap: 6px; margin-top: 8px; }
      .hint { font-size: 11px; color: var(--fg-mute); line-height: 1.5; margin-top: 6px; }
      .lock-list { max-height: 240px; overflow-y: auto; padding-right: 2px; }
    `);

    const locks = s.locks;
    const byId = new Map(s.network?.creeks.map((c) => [c.id, c]) ?? []);
    const reports = new Map(s.lockReport.map((r) => [r.creekId, r]));

    this.setContent(`
      <div class="col" style="gap:10px">
        <div class="panel">
          <div class="panel-head">
            <span>锁定段</span>
            <span class="spacer"></span>
            <span class="chip">${locks.length}</span>
          </div>
          <div class="panel-body">
            ${
              locks.length === 0
                ? `<div class="empty">还没有锁定段。<br>用「锁定」工具点选沟道, 或在上方沟道档案里点「锁定此段」。<br><br>锁定后改变主沟走向并重新生成时, 锁定段的形态严格不变, 只随父沟平移旋转并重新接上。</div>`
                : `<div class="lock-list">${locks
                    .map((lock) => {
                      const rep = reports.get(lock.creekId);
                      const exists = byId.has(lock.creekId);
                      return `<div class="lock-item">
                        <span class="mono" style="font-size:10px;color:var(--l${lock.level})">L${lock.level}</span>
                        <span class="lock-id">${htmlEscape(lock.creekId)}</span>
                        ${rep && !exists ? `<span class="chip danger" title="父沟已不存在">孤段</span>` : ''}
                        ${rep && exists ? (rep.ok ? `<span class="ok" title="形态签名一致">✓</span>` : `<span class="warn" title="形态偏差">!</span>`) : ''}
                        <button class="small ghost" data-unlock="${htmlEscape(lock.creekId)}" title="解除锁定">✕</button>
                      </div>`;
                    })
                    .join('')}</div>`
            }
            ${
              locks.length > 0
                ? `<div class="actions">
                    <button class="small" data-act="lock-all">全部锁定</button>
                    <button class="small ghost" data-act="clear-locks">清空</button>
                  </div>`
                : ''
            }
            <div class="hint">
              锁定段以起点为原点、起点切向为 +x 保存局部坐标, 并记录相对父沟的分叉角。
              重生成时只做刚体变换, 因此长度、弯曲与偏转完全保持, 同时随父沟旋转并保持原有分叉角。
            </div>
            ${
              s.lockReport.length
                ? `<div class="report">${s.lockReport
                    .map(
                      (r) =>
                        `<div class="report-row">
                          <span class="${r.ok ? 'ok' : 'warn'}">${r.ok ? '✓' : '!'}</span>
                          <span class="mono">${htmlEscape(r.creekId)}</span>
                          <span>${r.ok ? '形态不变 · 分叉角保留' : htmlEscape(r.reason ?? '校验失败')} · 接合 ${r.attachError < 1e-6 ? '0.000' : r.attachError.toFixed(3)} m</span>
                        </div>`,
                    )
                    .join('')}</div>`
                : ''
            }
          </div>
        </div>
      </div>
    `);

    for (const btn of this.$$<HTMLButtonElement>('[data-unlock]')) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.unlock!;
        const locks = this.store.get().locks.filter((l) => l.creekId !== id);
        const locked = new Set(this.store.get().lockedIds);
        locked.delete(id);
        this.store.set({ locks, lockedIds: locked });
        this.emit('locks-changed', {});
      });
    }
    this.$('[data-act="lock-all"]')?.addEventListener('click', () => {
      const s2 = this.store.get();
      if (!s2.network) return;
      const at = new Date().toISOString();
      const net = s2.network;
      const locks = net.creeks.filter((c) => c.level !== 3).map((c) => captureLockFor(net.creeks, c, at));
      const locked = new Set(locks.map((l) => l.creekId));
      this.store.set({ locks, lockedIds: locked });
      this.store.toast(`已锁定 ${locks.length} 条主干与支沟`, 'ok');
      this.emit('locks-changed', {});
    });
    this.$('[data-act="clear-locks"]')?.addEventListener('click', () => {
      this.store.set({ locks: [], lockedIds: new Set() });
      this.store.toast('已清空锁定段', 'info');
      this.emit('locks-changed', {});
    });
  }
}

defineElement('lock-panel', LockPanel);
