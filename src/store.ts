import { createRoot, createSignal } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type {
  Feature,
  FeatureDiff,
  LayerId,
  LayerState,
  ReviewVersion,
} from './types';
import { LAYER_METAS } from './layers';
import { deriveVersion, generateFeatures } from './data';
import {
  buildVersion,
  diffMap,
  diffVersions,
  featureArray,
  loadPersisted,
  makeAnnotation,
  savePersisted,
  uid,
} from './review';

const BASE_SEED = 20261120;

function defaultLayerStates(): Record<LayerId, LayerState> {
  const states = {} as Record<LayerId, LayerState>;
  LAYER_METAS.forEach((m, i) => {
    states[m.id] = { visible: true, opacity: 1, zOrder: i };
  });
  return states;
}

interface VersionSeedRecord {
  id: string;
  label: string;
  createdAt: string;
  note: string;
  seed: number;
  baseVersionId: string | null;
}

interface AppState {
  versions: ReviewVersion[];
  activeVersionId: string;
  layerStates: Record<LayerId, LayerState>;
  selectedIds: string[];
  hoveredId: string | null;
  /** 并排对比模式 */
  compareMode: boolean;
  compareLeftId: string | null;
  compareRightId: string | null;
  /** 版本间差异（左右版本） */
  diffs: FeatureDiff[];
  /** 批注工具是否激活 */
  annotationMode: boolean;
  annotationAuthor: string;
  activeAnnotationId: string | null;
}

function buildInitialVersions(): { versions: ReviewVersion[]; seeds: VersionSeedRecord[] } {
  const persisted = loadPersisted();
  if (persisted && persisted.versions.length >= 2) {
    // 沿版本链顺序重建：基线版本由种子生成，后续版本基于「上一版本的要素」派生，
    // 保证刷新后每个版本的几何与提交时完全一致（含多次提交的 V3、V4…）。
    const byId = new Map<string, Feature[]>();
    const versions: ReviewVersion[] = [];
    for (const rec of persisted.versions) {
      const feats =
        rec.baseVersionId == null
          ? generateFeatures(rec.seed)
          : deriveVersion(byId.get(rec.baseVersionId) ?? generateFeatures(BASE_SEED), rec.seed).features;
      byId.set(rec.id, feats);
      versions.push({
        id: rec.id,
        label: rec.label,
        createdAt: rec.createdAt,
        note: rec.note,
        features: Object.fromEntries(feats.map((f) => [f.id, f])),
        annotations: rec.annotations,
      });
    }
    return {
      versions,
      seeds: persisted.versions.map((r) => ({
        id: r.id,
        label: r.label,
        createdAt: r.createdAt,
        note: r.note,
        seed: r.seed,
        baseVersionId: r.baseVersionId,
      })),
    };
  }

  // 初始：V1 基线 + V2 修订（含新增/删除/修改，用于演示对比）
  const v1Feats = generateFeatures(BASE_SEED);
  const v2Seed = BASE_SEED + 7;
  const derived = deriveVersion(v1Feats, v2Seed);
  const v1 = buildVersion('v1', 'V1 初版布局', '首次提交的发射场平面布局基线', v1Feats, []);
  const v2 = buildVersion('v2', 'V2 评审修订', '根据初审意见调整点位与通道', derived.features, []);
  return {
    versions: [v1, v2],
    seeds: [
      { id: 'v1', label: v1.label, createdAt: v1.createdAt, note: v1.note, seed: BASE_SEED, baseVersionId: null },
      // seed 即派生时使用的随机种子，重建时对上一版本要素执行同一派生
      { id: 'v2', label: v2.label, createdAt: v2.createdAt, note: v2.note, seed: v2Seed, baseVersionId: 'v1' },
    ],
  };
}

