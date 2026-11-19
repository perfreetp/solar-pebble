// Canvas2D fallback renderer. Consumes the exact same scene primitives as the
// WebGPU path, so the viewport looks identical when WebGPU is unavailable.
// It replays the triangle list in order through a path cache to stay fast.

export class Canvas2DRenderer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.available = !!this.ctx;
    this.dpr = Math.min(opts.dpr || (globalThis.devicePixelRatio || 1), 2.5);
    this.visibleLayers = opts.visibleLayers || ['fill', 'cells', 'band', 'veins', 'outline', 'spots', 'detail'];
    this.backgroundColor = opts.backgroundColor || '#0e0f0c';
    this.artboardColor = opts.artboardColor || '#1b1e1a';
    this.view = { scale: 1, tx: 0, ty: 0 };
    this._scene = null;
    this._raf = null;
    this.groups = ['fill', 'cells', 'band', 'veins', 'outline', 'spots', 'detail', 'overlay'];
  }

  async init() {
    return this.available;
  }

  setScene(scene) {
    this._scene = scene;
  }

  setVisibleLayers(layers) {
    this.visibleLayers = layers;
    this.requestDraw();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * this.dpr));
    const h = Math.max(1, Math.round(rect.height * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.requestDraw();
  }

  setView(view) {
    this.view = view;
    this.requestDraw();
  }

  requestDraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this.draw();
    });
  }

  draw() {
    if (!this.available) return;
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    if (!this._scene) {
      ctx.fillStyle = this.backgroundColor;
      ctx.fillRect(0, 0, w, h);
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.backgroundColor;
    ctx.fillRect(0, 0, w, h);

    const s = (this.view.scale * this.dpr) / 1;
    ctx.setTransform(s, 0, 0, s, this.view.tx * this.dpr, this.view.ty * this.dpr);

    // artboard card
    ctx.fillStyle = this.artboardColor;
    ctx.fillRect(0, 0, 168, 122);

    const scene = this._scene;
    for (const key of this.groups) {
      const layer = scene[key];
      if (!layer) continue;
      if (key !== 'overlay' && !this.visibleLayers.includes(key)) continue;
      this.drawTriangles(ctx, layer);
    }
  }

  drawTriangles(ctx, layer) {
    const pos = layer.positions;
    const col = layer.colors;
    let lastKey = '';
    ctx.beginPath();
    let any = false;
    for (let i = 0, ci = 0; i + 5 < pos.length; i += 6, ci += 12) {
      const a = Math.round(col[ci + 3] * 100);
      const r = Math.round(col[ci] * 255);
      const g = Math.round(col[ci + 1] * 255);
      const b = Math.round(col[ci + 2] * 255);
      const key = `${r},${g},${b},${a}`;
      if (key !== lastKey) {
        if (any) {
          ctx.fill();
          ctx.beginPath();
        }
        ctx.fillStyle = `rgba(${r},${g},${b},${(a / 100).toFixed(2)})`;
        lastKey = key;
        any = true;
      }
      ctx.moveTo(pos[i], pos[i + 1]);
      ctx.lineTo(pos[i + 2], pos[i + 3]);
      ctx.lineTo(pos[i + 4], pos[i + 5]);
      ctx.closePath();
    }
    if (any) ctx.fill();
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this.available = false;
  }
}
