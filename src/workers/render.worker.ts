/// <reference lib="webworker" />
import type {
  Annotation, GuideLine, PathData, Pt, ViewTransform,
} from '../types';
import { DOC_H, DOC_W } from '../types';

export interface RenderState {
  paths: PathData[];
  guides: GuideLine[];
  view: ViewTransform;
  bg: ImageBitmap | null;
  bgOpacity: number;
  showGrid: boolean;
  selection: string[];
  activePathId: string | null;
  hover: { pathId?: string; nodeIndex?: number; handle?: 'in' | 'out'; snap?: string } | null;
  snapTarget: unknown | null;
  smartGuides: { orientation: 'h' | 'v'; pos: number }[];
  penPreview: Pt[] | null;
  annotations: Annotation[];
  reviewAnnotation: Annotation | null;
  readOnly: boolean;
  dpr: number;
}

let state: RenderState = {
  paths: [], guides: [], view: { scale: 1, offsetX: 0, offsetY: 0 },
  bg: null, bgOpacity: 0.7, showGrid: true, selection: [], activePathId: null,
  hover: null, snapTarget: null, smartGuides: [], penPreview: null,
  annotations: [], reviewAnnotation: null, readOnly: false, dpr: 1,
};
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let canvas: OffscreenCanvas | null = null;
let cssW = 0;
let cssH = 0;

self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    const cv: OffscreenCanvas = msg.canvas;
    canvas = cv;
    ctx = cv.getContext('2d');
    state.dpr = msg.dpr;
    cssW = cv.width / state.dpr;
    cssH = cv.height / state.dpr;
    draw();
  } else if (msg.type === 'resize') {
    if (canvas) {
      canvas.width = msg.width;
      canvas.height = msg.height;
      cssW = msg.cssWidth;
      cssH = msg.cssHeight;
      draw();
    }
  } else if (msg.type === 'patch') {
    state = { ...state, ...msg.patch };
    draw();
  }
};

function draw() {
  if (!ctx || !canvas) return;
  const c = ctx;
  const { view } = state;
  c.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  c.clearRect(0, 0, cssW, cssH);

  // 工作台背景
  c.fillStyle = '#2b2f36';
  c.fillRect(0, 0, cssW, cssH);

  c.save();
  c.translate(view.offsetX, view.offsetY);
  c.scale(view.scale, view.scale);

  // 文档纸面
  c.fillStyle = '#fbf7ec';
  c.fillRect(0, 0, DOC_W, DOC_H);

  if (state.bg) {
    c.globalAlpha = state.bgOpacity;
    c.drawImage(state.bg, 0, 0, DOC_W, DOC_H);
    c.globalAlpha = 1;
  }

  if (state.showGrid) drawGrid(c);
  drawGuides(c);

  // 先画斑纹(填充),再画翅脉(描边)
  state.paths.filter(p => p.visible && p.kind === 'pattern').forEach(p => drawPattern(c, p));
  state.paths.filter(p => p.visible && p.kind === 'vein').forEach(p => drawVein(c, p));

  drawPenPreview(c);
  drawSmartGuides(c);

  if (!state.readOnly) drawHandles(c);
  drawReviewAnnotations(c);

  // 文档边框
  c.strokeStyle = '#c9bda3';
  c.lineWidth = 1 / view.scale;
  c.strokeRect(0, 0, DOC_W, DOC_H);
  c.restore();
}

function drawGrid(c: OffscreenCanvasRenderingContext2D) {
  const step = 40;
  c.save();
  c.strokeStyle = 'rgba(120,100,70,0.12)';
  c.lineWidth = 1 / state.view.scale;
  c.beginPath();
  for (let x = step; x < DOC_W; x += step) { c.moveTo(x, 0); c.lineTo(x, DOC_H); }
  for (let y = step; y < DOC_H; y += step) { c.moveTo(0, y); c.lineTo(DOC_W, y); }
  c.stroke();
  c.restore();
}

