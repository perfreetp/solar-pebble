import { BaseElement, defineElement, htmlEscape } from './base';
import { TOKENS, PANEL } from './styles';
import type { Store } from './store';
import type { Level, LevelTuning, NetworkParams } from '../core/types';
import { DEFAULT_LEVEL_TUNING } from '../core/generator';

interface SliderDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  fmt?: (v: number) => string;
  hint?: string;
}

const SLIDERS: SliderDef[] = [
  {
    key: 'heading',
    label: '主沟走向',
    min: 0,
    max: 359,
    step: 1,
    unit: '°',
    fmt: (v) => `${v.toFixed(0)}° ${headingLabel(v)}`,
    hint: '自正北顺时针; 决定整个网络伸向滩面的方向',
  },
  {
    key: 'branchAngle',
    label: '分叉角度',
    min: 8,
    max: 110,
    step: 1,
    unit: '°',
    hint: '一对支沟相对父沟展开的总夹角',
  },
  {
    key: 'density',
    label: '支沟密度',
    min: 0,
    max: 1,
    step: 0.01,
    unit: '',
    fmt: (v) => `${(v * 100).toFixed(0)}%`,
    hint: '控制支沟与毛细沟的发育数量与间距',
  },
  {
    key: 'meander',
    label: '曲流幅度',
    min: 0,
    max: 1,
    step: 0.01,
    unit: '',
    fmt: (v) => `${(v * 100).toFixed(0)}%`,
    hint: '中心线的蛇曲强度, 由曲率噪声实现',
  },
  {
    key: 'headLevel',
    label: '沟头终止高程',
    min: 0.6,
    max: 2.6,
    step: 0.01,
    unit: 'm',
    fmt: (v) => `${v.toFixed(2)} m`,
    hint: '滩面升到此高程时沟道自然尖灭',
  },
  {
    key: 'slope',
    label: '滩面比降',
    min: 0.0002,
    max: 0.003,
    step: 0.00005,
    unit: '',
    fmt: (v) => `${(v * 1000).toFixed(2)}‰`,
    hint: '向陆方向的滩面抬升率',
  },
];

function headingLabel(deg: number): string {
  const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return dirs[idx];
}

export class ParamPanel extends BaseElement {
  private store!: Store;
  private unsubscribe: (() => void) | null = null;
  private expanded = false;

  setup(store: Store): void {
    this.store = store;
    this.unsubscribe?.();
    this.unsubscribe = store.subscribe((_s, patch) => {
      if ('params' in patch || 'generating' in patch) this.invalidate();
    });
  }

  protected override onUnmount(): void {
    this.unsubscribe?.();
  }

  protected render(): void {
    const s = this.store.get();
    const p = s.params;
    this.useStyles(TOKENS + PANEL + /* css */ `
      :host { display: block; }
      .group { display: flex; flex-direction: column; gap: 6px; }
      .slider { display: flex; flex-direction: column; gap: 0; }
      .slider-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
      .slider-label { color: var(--fg-dim); font-size: 12px; }
      .slider-val { font-size: 12px; color: var(--accent); font-variant-numeric: tabular-nums; font-family: var(--mono); }
      .hint { font-size: 10.5px; color: var(--fg-mute); line-height: 1.3; }
      .slider-hint { display: none; }
      .slider:hover .slider-hint { display: block; }
      .seed-hint { display: block; }
      .seed-row { display: flex; gap: 6px; }
      .seed-row input { font-family: var(--mono); }
      .level-block { display: flex; flex-direction: column; gap: 6px; }
      .level-row { display: grid; grid-template-columns: 62px 1fr 44px; align-items: center; gap: 7px; }
      .level-name { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--fg-dim); }
      .swatch { width: 8px; height: 8px; border-radius: 2px; }
      .lv-val { font-family: var(--mono); font-size: 11px; color: var(--fg-mute); text-align: right; }
      .sub { font-size: 11px; color: var(--fg-mute); margin: 2px 0 0; }
      .divider { height: 1px; background: var(--line-soft); margin: 7px 0; }
      details summary { cursor: pointer; color: var(--fg-dim); font-size: 12px; padding: 3px 0; }
      details summary:hover { color: var(--fg); }
      .reset-row { display: flex; gap: 6px; }
    `);

    const slider = (d: SliderDef): string => {
      const raw = (p as unknown as Record<string, number>)[d.key];
      const display = d.fmt ? d.fmt(raw) : `${raw.toFixed(d.step < 0.001 ? 5 : d.step < 0.01 ? 3 : 2)}${d.unit}`;
      return `
        <div class="slider">
          <div class="slider-head">
            <span class="slider-label">${d.label}</span>
            <span class="slider-val">${htmlEscape(display)}</span>
          </div>
          <input type="range" data-param="${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${raw}">
          ${d.hint ? `<div class="hint slider-hint">${d.hint}</div>` : ''}
        </div>`;
    };

    const tuning = p.levelTuning ?? DEFAULT_LEVEL_TUNING;
    const tuningRow = (lv: Level, key: keyof LevelTuning, label: string, min: number, max: number, step: number, fmt: (v: number) => string): string => `
      <div class="level-row">
        <span class="level-name"><span class="swatch" style="background:var(--l${lv})"></span>${label}</span>
        <input type="range" data-tune="${lv}:${key}" min="${min}" max="${max}" step="${step}" value="${tuning[lv][key]}">
        <span class="lv-val">${fmt(tuning[lv][key])}</span>
      </div>`;

    this.setContent(`
      <div class="col" style="gap:12px">
        <div class="panel">
          <div class="panel-head">
            <span>生成参数</span>
            <span class="spacer"></span>
            <span class="chip mono" title="参数指纹随结果更新">${s.network ? s.network.fingerprint : '—'}</span>
          </div>
          <div class="panel-body col" style="gap:8px">
            <div class="seed-row">
              <input type="text" data-param="seed" value="${htmlEscape(p.seed)}" spellcheck="false" aria-label="随机种子">
              <button class="small" data-act="reseed" title="换一个种子">换种子</button>
            </div>
            <div class="hint seed-hint">同一组参数与同一种子必须得到完全一致的结果; 改种子才会变化。</div>
            <div class="divider"></div>
            <div class="group">
              ${SLIDERS.filter((d) => d.key !== 'slope').map(slider).join('')}
            </div>
            <details ${this.expanded ? 'open' : ''}>
              <summary>分级参数 · 各级宽度衰减与弯曲噪声</summary>
              <div class="level-block" style="margin-top:8px">
                <div class="sub">宽度衰减 (每 100 m 收窄比例)</div>
                ${tuningRow(1, 'widthDecay', '主干', 0, 0.4, 0.005, (v) => `${(v * 100).toFixed(0)}%`)}
                ${tuningRow(2, 'widthDecay', '支沟', 0, 0.7, 0.005, (v) => `${(v * 100).toFixed(0)}%`)}
                ${tuningRow(3, 'widthDecay', '毛细沟', 0, 0.85, 0.005, (v) => `${(v * 100).toFixed(0)}%`)}
                <div class="sub" style="margin-top:6px">弯曲噪声倍数</div>
                ${tuningRow(1, 'meanderScale', '主干', 0.2, 2, 0.05, (v) => v.toFixed(2))}
                ${tuningRow(2, 'meanderScale', '支沟', 0.2, 2.5, 0.05, (v) => v.toFixed(2))}
                ${tuningRow(3, 'meanderScale', '毛细沟', 0.2, 3, 0.05, (v) => v.toFixed(2))}
                <button class="small" data-act="reset-tuning" style="margin-top:8px;align-self:flex-start">恢复默认分级参数</button>
              </div>
            </details>
            <div class="divider"></div>
            <div class="slider">
              <div class="slider-head">
                <span class="slider-label">滩面比降</span>
                <span class="slider-val">${(p.slope * 1000).toFixed(2)}‰</span>
              </div>
              <input type="range" data-param="slope" min="0.0002" max="0.003" step="0.00005" value="${p.slope}">
              <div class="hint">${SLIDERS[5].hint}</div>
            </div>
            <div class="slider">
              <div class="slider-head">
                <span class="slider-label">口门基准高程</span>
                <span class="slider-val">${p.datum.toFixed(2)} m</span>
              </div>
              <input type="range" data-param="datum" min="0" max="0.8" step="0.01" value="${p.datum}">
            </div>
          </div>
        </div>
      </div>
    `);

    this.bind();
  }

