// Babylon.js 体素视口引擎:渲染、拾取、框选、批注标记、版本差异高亮
import {
  Engine, Scene, ArcRotateCamera, Vector3, HemisphericLight, DirectionalLight,
  MeshBuilder, StandardMaterial, Color3,
  TransformNode, Matrix,
  PointerEventTypes
} from '@babylonjs/core';
import { GridMaterial } from '@babylonjs/materials/grid/gridMaterial';
import { key, parseKey, GRID_SIZE, inBounds } from './voxel.js';

const HALF = GRID_SIZE / 2;

// 3D DDA 网格遍历(Amanatides & Woo),返回射线穿过的体素格子序列
function* rayVoxelWalk(origin, dir, maxSteps = 96) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = dir.x > 0 ? 1 : -1;
  const stepY = dir.y > 0 ? 1 : -1;
  const stepZ = dir.z > 0 ? 1 : -1;
  const tDeltaX = dir.x === 0 ? Infinity : Math.abs(1 / dir.x);
  const tDeltaY = dir.y === 0 ? Infinity : Math.abs(1 / dir.y);
  const tDeltaZ = dir.z === 0 ? Infinity : Math.abs(1 / dir.z);
  let tMaxX = dir.x === 0 ? Infinity : (dir.x > 0 ? x + 1 - origin.x : origin.x - x) / Math.abs(dir.x);
  let tMaxY = dir.y === 0 ? Infinity : (dir.y > 0 ? y + 1 - origin.y : origin.y - y) / Math.abs(dir.y);
  let tMaxZ = dir.z === 0 ? Infinity : (dir.z > 0 ? z + 1 - origin.z : origin.z - z) / Math.abs(dir.z);

  let face = null;
  for (let i = 0; i < maxSteps; i++) {
    yield { x, y, z, face };
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; tMaxX += tDeltaX; face = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      y += stepY; tMaxY += tDeltaY; face = [0, -stepY, 0];
    } else {
      z += stepZ; tMaxZ += tDeltaZ; face = [0, 0, -stepZ];
    }
    if (x < -HALF - 1 || x > HALF || y < -1 || y > GRID_SIZE || z < -HALF - 1 || z > HALF) break;
  }
}

export class VoxelEngine {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = {
      interactive: true,        // 是否启用编辑拾取
      readonly: false,          // 审核/对比界面
      onPaint: null,            // (x,y,z,face) => void
      onErase: null,
      onFill: null,
      onMarquee: null,          // (min,max) => void
      onEmptyTap: null,         // (x,y,z) => void 审核界面用于落点写批注
      ...opts
    };
    this.hiddenLayers = new Set();
    this.selection = new Set();
    this.markerColor = Color3.Green();
    this.diffAdded = new Set();
    this.diffRemoved = new Set();
    this.annotations = [];
    this.annotationMeshes = [];
    this._paintedKeys = new Set();

    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = Color3.FromHexString('#f4f8fb').toColor4(1);

    this.camera = new ArcRotateCamera('cam', -Math.PI / 2.4, Math.PI / 3.2, 34, new Vector3(0, 4, 0), this.scene);
    this.camera.attachControl(canvas, true);
    this.camera.wheelPrecision = 8;
    this.camera.panningSensibility = 60;
    this.camera.lowerRadiusLimit = 8;
    this.camera.upperRadiusLimit = 70;
    this.camera.minZ = 0.1;
    this.camera.mode = 0; // perspective

    const hemi = new HemisphericLight('hemi', new Vector3(0.4, 1, 0.6), this.scene);
    hemi.intensity = 0.95;
    const dir = new DirectionalLight('dir', new Vector3(-0.5, -1, -0.3), this.scene);
    dir.intensity = 0.5;

