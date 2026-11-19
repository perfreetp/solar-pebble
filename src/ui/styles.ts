/** 共享设计令牌与组件样式 (阴影 DOM 内使用, 主题随全局 data-theme) */
export const TOKENS = /* css */ `
  :host {
    --bg-0: #0b1418;
    --bg-1: #111e24;
    --bg-2: #17272e;
    --bg-3: #1e333b;
    --line: #27424c;
    --line-soft: #1c333b;
    --fg: #dcecee;
    --fg-dim: #93adb4;
    --fg-mute: #648089;
    --accent: #4fd1c5;
    --accent-2: #64b5d6;
    --accent-soft: rgba(79, 209, 197, 0.14);
    --warn: #f2b04a;
    --danger: #e8746a;
    --ok: #6ed3a0;
    --l1: #5fe0d8;
    --l2: #3fa9c4;
    --l3: #3d7f9b;
    --radius: 8px;
    --radius-sm: 5px;
    --shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
    --font: 'Inter', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
    --mono: 'JetBrains Mono', 'Cascadia Code', 'Consolas', ui-monospace, monospace;
    color: var(--fg);
    font-family: var(--font);
    font-size: 13px;
    line-height: 1.5;
    box-sizing: border-box;
  }
  *, *::before, *::after { box-sizing: border-box; }

  button {
    font: inherit;
    color: inherit;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    padding: 6px 11px;
    cursor: pointer;
    transition: background 120ms, border-color 120ms, color 120ms;
    white-space: nowrap;
  }
  button:hover:not(:disabled) { background: var(--bg-3); border-color: var(--accent-2); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  button:disabled { opacity: 0.42; cursor: not-allowed; }
  button.primary {
    background: linear-gradient(180deg, #2f9e95, #237a75);
    border-color: #3fb8ad;
    color: #f2fffd;
    font-weight: 600;
  }
  button.primary:hover:not(:disabled) { background: linear-gradient(180deg, #37b3a8, #288a83); }
  button.ghost { background: transparent; border-color: transparent; color: var(--fg-dim); }
  button.ghost:hover:not(:disabled) { background: var(--bg-2); color: var(--fg); }
  button.danger:hover:not(:disabled) { border-color: var(--danger); color: #ffd9d4; background: rgba(232, 116, 106, 0.12); }
  button.small { padding: 3px 8px; font-size: 12px; }

  input[type='text'], input[type='number'], input[type='date'], select, textarea {
    font: inherit;
    color: var(--fg);
    background: var(--bg-0);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    padding: 5px 8px;
    width: 100%;
    min-width: 0;
  }
  input:focus, select:focus, textarea:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }
  input[type='range'] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 18px;
    background: transparent;
    cursor: pointer;
  }
  input[type='range']::-webkit-slider-runnable-track {
    height: 3px; background: var(--bg-3); border-radius: 2px;
  }
  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 13px; height: 13px; margin-top: -5px;
    border-radius: 50%;
    background: var(--accent);
    border: 2px solid var(--bg-1);
    box-shadow: 0 0 0 1px var(--accent);
  }
  input[type='range']:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px var(--accent-soft); }

  input[type='checkbox'] { accent-color: var(--accent); width: 14px; height: 14px; }

  .row { display: flex; align-items: center; gap: 8px; }
  .col { display: flex; flex-direction: column; gap: 8px; }
  .spacer { flex: 1; }
  .muted { color: var(--fg-mute); }
  .dim { color: var(--fg-dim); }
  .mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }
  .chip {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 2px 8px; border-radius: 999px;
    background: var(--bg-2); border: 1px solid var(--line-soft);
    font-size: 11.5px; color: var(--fg-dim);
  }
  .chip.ok { color: var(--ok); border-color: rgba(110, 211, 160, 0.35); }
  .chip.warn { color: var(--warn); border-color: rgba(242, 176, 74, 0.35); }
  .chip.danger { color: var(--danger); border-color: rgba(232, 116, 106, 0.35); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }

  ::-webkit-scrollbar { width: 9px; height: 9px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--line); border-radius: 6px; }
  ::-webkit-scrollbar-thumb:hover { background: #355a66; }
`;

export const PANEL = /* css */ `
  .panel {
    background: var(--bg-1);
    border: 1px solid var(--line-soft);
    border-radius: var(--radius);
  }
  .panel-head {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 11px;
    border-bottom: 1px solid var(--line-soft);
    font-weight: 600;
    font-size: 12.5px;
    letter-spacing: 0.02em;
  }
  .panel-body { padding: 10px 11px; }
  .section-title {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--fg-mute);
    margin-bottom: 7px;
  }
`;