function drawGuides(c: OffscreenCanvasRenderingContext2D) {
  c.save();
  state.guides.forEach(g => {
    c.strokeStyle = '#d24b7a';
    c.lineWidth = 1.4 / state.view.scale;
    c.setLineDash([8 / state.view.scale, 6 / state.view.scale]);
    c.beginPath();
    if (g.orientation === 'h') { c.moveTo(0, g.pos); c.lineTo(DOC_W, g.pos); }
    else { c.moveTo(g.pos, 0); c.lineTo(g.pos, DOC_H); }
    c.stroke();
  });
  c.setLineDash([]);
  c.restore();
}

function tracePath(c: OffscreenCanvasRenderingContext2D, p: PathData) {
  const n = p.nodes.length;
  if (n === 0) return;
  c.beginPath();
  c.moveTo(p.nodes[0].x, p.nodes[0].y);
  const segs = p.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const cur = p.nodes[i];
    const next = p.nodes[(i + 1) % n];
    const hOut = p.handlesOut[i];
    const hIn = p.handlesIn[(i + 1) % n];
    if (hOut || hIn) {
      const p1 = hOut ? { x: cur.x + hOut.x, y: cur.y + hOut.y } : cur;
      const p2 = hIn ? { x: next.x + hIn.x, y: next.y + hIn.y } : next;
      c.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, next.x, next.y);
    } else {
      c.lineTo(next.x, next.y);
    }
  }
  if (p.closed) c.closePath();
}

function drawVein(c: OffscreenCanvasRenderingContext2D, p: PathData) {
  c.save();
  tracePath(c, p);
  c.strokeStyle = p.color;
  c.lineWidth = (p.id === state.activePathId ? 3.2 : 2.4);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.globalAlpha = p.locked ? 0.55 : 1;
  c.stroke();
  if (state.selection.includes(p.id)) {
    c.strokeStyle = '#2f7ed8';
    c.lineWidth = 1 / state.view.scale + 0.6;
    c.setLineDash([6 / state.view.scale, 4 / state.view.scale]);
    tracePath(c, p);
    c.stroke();
    c.setLineDash([]);
  }
  c.restore();
}

function drawPattern(c: OffscreenCanvasRenderingContext2D, p: PathData) {
  c.save();
  tracePath(c, p);
  c.fillStyle = hexWithAlpha(p.color, 0.38);
  c.fill();
  // 镂空环:用 evenodd 复合路径重绘,挖空
  if (p.holes.length) {
    c.globalCompositeOperation = 'destination-out';
    p.holes.forEach(ring => {
      c.beginPath();
      ring.forEach((q, i) => i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y));
      c.closePath();
      c.fillStyle = 'rgba(0,0,0,1)';
      c.fill();
    });
    c.globalCompositeOperation = 'source-over';
  }
  c.strokeStyle = p.color;
  c.lineWidth = 2;
  c.globalAlpha = p.locked ? 0.55 : 0.95;
  tracePath(c, p);
  c.stroke();
  if (state.selection.includes(p.id)) {
    c.strokeStyle = '#2f7ed8';
    c.lineWidth = 1 / state.view.scale + 0.6;
    c.setLineDash([6 / state.view.scale, 4 / state.view.scale]);
    tracePath(c, p);
    c.stroke();
    c.setLineDash([]);
  }
  c.restore();
}

function drawPenPreview(c: OffscreenCanvasRenderingContext2D) {
  const pts = state.penPreview;
  if (!pts || pts.length === 0) return;
  c.save();
  c.strokeStyle = '#e8a33d';
  c.lineWidth = 1.6;
  c.setLineDash([5 / state.view.scale, 4 / state.view.scale]);
  c.beginPath();
  pts.forEach((q, i) => i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y));
  c.stroke();
  c.setLineDash([]);
  pts.forEach(q => {
    c.beginPath();
    c.arc(q.x, q.y, 4 / state.view.scale, 0, Math.PI * 2);
    c.fillStyle = '#e8a33d';
    c.fill();
  });
  c.restore();
}

