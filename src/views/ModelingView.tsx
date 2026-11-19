import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { CraterScene } from '../voxel/CraterScene';
import { LAYERS, VOXEL_SIZE } from '../voxel/constants';
import { voxelStore, type ToolId } from '../voxel/voxelStore';
import {
  buildFullMesh,
  buildSimplifiedMesh,
  downloadArrayBuffer,
  exportGLB,
} from '../voxel/meshes';
import { toast } from '../components/Toast';
import type { LayerId } from '../types';

const TOOLS: Array<{ id: ToolId; label: string; hint: string }> = [
  { id: 'add', label: '堆积', hint: '点击坑缘/坑底表面,在命中体素上方堆一块(半米)' },
  { id: 'erase', label: '擦除', hint: '点击移除体素,锁定层不受影响' },
  { id: 'select', label: '框选', hint: '在体素上按住左键拖出范围,复制坑缘片段' },
  { id: 'paste', label: '粘贴', hint: '点击目标位置,按落点表面法线自动转向贴附' },
];

export function ModelingView() {
  let mountRef: HTMLDivElement | undefined;
  let scene: CraterScene | null = null;
  const [scanResult, setScanResult] = createSignal<{
    isolated: number;
    floating: number;
  } | null>(null);
  const [exporting, setExporting] = createSignal(false);

  onMount(() => {
    if (!mountRef) return;
    scene = new CraterScene(mountRef);
    scene.onClick = (coord, normal) => {
      const t = voxelStore.tool();
      if (t === 'add') {
        const ok = voxelStore.stackOn(coord);
        if (!ok) toast('当前编辑层被锁定或隐藏,无法堆积', 'warn');
      } else if (t === 'erase') {
        const ok = voxelStore.eraseAt(coord);
        if (!ok) toast('该体素所在层锁定或隐藏,无法擦除', 'warn');
      } else if (t === 'paste') {
        if (!voxelStore.clipboard()) {
          toast('剪贴板为空,请先框选并复制一段体素', 'warn');
          return;
        }
        const r = voxelStore.pasteAt(coord, normal);
        toast(`粘贴完成:落位 ${r.placed} 块,避让重叠 ${r.skipped} 块`, r.placed ? 'good' : 'warn');
      }
    };
    scene.onDragBox = (min, max) => {
      const n = voxelStore.selectBox(min, max);
      toast(`框选 ${n} 个体素`, n ? 'info' : 'warn');
      scene?.focusSelection();
    };
  });

  onCleanup(() => {
    scene?.dispose();
    scene = null;
  });

  const currentHint = createMemo(
    () => TOOLS.find((t) => t.id === voxelStore.tool())?.hint ?? '',
  );

  const counts = createMemo(() => voxelStore.stats());

  function handleCopy() {
    const n = voxelStore.copySelection();
    if (n > 0) {
      toast(`已复制 ${n} 个体素到剪贴板,切换到「粘贴」工具放置`, 'good');
      voxelStore.setTool('paste');
    } else {
      toast('请先使用框选工具选择一段体素', 'warn');
    }
  }

  async function handleSimplify() {
    const ratio = voxelStore.simplifyRatio();
    const { info } = await buildSimplifiedMesh(ratio);
    voxelStore.setLastReduction(info);
    voxelStore.setMeshView(true);
    toast(
      `已合并为单网格并减面:${info.before} → ${info.after} 三角面(保留 ${(info.ratio * 100).toFixed(1)}%)`,
      'good',
    );
  }

  async function handleReduceTo20() {
    voxelStore.setSimplifyRatio(0.2);
    const { info } = await buildSimplifiedMesh(0.2);
    voxelStore.setLastReduction(info);
    voxelStore.setMeshView(true);
    toast(
      `已减到原始面数两成:${info.before} → ${info.after} 三角面(${info.collapsed ? '贪婪+二次塌缩' : '贪婪合并即达标'})`,
      'good',
    );
  }

  function handleScan() {
    const r = voxelStore.scanModel();
    setScanResult({ isolated: r.isolated.length, floating: r.floatingFaces.length });
    if (r.isolated.length + r.floatingFaces.length === 0) {
      toast('扫描通过:未发现孤立体素或悬空面', 'good');
    } else {
      toast(
        `发现 ${r.isolated.length} 个孤立体素、${r.floatingFaces.length} 处悬空面,已在视口红色高亮`,
        'bad',
      );
    }
  }

  async function handleExport() {
    const r = voxelStore.scanModel();
    setScanResult({ isolated: r.isolated.length, floating: r.floatingFaces.length });
    if (r.isolated.length + r.floatingFaces.length > 0) {
      toast('导出拦截:请先处理高亮的孤立体素/悬空面,或确认后重试', 'bad');
      return;
    }
    setExporting(true);
    try {
      // 导出始终基于减面后的合并网格;未生成则即时按当前比例构建
      let root;
      if (voxelStore.meshView() && voxelStore.lastReduction()) {
        root = (await buildSimplifiedMesh(voxelStore.simplifyRatio())).mesh;
      } else {
        root = buildFullMesh();
      }
      const buffer = await exportGLB(root);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      downloadArrayBuffer(buffer, `crater-terrain-${stamp}.glb`);
      toast('GLB 已导出(二进制 glTF,含三个编辑层网格)', 'good');
    } catch (err) {
      toast(`导出失败:${(err as Error).message}`, 'bad');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div class="model-layout">
      {/* 左栏:编辑层 */}
      <div class="side-col">
        <section class="panel">
          <div class="panel-h">
            编辑层
            <span class="sub">按深度划分 · 半米体素</span>
          </div>
          <div class="panel-b">
            {LAYERS.map((meta) => {
              const id = meta.id as LayerId;
              return (
                <div
                  class="layer-row"
                  classList={{ 'active-layer': voxelStore.activeLayer() === id }}
                >
                  <span class="swatch" style={{ background: `#${meta.color.toString(16).padStart(6, '0')}` }} />
                  <div class="meta" onClick={() => voxelStore.setActiveLayer(id)} style={{ cursor: 'pointer' }}>
                    <b>{meta.name}</b>
                    <span>{meta.desc}</span>
                    <span class="mono">{voxelStore.layerCounts()[id]} 块</span>
                  </div>
                  <button
                    class="icon-btn"
                    classList={{ off: !voxelStore.visible()[id] }}
                    title={voxelStore.visible()[id] ? '隐藏层' : '显示层'}
                    onClick={() => voxelStore.toggleVisible(id)}
                  >
                    {voxelStore.visible()[id] ? '👁' : '—'}
                  </button>
                  <button
                    class="icon-btn"
                    classList={{ off: voxelStore.locked()[id] }}
                    title={voxelStore.locked()[id] ? '解锁层' : '锁定层'}
                    onClick={() => voxelStore.toggleLock(id)}
                  >
                    {voxelStore.locked()[id] ? '🔒' : '🔓'}
                  </button>
                </div>
              );
            })}
            <p class="muted" style={{ margin: '8px 2px 0', 'font-size': '12px' }}>
              点击层名切换为当前堆积层;锁定后堆积/擦除/粘贴均不会改动该层。
            </p>
          </div>
        </section>

        <section class="panel">
          <div class="panel-h">对称与选区</div>
          <div class="panel-b">
            <div class="switch-row">
              <div>
                镜像对称轴
                <div class="muted" style={{ 'font-size': '12px' }}>x=0 平面,另一侧自动同步堆积</div>
              </div>
              <label class="switch">
                <input
                  type="checkbox"
                  checked={voxelStore.mirrorEnabled()}
                  onChange={(e) => voxelStore.setMirrorEnabled(e.currentTarget.checked)}
                />
                <span class="track" />
              </label>
            </div>
            <div style={{ display: 'flex', gap: '8px', margin: '12px 0 4px', 'flex-wrap': 'wrap' }}>
              <button class="tiny" onClick={handleCopy} disabled={voxelStore.selection().length === 0}>
                复制选区 ({voxelStore.selection().length})
              </button>
              <button class="tiny ghost" onClick={() => voxelStore.clearSelection()}>
                清除选区
              </button>
            </div>
            <Show when={voxelStore.clipboard()}>
              <p class="muted" style={{ 'font-size': '12px', margin: '6px 0 0' }}>
                剪贴板:{voxelStore.clipboard()?.length ?? 0} 块,粘贴时按落点法线转向
              </p>
            </Show>
          </div>
        </section>

        <section class="panel">
          <div class="panel-h">地形统计</div>
          <div class="panel-b">
            <div class="stat-grid">
              <div class="stat-card">
                <b>{counts().total}</b>
                <span>体素总数</span>
              </div>
              <div class="stat-card">
                <b>{(counts().total * VOXEL_SIZE ** 3).toFixed(1)}m³</b>
                <span>建模体积</span>
              </div>
            </div>
            <button
              class="ghost tiny"
              style={{ 'margin-top': '10px', width: '100%' }}
              onClick={() => {
                voxelStore.resetTerrain();
                setScanResult(null);
                toast('已恢复初始撞击坑地形', 'info');
              }}
            >
              重置为初始撞击坑
            </button>
          </div>
        </section>
      </div>

      {/* 中间:三维视口 */}
      <section class="panel viewport-wrap">
        <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
        <div class="vp-toolbar">
          {TOOLS.map((t) => (
            <button
              class={`tool-btn ${voxelStore.tool() === t.id ? 'active' : ''}`}
              onClick={() => voxelStore.setTool(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div class="vp-hint">{currentHint()}</div>
        <div class="vp-stat">
          <div>
            体素边长 {VOXEL_SIZE}m · 网格 ±24 格
          </div>
          <div>
            镜像 {voxelStore.mirrorEnabled() ? '开' : '关'} · 模式{' '}
            {voxelStore.meshView() ? '减面网格' : '体素'}
          </div>
        </div>
      </section>

      {/* 右栏:网格处理 / 扫描 / 导出 */}
      <div class="side-col">
        <section class="panel">
          <div class="panel-h">
            合并与减面
            <span class="sub">多块 → 单网格</span>
          </div>
          <div class="panel-b">
            <label class="muted" style={{ 'font-size': '12px' }}>
              面数预算 · 相对原始体素模型(当前 {(voxelStore.simplifyRatio() * 100).toFixed(0)}%)
            </label>
            <input
              type="range"
              min={0.2}
              max={0.8}
              step={0.05}
              value={voxelStore.simplifyRatio()}
              onInput={(e) => voxelStore.setSimplifyRatio(Number(e.currentTarget.value))}
            />
            <div class="toolbar-row" style={{ margin: '10px 0' }}>
              <button class="primary tiny" onClick={handleSimplify}>
                按预算合并减面
              </button>
              <button class="tiny" onClick={handleReduceTo20}>
                一键减到两成
              </button>
              <button
                class="tiny ghost"
                onClick={() => voxelStore.setMeshView(false)}
                disabled={!voxelStore.meshView()}
              >
                返回体素
              </button>
            </div>
            <Show when={voxelStore.lastReduction()}>
              {(info) => (
                <div class="kv">
                  <dt>原始体素面</dt>
                  <dd class="mono">{info().before} 三角面</dd>
                  <dt>贪婪合并后</dt>
                  <dd class="mono">{info().greedy} 三角面</dd>
                  <dt>最终输出</dt>
                  <dd class="mono">{info().after} 三角面</dd>
                  <dt>相对原始</dt>
                  <dd class="mono">{(info().ratio * 100).toFixed(1)}%</dd>
                </div>
              )}
            </Show>
            <p class="muted" style={{ 'font-size': '11px', margin: '8px 0 0' }}>
              贪婪合并已达标时保持地形连通,不再做破坏性减面;预算更激进时才二次塌缩。
            </p>
          </div>
        </section>

        <section class="panel">
          <div class="panel-h">
            导出前体检
            <span class="sub">孤立体素 · 悬空面</span>
          </div>
          <div class="panel-b">
            <button class="tiny" style={{ width: '100%' }} onClick={handleScan}>
              扫描孤立体素与悬空面
            </button>
            <Show when={scanResult()}>
              {(r) => (
                <div style={{ margin: '10px 0 4px' }}>
                  <div class="scan-finding">
                    <span class="dot" style={{ background: r().isolated ? 'var(--bad)' : 'var(--good)' }} />
                    孤立体素 {r().isolated} 个
                    <span class="spacer" />
                    <Show when={r().isolated > 0}>
                      <button class="tiny ghost" onClick={() => voxelStore.clearHighlight()}>
                        取消高亮
                      </button>
                    </Show>
                  </div>
                  <div class="scan-finding">
                    <span class="dot" style={{ background: r().floating ? 'var(--bad)' : 'var(--good)' }} />
                    悬空面 {r().floating} 处
                  </div>
                </div>
              )}
            </Show>
          </div>
        </section>

        <section class="panel">
          <div class="panel-h">GLB 导出</div>
          <div class="panel-b">
            <p class="muted" style={{ 'font-size': '12px', margin: '0 0 10px' }}>
              导出前自动再扫一次;存在未处理问题时拦截放行。
            </p>
            <button
              class="primary"
              style={{ width: '100%' }}
              disabled={exporting()}
              onClick={handleExport}
            >
              {exporting() ? '导出中…' : '导出 GLB 模型'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