    // 体素根节点 + 单位立方体模板
    this.voxelRoot = new TransformNode('voxelRoot', this.scene);
    this.box = MeshBuilder.CreateBox('voxel-template', { size: 0.96 }, this.scene);
    const mat = new StandardMaterial('voxmat', this.scene);
    mat.specularColor = new Color3(0.15, 0.15, 0.15);
    this.box.material = mat;
    this.box.isPickable = false;
    this.box.parent = this.voxelRoot;
    this.box.thinInstanceCount = 0;

    // 高亮光标立方体
    this.cursor = MeshBuilder.CreateBox('cursor', { size: 1.02 }, this.scene);
    const cursorMat = new StandardMaterial('cursormat', this.scene);
    cursorMat.emissiveColor = Color3.FromHexString('#ffffff');
    cursorMat.alpha = 0.35;
    cursorMat.disableLighting = true;
    this.cursor.material = cursorMat;
    this.cursor.isPickable = false;
    this.cursor.setEnabled(false);

    // 选区/框选描边立方体(线框)
    this.marqueeMesh = this._buildWireBox('#ffb400');
    this.marqueeMesh.setEnabled(false);

    // 网格地面
    this.grid = MeshBuilder.CreateGround('grid', { width: GRID_SIZE, height: GRID_SIZE, subdivisions: GRID_SIZE }, this.scene);
    this.grid.position.y = 0;
    const gridMat = new GridMaterial('gridmat', this.scene);
    gridMat.majorUnitFrequency = 4;
    gridMat.gridRatio = 1;
    gridMat.mainColor = Color3.FromHexString('#dfe9f2');
    gridMat.lineColor = Color3.FromHexString('#8fb4d6');
    gridMat.opacity = 0.92;
    gridMat.backFaceCulling = false;
    this.grid.material = gridMat;
    this.grid.isPickable = false;

    // 层指示器(当前层高亮薄片)
    this.layerPlane = MeshBuilder.CreateGround('layerplane', { width: GRID_SIZE, height: GRID_SIZE }, this.scene);
    const lpMat = new StandardMaterial('lpmat', this.scene);
    lpMat.emissiveColor = Color3.FromHexString('#4fc3f7');
    lpMat.alpha = 0.12;
    lpMat.disableLighting = true;
    this.layerPlane.material = lpMat;
    this.layerPlane.isPickable = false;

