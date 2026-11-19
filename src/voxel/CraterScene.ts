import * as THREE from 'three';
import { createEffect } from 'solid-js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { LayerId, VoxelCoord } from '../types';
import { GRID_R, LAYERS, VOXEL_SIZE, keyOf, parseKey } from './constants';
import { voxelStore } from './voxelStore';
import { buildSimplifiedMesh } from './meshes';

type ClickHandler = (
  coord: VoxelCoord,
  normal: { x: number; y: number; z: number },
  event: { shiftKey: boolean },
) => void;
type DragBoxHandler = (min: VoxelCoord, max: VoxelCoord) => void;

const HIGHLIGHT_COLOR = 0xff3344;
const SELECTION_COLOR = 0x35c4ff;
const HOVER_COLOR = 0xfff3b0;

export class CraterScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private voxelGroup = new THREE.Group();
  private meshViewGroup: THREE.Group | null = null;
  private instanced: Map<LayerId, THREE.InstancedMesh> = new Map();
  private hoverMarker: THREE.LineSegments;
  private mirrorPlane: THREE.GridHelper;
  private selectHelper: THREE.LineSegments;
  private ghostGroup = new THREE.Group();
  private container: HTMLElement;
  private raf = 0;
  private dragStart: { x: number; y: number } | null = null;
  private selectStart: VoxelCoord | null = null;
  private disposed = false;

  onClick: ClickHandler | null = null;
  onDragBox: DragBoxHandler | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    const w = container.clientWidth;
    const h = container.clientHeight;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x10131a);
    this.scene.fog = new THREE.Fog(0x10131a, 30, 70);

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 200);
    this.camera.position.set(16, 14, 18);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, -1.5, 0);
    this.controls.maxPolarAngle = Math.PI * 0.49;

    this.setupLights();
    this.setupGround();

    // 悬停线框
    const hoverGeo = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(VOXEL_SIZE * 1.02, VOXEL_SIZE * 1.02, VOXEL_SIZE * 1.02),
    );
    this.hoverMarker = new THREE.LineSegments(
      hoverGeo,
      new THREE.LineBasicMaterial({ color: HOVER_COLOR }),
    );
    this.hoverMarker.visible = false;
    this.scene.add(this.hoverMarker);

    // 镜像对称面(x=0)
    const planeSize = GRID_R * 2 * VOXEL_SIZE;
    this.mirrorPlane = new THREE.GridHelper(planeSize, GRID_R * 2, 0x66e0ff, 0x2a3f55);
    this.mirrorPlane.rotation.z = Math.PI / 2;
    (this.mirrorPlane.material as THREE.Material).transparent = true;
    (this.mirrorPlane.material as THREE.Material).opacity = 0.35;
    this.mirrorPlane.visible = false;
    this.scene.add(this.mirrorPlane);

    // 框选辅助盒
    this.selectHelper = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: SELECTION_COLOR }),
    );
    this.selectHelper.visible = false;
    this.scene.add(this.selectHelper);

    this.scene.add(this.voxelGroup);
    this.scene.add(this.ghostGroup);

    this.bindEvents();
    this.animate();

    // Solid 状态变化 → 重建
    const reactive = () => {
      this.rebuildVoxels();
      this.refreshGhost();
    };
    // 订阅信号(在 Solid 根之外使用 createEffect 等价手段:显式轮询版本 + 独立信号订阅)
    queueMicrotask(() => this.subscribeSolid(reactive));
  }

  private subscribeSolid(fn: () => void) {
    // 在 Solid 响应式上下文中注册 effect,信号变化即重建场景内容
    createEffect(() => {
      voxelStore.version();
      voxelStore.visible();
      voxelStore.meshView();
      voxelStore.highlightKeys();
      voxelStore.selection();
      voxelStore.clipboard();
      voxelStore.mirrorEnabled();
      fn();
    });
  }

  private setupLights() {
    const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x2a2118, 0.85);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
    sun.position.set(14, 22, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -20;
    sun.shadow.camera.right = 20;
    sun.shadow.camera.top = 20;
    sun.shadow.camera.bottom = -20;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
    fill.position.set(-12, 8, -10);
    this.scene.add(fill);
  }

  private setupGround() {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(GRID_R * VOXEL_SIZE + 4, 64),
      new THREE.MeshStandardMaterial({ color: 0x1b2029, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -4.6;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  private bindEvents() {
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointerleave', this.onPointerLeave);
    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private updatePointer(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private pickVoxel(): {
    coord: VoxelCoord;
    normal: { x: number; y: number; z: number };
    layer: LayerId;
  } | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = [...this.instanced.values()];
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return null;
    const hit = hits[0];
    const mesh = hit.object as THREE.InstancedMesh;
    const id = hit.instanceId;
    if (id == null) return null;
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(id, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    const coord: VoxelCoord = {
      x: Math.round(p.x / VOXEL_SIZE),
      y: Math.round(p.y / VOXEL_SIZE),
      z: Math.round(p.z / VOXEL_SIZE),
    };
    const n = hit.face?.normal
      ? hit.face.normal.clone().transformDirection(mesh.matrixWorld)
      : new THREE.Vector3(0, 1, 0);
    const layer = voxelStore.getVoxel(coord.x, coord.y, coord.z);
    if (!layer) return null;
    return { coord, normal: { x: n.x, y: n.y, z: n.z }, layer };
  }

  private onPointerMove = (e: PointerEvent) => {
    this.updatePointer(e);
    if (this.dragStart && voxelStore.tool() === 'select' && this.selectStart) {
      const cur = this.pickVoxel();
      if (cur) this.updateSelectHelper(this.selectStart, cur.coord);
      return;
    }
    const hit = this.pickVoxel();
    if (hit) {
      this.hoverMarker.visible = true;
      this.hoverMarker.position.set(
        hit.coord.x * VOXEL_SIZE,
        hit.coord.y * VOXEL_SIZE,
        hit.coord.z * VOXEL_SIZE,
      );
    } else {
      this.hoverMarker.visible = false;
    }
  };

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.dragStart = { x: e.clientX, y: e.clientY };
    if (voxelStore.tool() === 'select') {
      const hit = this.pickVoxel();
      this.selectStart = hit?.coord ?? null;
      if (hit) this.updateSelectHelper(hit.coord, hit.coord);
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.dragStart) return;
    const dx = e.clientX - this.dragStart.x;
    const dy = e.clientY - this.dragStart.y;
    const moved = Math.hypot(dx, dy);
    this.dragStart = null;

    if (voxelStore.tool() === 'select' && this.selectStart) {
      const end = this.pickVoxel();
      if (end && moved > 4) {
        const a = this.selectStart;
        const b = end.coord;
        this.onDragBox?.(
          {
            x: Math.min(a.x, b.x),
            y: Math.min(a.y, b.y),
            z: Math.min(a.z, b.z),
          },
          {
            x: Math.max(a.x, b.x),
            y: Math.max(a.y, b.y),
            z: Math.max(a.z, b.z),
          },
        );
      }
      this.selectStart = null;
      this.selectHelper.visible = false;
      return;
    }

    if (moved > 5) return; // 拖拽视角不算点击
    this.updatePointer(e);
    const hit = this.pickVoxel();
    if (hit) this.onClick?.(hit.coord, hit.normal, { shiftKey: e.shiftKey });
  };

  private onPointerLeave = () => {
    this.hoverMarker.visible = false;
  };

  private updateSelectHelper(a: VoxelCoord, b: VoxelCoord) {
    const min = {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      z: Math.min(a.z, b.z),
    };
    const max = {
      x: Math.max(a.x, b.x),
      y: Math.max(a.y, b.y),
      z: Math.max(a.z, b.z),
    };
    const sx = (max.x - min.x + 1) * VOXEL_SIZE;
    const sy = (max.y - min.y + 1) * VOXEL_SIZE;
    const sz = (max.z - min.z + 1) * VOXEL_SIZE;
    this.selectHelper.scale.set(sx, sy, sz);
    this.selectHelper.position.set(
      (min.x + max.x) / 2 * VOXEL_SIZE,
      (min.y + max.y) / 2 * VOXEL_SIZE,
      (min.z + max.z) / 2 * VOXEL_SIZE,
    );
    this.selectHelper.visible = true;
  }

  /** 重建所有实例化体素网格 */
  rebuildVoxels() {
    if (this.disposed) return;
    // 清理旧实例
    for (const mesh of this.instanced.values()) {
      this.voxelGroup.remove(mesh);
      mesh.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.instanced.clear();

    if (this.meshViewGroup) {
      this.scene.remove(this.meshViewGroup);
      this.meshViewGroup.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      this.meshViewGroup = null;
    }

    if (voxelStore.meshView()) {
      // 减面器内部为异步(meshoptimizer WASM),构建完成后再挂载
      buildSimplifiedMesh(voxelStore.simplifyRatio())
        .then(({ mesh }) => {
          if (this.disposed || !voxelStore.meshView()) return;
          this.meshViewGroup = mesh;
          this.scene.add(mesh);
          this.hoverMarker.visible = false;
        })
        .catch((err) => console.error('减面网格构建失败', err));
      return;
    }

    const data = voxelStore.snapshot();
    const visibleSet = voxelStore.visible();
    const highlight = new Set(voxelStore.highlightKeys());
    const selection = new Set(voxelStore.selection());

    const byLayer = new Map<LayerId, Array<{ coord: VoxelCoord; key: string }>>();
    for (const { coord, layer } of data) {
      if (!visibleSet[layer]) continue;
      const k = keyOf(coord.x, coord.y, coord.z);
      const arr = byLayer.get(layer) ?? [];
      arr.push({ coord, key: k });
      byLayer.set(layer, arr);
    }

    const geo = new THREE.BoxGeometry(VOXEL_SIZE * 0.98, VOXEL_SIZE * 0.98, VOXEL_SIZE * 0.98);
    const m4 = new THREE.Matrix4();
    for (const meta of LAYERS) {
      const items = byLayer.get(meta.id);
      if (!items || items.length === 0) continue;
      const mat = new THREE.MeshStandardMaterial({
        color: meta.color,
        roughness: 0.9,
        metalness: 0.05,
      });
      const im = new THREE.InstancedMesh(geo, mat, items.length);
      im.castShadow = true;
      im.receiveShadow = true;
      im.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      const color = new THREE.Color();
      items.forEach((item, i) => {
        m4.identity().setPosition(
          item.coord.x * VOXEL_SIZE,
          item.coord.y * VOXEL_SIZE,
          item.coord.z * VOXEL_SIZE,
        );
        im.setMatrixAt(i, m4);
        if (highlight.has(item.key)) color.setHex(HIGHLIGHT_COLOR);
        else if (selection.has(item.key)) color.setHex(SELECTION_COLOR);
        else color.setHex(meta.color);
        im.setColorAt(i, color);
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      this.voxelGroup.add(im);
      this.instanced.set(meta.id, im);
    }
    this.mirrorPlane.visible = voxelStore.mirrorEnabled();
  }

  /** 粘贴预览幽灵体素 */
  private refreshGhost() {
    this.ghostGroup.clear();
    if (voxelStore.tool() !== 'paste' || voxelStore.meshView()) return;
    const data = voxelStore.clipboard();
    if (!data) return;
    // 预览固定挂在坑缘一侧示例位置,实际落点由点击决定
    const anchor = { x: 4, y: 2, z: 0 };
    const mat = new THREE.MeshStandardMaterial({
      transparent: true,
      opacity: 0.45,
      color: 0x9dff8a,
    });
    const geo = new THREE.BoxGeometry(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE);
    for (const item of data) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(
        (anchor.x + item.coord.x) * VOXEL_SIZE,
        (anchor.y + item.coord.y) * VOXEL_SIZE,
        (anchor.z + item.coord.z) * VOXEL_SIZE,
      );
      this.ghostGroup.add(m);
    }
  }

  /** 程序化镜头聚焦到选区 */
  focusSelection() {
    const sel = voxelStore.selection();
    if (sel.length === 0) return;
    const center = new THREE.Vector3();
    sel.forEach((k) => {
      const c = parseKey(k);
      center.add(new THREE.Vector3(c.x * VOXEL_SIZE, c.y * VOXEL_SIZE, c.z * VOXEL_SIZE));
    });
    center.divideScalar(sel.length);
    this.controls.target.copy(center);
  }

  private animate = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    const el = this.renderer.domElement;
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.renderer.dispose();
    el.parentElement?.removeChild(el);
  }
}
