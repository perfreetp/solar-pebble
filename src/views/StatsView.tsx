import { createMemo, createEffect, onMount } from 'solid-js';
import { stats, users, submissions, addDemoStats } from '../store/store';

function lastNDates(n: number): string[] {
  const out: string[] = [];
  for (let d = n - 1; d >= 0; d--) {
    out.push(new Date(Date.now() - d * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

export default function StatsView() {
  const dates = createMemo(() => lastNDates(14));
  const illustrators = createMemo(() => users().filter(u => u.role === 'illustrator').map(u => u.name));

  const matrix = createMemo(() => illustrators().map(name => {
    const row = dates().map(d => stats().find(r => r.illustrator === name && r.date === d)?.count ?? 0);
    return { name, row, total: row.reduce((a, b) => a + b, 0) };
  }));
  const grandTotal = createMemo(() => matrix().reduce((s, r) => s + r.total, 0));
  const today = createMemo(() => new Date().toISOString().slice(0, 10));
  const todayTotal = createMemo(() =>
    stats().filter(r => r.date === today()).reduce((s, r) => s + r.count, 0));
  const pendingCount = createMemo(() => submissions().filter(s => s.status === 'pending').length);

  let chartEl: HTMLCanvasElement | undefined;

  onMount(() => { addDemoStats(); });

  createEffect(() => {
    // 订阅数据
    const data = matrix();
    const ds = dates();
    drawChart(data, ds);
  });

  function drawChart(data: { name: string; row: number[]; total: number }[], ds: string[]) {
    const c = chartEl;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = c.clientWidth, H = 320;
    c.width = W * dpr; c.height = H * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    const padL = 48, padB = 56, padT = 16, padR = 12;
    const max = Math.max(4, ...data.flatMap(d => d.row));
    const groupW = (W - padL - padR) / ds.length;
    const barW = Math.max(6, groupW / (data.length + 1));

    // 坐标轴
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, H - padB); ctx.lineTo(W - padR, H - padB); ctx.stroke();
    ctx.fillStyle = '#64748b'; ctx.font = '11px sans-serif';
    for (let v = 0; v <= max; v += Math.ceil(max / 5)) {
      const y = H - padB - (v / max) * (H - padB - padT);
      ctx.fillText(String(v), 18, y + 4);
      ctx.strokeStyle = '#e2e8f0';
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    }
    const colors = ['#2f7ed8', '#e8a33d', '#2f9e44'];
    data.forEach((person, pi) => {
      person.row.forEach((v, di) => {
        const x = padL + di * groupW + 4 + pi * barW;
        const h = (v / max) * (H - padB - padT);
        ctx.fillStyle = colors[pi % colors.length];
        ctx.fillRect(x, H - padB - h, barW - 2, h);
      });
    });
    ds.forEach((d, di) => {
      ctx.fillStyle = '#64748b';
      ctx.save();
      ctx.translate(padL + di * groupW + groupW / 2, H - padB + 14);
      ctx.rotate(-Math.PI / 7);
      ctx.fillText(d.slice(5), 0, 0);
      ctx.restore();
    });
    // 图例
    data.forEach((person, pi) => {
      const x = padL + pi * 130;
      ctx.fillStyle = colors[pi % colors.length];
      ctx.fillRect(x, H - 14, 12, 12);
      ctx.fillStyle = '#334155';
      ctx.fillText(person.name, x + 16, H - 4);
    });
  }

  return (
    <div class="view stats-view">
      <div class="kpi-row">
        <div class="kpi"><span class="kpi-num">{todayTotal()}</span><span class="kpi-label">今日完成图版</span></div>
        <div class="kpi"><span class="kpi-num">{grandTotal()}</span><span class="kpi-label">近 14 天累计</span></div>
        <div class="kpi"><span class="kpi-num">{pendingCount()}</span><span class="kpi-label">待审稿积压</span></div>
        <div class="kpi"><span class="kpi-num">{illustrators().length}</span><span class="kpi-label">在岗插画师</span></div>
      </div>

      <section class="admin-section">
        <h3>每人每天完成图版数(近 14 天)</h3>
        <canvas ref={chartEl} class="stats-chart" />
      </section>

      <section class="admin-section">
        <h3>明细数据表</h3>
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>插画师</th>
                {dates().map(d => <th>{d.slice(5)}</th>)}
                <th>合计</th>
              </tr>
            </thead>
            <tbody>
              {matrix().map(r => (
                <tr>
                  <td><strong>{r.name}</strong></td>
                  {r.row.map(v => <td classList={{ zero: v === 0, hot: v >= 7 }}>{v}</td>)}
                  <td><strong>{r.total}</strong></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>日合计</td>
                {dates().map((_, di) =>
                  <td><strong>{matrix().reduce((s, r) => s + r.row[di], 0)}</strong></td>)}
                <td><strong>{grandTotal()}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}
