import { BaseElement, defineElement } from './base';
import { TOKENS } from './styles';
import type { Store, Tool } from './store';
import { CreekRenderer, type OverlayMarker } from '../render/renderer';
import { pickCreek, deformCreek, captureLockFor, levelProfiles, refreshDerived } from '../core/generator';
import { Terrain } from '../core/terrain';
import type { Creek, Network } from '../core/types';

export class MapCanvas extends BaseElement {
  private store!: Store;
  private renderer: CreekRenderer | null = null;
  private unsubscribe: (() => void) | null = null;
  private resizeObs: ResizeObserver | null = null;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private editTarget: { creekId: string; u: number } | null = null;
  private brushRadius = 60;
  private needsFit = true;
  private statusTimer = 0;

  async setup(store: Store): Promise<void> {
    this.store = store;
    this.unsubscribe?.();
    this.unsubscribe = store.subscribe((_s, patch) => {
      if (
        'network' in patch ||
        'colorMode' in patch ||
        'levelAlpha' in patch ||
        'levelVisible' in patch ||
        'showContours' in patch ||
        'showGrid' in patch ||
        'showBasemap' in patch ||
        'basemapImage' in patch ||
        'selectedCreekId' in patch ||
        'hoverCreekId' in patch ||
        'lockedIds' in patch ||
        'tool' in patch
      ) {
        this.syncRenderer();
      }
    });
    await this.initRenderer();
  }

  getRenderer(): CreekRenderer | null {
    return this.renderer;
  }

  private async initRenderer(): Promise<void> {
    this.render();
    const canvas = this.$<HTMLCanvasElement>('#gl');
    if (!canvas) return;
    const renderer = await CreekRenderer.create(canvas);
    this.renderer = renderer;
    (window as unknown as { __mapRenderer: unknown }).__mapRenderer = renderer;
    if (renderer.backend === 'none') {
      this.showFallback(renderer.fallbackReason ?? '未知原因');
      return;
    }
    this.resizeObs = new ResizeObserver(() => {
      this.renderer?.resize();
      this.updateStatus();
    });
    this.resizeObs.observe(this);
    renderer.onCameraChange = () => this.updateStatus();
    this.bindInteractions();
    this.syncRenderer();
    if (this.store.get().network) this.fitSoon();
  }

  private showFallback(reason: string): void {
    this.root.querySelector('.fallback')?.classList.add('on');
    const msg = this.$('.fallback-msg');
    if (msg) msg.textContent = reason;
    this.updateStatus();
  }

  protected override onUnmount(): void {
    this.unsubscribe?.();
    this.resizeObs?.disconnect();
    this.renderer?.dispose();
    this.renderer = null;
  }

  private fitSoon(): void {
    if (!this.renderer) return;
    this.needsFit = true;
    requestAnimationFrame(() => {
      if (this.needsFit) {
        this.renderer?.fitToNetwork();
        this.needsFit = false;
      }
    });
  }

  /** 网络变化或视图设置变化时把状态推进渲染器 */
  syncRenderer(): void {
    const r = this.renderer;
    const empty = this.$('.empty');
    if (empty) empty.classList.toggle('hide', !!this.store.get().network);
    if (!r) return;
    const s = this.store.get();
    if (s.network) {
      if ((r as unknown as { _net?: Network })._net !== s.network) {
        (r as unknown as { _net?: Network })._net = s.network;
        r.setNetwork(s.network);
        this.fitSoon();
      }
    } else {
      r.setNetwork(null);
    }
    const levelAlpha = {
      1: s.levelVisible[1] ? s.levelAlpha[1] : 0,
      2: s.levelVisible[2] ? s.levelAlpha[2] : 0,
      3: s.levelVisible[3] ? s.levelAlpha[3] : 0,
    };
    r.setOptions({
      colorMode: s.colorMode,
      levelAlpha,
      showContours: s.showContours,
      showGrid: s.showGrid,
      highlightId: s.selectedCreekId,
      hoverId: s.hoverCreekId,
      lockedIds: s.lockedIds,
    });
    // 航拍底图
    if (s.basemap && s.basemapImage && s.showBasemap) {
      r.setBasemap({
        source: s.basemapImage,
        world: s.basemap.world,
        opacity: s.basemap.opacity,
        brightness: 1.05,
        contrast: 1.08,
        grayscale: false,
        flipY: true,
      });
    } else {
      r.setBasemap(null);
    }
    // 锁定段标记
    const markers: OverlayMarker[] = [];
    if (s.network) {
      for (const c of s.network.creeks) {
        if (s.lockedIds.has(c.id)) {
          markers.push({ x: c.pts[0], y: c.pts[1], size: 13, color: [0.98, 0.73, 0.35, 0.95], shape: 0 });
        }
      }
      if (s.selectedCreekId) {
        const c = s.network.creeks.find((x) => x.id === s.selectedCreekId);
        if (c) {
          const mid = Math.floor(c.pts.length / 4);
          markers.push({ x: c.pts[mid * 2], y: c.pts[mid * 2 + 1], size: 15, color: [1, 1, 1, 0.9], shape: 2 });
        }
      }
    }
    r.setMarkers(markers);
    this.updateOverlay();
    this.updateStatus();
  }

