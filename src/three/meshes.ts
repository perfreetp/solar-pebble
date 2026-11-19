import * as THREE from 'three';
import type { SceneComponent } from '../types';

/**
 * 每种构件的几何工厂：几何按基础尺寸建造，
 * 运行时通过 group.scale 应用实例缩放。
 */
export function buildMesh(c: SceneComponent): THREE.Group {
  const group = new THREE.Group();
  group.userData.componentId = c.id;
  const { x: w, y: h, z: d } = c.size;

  switch (c.kind) {
    case 'tank':
      buildTank(group, w, h, d, c.color);
      break;
    case 'log':
      buildLog(group, w, h, d, c.color);
      break;
    case 'moss':
      buildMoss(group, w, h, d, c.color);
      break;
    case 'net':
      buildNet(group, w, h, d, c.color);
      break;
    case 'basin':
      buildBasin(group, w, h, d, c.color);
      break;
    case 'backpanel':
      buildBackpanel(group, w, h, d, c.color);
      break;
  }
  return group;
}

function standard(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, ...opts });
}

function buildTank(g: THREE.Group, w: number, h: number, d: number, color: number): void {
  // 玻璃壁
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({
      color, transparent: true, opacity: 0.18, roughness: 0.15,
      metalness: 0, side: THREE.DoubleSide, depthWrite: false
    })
  );
  glass.name = 'glass';
  g.add(glass);

  // 边框棱线
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
    new THREE.LineBasicMaterial({ color: 0x3a5a6a })
  );
  g.add(edges);

  // 箱内台面（底板）
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.96, 0.02, d * 0.96),
    standard(0xc9b48a, { roughness: 0.95 })
  );
  floor.position.y = -h / 2 + 0.01;
  g.add(floor);
}

function buildLog(g: THREE.Group, w: number, h: number, d: number, color: number): void {
  const mat = standard(color, { roughness: 0.95 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(h / 2, h / 2 * 0.85, w, 12), mat);
  body.rotation.z = Math.PI / 2; // 横放，沿 X
  g.add(body);

  // 两端截面（深色）
  const capMat = standard(0x6b4423, { roughness: 1 });
  for (const sx of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.CircleGeometry(h / 2 * 0.95, 12), capMat);
    cap.position.x = (sx * w) / 2 + sx * 0.001;
    cap.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
    g.add(cap);
  }

  // 一根分叉短枝
  const branch = new THREE.Mesh(
    new THREE.CylinderGeometry(h / 5, h / 6, w * 0.45, 8),
    mat
  );
  branch.position.set(w * 0.15, h * 0.45, 0);
  branch.rotation.z = -0.7;
  g.add(branch);
}

function buildMoss(g: THREE.Group, w: number, h: number, d: number, color: number): void {
  const geo = new THREE.BoxGeometry(w, h, d, 6, 2, 6);
  const pos = geo.attributes.position;
  // 顶部顶点做不规则起伏，模拟苔藓团块
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > h / 2 - 1e-5) {
      pos.setY(i, y + (Math.random() - 0.3) * h * 0.5);
    }
  }
  geo.computeVertexNormals();
  const moss = new THREE.Mesh(geo, standard(color, { roughness: 1 }));
  moss.position.y = h / 2;
  g.add(moss);

  // 几个小圆丘
  const hillMat = standard(0x6fa055, { roughness: 1 });
  for (let i = 0; i < 4; i++) {
    const r = Math.min(w, d) * (0.12 + Math.random() * 0.08);
    const hill = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), hillMat);
    hill.scale.y = 0.6;
    hill.position.set(
      (Math.random() - 0.5) * w * 0.6,
      h * 0.9,
      (Math.random() - 0.5) * d * 0.6
    );
    g.add(hill);
  }
}

function buildNet(g: THREE.Group, w: number, h: number, d: number, color: number): void {
  // 外框
  const frameMat = standard(0x8c8272, { roughness: 0.8 });
  const t = 0.02;
  const top = new THREE.Mesh(new THREE.BoxGeometry(w + t, t, t), frameMat);
  top.position.y = h / 2;
  const bottom = top.clone();
  bottom.position.y = -h / 2;
  const left = new THREE.Mesh(new THREE.BoxGeometry(t, h, t), frameMat);
  left.position.x = -w / 2;
  const right = left.clone();
  right.position.x = w / 2;
  g.add(top, bottom, left, right);

  // 网格线
  const pts: number[] = [];
  const cols = 8;
  const rows = 8;
  for (let i = 1; i < cols; i++) {
    const x = -w / 2 + (w * i) / cols;
    pts.push(x, -h / 2, 0, x, h / 2, 0);
  }
  for (let i = 1; i < rows; i++) {
    const y = -h / 2 + (h * i) / rows;
    pts.push(-w / 2, y, 0, w / 2, y, 0);
  }
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const lines = new THREE.LineSegments(
    lineGeo,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 })
  );
  g.add(lines);
}

function buildBasin(g: THREE.Group, w: number, h: number, d: number, color: number): void {
  const r = Math.min(w, d) / 2;
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r * 0.85, h, 20, 1, true),
    standard(color, { roughness: 0.4, side: THREE.DoubleSide })
  );
  wall.position.y = h / 2;
  g.add(wall);

  const bottom = new THREE.Mesh(
    new THREE.CircleGeometry(r * 0.85, 20),
    standard(0x356a8a, { roughness: 0.5 })
  );
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = 0.005;
  g.add(bottom);

  // 水面
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(r * 0.82, 20),
    new THREE.MeshStandardMaterial({
      color: 0x6fc3e8, transparent: true, opacity: 0.65,
      roughness: 0.05, metalness: 0.1
    })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = h * 0.7;
  g.add(water);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(r, 0.012, 8, 24),
    standard(0x3a7aa0, { roughness: 0.4 })
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = h;
  g.add(rim);
}

function buildBackpanel(g: THREE.Group, w: number, h: number, d: number, color: number): void {
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    standard(color, { roughness: 0.9 })
  );
  g.add(panel);

  // 横向凹槽纹理
  const grooveMat = standard(0x5f584e, { roughness: 1 });
  const grooves = 5;
  for (let i = 1; i <= grooves; i++) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, 0.008, d * 1.4), grooveMat);
    line.position.y = -h / 2 + (h * i) / (grooves + 1);
    g.add(line);
  }
}

/** 选中高亮描边颜色 */
export const SELECT_COLOR = 0xffc531;
/** 碰撞无效红色 */
export const INVALID_COLOR = 0xff3b30;

export function setGroupHighlight(group: THREE.Group, mode: 'none' | 'selected' | 'invalid'): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (!mat || !('emissive' in mat)) return;
    if (mode === 'invalid') {
      mat.emissive.setHex(INVALID_COLOR);
      mat.emissiveIntensity = 0.75;
    } else if (mode === 'selected') {
      mat.emissive.setHex(SELECT_COLOR);
      mat.emissiveIntensity = 0.35;
    } else {
      mat.emissive.setHex(0x000000);
      mat.emissiveIntensity = 0;
    }
  });
}