  private bind(): void {
    for (const el of this.$$<HTMLInputElement>('input[type="range"][data-param]')) {
      el.addEventListener('input', () => {
        const key = el.dataset.param!;
        this.store.setParams({ [key]: Number(el.value) } as Partial<NetworkParams>);
        // 局部更新数值显示, 避免整块重绘导致滑块失焦
        const head = el.parentElement?.querySelector('.slider-val');
        const def = SLIDERS.find((d) => d.key === key);
        if (head) {
          const v = Number(el.value);
          head.textContent = def?.fmt ? def.fmt(v) : `${v}${def?.unit ?? ''}`;
          if (key === 'slope') head.textContent = `${(v * 1000).toFixed(2)}‰`;
        }
      });
      el.addEventListener('change', () => this.invalidate());
    }
    for (const el of this.$$<HTMLInputElement>('input[type="range"][data-tune]')) {
      el.addEventListener('input', () => {
        const [lv, key] = el.dataset.tune!.split(':');
        const level = Number(lv) as Level;
        const current = this.store.get().params.levelTuning ?? DEFAULT_LEVEL_TUNING;
        const next: Record<Level, LevelTuning> = {
          1: { ...current[1] },
          2: { ...current[2] },
          3: { ...current[3] },
          [level]: { ...current[level], [key]: Number(el.value) },
        } as Record<Level, LevelTuning>;
        this.store.setParams({ levelTuning: next });
        const valEl = el.parentElement?.querySelector('.lv-val');
        if (valEl) {
          valEl.textContent =
            key === 'widthDecay' ? `${(Number(el.value) * 100).toFixed(0)}%` : Number(el.value).toFixed(2);
        }
      });
      el.addEventListener('change', () => this.invalidate());
    }

    const seedInput = this.$<HTMLInputElement>('input[data-param="seed"]');
    seedInput?.addEventListener('change', () => {
      this.store.setParams({ seed: seedInput.value.trim() || 'TIDAL-2026' });
      this.invalidate();
    });
    seedInput?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') (seedInput as HTMLInputElement).blur();
    });

    this.$<HTMLButtonElement>('[data-act="reseed"]')?.addEventListener('click', () => {
      const next = `TIDAL-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      this.store.setParams({ seed: next });
      this.emit('params-commit', {});
      this.invalidate();
    });

    this.$<HTMLButtonElement>('[data-act="reset-tuning"]')?.addEventListener('click', () => {
      this.store.setParams({ levelTuning: undefined });
      this.invalidate();
    });

    this.$('details')?.addEventListener('toggle', (e) => {
      this.expanded = (e.target as HTMLDetailsElement).open;
    });
  }

  /** 外部更新 (切换档案时) */
  sync(): void {
    this.invalidate();
  }
}

defineElement('param-panel', ParamPanel);