  private bindInteractions(): void {
    const canvas = this.$<HTMLCanvasElement>('#gl');
    if (!canvas || !this.renderer) return;
    const r = this.renderer;

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 1 || (e.button === 0 && this.store.get().tool === 'pan') || e.shiftKey) {
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = 'grabbing';
        return;
      }
      if (e.button === 0) {
        const rect = canvas.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const world = r.screenToWorld(px, py);
        this.handleLeftDown(world.x, world.y, px, py);
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      if (this.dragging) {
        r.pan(e.clientX - this.lastX, e.clientY - this.lastY);
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.updateOverlay();
        return;
      }
      const world = r.screenToWorld(px, py);
      this.updateCoords(world.x, world.y);
      if (this.editTarget) {
        this.applyEdit(world.x, world.y);
        return;
      }
      // 悬停高亮: 在 inspect / lock 工具下给出要操作的目标
      const s = this.store.get();
      if (s.tool === 'inspect' || s.tool === 'lock') {
        const tol = 7 / Math.max(1e-6, r.getCamera().scale);
        const hit = s.network ? pickCreek(s.network.creeks, world.x, world.y, tol) : null;
        const next = hit?.creek.id ?? null;
        if (next !== s.hoverCreekId) {
          this.store.set({ hoverCreekId: next });
          const label = next ? hit!.creek.id : '';
          const hintEl = this.$('.hover-hint');
          if (hintEl) hintEl.textContent = next ? `${label} · 点击${s.tool === 'lock' ? '锁定' : '查看'}` : TOOL_HINT[s.tool];
        }
      }
    });

    const endDrag = (e: PointerEvent) => {
      if (this.dragging) {
        this.dragging = false;
        canvas.style.cursor = '';
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      if (this.editTarget) {
        this.commitEdit();
      }
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('pointerleave', () => {
      if (this.editTarget) this.commitEdit();
      this.store.set({ hoverCreekId: null });
      const hintEl = this.$('.hover-hint');
      if (hintEl) hintEl.textContent = TOOL_HINT[this.store.get().tool];
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.0016);
      r.zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
      this.updateOverlay();
    }, { passive: false });

    canvas.addEventListener('dblclick', () => {
      r.fitToNetwork();
      this.updateOverlay();
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // 点击其他地方取消选中
    canvas.addEventListener('click', (e) => {
      if (this.store.get().tool === 'pan' && !e.shiftKey && Math.abs(e.clientX - this.lastX) < 2) {
        // 由 handleLeftDown 处理
      }
    });

    // 触屏: 双指缩放
    let pinch: { d: number; cx: number; cy: number } | null = null;
    const active = new Map<number, { x: number; y: number }>();
    canvas.addEventListener('pointerdown', (e) => {
      active.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (active.size === 2) {
        const [a, b] = [...active.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!active.has(e.pointerId)) return;
      active.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (active.size === 2 && pinch) {
        const [a, b] = [...active.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const rect = canvas.getBoundingClientRect();
        if (pinch.d > 0) {
          r.zoomAt(d / pinch.d, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
        }
        pinch = { d, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        this.updateOverlay();
      }
    });
    canvas.addEventListener('pointerup', (e) => active.delete(e.pointerId));
  }

  private handleLeftDown(wx: number, wy: number, px: number, py: number): void {
    const s = this.store.get();
    const r = this.renderer!;
    if (!s.network) return;
    const tolWorld = 9 / r.getCamera().scale;
    const hit = pickCreek(s.network.creeks, wx, wy, tolWorld);
    if (s.tool === 'edit') {
      if (hit) {
        this.editTarget = { creekId: hit.creek.id, u: hit.u };
        this.store.set({ selectedCreekId: hit.creek.id });
        this.updateOverlay();
        // 施加初笔
        this.applyEdit(wx, wy);
      } else {
        this.store.toast('请在沟道上按下并拖动以调整走向', 'warn');
      }
      return;
    }
    if (s.tool === 'lock') {
      if (!hit) {
        this.store.toast('未选中沟道', 'warn');
        return;
      }
      const locked = new Set(s.lockedIds);
      if (locked.has(hit.creek.id)) {
        locked.delete(hit.creek.id);
        this.store.toast(`已解除锁定 ${hit.creek.id}`, 'info');
      } else {
        const lock = captureLockFor(s.network.creeks, hit.creek, new Date().toISOString());
        const locks = [...s.locks.filter((l) => l.creekId !== lock.creekId), lock];
        locked.add(hit.creek.id);
        this.store.set({ locks });
        this.store.toast(`已锁定 ${hit.creek.id} · 改走向后形态不变`, 'ok');
      }
      this.store.set({ lockedIds: locked, selectedCreekId: hit.creek.id });
      this.syncRenderer();
      return;
    }
    // pan 工具: 选中 / 取消
    this.store.set({ selectedCreekId: hit ? hit.creek.id : null });
    this.syncRenderer();
  }

  private applyEdit(wx: number, wy: number): void {
    if (!this.editTarget) return;
    const s = this.store.get();
    if (!s.network) return;
    const creek = s.network.creeks.find((c) => c.id === this.editTarget!.creekId);
    if (!creek) return;
    const hit = pickCreek([creek], wx, wy, 1e9);
    void hit;
    // 计算鼠标相对沟道的横向位移
    const near = nearestOnCreek(creek, wx, wy);
    const delta = near.signed;
    const clamped = Math.max(-120, Math.min(120, delta));
    const terrain = new Terrain(s.params);
    const profile = levelProfiles(s.params)[creek.level];
    const moved = deformCreek(creek, this.editTarget.u, clamped * 0.55, this.brushRadius, terrain, profile);
    moved.edited = true;
    const creeks = s.network.creeks.map((c) => (c.id === moved.id ? moved : c));
    const network = refreshDerived({ ...s.network, creeks });
    this.store.set({ network, selectedCreekId: moved.id });
  }

  private commitEdit(): void {
    this.editTarget = null;
  }

  private updateOverlay(): void {
    const s = this.store.get();
    const hover = this.$('.hover-hint');
    if (hover) {
      hover.textContent = TOOL_HINT[s.tool] ?? '';
    }
    this.updateStatus();
  }

  private updateCoords(x: number, y: number): void {
    const el = this.$('.coord');
    if (el) el.textContent = `E ${x.toFixed(1)} m   N ${y.toFixed(1)} m`;
  }

  private updateStatus(): void {
    const r = this.renderer;
    const s = this.store.get();
    const scaleEl = this.$('.scale-info');
    const backendEl = this.$('.backend');
    if (scaleEl && r) {
      const cam = r.getCamera();
      const mPerPx = 1 / cam.scale;
      scaleEl.textContent = `1 px ≈ ${mPerPx < 1 ? mPerPx.toFixed(2) : mPerPx.toFixed(1)} m`;
    }
    if (backendEl) {
      backendEl.textContent = r?.backend === 'webgpu' ? 'WebGPU' : '未启用';
      backendEl.className = `chip ${r?.backend === 'webgpu' ? 'ok' : 'danger'} backend`;
    }
    const info = this.$('.net-info');
    if (info && s.network) {
      const st = s.network.stats;
      info.innerHTML = `
        <span class="chip">${st.counts[1] + st.counts[2] + st.counts[3]} 条沟道</span>
        <span class="chip">总长 ${(st.totalLength / 1000).toFixed(2)} km</span>
        <span class="chip">密度 ${st.densityKmPerKm2.toFixed(1)} km/km²</span>
        <span class="chip mono" title="参数指纹">${s.network.fingerprint}</span>
      `;
    }
    window.clearTimeout(this.statusTimer);
  }

  private structureBuilt = false;

  protected render(): void {
    // 结构与 canvas 只构建一次; 之后的重绘只刷新状态, 否则 WebGPU 上下文会绑在已卸载的节点上
    if (this.structureBuilt) {
      this.updateStatus();
      return;
    }
    this.structureBuilt = true;
    this.useStyles(
      TOKENS +
        /* css */ `
      :host { display: block; position: relative; height: 100%; min-height: 0; overflow: hidden; background: #060d11; border-radius: var(--radius); }
      #gl { display: block; width: 100%; height: 100%; touch-action: none; }
      .toolbar {
        position: absolute; top: 10px; left: 10px; z-index: 3;
        display: flex; flex-direction: column; gap: 4px;
        background: rgba(11, 20, 24, 0.86);
        backdrop-filter: blur(8px);
        border: 1px solid var(--line-soft);
        border-radius: var(--radius);
        padding: 4px;
      }
      .tool-btn {
        display: flex; align-items: center; gap: 7px;
        padding: 6px 9px; border-radius: var(--radius-sm);
        background: transparent; border: 1px solid transparent;
        color: var(--fg-dim); font-size: 12px; cursor: pointer;
      }
      .tool-btn:hover { background: var(--bg-2); color: var(--fg); }
      .tool-btn.active { background: var(--accent-soft); border-color: rgba(79,209,197,0.4); color: var(--accent); }
      .tool-btn .ico { font-size: 14px; width: 16px; text-align: center; }
      .hud {
        position: absolute; right: 10px; top: 10px; z-index: 3;
        display: flex; flex-direction: column; align-items: flex-end; gap: 6px;
      }
      .net-info { display: flex; gap: 5px; flex-wrap: wrap; justify-content: flex-end; }
      .net-info .chip { background: rgba(11,20,24,0.86); backdrop-filter: blur(8px); }
      .statusbar {
        position: absolute; left: 10px; bottom: 10px; right: 10px; z-index: 3;
        display: flex; align-items: center; gap: 10px;
        font-size: 11.5px; color: var(--fg-dim);
        pointer-events: none;
      }
      .statusbar > * { background: rgba(11,20,24,0.8); padding: 3px 8px; border-radius: 4px; backdrop-filter: blur(6px); }
      .hint { color: var(--fg-mute); }
      .fallback {
        position: absolute; inset: 0; z-index: 5; display: none;
        align-items: center; justify-content: center;
        background: rgba(6, 13, 17, 0.94); padding: 30px; text-align: center;
      }
      .fallback.on { display: flex; }
      .fallback-card { max-width: 460px; display: flex; flex-direction: column; gap: 10px; align-items: center; }
      .fallback h3 { margin: 0; font-size: 15px; color: var(--warn); }
      .fallback-msg { color: var(--fg-dim); font-size: 12.5px; line-height: 1.6; }
      .fallback code { font-family: var(--mono); background: var(--bg-2); padding: 1px 5px; border-radius: 3px; }
      .empty {
        position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
        color: var(--fg-mute); font-size: 13px; z-index: 2; pointer-events: none;
      }
      .empty.hide { display: none; }
      .crosshair { position: absolute; width: 18px; height: 18px; border: 1px solid rgba(255,255,255,0.35); border-radius: 50%; pointer-events: none; transform: translate(-50%,-50%); display: none; z-index: 4; }

      /* 窄屏: 工具栏改为横排贴在顶部, 信息条收起, 避免与小画布互相遮挡 */
      @media (max-width: 900px) {
        .toolbar { flex-direction: row; top: 6px; left: 6px; right: 6px; width: auto; gap: 2px; padding: 3px; }
        .tool-btn { flex: 1; justify-content: center; gap: 4px; padding: 5px 6px; font-size: 11.5px; }
        .tool-btn .ico { display: none; }
        .hud { top: auto; bottom: 40px; left: 6px; right: 6px; align-items: flex-start; }
        .net-info { justify-content: flex-start; gap: 4px; }
        .net-info .chip { font-size: 10px; padding: 1px 6px; }
        .net-info .chip:last-child { display: none; }
        .statusbar { left: 6px; right: 6px; bottom: 6px; gap: 5px; font-size: 10px; }
        .statusbar > * { padding: 2px 5px; }
        .statusbar .hover-hint { display: none; }
      }
    `,
    );

    this.setContent(`
      <canvas id="gl"></canvas>
      <div class="empty hide">暂无网络 — 在左侧设置参数后点击「生成网络」</div>
      <div class="toolbar">
        <button class="tool-btn" data-tool="pan"><span class="ico">✥</span>平移</button>
        <button class="tool-btn" data-tool="inspect"><span class="ico">◎</span>查看</button>
        <button class="tool-btn" data-tool="edit"><span class="ico">✎</span>编辑</button>
        <button class="tool-btn" data-tool="lock"><span class="ico">⊘</span>锁定</button>
      </div>
      <div class="hud">
        <div class="net-info"></div>
      </div>
      <div class="statusbar">
        <span class="chip backend">—</span>
        <span class="coord mono">E 0.0 m   N 0.0 m</span>
        <span class="scale-info mono">—</span>
        <span class="hint hover-hint"></span>
      </div>
      <div class="fallback">
        <div class="fallback-card">
          <h3>WebGPU 不可用</h3>
          <div class="fallback-msg"></div>
          <div class="fallback-msg">
            请在 Chrome / Edge 中启用 WebGPU 后重新打开: <code>chrome://flags/#enable-unsafe-webgpu</code>，
            或确认显卡驱动支持。生成与归档功能不受影响。
          </div>
        </div>
      </div>
    `);

    for (const btn of this.$$<HTMLButtonElement>('[data-tool]')) {
      btn.classList.toggle('active', btn.dataset.tool === this.store?.get().tool);
      btn.addEventListener('click', () => {
        this.store.set({ tool: btn.dataset.tool as Tool });
        for (const b of this.$$('[data-tool]')) b.classList.toggle('active', b === btn);
        this.updateOverlay();
      });
    }
    this.updateStatus();
  }

  /** 供外部 (工具栏 / 快捷键) 调整相机 */
  fit(): void {
    this.renderer?.fitToNetwork();
    this.updateOverlay();
  }

  zoom(factor: number): void {
    const c = this.$<HTMLCanvasElement>('#gl');
    if (!c) return;
    this.renderer?.zoomAt(factor, c.clientWidth / 2, c.clientHeight / 2);
    this.updateOverlay();
  }

  setBrush(px: number): void {
    this.brushRadius = px;
  }

  async snapshot(): Promise<Blob | null> {
    const c = this.$<HTMLCanvasElement>('#gl');
    if (!c) return null;
    return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/png'));
  }
}

const TOOL_HINT: Record<Tool, string> = {
  pan: '滚轮缩放 · 拖动平移 · 双击全图',
  inspect: '点击沟道查看分级属性',
  edit: '在沟道上按下并拖动, 改变局部走向',
  lock: '点击沟道加锁在侧栏中; 锁定段在改走向后形态不变',
};

function nearestOnCreek(creek: Creek, x: number, y: number): { signed: number; u: number } {
  const n = creek.pts.length / 2;
  let bestD = Infinity;
  let signed = 0;
  let bestU = 0;
  for (let i = 0; i < n - 1; i++) {
    const ax = creek.pts[i * 2], ay = creek.pts[i * 2 + 1];
    const bx = creek.pts[i * 2 + 2], by = creek.pts[i * 2 + 3];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let u = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
    u = Math.max(0, Math.min(1, u));
    const qx = ax + dx * u, qy = ay + dy * u;
    const d = Math.hypot(x - qx, y - qy);
    if (d < bestD) {
      bestD = d;
      const tlen = Math.sqrt(l2) || 1;
      // 法向叉积给出带符号的横向位移
      signed = ((x - ax) * (-dy / tlen) + (y - ay) * (dx / tlen));
      bestU = (creek.s[i] + (creek.s[i + 1] - creek.s[i]) * u) / Math.max(1e-6, creek.s[n - 1]);
    }
  }
  return { signed, u: bestU };
}

defineElement('map-canvas', MapCanvas);
