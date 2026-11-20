// Babylon scene builder for the ant nest. All visuals derive from the pure nest model.
import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Matrix,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Plane,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexBuffer
} from '@babylonjs/core';

import '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import '@babylonjs/core/Meshes/Builders/planeBuilder.js';
import '@babylonjs/core/Meshes/Builders/tubeBuilder.js';
import '@babylonjs/core/Meshes/Builders/torusBuilder.js';
import '@babylonjs/core/Meshes/Builders/icoSphereBuilder.js';
import '@babylonjs/core/Meshes/Builders/linesBuilder.js';
import '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import '@babylonjs/core/Materials/Textures/texture.js';
import '@babylonjs/core/Rendering/edgesRenderer.js';
import '@babylonjs/core/Culling/ray.js';
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import '@babylonjs/core/Materials/Textures/Procedurals/proceduralTexture.js';

import { SOIL_PRESETS, getSoilTextures } from './soilmaterials.js';
import { samplePath, CHAMBER_TYPES } from '../nest/generate.js';

export const CHAMBER_COLORS = {
  nursery: new Color3(1.0, 0.58, 0.42),
  granary: new Color3(1.0, 0.79, 0.28),
  fungus: new Color3(0.36, 0.92, 0.66)
};

const CAM = {
  perspective: { alpha: -Math.PI / 2, beta: Math.PI * 0.36, radius: 46 },
  top: { alpha: -Math.PI / 2, beta: 0.055 },
  front: { alpha: -Math.PI / 2, beta: Math.PI * 0.475 }
};

