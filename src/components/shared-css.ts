/** 各 Web Components 共享的样式：基础控件 + 布局片段（Shadow DOM 内自带，不依赖全局 CSS） */
export const baseCss = `
  :host { display: block; height: 100%; }
  button {
    font-family: inherit; cursor: pointer; border: 1px solid var(--border, #d9dee4);
    background: #fff; color: var(--text, #1f2d3d); border-radius: 6px;
    padding: 6px 14px; font-size: 13px;
    transition: background .15s, border-color .15s;
  }
  button:hover { border-color: var(--primary, #2f7ed8); color: var(--primary, #2f7ed8); }
  button.primary { background: var(--primary, #2f7ed8); border-color: var(--primary, #2f7ed8); color: #fff; }
  button.primary:hover { background: var(--primary-dark, #2266b8); color: #fff; }
  button.danger { color: var(--danger, #e5484d); border-color: #f0b7b9; }
  button.danger:hover { background: #fdecec; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  button.active { background: var(--primary, #2f7ed8); border-color: var(--primary, #2f7ed8); color: #fff; }
  input, select, textarea {
    font-family: inherit; font-size: 13px; border: 1px solid var(--border, #d9dee4);
    border-radius: 6px; padding: 6px 10px; outline: none; background: #fff;
    color: var(--text, #1f2d3d);
  }
  input:focus, select:focus, textarea:focus { border-color: var(--primary, #2f7ed8); }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border, #d9dee4); font-size: 13px; }
  th { color: var(--muted, #6b7a8d); font-weight: 600; background: #f8fafc; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; line-height: 1.6; }
  .badge.pending { background: #eef1f5; color: #6b7a8d; }
  .badge.assigned { background: #e3f0fd; color: #2f7ed8; }
  .badge.submitted { background: #fff4e0; color: #c47f17; }
  .badge.rejected { background: #fde8e8; color: #e5484d; }
  .badge.done { background: #e3f6ec; color: #2f8a5b; }
  .empty { color: var(--muted, #6b7a8d); font-size: 12px; text-align: center; padding: 18px 0; }
  .stat-pill { background: #f0f5fc; color: #2266b8; border-radius: 999px; padding: 3px 10px; font-size: 12px; font-weight: 600; }
`;

export const sharedCss = `
  ${baseCss}
  .layout { display: flex; height: 100%; background: var(--bg, #f4f6f8); }
  .panel {
    background: var(--panel, #fff); border: 1px solid var(--border, #d9dee4);
    border-radius: 10px; box-shadow: 0 2px 10px rgba(20,40,70,.08);
  }
  .side {
    width: 238px; min-width: 238px; margin: 12px 0 12px 12px;
    display: flex; flex-direction: column; overflow: hidden;
  }
  .side.right { margin: 12px 12px 12px 0; width: 268px; min-width: 268px; }
  .panel-head {
    padding: 12px 14px; font-weight: 600; font-size: 13px;
    border-bottom: 1px solid var(--border, #d9dee4);
    display: flex; align-items: center; justify-content: space-between;
  }
  .panel-body { padding: 12px 14px; overflow: auto; flex: 1; }
  .catalog-item {
    border: 1px solid var(--border, #d9dee4); border-radius: 8px;
    padding: 10px 12px; margin-bottom: 10px; cursor: grab;
    display: flex; gap: 10px; align-items: center;
    transition: border-color .15s, box-shadow .15s, background .15s;
    user-select: none;
  }
  .catalog-item:hover { border-color: var(--primary, #2f7ed8); box-shadow: 0 2px 10px rgba(20,40,70,.08); }
  .catalog-item:active { cursor: grabbing; }
  .catalog-item .swatch { width: 26px; height: 26px; border-radius: 6px; flex: none; border: 1px solid rgba(0,0,0,.12); }
  .catalog-item .name { font-weight: 600; font-size: 13px; }
  .catalog-item .desc { font-size: 11px; color: var(--muted, #6b7a8d); margin-top: 2px; line-height: 1.35; }
  .toolbar {
    display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
    padding: 10px 14px; border-bottom: 1px solid var(--border, #d9dee4);
    background: var(--panel, #fff);
  }
  .toolbar .group { display: flex; gap: 4px; align-items: center; }
  .toolbar .sep { width: 1px; height: 22px; background: var(--border, #d9dee4); margin: 0 4px; }
  .toolbar label { font-size: 12px; color: var(--muted, #6b7a8d); display: flex; align-items: center; gap: 4px; }
  .toolbar input[type=number] { width: 64px; }
  .viewport-wrap { flex: 1; display: flex; flex-direction: column; margin: 12px; min-width: 0; }
  .viewport { flex: 1; position: relative; border-radius: 10px; overflow: hidden;
    border: 1px solid var(--border, #d9dee4); box-shadow: 0 2px 10px rgba(20,40,70,.08); background: #eef2f5; }
  .hint {
    position: absolute; left: 12px; bottom: 10px; z-index: 4;
    background: rgba(255,255,255,.88); border-radius: 8px; padding: 7px 12px;
    font-size: 11.5px; color: var(--muted, #6b7a8d); line-height: 1.6; pointer-events: none;
  }
  .prop-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; gap: 8px; }
  .prop-row label { font-size: 12px; color: var(--muted, #6b7a8d); flex: none; width: 56px; }
  .prop-row input { width: 100%; }
  .vec3 { display: flex; gap: 6px; flex: 1; }
  .vec3 input { width: 0; flex: 1; }
  .bom-row { display: flex; justify-content: space-between; align-items: center;
    padding: 8px 0; border-bottom: 1px dashed var(--border, #d9dee4); font-size: 13px; }
  .bom-row .qty { font-weight: 700; color: var(--primary, #2f7ed8); }
  .sel-list { font-size: 12px; color: var(--muted, #6b7a8d); margin-bottom: 10px; line-height: 1.6; }
  .checkbox { display: flex; align-items: center; gap: 6px; font-size: 12px;
    color: var(--muted, #6b7a8d); cursor: pointer; }
  .bom-total { margin-top: 12px; padding-top: 10px; border-top: 2px solid var(--border, #d9dee4);
    display:flex; justify-content:space-between; font-weight:700; }
  .mini-btn { padding: 4px 8px; font-size: 12px; }
`;

/** 外壳专用样式 */
export const shellCss = `
  ${baseCss}
  :host { display: block; height: 100vh; }
  .topbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 20px; background: #fff; border-bottom: 1px solid var(--border, #d9dee4);
    box-shadow: 0 1px 6px rgba(20,40,70,.06); gap: 16px; flex-wrap: wrap;
  }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand .logo { font-size: 26px; }
  .brand .title { font-weight: 700; font-size: 15px; }
  .brand .subtitle { font-size: 11.5px; color: var(--muted, #6b7a8d); margin-top: 1px; }
  nav { display: flex; gap: 8px; flex-wrap: wrap; }
  nav button { position: relative; padding: 7px 14px; }
  .dot {
    display: inline-block; min-width: 17px; height: 17px; line-height: 17px;
    border-radius: 999px; background: var(--danger, #e5484d); color: #fff;
    font-size: 11px; text-align: center; margin-left: 6px; padding: 0 4px;
  }
  .dot.warn { background: var(--warn, #f5a623); }
  .view-host { height: calc(100vh - 64px); }
`;
