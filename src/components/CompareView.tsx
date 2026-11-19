import { createMemo, createSignal, type JSX } from 'solid-js';
import type { CameraState } from '../types';
import { appStore } from '../store';
import { featureArray } from '../review';
import { MapCanvas } from './MapCanvas';

/**
 * 双版本并排对比：
 * 左旧右新，相机完全联动；差异要素按 新增绿 / 删除红 / 修改黄 着色。
 */
export function CompareView(): JSX.Element {
  const leftVersion = () =>
    appStore.state.versions.find((v) => v.id === appStore.state.compareLeftId) ??
    appStore.state.versions[0]!;
  const rightVersion = () =>
    appStore.state.versions.find((v) => v.id === appStore.state.compareRightId) ??
    appStore.state.versions[1]!;

  const layerStates = () => appStore.state.layerStates;
  const diffMap = () => appStore.currentDiffMap();

  // 相机联动：任一面板拖动/缩放，另一面板跟随（按来源标记避免回环）
  const [leftCam, setLeftCam] = createSignal<{ cam: CameraState; n: number } | null>(null);
  const [rightCam, setRightCam] = createSignal<{ cam: CameraState; n: number } | null>(null);
  const tick = { n: 0 };

  const leftIncoming = createMemo(() => {
    const r = rightCam();
    return r ? r.cam : undefined;
  });
  const rightIncoming = createMemo(() => {
    const l = leftCam();
    return l ? l.cam : undefined;
  });

  const stats = createSignal<{ side: string; tiles: number; features: number; cells: number; offscreen: boolean }[]>(
    [],
  );
  const [, setStats] = stats;

  return (
    <div class="compare-root">
      <div class="compare-pane">
        <div class="pane-header">
          <span class="pane-title">{leftVersion().label}（旧版本）</span>
          <span class="diff-legend">
            <i class="dot dot-add" />新增
            <i class="dot dot-remove" />删除
            <i class="dot dot-mod" />修改
          </span>
        </div>
        <MapCanvas
          versionId={() => leftVersion().id}
          features={() => featureArray(leftVersion())}
          layerStates={layerStates}
          versionKey={() => leftVersion().id}
          diffById={diffMap}
          cameraSignal={leftIncoming}
          onCamera={(cam) => setLeftCam({ cam, n: ++tick.n })}
          annotationMode={() => false}
          onDraftAnnotation={() => undefined}
          onStats={(s) =>
            setStats((arr) => {
              const next = arr.filter((x) => x.side !== 'left');
              next.push({ side: 'left', ...s });
              return next;
            })
          }
        />
      </div>
      <div class="compare-divider" />
      <div class="compare-pane">
        <div class="pane-header">
          <span class="pane-title">{rightVersion().label}（新版本）</span>
          <span class="diff-summary">
            新增 {appStore.state.diffs.filter((d) => d.kind === 'added').length} · 删除{' '}
            {appStore.state.diffs.filter((d) => d.kind === 'removed').length} · 修改{' '}
            {appStore.state.diffs.filter((d) => d.kind === 'modified').length}
          </span>
        </div>
        <MapCanvas
          versionId={() => rightVersion().id}
          features={() => featureArray(rightVersion())}
          layerStates={layerStates}
          versionKey={() => rightVersion().id}
          diffById={diffMap}
          cameraSignal={rightIncoming}
          onCamera={(cam) => setRightCam({ cam, n: ++tick.n })}
          annotationMode={() => false}
          onDraftAnnotation={() => undefined}
          onStats={(s) =>
            setStats((arr) => {
              const next = arr.filter((x) => x.side !== 'right');
              next.push({ side: 'right', ...s });
              return next;
            })
          }
        />
      </div>
    </div>
  );
}
