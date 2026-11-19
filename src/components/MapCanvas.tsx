import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js';
import type { CameraState, DiffKind, Feature, LayerId, LayerState } from '../types';
import { MapView } from '../lib/map-view';
import { appStore } from '../store';

export interface MapCanvasProps {
  /** 该面板展示的版本 id（决定读取哪份批注） */
  versionId: () => string;
  features: () => readonly Feature[];
  layerStates: () => Record<LayerId, LayerState>;
  versionKey: () => string;
  diffById: () => ReadonlyMap<string, DiffKind> | null;
  /** 外部推送的相机状态（并排对比联动），undefined 表示不联动 */
  cameraSignal: () => CameraState | undefined;
  onCamera: (cam: CameraState) => void;
  onStats?: (s: { tiles: number; cells: number; features: number; offscreen: boolean }) => void;
  annotationMode: () => boolean;
  /** 批注模式下在空白处点击打点 */
  onDraftAnnotation: (world: { x: number; y: number }) => void;
}

export function MapCanvas(props: MapCanvasProps): JSX.Element {
  let canvasEl: HTMLCanvasElement | undefined;
  let view: MapView | null = null;
  const [selectedSet, setSelectedSet] = createSignal<Set<string>>(new Set());
  const [hoveredId, setHoveredId] = createSignal<string | null>(null);
  let suppressCameraSync = false;

  // 与全局 store 的选中/悬停保持同步
  createEffect(() => setSelectedSet(new Set(appStore.state.selectedIds)));
  createEffect(() => setHoveredId(appStore.state.hoveredId));

  onMount(() => {
    if (!canvasEl) return;
    view = new MapView(
      canvasEl,
      props.features(),
      props.layerStates(),
      props.versionKey(),
      props.diffById(),
      {
        isAnnotationMode: () => props.annotationMode(),
        getSelectedIds: () => selectedSet(),
        getHoveredId: () => hoveredId(),
        onHover: (id) => {
          setHoveredId(id);
          appStore.setHovered(id);
        },
        onFeatureClick: (feature, additive) => {
          if (additive) appStore.toggleSelection(feature.id);
          else appStore.setSelection([feature.id]);
        },
        onBoxSelect: (features) => appStore.setSelection(features.map((f) => f.id)),
        onMapClick: (wx, wy) => {
          if (props.annotationMode()) {
            props.onDraftAnnotation({ x: wx, y: wy });
          } else {
            appStore.clearSelection();
          }
        },
        onCameraChange: (cam) => {
          if (suppressCameraSync) return;
          props.onCamera(cam);
        },
        getAnnotations: () =>
          appStore.state.versions.find((v) => v.id === props.versionId())?.annotations ?? [],
        getActiveAnnotationId: () => appStore.state.activeAnnotationId,
        onAnnotationClick: (id) => appStore.setActiveAnnotation(id),
      },
    );

    const ro = new ResizeObserver(() => view?.resize());
    ro.observe(canvasEl);
    onCleanup(() => {
      ro.disconnect();
      view?.destroy();
      const reg = (window as unknown as { __mapViews?: MapView[] }).__mapViews;
      if (reg && view) {
        const i = reg.indexOf(view);
        if (i >= 0) reg.splice(i, 1);
      }
    });

    // 调试/自动化测试句柄
    const w = window as unknown as { __mapViews?: MapView[] };
    (w.__mapViews ??= []).push(view);

    const report = () => {
      if (view && props.onStats) {
        const st = view.spatialStats;
        props.onStats({
          tiles: view.tileCacheCount,
          cells: st.cells,
          features: st.totalFeatures,
          offscreen: view.offscreen,
        });
      }
    };
    const timer = window.setInterval(report, 1500);
    onCleanup(() => window.clearInterval(timer));
  });

  // 数据版本切换 → 重建索引与瓦片
  const dataKey = createMemo(() => `${props.versionKey()}:${props.features().length}`);
  createEffect(() => {
    if (!view) return;
    dataKey();
    view.setData(props.features(), props.layerStates(), props.versionKey(), props.diffById());
  });

  // 样式变化（显隐/透明度/顺序/差异）→ 仅更新样式，旧瓦片保留作回退
  createEffect(() => {
    if (!view) return;
    props.layerStates();
    props.diffById();
    view.setStyle(props.layerStates(), props.versionKey(), props.diffById());
  });

  // 外部相机同步（并排对比时另一面板联动）
  createEffect(() => {
    const cam = props.cameraSignal();
    if (!view || !cam) return;
    suppressCameraSync = true;
    view.applyExternalCamera(cam);
    suppressCameraSync = false;
  });

  return (
    <canvas
      ref={canvasEl}
      class="map-canvas"
      style={{ width: '100%', height: '100%', display: 'block', 'touch-action': 'none' }}
    />
  );
}
