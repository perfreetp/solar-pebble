// 编辑器全局状态:经典 Svelte store 契约(可在 .svelte 组件外使用)
import { cloneVoxels, GRID_SIZE } from '../voxel.js';
import { TEMPLATES } from '../templates.js';

const DEFAULT_COLORS = ['#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#2980b9', '#8e44ad', '#7f4a2d', '#2c3e50'];

function createEditorStore() {
  const state = $state({
    voxels: new Map(),
    tool: 'brush', // brush | eraser | fill | select
    color: '#c0392b',
    palette: [...DEFAULT_COLORS], // 最近用过的颜色(最近在最前)
    mirror: false,
    showGrid: true,
    cameraMode: 'perspective', // perspective | ortho
    activeLayer: 0, // 当前层(y)
    layerLockEnabled: false, // 开启后只改 activeLayer
    hiddenLayers: [], // 被隐藏的层 y 列表
    selection: [], // 选中的体素 key
    clipboard: null,
    pasteOrigin: null,
    marquee: null, // {min,max} 屏幕框选暂存
    projectName: '我的昆虫模型'
  });

  const past = [];
  const future = [];

  function snapshot() {
    return {
      voxels: cloneVoxels(state.voxels),
      selection: [...state.selection],
      hiddenLayers: [...state.hiddenLayers]
    };
  }
  function commit() {
    past.push(snapshot());
    if (past.length > 60) past.shift();
    future.length = 0;
  }
  function restore(snap) {
    state.voxels = cloneVoxels(snap.voxels);
    state.selection = [...snap.selection];
    state.hiddenLayers = [...snap.hiddenLayers];
  }

  function undo() {
    if (!past.length) return;
    future.push(snapshot());
    restore(past.pop());
  }
  function redo() {
    if (!future.length) return;
    past.push(snapshot());
    restore(future.pop());
  }

  function rememberColor(c) {
    state.palette = [c, ...state.palette.filter(x => x !== c)].slice(0, 12);
  }

  function loadTemplate(id) {
    const tpl = TEMPLATES.find(t => t.id === id);
    if (!tpl) return;
    commit();
    state.voxels = tpl.build();
    state.selection = [];
    state.projectName = tpl.name;
  }

  function clearAll() {
    commit();
    state.voxels = new Map();
    state.selection = [];
  }

  function replaceVoxels(map, { track = true } = {}) {
    if (track) commit();
    state.voxels = map;
  }

  function setSelection(keys) {
    state.selection = keys;
  }

  function toggleLayerHidden(y) {
    if (state.hiddenLayers.includes(y)) {
      state.hiddenLayers = state.hiddenLayers.filter(v => v !== y);
    } else {
      state.hiddenLayers = [...state.hiddenLayers, y];
    }
  }

  return {
    state,
    subscribe(fn) {
      // $state 深响应:组件里用 $editor 拿到 state 本身
      fn(state);
      return () => {};
    },
    // 直接暴露 state 给组件 import 使用(配合 $state 深响应)
    get s() { return state; },
    commit, undo, redo,
    rememberColor, loadTemplate, clearAll, replaceVoxels,
    setSelection, toggleLayerHidden,
    GRID_SIZE,
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0
  };
}

export const editor = createEditorStore();