export class NestScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, antialias: true, alpha: false }, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.043, 0.05, 0.062, 1);

    this.soilPreset = 'dry';
    this.cutaway = { enabled: false, depth: 0.5 };
    this.mode = 'solid';
    this.selection = null;
    this.nest = null;
    this.onSelect = null;
    this.onEdit = null;
    this.onCameraChange = null;
    this.onNestBuilt = null;

    this.tunnelMeshes = [];
    this.chamberMeshes = [];
    this.pickables = new Map();
    this.drag = null;
    this._camTween = null;

    this._buildCamera();
    this._buildLights();
    this._buildGround();
    this._attachPointer();

    this.engine.runRenderLoop(() => {
      this._tick();
      this.scene.render();
    });
  }

  /* ------------------------------------------------------------ camera */

  _buildCamera() {
    const c = new ArcRotateCamera('cam', CAM.perspective.alpha, CAM.perspective.beta, CAM.perspective.radius, new Vector3(0, -6, 0), this.scene);
    c.lowerBetaLimit = 0.04;
    c.upperBetaLimit = Math.PI * 0.497;
    c.lowerRadiusLimit = 10;
    c.upperRadiusLimit = 150;
    c.wheelDeltaPercentage = 0.015;
    c.pinchDeltaPercentage = 0.015;
    c.panningSensibility = 45;
    c.angularSensibilityX = 800;
    c.angularSensibilityY = 800;
    c.minZ = 0.3;
    c.maxZ = 900;
    c.fov = 0.75;
    c.attachControl(this.canvas, true);
    this.camera = c;
    c.onViewMatrixChangedObservable.add(() => {
      if (this._ready && this.onCameraChange) this.onCameraChange(this.getCameraState());
      if (this.cutaway.enabled && this.nest && this._cutInfo) {
        const { axis, dir } = this._cutInfo;
        const dx = c.position.x - c.target.x;
        const dz = c.position.z - c.target.z;
        const mix = Math.abs(dx) / (Math.abs(dx) + Math.abs(dz) + 1e-6);
        const nAxis = mix > 0.5 + 1e-6 ? 'x' : 'z';
        const nDir = nAxis === 'z' ? Math.sign(dz) || 1 : Math.sign(dx) || 1;
        if (nAxis !== axis || nDir !== dir) this._applySoilCut();
      }
    });
    this._ready = true;
  }

  getCameraState() {
    const c = this.camera;
    return {
      alpha: r5(c.alpha),
      beta: r5(c.beta),
      radius: r3(c.radius),
      target: { x: r3(c.target.x), y: r3(c.target.y), z: r3(c.target.z) },
      ortho: this.ortho || null
    };
  }

  applyCameraState(s) {
    if (!s) return;
    this._camTween = null;
    const c = this.camera;
    this.ortho = null;
    c.mode = ArcRotateCamera.PERSPECTIVE_CAMERA;
    // target first: ArcRotateCamera.setTarget() recomputes alpha/beta/radius
    c.setTarget(new Vector3(s.target.x, s.target.y, s.target.z));
    c.alpha = s.alpha;
    c.beta = s.beta;
    c.radius = s.radius;
    if (s.ortho) this.setOrtho(s.ortho.mode, s.ortho.halfHeight, true);
  }

  frameTo(mode, { animate = true, ortho = null } = {}) {
    const b = this.fitBounds || { min: { x: -12, y: -16, z: -9 }, max: { x: 12, y: 0, z: 9 } };
    const cx = (b.min.x + b.max.x) / 2;
    const cy = (b.min.y + b.max.y) / 2;
    const cz = (b.min.z + b.max.z) / 2;
    const w = b.max.x - b.min.x;
    const h = b.max.y - b.min.y;
    const d = b.max.z - b.min.z;
    const target = new Vector3(cx, cy + (mode === 'top' ? 0 : 0.8), cz);
    const c = this.camera;
    const next = { alpha: CAM[mode]?.alpha ?? CAM.perspective.alpha, beta: CAM[mode]?.beta ?? CAM.perspective.beta, radius: 40, target };

    // Fit the bounding sphere of whatever remains visible into the vertical FOV.
    const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
    const halfV = c.fov / 2;
    const halfH = Math.atan(Math.tan(halfV) * aspect);
    const fitFactor = Math.min(halfV, halfH) * 0.93;
    const cut = this.cutaway.enabled;
    const vd = cut ? (d * (1 - this.cutaway.depth) * 0.62 + d * 0.5) : d;
    const R = Math.sqrt((w / 2) ** 2 + (h / 2) ** 2 + (vd / 2) ** 2);
    const fit = R / Math.sin(fitFactor);

    if (mode === 'top') {
      next.alpha = -Math.PI / 2;
      next.beta = 0.021;
      // plan view: frame the soil footprint with a small margin for the mounds
      const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
      const soilW = this.nest?.soil.halfX * 2 || 26;
      const soilD = this.nest?.soil.halfZ * 2 || 21;
      const needH = (Math.max(soilW, soilD * aspect) / 2) / Math.tan(halfV) * 1.08;
      next.radius = needH;
      next.target = new Vector3(cx, -0.15, cz);
    } else if (mode === 'front') {
      next.alpha = -Math.PI / 2;
      next.beta = Math.PI * 0.478;
      next.radius = Math.max(fit, h * 1.05);
    } else if (mode === 'perspective') {
      next.alpha = -Math.PI * 0.615;
      next.beta = Math.PI * 0.335;
      next.radius = fit * 1.02;
    }

    this.ortho = null;
    c.mode = ArcRotateCamera.PERSPECTIVE_CAMERA;
    if (ortho) this.setOrtho(ortho, Math.max(w, h) * 0.58, true);

    if (animate) {
      this._camTween = {
        t: 0,
        dur: 620,
        from: { alpha: c.alpha, beta: c.beta, radius: c.radius, target: c.target.clone() },
        to: next
      };
    } else {
      this._camTween = null;
      c.setTarget(next.target);
      c.alpha = next.alpha;
      c.beta = next.beta;
      c.radius = next.radius;
    }
  }

  setOrtho(mode, halfHeight, keepPose) {
    const c = this.camera;
    if (!mode) {
      c.mode = ArcRotateCamera.PERSPECTIVE_CAMERA;
      this.ortho = null;
      return;
    }
    const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
    const h = Math.max(2, halfHeight || 16);
    c.mode = ArcRotateCamera.ORTHOGRAPHIC_CAMERA;
    c.orthoTop = h;
    c.orthoBottom = -h;
    c.orthoLeft = -h * aspect;
    c.orthoRight = h * aspect;
    this.ortho = { mode, halfHeight: r3(h) };
  }

  /* ------------------------------------------------------------ lights */

  _buildLights() {
    const hemi = new HemisphericLight('hemi', new Vector3(0.15, 1, 0.3), this.scene);
    hemi.intensity = 0.62;
    hemi.diffuse = new Color3(0.78, 0.82, 0.95);
    hemi.groundColor = new Color3(0.16, 0.15, 0.14);
    this.hemi = hemi;

    const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, -0.55), this.scene);
    sun.position = new Vector3(26, 38, 26);
    sun.intensity = 1.5;
    sun.diffuse = new Color3(1.0, 0.95, 0.86);
    sun.specular = new Color3(1, 0.97, 0.92);
    this.sun = sun;

    const fill = new DirectionalLight('fill', new Vector3(0.8, -0.35, -0.5), this.scene);
    fill.intensity = 0.5;
    fill.diffuse = new Color3(0.48, 0.6, 0.85);
    this.fill = fill;

    // Daylight spilling into the open pit: a soft downward light near the rim,
    // so the cut interior is readable instead of a black cavity.
    const shaft = new HemisphericLight('shaft', new Vector3(-0.1, -1, -0.15), this.scene);
    shaft.intensity = 0.0;
    shaft.diffuse = new Color3(1.0, 0.92, 0.79);
    shaft.groundColor = new Color3(0.42, 0.32, 0.22);
    this.shaft = shaft;

    const ip = this.scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.exposure = 1.28;
    ip.contrast = 1.14;
    this._updateFog();
  }

  // Set once a nest exists, so the shaft sits inside the pit volume.
  _updateShaft() {
    if (!this.shaft || !this.nest) return;
    this.shaft.intensity = 0.42;
  }

  // Depth fog inside the pit: softens the far soil walls so the cutaway reads
  // as depth. Kept gentle and warm so tunnels and chambers stay legible.
  _updateFog() {
    const s = this.scene;
    if (!this.nest) return;
    const r = this.camera.radius;
    const d = this.nest.soil.depth;
    s.fogMode = Scene.FOGMODE_LINEAR;
    s.fogColor = new Color3(0.14, 0.11, 0.082);
    s.fogStart = r * 1.0;
    s.fogEnd = r + d * 2.8;
  }

  setFogEnabled(on) {
    this.scene.fogMode = on ? Scene.FOGMODE_LINEAR : Scene.FOGMODE_NONE;
    this._fogOn = on;
    if (on) this._updateFog();
  }

  setLightAzimuth(deg) {
    const a = (deg * Math.PI) / 180;
    this.sun.direction = new Vector3(-Math.cos(a) * 0.62, -1, -Math.sin(a) * 0.62).normalize();
    this.sun.position = new Vector3(Math.cos(a) * 40, 46, Math.sin(a) * 40);
  }

  /* ------------------------------------------------------------ ground */

  _buildGround() {
    const mat = new PBRMaterial('groundMat', this.scene);
    mat.albedoColor = new Color3(0.05, 0.055, 0.066);
    mat.metallic = 0;
    mat.roughness = 0.97;
    this.groundMat = mat;

    // No ground plane or grid: the soil block is the whole subject, and any
    // floor would slice across the open cutaway or show through it.
    this.soilRoot = new TransformNode('soilRoot', this.scene);
    this.nestRoot = new TransformNode('nestRoot', this.scene);
  }

  _buildGrid() {
    /* removed: an ambient grid shows through the cutaway and reads as noise */
  }

  _buildGroundFrame(hx, hz) {
    for (const m of this._groundMeshes || []) m.dispose();
    this._groundMeshes = [];
    // A narrow apron around the soil block reads as terrain without hiding the
    // open pit at low viewing angles.
    const pad = 2.6;
    const ring = 3.4;
    const x0 = hx + pad;
    const z0 = hz + pad;
    const add = (name, w, d, x, z) => {
      const g = MeshBuilder.CreateGround(name, { width: w, height: d }, this.scene);
      g.position.set(x, -0.34, z);
      g.material = this.groundMat;
      g.isPickable = false;
      g.receiveShadows = true;
      this._groundMeshes.push(g);
      return g;
    };
    const spanX = (x0 + ring) * 2;
    const spanZ = (z0 + ring) * 2;
    add('g-n', spanX, ring, 0, -(z0 + ring / 2));
    add('g-s', spanX, ring, 0, z0 + ring / 2);
    add('g-w', ring, spanZ, -(x0 + ring / 2), 0);
    add('g-e', ring, spanZ, x0 + ring / 2, 0);
  }

  /* ------------------------------------------------------------ soil */

  setSoil(presetKey) {
    this.soilPreset = presetKey;
    const p = SOIL_PRESETS[presetKey];
    if (p) this.scene.imageProcessingConfiguration.exposure = p.exposure;
    this._buildSoil(true);
  }

  buildSoil(nest) {
    this.nest = nest;
    this.fitBounds = nest.bounds;
    this._updateFog();
    this._updateShaft();
    this._buildSoil(false);
  }

  _disposeSoils() {
    for (const m of this.soilMeshes || []) m.dispose();
    this.soilMeshes = [];
    if (this.sectionFace) {
      this.sectionFace.dispose();
      this.sectionFace = null;
    }
  }

  _buildSoil(preserve) {
    const nest = this.nest;
    if (!nest) return;
    this._disposeSoils();
    const preset = SOIL_PRESETS[this.soilPreset];
    const tex = getSoilTextures(this.scene, this.soilPreset);
    const hx = nest.soil.halfX;
    const hz = nest.soil.halfZ;
    const depth = nest.soil.depth;
    const push = (m) => {
      m.parent = this.soilRoot;
      m.isPickable = false;
      this.soilMeshes.push(m);
      return m;
    };

    this.soilMat = new PBRMaterial('soilMat', this.scene);
    this.soilMat.albedoColor = new Color3(1, 1, 1);
    this.soilMat.albedoTexture = tex.diffuse;
    this.soilMat.metallic = 0;
    this.soilMat.roughness = preset.roughness;
    this.soilMat.bumpTexture = tex.bump;
    this.soilMat.backFaceCulling = true;

    // Inner walls: cut-away earth, warm and slightly darker, lit on their inward
    // face so the open pit reads as a hollow dug chamber instead of an unlit void.
    this.soilInnerMat = new PBRMaterial('soilInnerMat', this.scene);
    this.soilInnerMat.albedoColor = new Color3(0.86, 0.77, 0.65);
    this.soilInnerMat.albedoTexture = tex.diffuse;
    this.soilInnerMat.emissiveColor = new Color3(0.07, 0.055, 0.04);
    this.soilInnerMat.metallic = 0;
    this.soilInnerMat.roughness = Math.min(0.99, preset.roughness + 0.04);
    this.soilInnerMat.bumpTexture = tex.bump;
    this.soilInnerMat.backFaceCulling = false;

    this.soilTopMat = this.soilMat;
    this.cutMat = new PBRMaterial('cutMat', this.scene);
    this.cutMat.albedoColor = new Color3(1, 1, 1);
    this.cutMat.albedoTexture = tex.cut;
    this.cutMat.metallic = 0;
    this.cutMat.roughness = Math.min(0.99, preset.roughness + 0.02);
    this.cutMat.bumpTexture = tex.bump;
    this.cutMat.emissiveColor = new Color3(0.05, 0.045, 0.04);

    const block = MeshBuilder.CreateBox('soilBlock', { width: hx * 2, height: depth, depth: hz * 2 }, this.scene);
    block.material = this.soilMat;
    block.position.y = -depth / 2;
    push(block);
    this.soilBlock = block;

    // Lining just inside each wall: what the viewer sees when the block is cut open.
    const t = 0.02;
    const liners = [
      { w: hx * 2 - t, h: depth, d: hz * 2, x: 0, y: -depth / 2, z: 0 },
    ];
    for (const sgn of [-1, 1]) {
      liners.push({ w: 0.03, h: depth, d: hz * 2 - t, x: sgn * (hx - t), y: -depth / 2, z: 0 });
      liners.push({ w: hx * 2 - t, h: depth, d: 0.03, x: 0, y: -depth / 2, z: sgn * (hz - t) });
    }
    liners.push({ w: hx * 2 - t, h: 0.03, d: hz * 2 - t, x: 0, y: -depth + t, z: 0 });
    for (const [i, L] of liners.entries()) {
      if (i === 0) continue;
      const wall = MeshBuilder.CreateBox(`soilLiner${i}`, { width: Math.max(0.01, L.w), height: L.h, depth: Math.max(0.01, L.d) }, this.scene);
      wall.position.set(L.x, L.y, L.z);
      wall.material = this.soilInnerMat;
      push(wall);
    }

    const top = MeshBuilder.CreateGround('soilTop', { width: hx * 2, height: hz * 2, subdivisions: 56 }, this.scene);
    const verts = top.getVerticesData(VertexBuffer.PositionKind);
    const rnd = seeded(4242);
    for (let i = 0; i < verts.length; i += 3) {
      const x = verts[i];
      const z = verts[i + 2];
      const edge = Math.min(1, Math.max(0, 1.6 - Math.min(hx - Math.abs(x), hz - Math.abs(z))));
      const h = (rnd() - 0.5) * 0.1 + Math.sin(x * 0.4) * Math.cos(z * 0.34) * 0.1 - edge * 0.28;
      verts[i + 1] = h;
    }
    top.updateVerticesData(VertexBuffer.PositionKind, verts);
    top.createNormals(true);
    // Surface material keeps the albedo but drops the fine bump map: seen straight
    // down, a normal map this dense aliases into moire.
    this.soilTopMat = this.soilMat.clone('soilTopMat');
    this.soilTopMat.bumpTexture = null;
    this.soilTopMat.roughness = Math.min(0.99, preset.roughness);
    top.material = this.soilTopMat;
    push(top);
    this.soilTop = top;

    for (const e of nest.entrances) {
      const mound = MeshBuilder.CreateTorus(`mound-${e.id}`, { diameter: 2.35, thickness: 0.95, tessellation: 26 }, this.scene);
      mound.position = new Vector3(e.x, 0.1, e.z);
      mound.scaling.y = 0.38;
      mound.material = this.soilMat;
      push(mound);
      const hole = MeshBuilder.CreateCylinder(`hole-${e.id}`, { diameter: 1.06, height: 1.4, tessellation: 22 }, this.scene);
      hole.position = new Vector3(e.x, 0.2, e.z);
      const holeMat = new PBRMaterial(`holeMat`, this.scene);
      holeMat.albedoColor = new Color3(0.02, 0.018, 0.016);
      holeMat.metallic = 0;
      holeMat.roughness = 1;
      holeMat.emissiveColor = new Color3(0.02, 0.018, 0.015);
      hole.material = holeMat;
      push(hole);
    }

    this._applySoilCut();
  }

  /* ------------------------------------------------------------ cutaway */

  setCutaway(enabled, depthFraction) {
    this.cutaway.enabled = !!enabled;
    if (typeof depthFraction === 'number') this.cutaway.depth = Math.min(0.98, Math.max(0.02, depthFraction));
    this._applySoilCut();
  }

  setCutDepth(f) {
    this.cutaway.depth = Math.min(0.98, Math.max(0.02, f));
    this._applySoilCut();
  }

  _allCutMeshes() {
    return [...(this.soilMeshes || []), ...(this.tunnelMeshes || []), ...(this.chamberMeshes || []), ...(this.propMeshes || [])];
  }

  _refreshHandleVisibility() {
    const show = this.cutaway.enabled || this.mode === 'xray';
    for (const m of this.scene.meshes) {
      if (m.metadata?.kind === 'handle') m.isVisible = show;
    }
  }

  _applySoilCut() {
    if (!this.nest) return;
    const on = this.cutaway.enabled;
    if (this.sectionFace) {
      this.sectionFace.dispose();
      this.sectionFace = null;
    }
    if (this._cutEdge) {
      this._cutEdge.dispose();
      this._cutEdge = null;
    }
    if (!on) {
      for (const m of this._allCutMeshes()) if (m.material) m.material.clipPlane = null;
      return;
    }
    if (!this.cutPlane) this.cutPlane = new Plane(0, 0, 1, 0);
    this._orientCut();
    for (const m of this._allCutMeshes()) if (m.material) m.material.clipPlane = this.cutPlane;
    this._refreshHandleVisibility();

    const { axis, coord } = this._cutInfo;
    const hx = this.nest.soil.halfX;
    const hz = this.nest.soil.halfZ;
    const depth = this.nest.soil.depth;

    // Mark the cut boundary with a thin outline instead of an opaque cap, so the
    // open interior stays readable (dollhouse cutaway).
    const halfW = axis === 'z' ? hx : hz;
    const ringPts = [
      [-halfW, 0],
      [halfW, 0],
      [halfW, -depth],
      [-halfW, -depth],
      [-halfW, 0]
    ].map(([u, v]) => (axis === 'z' ? new Vector3(u, v, coord) : new Vector3(coord, v, u)));
    const edge = MeshBuilder.CreateLines('cutEdge', { points: ringPts }, this.scene);
    edge.color = new Color3(0.95, 0.8, 0.52);
    edge.alpha = 0.55;
    edge.isPickable = false;
    edge.parent = this.soilRoot;
    this._cutEdge = edge;

    // faint translucent film hinting at the cut surface
    const film = MeshBuilder.CreatePlane(
      'cutFilm',
      axis === 'z' ? { width: hx * 2, height: depth } : { width: hz * 2, height: depth },
      this.scene
    );
    if (axis === 'z') film.position.set(0, -depth / 2, coord);
    else {
      film.position.set(coord, -depth / 2, 0);
      film.rotation.y = Math.PI / 2;
    }
    const fm = new PBRMaterial('cutFilmMat', this.scene);
    fm.albedoColor = new Color3(0.05, 0.042, 0.036);
    fm.emissiveColor = new Color3(0.02, 0.016, 0.012);
    fm.alpha = 0.06;
    fm.roughness = 1;
    fm.metallic = 0;
    fm.backFaceCulling = false;
    fm.transparencyMode = 2;
    film.material = fm;
    film.isPickable = false;
    film.parent = this.soilRoot;
    this.sectionFace = film;

    const t = new Vector3(this.cutPlane.normal.x, 0, this.cutPlane.normal.z);
    film.position.addInPlace(t.scale(-0.004));
    edge.position.addInPlace(t.scale(-0.005));
  }

  // Choose an axis-aligned vertical cut facing the camera; the near half is removed.
  _orientCut() {
    const c = this.camera;
    const t = c.target;
    const hx = this.nest.soil.halfX;
    const hz = this.nest.soil.halfZ;
    const dx = c.position.x - t.x;
    const dz = c.position.z - t.z;
    const mix = Math.abs(dx) / (Math.abs(dx) + Math.abs(dz) + 1e-6);
    const axis = mix > 0.5 + 1e-6 ? 'x' : 'z';
    const half = axis === 'z' ? hz : hx;
    const dir = axis === 'z' ? Math.sign(dz) || 1 : Math.sign(dx) || 1;
    // keep the far half: plane sits between centre and the near edge
    const coord = -dir * half * (1 - 2 * this.cutaway.depth);
    this.cutPlane.normal.set(axis === 'z' ? 0 : dir, 0, axis === 'z' ? dir : 0);
    this.cutPlane.d = -dir * coord;
    this._cutInfo = { axis, coord, dir };
  }

  /* ------------------------------------------------------------ nest */

  buildNest(nest) {
    this.nest = nest;
    this.fitBounds = nest.bounds;
    this._clearNest();
    this._buildTunnels(nest);
    this._buildChambers(nest);
    // Materials are recreated above, so the section plane must be re-applied to
    // the new nest geometries (the soil pass only covers soil meshes).
    this._applySoilCut();
    this.applyMode(this.mode);
    if (this.selection && !this._exists(this.selection)) this.selection = null;
    this._drawSelection();
    if (this.onNestBuilt) this.onNestBuilt(nest);
  }

  _exists(id) {
    return !!this.nest?.tunnels.some((t) => t.id === id) || !!this.nest?.chambers.some((c) => c.id === id);
  }

  _clearNest() {
    for (const m of this.tunnelMeshes) m.dispose();
    for (const m of this.chamberMeshes) m.dispose();
    for (const p of this.propMeshes || []) if (!p.isDisposed()) p.dispose();
    for (const m of this.nestRoot.getChildMeshes()) m.dispose();
    this.tunnelMeshes = [];
    this.chamberMeshes = [];
    this.propMeshes = [];
    this.pickables.clear();
    this._clearOverlay();
  }

  _clearOverlay() {
    if (this.overlayRoot) {
      this.overlayRoot.dispose(false, true);
      this.overlayRoot = null;
    }
  }

  _buildTunnels(nest) {
    this.matTunnel = new PBRMaterial('matTunnel', this.scene);
    this.matTunnel.albedoColor = new Color3(0.016, 0.012, 0.01);
    this.matTunnel.metallic = 0;
    this.matTunnel.roughness = 1;
    this.matTunnel.emissiveColor = new Color3(0.05, 0.04, 0.032);
    this.matTunnel.backFaceCulling = false;

    this.matTunnelLocked = new PBRMaterial('matTunnelLocked', this.scene);
    this.matTunnelLocked.albedoColor = new Color3(0.05, 0.032, 0.02);
    this.matTunnelLocked.metallic = 0;
    this.matTunnelLocked.roughness = 0.9;
    this.matTunnelLocked.emissiveColor = new Color3(0.3, 0.13, 0.03);
    this.matTunnelLocked.backFaceCulling = false;

    // Bore lining: a much darker, cooler passage wall so tunnels separate
    // clearly from the warm soil around them.
    this.matBoreLining = new PBRMaterial('matBoreLining', this.scene);
    this.matBoreLining.albedoColor = new Color3(0.055, 0.045, 0.038);
    this.matBoreLining.metallic = 0;
    this.matBoreLining.roughness = 1;
    this.matBoreLining.emissiveColor = new Color3(0.018, 0.014, 0.011);
    this.matBoreLining.backFaceCulling = false;

    for (const t of nest.tunnels) {
      const path = samplePath(t.points, 10).map((p) => new Vector3(p.x, p.y, p.z));
      if (path.length < 2) continue;
      const r = Math.max(0.075, t.radius);
      const tube = MeshBuilder.CreateTube(
        `T:${t.id}`,
        { path, radius: r, tessellation: 14, cap: Mesh.CAP_ALL, updatable: true },
        this.scene
      );
      tube.material = t.locked ? this.matTunnelLocked : this.matTunnel;
      tube.parent = this.nestRoot;
      tube.metadata = { kind: 'tunnel', id: t.id };
      this.tunnelMeshes.push(tube);
      this.pickables.set(t.id, tube);

      // Inner lining sits just inside the bore; looking at the open cut, this is
      // the wall the viewer actually sees, so it carries the readable value.
      const lining = MeshBuilder.CreateTube(
        `L:${t.id}`,
        { path, radius: r * 0.86, tessellation: 12, cap: Mesh.NO_CAP, sideOrientation: Mesh.BACKSIDE },
        this.scene
      );
      lining.material = this.matBoreLining;
      lining.parent = this.nestRoot;
      lining.isPickable = false;
      lining.renderingGroupId = 0;
      this.tunnelMeshes.push(lining);
      tube._lining = lining;
      this._liningOf = this._liningOf || new Map();
      this._liningOf.set(t.id, lining);
    }
  }

  // Seeded low-frequency displacement along the vertex normal, so chambers look
  // hand-dug. Deterministic for a given seed, keeping regeneration reproducible.
  _roughenSphere(mesh, seed, amount) {
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
    if (!positions || !normals) return;
    const R = seeded(seed || 1);
    const phases = [R() * 6.283, R() * 6.283, R() * 6.283];
    const freqs = [2.1 + R() * 1.6, 3.4 + R() * 2.2, 5.1 + R() * 2.6];
    const amps = [0.55, 0.3, 0.15];
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];
      let d = 0;
      for (let k = 0; k < 3; k++) {
        d += amps[k] * Math.sin(x * freqs[k] + phases[k]) * Math.cos(y * freqs[k] * 0.9 - phases[k]) * Math.sin(z * freqs[k] * 1.1 + phases[k] * 0.7);
      }
      const s = 1 + d * amount;
      positions[i] = x * s;
      positions[i + 1] = y * s;
      positions[i + 2] = z * s;
    }
    mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
    mesh.createNormals(true);
  }

  _buildChambers(nest) {
    this.propMeshes = this.propMeshes || [];
    this.chamberMats = {};
    this.chamberVoidMats = {};
    for (const key of Object.keys(CHAMBER_TYPES)) {
      // Chamber volume: a translucent tinted shell. Contents stay visible through
      // it, so the three shapes read as volumes in a cutaway diagram rather than
      // as opaque eggs filling the pit.
      const m = new PBRMaterial(`matChamber-${key}`, this.scene);
      m.albedoColor = CHAMBER_COLORS[key].scale(0.9);
      m.emissiveColor = CHAMBER_COLORS[key].scale(0.16);
      m.metallic = 0;
      m.roughness = 0.35;
      m.alpha = 0.42;
      m.transparencyMode = 2;
      m.backFaceCulling = false;
      m.twoSidedLighting = true;
      this.chamberMats[key] = m;

      // Thin rim: brightens the silhouette so overlapping chambers stay separate.
      const v = new PBRMaterial(`matVoid-${key}`, this.scene);
      v.albedoColor = CHAMBER_COLORS[key].scale(0.55);
      v.emissiveColor = CHAMBER_COLORS[key].scale(0.5);
      v.metallic = 0;
      v.roughness = 0.6;
      v.alpha = 0.9;
      v.backFaceCulling = true;
      this.chamberVoidMats[key] = v;
    }

    for (const c of nest.chambers) {
      const shell = MeshBuilder.CreateSphere(`C:${c.id}`, { diameter: 2, segments: 26 }, this.scene);
      // Roughen the shell so it reads as dug earth rather than a perfect ball;
      // the distortion is seeded from the chamber id so it stays reproducible.
      this._roughenSphere(shell, hash(c.id), 0.055);
      shell.scaling.set(c.radii.x, c.radii.y, c.radii.z);
      shell.rotation.y = c.rot || 0;
      shell.position.set(c.center.x, c.center.y, c.center.z);
      shell.material = this.chamberMats[c.type] || this.chamberMats.nursery;
      shell.parent = this.nestRoot;
      shell.metadata = { kind: 'chamber', id: c.id };
      this.chamberMeshes.push(shell);
      this.pickables.set(c.id, shell);

      this._buildProps(c, shell);
    }
  }

  _buildProps(c, shell) {
    const R = seeded(hash(c.id));
    // Unscaled container at the chamber centre so props keep true proportions.
    const holder = new TransformNode(`P:${c.id}`, this.scene);
    holder.position.set(c.center.x, c.center.y, c.center.z);
    holder.rotation.y = c.rot || 0;
    holder.parent = this.nestRoot;
    shell._propRoot = holder;

    const props = [];
    const add = (m) => {
      m.parent = holder;
      m.isPickable = false;
      props.push(m);
      return m;
    };
    const rx = c.radii.x;
    const ry = c.radii.y;
    const rz = c.radii.z;
    const floorY = -ry * 0.52;
    // scatter within an ellipse inset from the shell wall
    const scatter = (r) => {
      const a = R() * Math.PI * 2;
      const rad = Math.sqrt(R()) * r;
      return { x: Math.cos(a) * rad * rx, z: Math.sin(a) * rad * rz };
    };

    if (c.type === 'granary') {
      const mat = new PBRMaterial('matSeed', this.scene);
      mat.albedoColor = new Color3(0.9, 0.76, 0.3);
      mat.emissiveColor = new Color3(0.2, 0.15, 0.04);
      mat.metallic = 0;
      mat.roughness = 0.5;
      const proto = MeshBuilder.CreateSphere('seedProto', { diameter: 0.15, segments: 6 }, this.scene);
      proto.material = mat;
      const n = Math.round(30 + Math.min(40, rx * rz * 6));
      for (let i = 0; i < n; i++) {
        const inst = proto.createInstance(`seed-${c.id}-${i}`);
        const p = scatter(0.74);
        inst.position.set(p.x, floorY + R() * 0.12 + 0.06, p.z);
        inst.scaling.setAll(0.6 + R() * 0.7);
        inst.isPickable = false;
        add(inst);
      }
      proto.dispose();
    } else if (c.type === 'nursery') {
      const mat = new PBRMaterial('matEgg', this.scene);
      mat.albedoColor = new Color3(0.99, 0.95, 0.86);
      mat.emissiveColor = new Color3(0.2, 0.17, 0.12);
      mat.roughness = 0.42;
      const n = Math.round(9 + Math.min(14, rx * 3));
      for (let i = 0; i < n; i++) {
        const d = 0.17 + R() * 0.09;
        const egg = MeshBuilder.CreateSphere(`egg-${c.id}-${i}`, { diameter: d, segments: 9 }, this.scene);
        const p = scatter(0.62);
        egg.position.set(p.x, floorY + d * 0.7, p.z);
        egg.scaling.set(1, 1.45, 1);
        egg.rotation.z = (R() - 0.5) * 0.7;
        egg.material = mat;
        add(egg);
      }
    } else {
      const mat = new PBRMaterial('matFungus', this.scene);
      mat.albedoColor = new Color3(0.42, 0.68, 0.4);
      mat.emissiveColor = new Color3(0.06, 0.16, 0.07);
      mat.roughness = 0.86;
      const n = Math.round(8 + Math.min(12, rx * 2.5));
      for (let i = 0; i < n; i++) {
        const r = 0.11 + R() * 0.13;
        const blob = MeshBuilder.CreateIcoSphere(`fungus-${c.id}-${i}`, { radius: r, subdivisions: 1 }, this.scene);
        const p = scatter(0.56);
        blob.position.set(p.x, floorY + r * 0.8, p.z);
        blob.scaling.set(1.2, 0.62, 1.1);
        blob.rotation.y = R() * Math.PI;
        blob.material = mat;
        add(blob);
      }
    }
    shell._props = props;
    for (const p of props) this.propMeshes.push(p);
  }

  /* ------------------------------------------------------------ modes */

  applyMode(mode) {
    this.mode = mode;
    const seeThrough = mode === 'xray';
    this.soilMat && (this.soilMat.alpha = seeThrough ? 0.16 : 1);
    this.soilMat && (this.soilMat.transparencyMode = seeThrough ? 2 : 0);
    this.cutMat && (this.cutMat.alpha = seeThrough ? 0.12 : 1);
    this.cutMat && (this.cutMat.transparencyMode = seeThrough ? 2 : 0);
    for (const m of this.soilMeshes || []) m.visibility = 1;
    if (seeThrough) {
      if (this.soilBlock) this.soilBlock.visibility = 0.5;
      if (this.soilTop) this.soilTop.visibility = 0.4;
    }
    const flat = mode === 'flat';
    for (const m of this.tunnelMeshes) {
      if (m.name.startsWith('L:')) m.material = this.matBoreLining;
      else m.material = this._tunnelOwnMat(m);
    }
    for (const m of this.chamberMeshes) {
      if (m.name.startsWith('Ci:')) {
        m.visibility = 1;
      }
    }
    for (const c of this.nest?.chambers ?? []) {
      const shell = this.pickables.get(c.id);
      if (shell) shell.visibility = flat ? 0.34 : 1;
    }
    for (const m of this.tunnelMeshes) {
      if (flat) m.visibility = 0.85;
      else m.visibility = 1;
    }
    this._drawSelection();
    this._refreshHandleVisibility();
  }

  _tunnelOwnMat(mesh) {
    const t = this.nest?.tunnels.find((x) => 'T:' + x.id === mesh.name);
    return t?.locked ? this.matTunnelLocked : this.matTunnel;
  }

  /* ------------------------------------------------------------ selection */

  select(id, silent = false) {
    this.selection = id;
    this._drawSelection();
    this._applySoilCut();
    if (!silent && this.onSelect) this.onSelect(id);
  }

  _drawSelection() {
    this._clearOverlay();
    if (!this.selection || !this.nest) return;
    const mesh = this.pickables.get(this.selection);
    if (!mesh) return;
    const root = new TransformNode('overlay', this.scene);
    this.overlayRoot = root;
    const id = this.selection;
    const tunnel = this.nest.tunnels.find((t) => t.id === id);
    const chamber = this.nest.chambers.find((c) => c.id === id);

    if (tunnel) {
      const path = samplePath(tunnel.points, 10).map((p) => new Vector3(p.x, p.y, p.z));
      const halo = MeshBuilder.CreateTube(`halo-${id}`, { path, radius: Math.max(0.075, tunnel.radius) * 1.55, tessellation: 12 }, this.scene);
      const m = new PBRMaterial('matHalo', this.scene);
      m.emissiveColor = new Color3(1.0, 0.74, 0.22);
      m.diffuseColor = new Color3(1, 0.8, 0.35);
      m.alpha = 0.16;
      m.roughness = 1;
      m.metallic = 0;
      m.backFaceCulling = false;
      m.disableLighting = true;
      halo.material = m;
      halo.parent = root;
      halo.isPickable = false;
      this._haloMesh = halo;

      // handles
      tunnel.points.forEach((p, idx) => {
        if (idx === 0) return;
        const h = MeshBuilder.CreateSphere(`handle-${idx}`, { diameter: idx === tunnel.points.length - 1 ? 0.66 : 0.5, segments: 12 }, this.scene);
        h.position.set(p.x, p.y, p.z);
        const hm = new PBRMaterial(`matHandle-${idx}`, this.scene);
        hm.emissiveColor = new Color3(1, 0.76, 0.26);
        hm.diffuseColor = new Color3(1, 0.85, 0.5);
        hm.roughness = 0.35;
        hm.metallic = 0.1;
        h.material = hm;
        h.parent = root;
        h.isPickable = true;
        h.metadata = { kind: 'handle', id, index: idx };
        // Draw above the soil so handles stay reachable inside chambers. They are
        // only meaningful when the interior is exposed (cut or x-ray), so keep
        // them out of the way in a solid, uncut overview.
        h.renderingGroupId = 2;
        h.isVisible = this.cutaway.enabled || this.mode === 'xray';
        h.enableEdgesRendering();
        h.edgesWidth = 2.5;
        h.edgesColor = new Color4(0.15, 0.08, 0, 1);
      });
    }
    if (chamber) {
      const halo = MeshBuilder.CreateSphere(`halo-${id}`, { diameter: 2, segments: 18 }, this.scene);
      halo.scaling.set(chamber.radii.x * 1.06, chamber.radii.y * 1.06, chamber.radii.z * 1.06);
      halo.rotation.y = chamber.rot || 0;
      halo.position.set(chamber.center.x, chamber.center.y, chamber.center.z);
      const m = new PBRMaterial('matHaloC', this.scene);
      m.emissiveColor = CHAMBER_COLORS[chamber.type].scale(0.55);
      m.alpha = 0.16;
      m.roughness = 1;
      m.metallic = 0;
      m.backFaceCulling = false;
      m.disableLighting = true;
      halo.material = m;
      halo.parent = root;
      halo.isPickable = false;
      halo.enableEdgesRendering();
      halo.edgesWidth = 5;
      halo.edgesColor = new Color4(CHAMBER_COLORS[chamber.type].r, CHAMBER_COLORS[chamber.type].g, CHAMBER_COLORS[chamber.type].b, 1);
      this._haloMesh = halo;
    }
  }

  /* ------------------------------------------------------------ dragging */

  _attachPointer() {
    const scene = this.scene;
    const pickKinds = (m) => !!m.metadata && (m.metadata.kind === 'tunnel' || m.metadata.kind === 'chamber');

    // Handles win over the solid soil they sit inside, so try them first.
    const pickHandle = () => scene.pick(scene.pointerX, scene.pointerY, (m) => !!m.metadata && m.metadata.kind === 'handle');

    scene.onPointerObservable.add((pi) => {
      if (pi.type === 1 && pi.event?.button === 0) {
        const hp = pickHandle();
        if (hp?.hit) {
          this._beginDrag(hp.pickedMesh.metadata.id, hp.pickedMesh.metadata.index, hp.pickedMesh);
          pi.event.preventDefault?.();
          return;
        }
        const p = scene.pick(scene.pointerX, scene.pointerY, pickKinds);
        const md = p?.hit ? p.pickedMesh.metadata : null;
        this._down = { x: scene.pointerX, y: scene.pointerY, hit: md?.kind === 'tunnel' || md?.kind === 'chamber' ? md.id : null };
      }
      if (pi.type === 4) {
        if (this.drag) this._moveDrag();
      }
      if (pi.type === 2) {
        if (this.drag) {
          this._endDrag();
          return;
        }
        if (!this._down) return;
        const moved = Math.hypot(this._down.x - scene.pointerX, this._down.y - scene.pointerY) > 5;
        const downId = this._down.hit;
        this._down = null;
        if (moved) return;
        const p = scene.pick(scene.pointerX, scene.pointerY, pickKinds);
        const md = p?.hit ? p.pickedMesh.metadata : null;
        const id = md?.kind === 'tunnel' || md?.kind === 'chamber' ? md.id : null;
        if (id !== this.selection) this.select(id);
        else if (!id && downId === null) this.select(null);
      }
    });
  }

  _beginDrag(tunnelId, index, mesh) {
    const tunnel = this.nest?.tunnels.find((t) => t.id === tunnelId);
    if (!tunnel) return;
    const camDir = this.camera.getForwardRay().direction.scale(-1).normalize();
    const start = new Vector3(tunnel.points[index].x, tunnel.points[index].y, tunnel.points[index].z);
    this.drag = { tunnelId, index, mesh, planeNormal: camDir, planePoint: start.clone(), moved: false };
    this.camera.detachControl();
    this.canvas.style.cursor = 'grabbing';
    this._setHandleActive(mesh, true);
  }

  _moveDrag() {
    const d = this.drag;
    if (!d) return;
    const scene = this.scene;
    const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), this.camera);
    const plane = Plane.FromPositionAndNormal(d.planePoint, d.planeNormal);
    const dist = ray.intersectsPlane(plane);
    if (dist == null) return;
    const hit = ray.origin.add(ray.direction.scale(dist));
    const soil = this.nest?.soil || { halfX: 12, halfZ: 9, depth: 26 };
    const x = clampf(hit.x, -soil.halfX + 0.5, soil.halfX - 0.5);
    const y = clampf(hit.y, -soil.depth + 0.5, -0.6);
    const z = clampf(hit.z, -soil.halfZ + 0.5, soil.halfZ - 0.5);
    d.mesh.position.set(x, y, z);
    d.moved = true;
    d.last = { x: r3(x), y: r3(y), z: r3(z) };
    this._previewPath(d.tunnelId, d.index, d.last);
  }

  _previewPath(tunnelId, index, pos) {
    const tunnel = this.nest?.tunnels.find((t) => t.id === tunnelId);
    const mesh = this.pickables.get(tunnelId);
    if (!tunnel || !mesh) return;
    const pts = tunnel.points.map((p, i) => (i === index ? pos : p));
    const path = samplePath(pts, 10).map((p) => new Vector3(p.x, p.y, p.z));
    const r = Math.max(0.075, tunnel.radius);
    try {
      MeshBuilder.CreateTube(mesh.name, { path, radius: r, tessellation: 14, cap: Mesh.CAP_ALL, instance: mesh }, this.scene);
    } catch (e) {
      /* ignore preview failure */
    }
    const lining = this._liningOf?.get(tunnelId);
    if (lining) {
      try {
        MeshBuilder.CreateTube(lining.name, { path, radius: r * 0.86, tessellation: 12, cap: Mesh.NO_CAP, sideOrientation: Mesh.BACKSIDE, instance: lining }, this.scene);
      } catch (e) {
        /* ignore */
      }
    }
    const halo = this._haloMesh;
    if (halo) {
      try {
        MeshBuilder.CreateTube(halo.name, { path, radius: r * 1.55, tessellation: 12, instance: halo }, this.scene);
      } catch (e) {
        /* ignore */
      }
    }
  }

  _setHandleActive(mesh, active) {
    if (!mesh?.material) return;
    mesh.material.emissiveColor = active ? new Color3(0.4, 1, 0.7) : new Color3(1, 0.74, 0.24);
  }

  _endDrag() {
    const d = this.drag;
    this.drag = null;
    this.camera.attachControl(this.canvas, true);
    this.canvas.style.cursor = 'default';
    if (!d) return;
    this._setHandleActive(d.mesh, false);
    if (d.moved && d.last && this.onEdit) {
      this.onEdit(d.tunnelId, d.index, d.last);
    }
  }

  /* ------------------------------------------------------------ runtime */

  _tick() {
    const tw = this._camTween;
    if (tw) {
      const c = this.camera;
      tw.t = Math.min(1, tw.t + this.engine.getDeltaTime() / tw.dur);
      const e = ease(tw.t);
      c.setTarget(Vector3.Lerp(tw.from.target, tw.to.target, e));
      c.alpha = lerp(tw.from.alpha, tw.to.alpha, e);
      c.beta = lerp(tw.from.beta, tw.to.beta, e);
      c.radius = lerp(tw.from.radius, tw.to.radius, e);
      if (tw.t >= 1) this._camTween = null;
    }
    // keep the section cut oriented toward the camera while orbiting
    if (this.cutaway.enabled && this.nest && !this._cutTick) {
      this._cutTick = 0;
    }
    if (this.cutaway.enabled && this.nest) {
      this._cutTick = (this._cutTick || 0) + 1;
      if (this._cutTick % 12 === 0) {
        const c = this.camera;
        const dx = c.position.x - c.target.x;
        const dz = c.position.z - c.target.z;
        const mix = Math.abs(dx) / (Math.abs(dx) + Math.abs(dz) + 1e-6);
        const nAxis = mix > 0.5 + 1e-6 ? 'x' : 'z';
        const nDir = nAxis === 'z' ? Math.sign(dz) || 1 : Math.sign(dx) || 1;
        if (!this._cutInfo || nAxis !== this._cutInfo.axis || nDir !== this._cutInfo.dir) this._applySoilCut();
      }
    }
  }

  snapshot(width = 1440, height = 900) {
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    try {
      this.engine.setSize(width, height);
      if (this.ortho) this.setOrtho(this.ortho.mode, this.ortho.halfHeight, true);
      this.scene.render();
      return this.canvas.toDataURL('image/jpeg', 0.84);
    } finally {
      this.engine.setSize(w, h);
      if (this.ortho) this.setOrtho(this.ortho.mode, this.ortho.halfHeight, true);
      this.scene.render();
    }
  }

  resize() {
    this.engine.resize();
    if (this.ortho) this.setOrtho(this.ortho.mode, this.ortho.halfHeight, true);
  }

  debugCamera(alpha, beta, radius, tx, ty, tz) {
    const c = this.camera;
    this._camTween = null;
    if (tx !== undefined) c.setTarget(new Vector3(tx, ty, tz));
    c.alpha = alpha;
    c.beta = beta;
    c.radius = radius;
    return { alpha: c.alpha, beta: c.beta, radius: c.radius, target: c.target.asArray(), pos: c.position.asArray() };
  }

  dispose() {
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }
}

const clampf = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const r3 = (v) => Math.round(v * 1000) / 1000;
const r5 = (v) => Math.round(v * 100000) / 100000;

function hash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
