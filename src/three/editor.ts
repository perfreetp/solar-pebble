import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { store } from '../store';
import { CATALOG, KIND_LABEL } from '../catalog';
import type { ComponentKind, SceneComponent } from '../types';
import {
  alignLeft, distributeEvenly, findCollisions, insideTank, snap, snapAngle,
  surfaceAlign, tuple, v3, worldBox
} from '../geometry';
import { buildMesh, INVALID_COLOR, setGroupHighlight } from './meshes';
import { dragBus } from '../drag-bus';

interface InvalidState {
  invalidIds: Set<string>;
  reason: string;
  valid: boolean;
}

/**
 * 三维编辑器引擎：场景渲染、射线拾取、变换手柄、碰撞拦截、
 * 框选、俯视图与展箱占位轮廓。
 */
export class EditorEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private perspCamera: THREE.PerspectiveCamera;
  private orthoCamera: THREE.OrthographicCamera;
  private activeCamera: THREE.Camera;
  private perspControls: OrbitControls;
  private orthoControls: OrbitControls;
  private activeControls: OrbitControls;
  private transformControls: TransformControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private grid: THREE.GridHelper;
  private compLayer = new THREE.Group();   // 构件层
  private footprintLayer = new THREE.Group(); // 展箱占位轮廓
  private meshMap = new Map<string, THREE.Group>();
  private proxy = new THREE.Object3D();    // 多选变换代理
  private lastProxy = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  private gizmoHelper: THREE.Object3D | null = null;
  private proxyMode: 'translate' | 'rotate' = 'translate';

  private ghost: THREE.Mesh;               // 拖入预览
  private ghostValid = true;

  private invalid: InvalidState = { invalidIds: new Set(), reason: '', valid: true };
  private dragSnapshot: SceneComponent[] | null = null;
  private suppressStoreSync = false;
  private raf = 0;
  private resizeObs: ResizeObserver;
  private storeUnsub: () => void;

  // 框选
  private marquee: HTMLDivElement;
  private marqueeing = false;
  private marqueeStart = { x: 0, y: 0 };
  private downHit = false;
  private downPos = { x: 0, y: 0 };

  /** 给 UI 的回调 */
  onMessage: (text: string, kind: 'error' | 'info') => void = () => undefined;
  onSelectionChange: () => void = () => undefined;

  constructor(container: HTMLElement) {
    this.container = container;
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0xeef2f5);
    this.scene.fog = new THREE.Fog(0xeef2f5, 6, 14);

    // 相机
    this.perspCamera = new THREE.PerspectiveCamera(50, w / h, 0.05, 100);
    this.perspCamera.position.set(2.4, 2.0, 2.6);
    const aspect = w / h;
    const frustum = 3.2;
    this.orthoCamera = new THREE.OrthographicCamera(
      (-frustum * aspect) / 2, (frustum * aspect) / 2,
      frustum / 2, -frustum / 2, 0.05, 100
    );
    this.orthoCamera.position.set(0, 5, 0.0001);
    this.orthoCamera.up.set(0, 0, -1); // 俯视图：屏幕上方 = -Z
    this.orthoCamera.lookAt(0, 0, 0);
    this.activeCamera = this.perspCamera;

    // 控制器
    this.perspControls = new OrbitControls(this.perspCamera, this.renderer.domElement);
    this.perspControls.enableDamping = true;
    this.perspControls.dampingFactor = 0.12;
    this.perspControls.target.set(0, 0.35, 0);
    this.orthoControls = new OrbitControls(this.orthoCamera, this.renderer.domElement);
    this.orthoControls.enableRotate = false;
    this.orthoControls.enableDamping = true;
    this.orthoControls.target.set(0, 0, 0);
    this.orthoControls.enabled = false;
    this.activeControls = this.perspControls;

    // 灯光
    const hemi = new THREE.HemisphereLight(0xffffff, 0xb8a888, 0.85);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(3, 5, 2.5);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -3;
    dir.shadow.camera.right = 3;
    dir.shadow.camera.top = 3;
    dir.shadow.camera.bottom = -3;
    dir.shadow.camera.far = 15;
    this.scene.add(dir);

    // 地面与网格
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshStandardMaterial({ color: 0xd9d2c4, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.grid = this.buildGrid();
    this.scene.add(this.grid);

    this.scene.add(this.compLayer, this.footprintLayer);

    // 变换手柄
    this.transformControls = new TransformControls(this.perspCamera, this.renderer.domElement);
    this.transformControls.addEventListener('dragging-changed', (e) => {
      const dragging = (e as unknown as { value: boolean }).value;
      this.activeControls.enabled = !dragging;
      if (dragging) this.onTransformStart();
      else this.onTransformEnd();
    });
    this.transformControls.addEventListener('objectChange', () => this.onTransformChange());
    this.gizmoHelper = this.transformControls.getHelper
      ? this.transformControls.getHelper()
      : (this.transformControls as unknown as THREE.Object3D);
    this.scene.add(this.gizmoHelper);

    // 拖入预览 ghost
    this.ghost = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.35, depthWrite: false })
    );
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    // 框选框 DOM
    this.marquee = document.createElement('div');
    Object.assign(this.marquee.style, {
      position: 'absolute', border: '1px dashed #2f7ed8', background: 'rgba(47,126,216,0.08)',
      pointerEvents: 'none', display: 'none', zIndex: '5'
    } satisfies Partial<CSSStyleDeclaration>);
    container.appendChild(this.marquee);

    this.bindEvents();
    this.syncFromStore();
    this.storeUnsub = store.subscribe(() => {
      if (!this.suppressStoreSync) this.syncFromStore();
    });

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.loop();
  }

  // ---------------- 场景构建 / 同步 ----------------

  private buildGrid(): THREE.GridHelper {
    const { gridSize, gridDivisions } = store.settings;
    const old = this.grid;
    const g = new THREE.GridHelper(
      gridSize * gridDivisions, gridDivisions, 0x8aa0ad, 0xc3ced6
    );
    (g.material as THREE.Material).transparent = true;
    (g.material as THREE.Material).opacity = 0.85;
    if (old) this.scene.remove(old);
    return g;
  }

  refreshGrid(): void {
    const fresh = this.buildGrid();
    this.grid = fresh;
    this.scene.add(fresh);
  }

  /** 全量同步 store → three 场景（按 id diff，保留未变化的 mesh） */
  syncFromStore(): void {
    const ids = new Set(store.components.map((c) => c.id));
    for (const [id, group] of this.meshMap) {
      if (!ids.has(id)) {
        this.compLayer.remove(group);
        group.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.geometry.dispose();
            const mat = m.material;
            if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
            else mat?.dispose();
          }
        });
        this.meshMap.delete(id);
      }
    }
    for (const c of store.components) {
      let group = this.meshMap.get(c.id);
      if (!group) {
        group = buildMesh(c);
        group.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = c.kind !== 'tank';
            m.receiveShadow = true;
          }
        });
        this.meshMap.set(c.id, group);
        this.compLayer.add(group);
      }
      group.position.copy(v3(c.position));
      group.rotation.set(c.rotation.x, c.rotation.y, c.rotation.z);
      group.scale.set(c.scale.x, c.scale.y, c.scale.z);
    }
    this.refreshHighlight();
    this.refreshFootprints();
    this.attachGizmo();
  }

  private refreshHighlight(): void {
    for (const c of store.components) {
      const group = this.meshMap.get(c.id);
      if (!group) continue;
      if (this.invalid.invalidIds.has(c.id)) setGroupHighlight(group, 'invalid');
      else if (store.selection.has(c.id)) setGroupHighlight(group, 'selected');
      else setGroupHighlight(group, 'none');
    }
  }

  /** 展箱占位轮廓：俯视矩形 + 名称/尺寸标签 */
  private refreshFootprints(): void {
    this.footprintLayer.clear();
    if (!store.settings.showFootprint && !store.settings.topView) return;
    for (const tank of store.components.filter((c) => c.kind === 'tank')) {
      const b = worldBox(tank);
      const w = b.max.x - b.min.x;
      const d = b.max.z - b.min.z;
      const rectPts = [
        new THREE.Vector3(b.min.x, 0.012, b.min.z),
        new THREE.Vector3(b.max.x, 0.012, b.min.z),
        new THREE.Vector3(b.max.x, 0.012, b.max.z),
        new THREE.Vector3(b.min.x, 0.012, b.max.z)
      ];
      const line = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(rectPts),
        new THREE.LineBasicMaterial({ color: 0x2f7ed8 })
      );
      this.footprintLayer.add(line);

      const label = this.makeLabel(
        `${tank.name}  占位 ${w.toFixed(2)}m × ${d.toFixed(2)}m`,
        b.min.x, b.max.z
      );
      this.footprintLayer.add(label);
    }
  }

  private makeLabel(text: string, x: number, z: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 56;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(47,126,216,0.85)';
    ctx.roundRect(2, 2, 316, 52, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '22px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 12, 29);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sprite.position.set(x, 0.05, z);
    sprite.scale.set(0.62, 0.11, 1);
    return sprite;
  }

  // ---------------- 变换手柄 ----------------

  private attachGizmo(): void {
    const selected = store.getSelected();
    this.transformControls.detach();
    if (selected.length === 0) {
      if (this.gizmoHelper) this.gizmoHelper.visible = false;
      return;
    }
    if (this.gizmoHelper) this.gizmoHelper.visible = true;
    if (selected.length === 1) {
      const group = this.meshMap.get(selected[0].id);
      if (group) this.transformControls.attach(group);
      this.transformControls.setMode(store.settings.transformMode);
    } else {
      // 多选：代理对象，仅平移/旋转
      this.proxy.position.set(0, 0, 0);
      this.proxy.rotation.set(0, 0, 0);
      this.proxy.scale.set(1, 1, 1);
      this.lastProxy.pos.set(0, 0, 0);
      this.lastProxy.quat.identity();
      this.proxyMode = store.settings.transformMode === 'rotate' ? 'rotate' : 'translate';
      this.transformControls.attach(this.proxy);
      this.transformControls.setMode(this.proxyMode);
    }
    this.transformControls.size = 0.9;
  }

  setTransformMode(mode: 'translate' | 'rotate' | 'scale'): void {
    store.updateSettings({ transformMode: mode });
    this.attachGizmo();
  }

  private onTransformStart(): void {
    // 快照全部构件：展箱拖动时箱内构件也会变化，回滚需要它们
    this.dragSnapshot = store.components.map((c) => JSON.parse(JSON.stringify(c)) as SceneComponent);
    this.invalid = { invalidIds: new Set(), reason: '', valid: true };
  }

  private onTransformChange(): void {
    if (!this.dragSnapshot) return;
    const mode = store.settings.transformMode;
    const selected = store.getSelected();
    if (selected.length === 0) return;

    // 以当前 mesh 状态构造工作副本
    const working = selected.map((c) => {
      const g = this.meshMap.get(c.id)!;
      const copy: SceneComponent = JSON.parse(JSON.stringify(c));
      copy.position = tuple(g.position);
      copy.rotation = { x: g.rotation.x, y: g.rotation.y, z: g.rotation.z };
      copy.scale = { x: g.scale.x, y: g.scale.y, z: g.scale.z };
      return copy;
    });

    // 多选时代理对象的增量
    if (selected.length > 1) {
      this.applyProxyDelta(working);
    }

    // 移动/旋转展箱时，箱内构件跟随
    this.carryTankChildren(working);

    const result = this.validateWorking(working);
    // 缩放展箱直接拦截（箱内构件不会随缩放，避免穿模）
    if (mode === 'scale' && working.some((c) => c.kind === 'tank')) {
      for (const t of working.filter((c) => c.kind === 'tank')) result.invalidIds.add(t.id);
      result.reason = '展箱不支持缩放，请改为调整箱内构件';
      result.valid = false;
    }
    this.invalid = result;
    this.refreshHighlight();
    if (!result.valid) {
      this.onMessage(result.reason, 'error');
    }
  }

  /** 工作副本里若含展箱，把箱内构件按相同平移/旋转增量一并移动 */
  private carryTankChildren(working: SceneComponent[]): void {
    const snapshotMap = new Map(this.dragSnapshot!.map((c) => [c.id, c]));
    for (const tank of working.filter((c) => c.kind === 'tank')) {
      const before = snapshotMap.get(tank.id);
      if (!before) continue;
      const dp = v3(tank.position).sub(v3(before.position));
      const dEuler = new THREE.Euler(
        tank.rotation.x - before.rotation.x,
        tank.rotation.y - before.rotation.y,
        tank.rotation.z - before.rotation.z
      );
      const dq = new THREE.Quaternion().setFromEuler(dEuler);
      const center = v3(before.position);
      for (const child of store.components.filter((c) => c.tankId === tank.id)) {
        if (working.some((w) => w.id === child.id)) continue;
        const copy: SceneComponent = JSON.parse(JSON.stringify(child));
        // 绕展箱中心旋转后平移
        const rel = v3(copy.position).sub(center).applyQuaternion(dq);
        copy.position = tuple(center.clone().add(rel).add(dp));
        const q = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(copy.rotation.x, copy.rotation.y, copy.rotation.z)
        ).multiply(dq);
        const e = new THREE.Euler().setFromQuaternion(q);
        copy.rotation = { x: e.x, y: e.y, z: e.z };
        working.push(copy);
        const g = this.meshMap.get(copy.id);
        if (g) {
          g.position.copy(v3(copy.position));
          g.rotation.set(copy.rotation.x, copy.rotation.y, copy.rotation.z);
        }
      }
    }
  }

  private applyProxyDelta(working: SceneComponent[]): void {
    const dp = this.proxy.position.clone().sub(this.lastProxy.pos);
    const dq = this.lastProxy.quat.clone().invert().multiply(this.proxy.quaternion);
    for (const c of working) {
      c.position.x += dp.x;
      c.position.y += dp.y;
      c.position.z += dp.z;
      if (this.proxyMode === 'rotate') {
        const e = new THREE.Euler().setFromQuaternion(dq);
        c.rotation.y += e.y;
        c.rotation.x += e.x;
        c.rotation.z += e.z;
      }
      // 立即写回 mesh 以便包围盒判定
      const g = this.meshMap.get(c.id);
      if (g) {
        g.position.copy(v3(c.position));
        g.rotation.set(c.rotation.x, c.rotation.y, c.rotation.z);
      }
    }
    this.lastProxy.pos.copy(this.proxy.position);
    this.lastProxy.quat.copy(this.proxy.quaternion);
  }

  /** 校验一组工作副本：碰撞 + 不出展箱/台面 */
  private validateWorking(working: SceneComponent[]): InvalidState {
    const state: InvalidState = { invalidIds: new Set(), reason: '', valid: true };
    // 用工作副本替换 store 中的对应项后做判定
    const map = new Map(working.map((c) => [c.id, c]));
    const all = store.components.map((c) => map.get(c.id) ?? c);
    for (const c of working) {
      const hits = findCollisions(c, all);
      if (hits.length > 0) {
        state.invalidIds.add(c.id);
        state.reason = `与${hits.map((x) => x.name).join('、')}碰撞，无法落下`;
      }
      if (!insideTank(c, all)) {
        state.invalidIds.add(c.id);
        state.reason = state.reason || '超出展箱范围或穿入台面';
      }
    }
    state.valid = state.invalidIds.size === 0;
    return state;
  }

  private onTransformEnd(): void {
    const snapshot = this.dragSnapshot;
    if (!snapshot) return;
    const selected = store.getSelected();
    const working = selected.map((c) => {
      const g = this.meshMap.get(c.id)!;
      const copy: SceneComponent = JSON.parse(JSON.stringify(c));
      copy.position = tuple(g.position);
      copy.rotation = { x: g.rotation.x, y: g.rotation.y, z: g.rotation.z };
      copy.scale = { x: g.scale.x, y: g.scale.y, z: g.scale.z };
      return copy;
    });
    // 多选代理的增量已在 objectChange 中应用到 mesh，这里只需处理展箱带动
    this.carryTankChildren(working);
    const result = this.validateWorking(working);

    this.suppressStoreSync = true;
    if (result.valid) {
      const step = store.settings.snapStep;
      const ang = store.settings.angleSnap;
      const map2 = new Map(working.map((x) => [x.id, x]));
      for (const c of working) {
        if (store.settings.transformMode === 'translate') {
          c.position.x = snap(c.position.x, step);
          c.position.z = snap(c.position.z, step);
          c.position.y = snap(c.position.y, step);
          // 自动贴面对齐（展箱本身贴地面即可）
          if (c.kind !== 'tank') {
            const all = store.components.map((x) => map2.get(x.id) ?? x);
            const p = surfaceAlign(c, all);
            c.position = tuple(p);
          }
        } else if (store.settings.transformMode === 'rotate') {
          c.rotation.x = snapAngle(c.rotation.x, ang);
          c.rotation.y = snapAngle(c.rotation.y, ang);
          c.rotation.z = snapAngle(c.rotation.z, ang);
        }
      }
      store.replaceComponents(working);
      this.onMessage('已吸附并贴面落位', 'info');
    } else {
      // 无效：回滚到拖拽前快照（全量）
      store.replaceComponents(snapshot);
      this.onMessage(`已拦截：${result.reason}，位置已还原`, 'error');
    }
    this.suppressStoreSync = false;
    this.invalid = { invalidIds: new Set(), reason: '', valid: true };
    this.dragSnapshot = null;
    this.syncFromStore();
  }

  // ---------------- 射线拾取与框选 ----------------

  private updatePointer(e: { clientX: number; clientY: number }): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private pickComponent(): SceneComponent | null {
    this.raycaster.setFromCamera(this.pointer, this.activeCamera);
    const hits = this.raycaster.intersectObjects(this.compLayer.children, true);
    for (const hit of hits) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj && !obj.userData.componentId) obj = obj.parent;
      if (obj?.userData.componentId) {
        return store.components.find((c) => c.id === obj!.userData.componentId) ?? null;
      }
    }
    return null;
  }

  private bindEvents(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    el.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    el.addEventListener('dragover', (e) => this.onDragOver(e));
    el.addEventListener('dragleave', () => { this.ghost.visible = false; });
    el.addEventListener('drop', (e) => this.onDrop(e));
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (this.transformControls.dragging) return;
    this.updatePointer(e);
    this.downPos = { x: e.clientX, y: e.clientY };
    const hit = this.pickComponent();
    this.downHit = !!hit;
    if (hit) {
      if (e.shiftKey) store.toggleSelection(hit.id);
      else if (!store.selection.has(hit.id)) store.setSelection([hit.id]);
      this.onSelectionChange();
    } else {
      // 空白处：准备框选
      this.marqueeing = true;
      this.marqueeStart = { x: e.clientX, y: e.clientY };
    }
  }

  private onPointerMove(e: PointerEvent): void {
    this.updatePointer(e);
    if (this.marqueeing) {
      const rect = this.container.getBoundingClientRect();
      const x1 = Math.min(e.clientX, this.marqueeStart.x) - rect.left;
      const y1 = Math.min(e.clientY, this.marqueeStart.y) - rect.top;
      const x2 = Math.abs(e.clientX - this.marqueeStart.x);
      const y2 = Math.abs(e.clientY - this.marqueeStart.y);
      Object.assign(this.marquee.style, {
        display: 'block', left: `${x1}px`, top: `${y1}px`,
        width: `${x2}px`, height: `${y2}px`
      });
    } else if (!this.transformControls.dragging) {
      this.renderer.domElement.style.cursor = this.pickComponent() ? 'pointer' : 'default';
    }
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.marqueeing) return;
    this.marqueeing = false;
    this.marquee.style.display = 'none';
    const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
    if (moved < 6) {
      // 普通点击空白：清除选择
      if (!this.downHit) store.clearSelection();
      return;
    }
    // 框选：把构件中心投影到屏幕，落在矩形内即选中
    // 注意：NDC 投影对应 canvas 像素尺寸，矩形坐标基于容器；二者原点相同，
    // 但宽高可能差 1~2px，统一用 canvas 的 clientWidth/Height 做投影换算
    const rect = this.container.getBoundingClientRect();
    const cw = this.renderer.domElement.clientWidth;
    const ch = this.renderer.domElement.clientHeight;
    const rx1 = Math.min(e.clientX, this.marqueeStart.x) - rect.left;
    const rx2 = Math.max(e.clientX, this.marqueeStart.x) - rect.left;
    const ry1 = Math.min(e.clientY, this.marqueeStart.y) - rect.top;
    const ry2 = Math.max(e.clientY, this.marqueeStart.y) - rect.top;
    const picked: string[] = [];
    this.activeCamera.updateMatrixWorld(true);
    for (const c of store.components) {
      if (c.kind === 'tank') continue; // 框选只选箱内构件
      const g = this.meshMap.get(c.id);
      if (!g) continue;
      const p = v3(c.position).project(this.activeCamera as THREE.PerspectiveCamera);
      const sx = ((p.x + 1) / 2) * cw;
      const sy = ((-p.y + 1) / 2) * ch;
      if (sx >= rx1 && sx <= rx2 && sy >= ry1 && sy <= ry2) picked.push(c.id);
    }
    store.setSelection(picked, e.shiftKey);
    this.onSelectionChange();
  }

  // ---------------- 外部拖入（构件库 → 视口） ----------------

  private groundPoint(): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.pointer, this.activeCamera);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, hit) ? hit : null;
  }

  private tankAt(point: THREE.Vector3): SceneComponent | null {
    let best: SceneComponent | null = null;
    for (const t of store.components.filter((c) => c.kind === 'tank')) {
      const b = worldBox(t);
      if (point.x >= b.min.x && point.x <= b.max.x && point.z >= b.min.z && point.z <= b.max.z) {
        best = t; // 嵌套场景少，取最后一个即可
      }
    }
    return best;
  }

  private onDragOver(e: DragEvent): void {
    const kind = dragBus.kind;
    if (!kind) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    this.updatePointer(e);
    const point = this.groundPoint();
    if (!point) return;
    const def = CATALOG.find((c) => c.kind === kind)!;
    this.ghost.visible = true;
    this.ghost.scale.set(def.defaultSize.x, def.defaultSize.y, def.defaultSize.z);

    let valid = true;
    let pos = new THREE.Vector3();
    if (kind === 'tank') {
      pos.set(snap(point.x, store.settings.snapStep), def.defaultSize.y / 2, snap(point.z, store.settings.snapStep));
      // 展箱之间 footprint 不可重叠
      const candidate = store.createComponent('tank', pos, null);
      valid = store.components.every((o) => {
        if (o.kind !== 'tank') return true;
        const a = worldBox(candidate);
        const b = worldBox(o);
        return a.max.x <= b.min.x || a.min.x >= b.max.x || a.max.z <= b.min.z || a.min.z >= b.max.z;
      });
    } else {
      const tank = this.tankAt(point);
      valid = !!tank;
      if (tank) {
        pos.set(
          snap(point.x, store.settings.snapStep),
          def.defaultSize.y / 2,
          snap(point.z, store.settings.snapStep)
        );
        const candidate = store.createComponent(kind, pos, tank.id);
        const hits = findCollisions(candidate, [...store.components, candidate]);
        if (hits.length) valid = false;
      }
    }
    this.ghost.position.copy(pos);
    this.ghostValid = valid;
    (this.ghost.material as THREE.MeshStandardMaterial).color.setHex(valid ? 0x35c759 : INVALID_COLOR);
  }

  private onDrop(e: DragEvent): void {
    const kind = (e.dataTransfer?.getData('application/x-component-kind') as ComponentKind) || dragBus.kind;
    dragBus.end();
    this.ghost.visible = false;
    if (!kind) return;
    e.preventDefault();
    this.updatePointer(e);
    const point = this.groundPoint();
    if (!point) return;
    const def = CATALOG.find((c) => c.kind === kind)!;

    if (kind === 'tank') {
      const pos = new THREE.Vector3(
        snap(point.x, store.settings.snapStep), def.defaultSize.y / 2,
        snap(point.z, store.settings.snapStep)
      );
      const candidate = store.createComponent('tank', pos, null);
      const overlap = store.components.some((o) => {
        if (o.kind !== 'tank') return false;
        const a = worldBox(candidate);
        const b = worldBox(o);
        return !(a.max.x <= b.min.x || a.min.x >= b.max.x || a.max.z <= b.min.z || a.min.z >= b.max.z);
      });
      if (overlap) {
        this.flashInvalid('展箱占位重叠，不能放在这里');
        return;
      }
      store.addComponent(candidate);
      this.onMessage(`已放入${def.label}`, 'info');
      return;
    }

    const tank = this.tankAt(point);
    if (!tank) {
      this.flashInvalid('构件必须放入展箱内部');
      return;
    }
    const candidate = store.createComponent(
      kind,
      { x: snap(point.x, store.settings.snapStep), y: 0, z: snap(point.z, store.settings.snapStep) },
      tank.id
    );
    const withCandidate = [...store.components, candidate];
    if (findCollisions(candidate, withCandidate).length) {
      this.flashInvalid(`该位置与相邻构件碰撞，${def.label}无法落下`);
      return;
    }
    const p = surfaceAlign(candidate, withCandidate);
    candidate.position = tuple(p);
    store.addComponent(candidate);
    this.onMessage(`已放入${def.label}并贴面落位`, 'info');
  }

  private flashInvalid(msg: string): void {
    this.onMessage(msg, 'error');
    const old = this.ghost.material;
    (this.ghost.material as THREE.MeshStandardMaterial).color.setHex(INVALID_COLOR);
    this.ghost.visible = true;
    setTimeout(() => {
      this.ghost.visible = false;
      (old as THREE.MeshStandardMaterial).color.setHex(0x35c759);
    }, 450);
  }

  // ---------------- 批量操作 ----------------

  alignSelectedLeft(): void {
    const items = store.getSelected();
    if (items.length < 2) {
      this.onMessage('请先框选两个以上构件', 'error');
      return;
    }
    const next = alignLeft(items);
    this.guardedBatch(next, '已左对齐');
  }

  distributeSelected(): void {
    const items = store.getSelected();
    if (items.length < 3) {
      this.onMessage('等距排布至少需要三个构件', 'error');
      return;
    }
    const next = distributeEvenly(items);
    this.guardedBatch(next, '已按 X 方向等距排布');
  }

  /** 批量变换后统一校验，冲突则整体回滚 */
  private guardedBatch(next: SceneComponent[], okMsg: string): void {
    const map = new Map(next.map((c) => [c.id, c]));
    const all = store.components.map((c) => map.get(c.id) ?? c);
    const bad = next.some((c) => findCollisions(c, all).length > 0 || !insideTank(c, all));
    if (bad) {
      this.onMessage('排布后发生碰撞或超出展箱，已取消', 'error');
      this.syncFromStore();
      return;
    }
    store.replaceComponents(next);
    this.onMessage(okMsg, 'info');
  }

  // ---------------- 视图切换 ----------------

  toggleTopView(top: boolean): void {
    store.updateSettings({ topView: top });
    if (top) {
      this.activeCamera = this.orthoCamera;
      this.activeControls = this.orthoControls;
      this.perspControls.enabled = false;
      this.orthoControls.enabled = true;
    } else {
      this.activeCamera = this.perspCamera;
      this.activeControls = this.perspControls;
      this.orthoControls.enabled = false;
      this.perspControls.enabled = true;
    }
    // TransformControls 重新绑定当前相机：先移除旧 helper 再重建
    this.transformControls.detach();
    if (this.gizmoHelper) this.scene.remove(this.gizmoHelper);
    this.transformControls.dispose();
    this.transformControls = new TransformControls(this.activeCamera, this.renderer.domElement);
    this.transformControls.addEventListener('dragging-changed', (e) => {
      const dragging = (e as unknown as { value: boolean }).value;
      this.activeControls.enabled = !dragging;
      if (dragging) this.onTransformStart();
      else this.onTransformEnd();
    });
    this.transformControls.addEventListener('objectChange', () => this.onTransformChange());
    this.gizmoHelper = this.transformControls.getHelper
      ? this.transformControls.getHelper()
      : (this.transformControls as unknown as THREE.Object3D);
    this.scene.add(this.gizmoHelper);
    this.refreshFootprints();
    this.attachGizmo();
  }

  toggleFootprint(show: boolean): void {
    store.updateSettings({ showFootprint: show });
    this.refreshFootprints();
  }

  resetCamera(): void {
    this.perspCamera.position.set(2.4, 2.0, 2.6);
    this.perspControls.target.set(0, 0.35, 0);
    this.perspControls.update();
    this.orthoCamera.position.set(0, 5, 0.0001);
    this.orthoControls.target.set(0, 0, 0);
    this.orthoControls.update();
  }

  private onKeyDown(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (store.selection.size) { store.removeSelected(); this.attachGizmo(); }
    } else if (e.key === 'Escape') {
      store.clearSelection();
    } else if (e.key === 'w' || e.key === 'W') this.setTransformMode('translate');
    else if (e.key === 'e' || e.key === 'E') this.setTransformMode('rotate');
    else if (e.key === 'r' || e.key === 'R') this.setTransformMode('scale');
  }

  // ---------------- 渲染循环 / 尺寸 ----------------

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.perspCamera.aspect = w / h;
    this.perspCamera.updateProjectionMatrix();
    const frustum = 3.2;
    const aspect = w / h;
    this.orthoCamera.left = (-frustum * aspect) / 2;
    this.orthoCamera.right = (frustum * aspect) / 2;
    this.orthoCamera.top = frustum / 2;
    this.orthoCamera.bottom = -frustum / 2;
    this.orthoCamera.updateProjectionMatrix();
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    this.activeControls.update();
    this.renderer.render(this.scene, this.activeCamera);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.storeUnsub();
    this.transformControls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.marquee.remove();
  }

  getKindLabel = KIND_LABEL;
}