export const appStore = createRoot(() => {
  const initial = buildInitialVersions();
  const [state, setState] = createStore<AppState>({
    versions: initial.versions,
    activeVersionId: initial.versions[0]!.id,
    layerStates: defaultLayerStates(),
    selectedIds: [],
    hoveredId: null,
    compareMode: false,
    compareLeftId: initial.versions[0]!.id,
    compareRightId: initial.versions[1]!.id,
    diffs: [],
    annotationMode: false,
    annotationAuthor: '审核人-张工',
    activeAnnotationId: null,
  });

  const seedRecords = createSignal<VersionSeedRecord[]>(initial.seeds);
  const [getSeeds, setSeeds] = seedRecords;

  const persist = () => {
    const annotationsById = new Map(state.versions.map((v) => [v.id, v.annotations]));
    savePersisted({
      versions: getSeeds().map((rec) => ({
        ...rec,
        annotations: annotationsById.get(rec.id) ?? [],
      })),
    });
  };

  const activeVersion = (): ReviewVersion =>
    state.versions.find((v) => v.id === state.activeVersionId) ?? state.versions[0]!;

  const activeFeatures = (): Feature[] => featureArray(activeVersion());

  const selectVersion = (id: string) => {
    setState({ activeVersionId: id, selectedIds: [], hoveredId: null, activeAnnotationId: null });
  };

  /** 提交新版本：基于当前版本数据派生一批确定性变更，形成新快照 */
  const submitNewVersion = (label: string, note: string) => {
    const base = activeVersion();
    const newSeed = BASE_SEED + state.versions.length * 101 + 13;
    const derived = deriveVersion(featureArray(base), newSeed);
    const id = uid('v');
    const version = buildVersion(id, label, note, derived.features, []);
    setState(
      produce((s) => {
        s.versions.push(version);
        s.activeVersionId = id;
        s.selectedIds = [];
        s.hoveredId = null;
      }),
    );
    setSeeds((recs) => [
      ...recs,
      { id, label, createdAt: version.createdAt, note, seed: newSeed, baseVersionId: base.id },
    ]);
    persist();
  };

  // ---------------- 图层控制 ----------------

  const toggleLayer = (id: LayerId) =>
    setState('layerStates', id, 'visible', (v) => !v);

  const setLayerOpacity = (id: LayerId, opacity: number) =>
    setState('layerStates', id, 'opacity', opacity);

  const moveLayer = (id: LayerId, dir: -1 | 1) => {
    const sorted = [...LAYER_METAS].sort(
      (a, b) => state.layerStates[a.id].zOrder - state.layerStates[b.id].zOrder,
    );
    const idx = sorted.findIndex((m) => m.id === id);
    const swap = idx + dir;
    if (swap < 0 || swap >= sorted.length) return;
    const a = sorted[idx]!.id;
    const b = sorted[swap]!.id;
    setState(
      produce((s) => {
        const za = s.layerStates[a].zOrder;
        s.layerStates[a].zOrder = s.layerStates[b].zOrder;
        s.layerStates[b].zOrder = za;
      }),
    );
  };

  // ---------------- 选择 / 悬停 ----------------

  const setHovered = (id: string | null) => setState({ hoveredId: id });

  const setSelection = (ids: string[]) => setState({ selectedIds: ids });

  const toggleSelection = (id: string) =>
    setState(
      produce((s) => {
        const i = s.selectedIds.indexOf(id);
        if (i >= 0) s.selectedIds.splice(i, 1);
        else s.selectedIds.push(id);
      }),
    );

  const clearSelection = () => setState({ selectedIds: [] });

  // ---------------- 批注 ----------------

  const addAnnotation = (featureId: string | null, x: number, y: number, content: string) => {
    const ann = makeAnnotation(featureId, x, y, state.annotationAuthor, content);
    setState(
      produce((s) => {
        const v = s.versions.find((vv) => vv.id === s.activeVersionId);
        v?.annotations.push(ann);
        s.activeAnnotationId = ann.id;
      }),
    );
    persist();
    return ann;
  };

  const replyAnnotation = (annotationId: string, action: 'resolved' | 'rejected', content: string) => {
    setState(
      produce((s) => {
        const v = s.versions.find((vv) => vv.id === s.activeVersionId);
        const ann = v?.annotations.find((a) => a.id === annotationId);
        if (!ann) return;
        ann.replies.push({
          id: uid('rep'),
          author: '制作方-李工',
          action,
          content,
          createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
        });
        ann.status = action === 'resolved' ? 'resolved' : 'rejected';
      }),
    );
    persist();
  };

  const setActiveAnnotation = (id: string | null) => setState({ activeAnnotationId: id });

  const setAnnotationMode = (on: boolean) =>
    setState({ annotationMode: on, activeAnnotationId: on ? state.activeAnnotationId : null });

  // ---------------- 对比模式 ----------------

  const enterCompare = (leftId: string, rightId: string) => {
    const left = state.versions.find((v) => v.id === leftId);
    const right = state.versions.find((v) => v.id === rightId);
    if (!left || !right) return;
    const diffs = diffVersions(left.features, right.features);
    setState({
      compareMode: true,
      compareLeftId: leftId,
      compareRightId: rightId,
      diffs,
      selectedIds: [],
      hoveredId: null,
    });
  };

  const exitCompare = () => setState({ compareMode: false, diffs: [] });

  const currentDiffMap = (): ReadonlyMap<string, FeatureDiff['kind']> =>
    diffMap(state.diffs);

  return {
    state,
    activeVersion,
    activeFeatures,
    selectVersion,
    submitNewVersion,
    toggleLayer,
    setLayerOpacity,
    moveLayer,
    setHovered,
    setSelection,
    toggleSelection,
    clearSelection,
    addAnnotation,
    replyAnnotation,
    setActiveAnnotation,
    setAnnotationMode,
    enterCompare,
    exitCompare,
    currentDiffMap,
    annotations: () => activeVersion().annotations,
  };
});

export type AppStore = typeof appStore;