function drawSmartGuides(c: OffscreenCanvasRenderingContext2D) {
  if (!state.smartGuides.length) return;
  c.save();
  c.strokeStyle = '#e04f9e';
  c.lineWidth = 1 / state.view.scale;
  state.smartGuides.forEach(g => {
    c.beginPath();
    if (g.orientation === 'h') { c.moveTo(0, g.pos); c.lineTo(DOC_W, g.pos); }
    else { c.moveTo(g.pos, 0); c.lineTo(g.pos, DOC_H); }
    c.stroke();
  });
  c.restore();
}

function drawHandles(c: OffscreenCanvasRenderingContext2D) {
  const s = state.view.scale;
  state.paths.forEach(p => {
    if (!state.selection.includes(p.id) || !p.visible) return;
    // 控制柄连线
    c.save();
    c.strokeStyle = '#2f7ed8';
    c.lineWidth = 1 / s;
    p.nodes.forEach((n, i) => {
      const hIn = p.handlesIn[i], hOut = p.handlesOut[i];
      if (hIn) {
        c.beginPath();
        c.moveTo(n.x, n.y);
        c.lineTo(n.x + hIn.x, n.y + hIn.y);
        c.stroke();
      }
      if (hOut) {
        c.beginPath();
        c.moveTo(n.x, n.y);
        c.lineTo(n.x + hOut.x, n.y + hOut.y);
        c.stroke();
      }
    });
    // 节点方块
    p.nodes.forEach((n, i) => {
      const isHover = state.hover?.pathId === p.id && state.hover?.nodeIndex === i;
      const r = (isHover ? 6.5 : 5) / s;
      c.beginPath();
      c.rect(n.x - r, n.y - r, r * 2, r * 2);
      c.fillStyle = isHover ? '#ffd34d' : '#ffffff';
      c.fill();
      c.strokeStyle = '#2f7ed8';
      c.lineWidth = 1.4 / s;
      c.stroke();
    });
    // 控制柄圆点
    p.nodes.forEach((n, i) => {
      (['in', 'out'] as const).forEach(which => {
        const h = which === 'in' ? p.handlesIn[i] : p.handlesOut[i];
        if (!h) return;
        const isHover = state.hover?.pathId === p.id && state.hover?.nodeIndex === i && state.hover?.handle === which;
        const r = (isHover ? 5 : 4) / s;
        c.beginPath();
        c.arc(n.x + h.x, n.y + h.y, r, 0, Math.PI * 2);
        c.fillStyle = isHover ? '#ffd34d' : '#2f7ed8';
        c.fill();
                c.strokeStyle = '#fff';
        c.lineWidth = 1 / s;
        c.stroke();
      });
    });
    c.restore();
  });
}

function drawReviewAnnotations(c: OffscreenCanvasRenderingContext2D) {
  state.annotations.forEach(a => {
    c.save();
    c.strokeStyle = a.kind === 'reject' ? '#d83a3a' : '#2f9e44';
    c.lineWidth = 3 / state.view.scale;
    c.beginPath();
    c.arc(a.cx, a.cy, a.r, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = a.kind === 'reject' ? 'rgba(216,58,58,0.12)' : 'rgba(47,158,68,0.12)';
    c.fill();
    c.font = `${14 / state.view.scale}px sans-serif`;
    c.fillStyle = a.kind === 'reject' ? '#d83a3a' : '#2f9e44';
    c.fillText(a.kind === 'reject' ? `驳回:${a.comment}` : `通过:${a.comment}`, a.cx - a.r, a.cy - a.r - 6 / state.view.scale);
    c.restore();
  });
  if (state.reviewAnnotation) {
    const a = state.reviewAnnotation;
    c.save();
    c.strokeStyle = a.kind === 'reject' ? '#d83a3a' : '#2f9e44';
    c.lineWidth = 2 / state.view.scale;
    c.setLineDash([6 / state.view.scale, 4 / state.view.scale]);
    c.beginPath();
    c.arc(a.cx, a.cy, a.r, 0, Math.PI * 2);
    c.stroke();
    c.restore();
  }
}

function hexWithAlpha(hex: string, alpha: number) {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