    this._bindPointer();
    this.engine.runRenderLoop(() => this.scene.render());
    this._onResize = () => this.engine.resize();
    window.addEventListener('resize', this._onResize);
  }

  _buildWireBox(hex) {
    const m = MeshBuilder.CreateBox('wire', { size: 1 }, this.scene);
    const mat = new StandardMaterial('wiremat', this.scene);
    mat.wireframe = true;
    mat.emissiveColor = Color3.FromHexString(hex);
    mat.disableLighting = true;
    mat.zOffset = -2;
    m.material = mat;
    m.isPickable = false;
    return m;
  }

  // ---------------------------------------------------------------- 渲染同步
  setVoxels(voxels) {
    this.voxels = voxels;
    const list = [];
    for (const [k, v] of voxels) {
      if (this.hiddenLayers.has(v.y)) continue;
      list.push(v);
    }
    const count = list.length;
    // 至少分配 1 个槽位,实际渲染数量由 thinInstanceCount 控制(0 时根方块不显示)
    const matrices = new Float32Array(Math.max(1, count) * 16);
    const colors = new Float32Array(Math.max(1, count) * 4);
    list.forEach((v, i) => {
      Matrix.Translation(v.x + 0.5, v.y + 0.5, v.z + 0.5).copyToArray(matrices, i * 16);
      const c = Color3.FromHexString(v.c);
      // 差异着色优先
      let final = c;
      if (this.diffAdded.has(key(v.x, v.y, v.z))) final = Color3.FromHexString('#2ecc71');
      colors[i * 4] = final.r; colors[i * 4 + 1] = final.g; colors[i * 4 + 2] = final.b; colors[i * 4 + 3] = 1;
    });
    this.box.thinInstanceSetBuffer('matrix', matrices, 16, true);
    this.box.thinInstanceSetBuffer('color', colors, 4, true);
    this.box.thinInstanceCount = count;
    // 0 实例时禁用根方块,避免它以普通网格形式渲染在原点
    this.box.setEnabled(count > 0);
  }

  setHiddenLayers(ys) {
    this.hiddenLayers = new Set(ys);
    if (this.voxels) this.setVoxels(this.voxels);
  }

  setSelection(keys) {
    this.selection = new Set(keys);
    // 用第二组 thin instances 画选中描边(简化:整体高亮通过标记 mesh 实现)
    this._rebuildSelectionMarkers();
  }

  _rebuildSelectionMarkers() {
    if (this._selRoot) {
      this._selRoot.dispose();
      this._selRoot = null;
    }
    if (!this.selection.size) return;
    const root = new TransformNode('selRoot', this.scene);
    const tpl = this._buildWireBox('#ff8800');
    tpl.parent = root;
    const slots = Math.max(1, n);
    const arr = new Float32Array(slots * 16);
    let i = 0;
    for (const k of this.selection) {
      const p = parseKey(k);
      Matrix.Translation(p.x + 0.5, p.y + 0.5, p.z + 0.5).copyToArray(arr, i * 16);
      i++;
    }
    tpl.thinInstanceSetBuffer('matrix', arr, 16, true);
    tpl.thinInstanceCount = n;
    tpl.setEnabled(n > 0);
    this._selRoot = root;
  }

  setDiff(addedKeys, removedKeys) {
    this.diffAdded = new Set(addedKeys);
    // removed:用红色半透明方块标记"被删掉的位置"(基于旧数据,调用方传入旧 voxels 时直接渲染)
    if (this._removedRoot) this._removedRoot.dispose();
    if (removedKeys?.length) {
      const root = new TransformNode('removedRoot', this.scene);
      const tpl = MeshBuilder.CreateBox('rm', { size: 0.9 }, this.scene);
      const mat = new StandardMaterial('rmmat', this.scene);
      mat.emissiveColor = Color3.FromHexString('#e74c3c');
      mat.alpha = 0.45;
      mat.disableLighting = true;
      tpl.material = mat;
      tpl.isPickable = false;
      tpl.parent = root;
      const arr = new Float32Array(removedKeys.length * 16);
      removedKeys.forEach((k, i) => {
        const p = parseKey(k);
        Matrix.Translation(p.x + 0.5, p.y + 0.5, p.z + 0.5).copyToArray(arr, i * 16);
      });
      tpl.thinInstanceSetBuffer('matrix', arr, 16, true);
      tpl.thinInstanceCount = removedKeys.length;
      this._removedRoot = root;
    }
    if (this.voxels) this.setVoxels(this.voxels);
  }

  setAnnotations(annotations, onClick) {
    this.annotations = annotations;
    for (const m of this.annotationMeshes) m.dispose();
    this.annotationMeshes = [];
    annotations.forEach((a) => {
      const pin = MeshBuilder.CreateSphere('pin-' + a.id, { diameter: 0.7, segments: 8 }, this.scene);
      pin.position = new Vector3(a.pos.x + 0.5, a.pos.y + 1, a.pos.z + 0.5);
      const mat = new StandardMaterial('pinmat-' + a.id, this.scene);
      mat.emissiveColor = Color3.FromHexString(a.resolved ? '#7f8c8d' : '#e91e63');
      mat.disableLighting = true;
      pin.material = mat;
      pin.metadata = { annotationId: a.id };
      pin.isPickable = true;
      if (onClick) pin.actionOnPick = () => onClick(a);
      this.annotationMeshes.push(pin);
    });
  }

  setActiveLayer(y, locked) {
    this.layerPlane.position.y = y + 0.02;
    this.layerPlane.setEnabled(locked);
  }

  setGridVisible(visible) {
    this.grid.setEnabled(visible);
  }

  setCameraMode(mode) {
    const saved = this.camera.alpha;
    const beta = this.camera.beta;
    const radius = this.camera.radius;
    const target = this.camera.target.clone();
    this.camera.mode = mode === 'ortho' ? 1 : 0;
    if (mode === 'ortho') {
      this.camera.orthoTop = 16;
      this.camera.orthoBottom = -16;
      this.camera.orthoLeft = -16;
      this.camera.orthoRight = 16;
    }
    this.camera.alpha = saved;
    this.camera.beta = beta;
    this.camera.radius = radius;
    this.camera.setTarget(target);
  }

  // ---------------------------------------------------------------- 拾取与交互
  _rayFromEvent(evt) {
    const rect = this.canvas.getBoundingClientRect();
    const px = evt.clientX - rect.left;
    const py = evt.clientY - rect.top;
    const ray = this.scene.createPickingRay(
      px / rect.width, py / rect.height,
      Matrix.Identity(), this.camera, false
    );
    return ray;
  }

  /** DDA 拾取:返回第一个命中的已有体素 {x,y,z,face},以及下一个空气格 next */
  pickVoxel(ray) {
    const origin = ray.origin;
    const dir = ray.direction.clone().normalize();
    let hit = null;
    for (const cell of rayVoxelWalk(origin, dir)) {
      const k = key(cell.x, cell.y, cell.z);
      if (this.voxels && this.voxels.has(k)) {
        hit = { ...cell, face: cell.face };
        break;
      }
      if (!inBounds(cell.x, cell.y, cell.z)) break;
    }
    // 空气格:射线与 y=0 / 当前层平面的交点
    let next = null;
    if (dir.y < 0) {
      const t = -origin.y / dir.y;
      if (t > 0 && t < 200) {
        const p = origin.add(dir.scale(t));
        next = { x: Math.floor(p.x), y: this._layerPlaneY ?? 0, z: Math.floor(p.z) };
      }
    }
    return { hit, next };
  }

  _bindPointer() {
    const canvas = this.canvas;
    let down = null;       // 按下信息
    let dragMoved = false;
    let marqueeStart = null;

    canvas.addEventListener('pointerdown', (evt) => {
      if (this.opts.readonly) return;
      if (evt.button !== 0) return;
      // 编辑模式下左键用于落笔/框选,相机旋转交给右键与中键
      this.camera.detachControl();
      this._cameraDetached = true;
      down = { x: evt.clientX, y: evt.clientY };
      dragMoved = false;
      marqueeStart = this._rayFromEvent(evt);
      this._paintedKeys = new Set();
    });

    const reattach = () => {
      if (this._cameraDetached) {
        this.camera.attachControl(canvas, true);
        this._cameraDetached = false;
      }
    };
    window.addEventListener('pointerup', reattach);
    this._reattachCamera = reattach;

    canvas.addEventListener('pointermove', (evt) => {
      if (down && (Math.abs(evt.clientX - down.x) > 4 || Math.abs(evt.clientY - down.y) > 4)) {
        dragMoved = true;
      }
      if (!this.opts.interactive) return;
      // 悬停光标
      const ray = this._rayFromEvent(evt);
      const { hit, next } = this.pickVoxel(ray);
      const target = hit || next;
      if (target && inBounds(target.x, target.y, target.z)) {
        this.cursor.setEnabled(true);
        this.cursor.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
      } else {
        this.cursor.setEnabled(false);
      }
      // 拖动中连续落笔/擦除
      if (down && !this.opts.readonly) {
        if (this.opts.tool === 'brush') this._strokeApply('paint', ray);
        if (this.opts.tool === 'eraser') this._strokeApply('erase', ray);
      }
    });

    canvas.addEventListener('pointerup', (evt) => {
      if (!down) return;
      const wasDrag = dragMoved;
      down = null;
      const ray = this._rayFromEvent(evt);
      const { hit, next } = this.pickVoxel(ray);

      // 框选工具:拖动 => 框选;单击 => 选连通团
      if (this.opts.tool === 'select' && !this.opts.readonly) {
        if (wasDrag && marqueeStart) {
          this._doMarquee(marqueeStart, ray);
        } else if (hit) {
          this.opts.onSelectConnected?.(key(hit.x, hit.y, hit.z));
        }
        return;
      }
      if (wasDrag) return;

      // 单击(拖动结束视为旋转/框选,不落点)
      if (this.opts.readonly) {
        if (!wasDrag) this.opts.onEmptyTap?.(next || hit);
        return;
      }
      if (this.opts.tool === 'brush') this.opts.onPaint?.(hit, next, evt);
      if (this.opts.tool === 'eraser' && hit) this.opts.onErase?.(hit);
      if (this.opts.tool === 'fill' && (hit || next)) this.opts.onFill?.(hit || next);
    });

    // 批注 pin 点击(独立于编辑拾取)
    this.scene.onPointerObservable.add((info) => {
      if (info.type !== PointerEventTypes.POINTERPICK) return;
      const picked = info.pickInfo?.pickedMesh;
      if (picked?.metadata?.annotationId && picked.actionOnPick) {
        picked.actionOnPick();
      }
    });
  }

  _strokeApply(kind, ray) {
    const { hit, next } = this.pickVoxel(ray);
    const target = kind === 'paint' ? (hit ? this._adjacent(hit) : next) : hit;
    if (!target) return;
    const k = key(target.x, target.y, target.z);
    if (this._paintedKeys.has(k)) return;
    this._paintedKeys.add(k);
    if (kind === 'paint') this.opts.onPaint?.(hit, target, null, true);
    else this.opts.onErase?.(target, true);
  }

  _adjacent(hit) {
    if (!hit.face) return hit;
    return { x: hit.x + hit.face[0], y: hit.y + hit.face[1], z: hit.z + hit.face[2] };
  }

  _doMarquee(rayA, rayB) {
    // 把两条射线投到 y=0 平面取角点,形成 AABB
    const planeY = this._layerPlaneY ?? 0;
    const toPlane = (ray) => {
      const t = (planeY - ray.origin.y) / ray.direction.y;
      if (!isFinite(t) || t <= 0) return null;
      const p = ray.origin.add(ray.direction.scale(t));
      return { x: Math.floor(p.x), z: Math.floor(p.z) };
    };
    const a = toPlane(rayA);
    const b = toPlane(rayB);
    if (!a || !b) return;
    const min = { x: Math.min(a.x, b.x), y: planeY, z: Math.min(a.z, b.z) };
    const max = { x: Math.max(a.x, b.x), y: planeY, z: Math.max(a.z, b.z) };
    // 框选覆盖整列高度(层锁定时只取该层)
    if (this._lockLayer !== null) {
      min.y = max.y = this._lockLayer;
    } else {
      min.y = 0; max.y = GRID_SIZE - 1;
    }
    this.showMarquee(min, max);
    this.opts.onMarquee?.(min, max);
  }

  showMarquee(min, max) {
    const sx = max.x - min.x + 1, sy = max.y - min.y + 1, sz = max.z - min.z + 1;
    this.marqueeMesh.scaling.set(sx, sy, sz);
    this.marqueeMesh.position.set(min.x + sx / 2, min.y + sy / 2, min.z + sz / 2);
    this.marqueeMesh.setEnabled(true);
  }

  hideMarquee() {
    this.marqueeMesh.setEnabled(false);
  }

  setLayerPlane(y, lockLayer) {
    this._layerPlaneY = y;
    this._lockLayer = lockLayer ? y : null;
  }

  setTool(tool) {
    this.opts.tool = tool;
    if (tool !== 'select') this.hideMarquee();
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    if (this._reattachCamera) window.removeEventListener('pointerup', this._reattachCamera);
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }
}
