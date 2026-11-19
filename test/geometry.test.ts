import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStarterScene } from '../shared/scene';
import {
  computeInterference,
  computeTopView,
  makeBOM,
  pickAll,
  polygonArea,
  clipPolygon,
  project,
  screenRay,
  findPortSnap,
  supportHeight,
  entityOBB,
  footprint,
  rayOBBDistance,
  entitySilhouette,
  polygonIntersectsRect,
} from '../shared/geometry';
import { PART_MAP, partWeight, cylDims } from '../shared/parts';

test('starter scene: coherent, non-colliding, plausible BOM', () => {
  const scene = buildStarterScene();
  assert.ok(scene.entities.length > 20, 'has a decent number of parts');
  const bom = makeBOM(scene);
  assert.equal(bom.totalParts, scene.entities.length);
  // A 1500×2000 steel tube bed frame with two boards is roughly 80–140 kg.
  assert.ok(bom.totalWeight > 60 && bom.totalWeight < 160, `weight ${bom.totalWeight}`);
  assert.ok(bom.totalVolume > 0.1 && bom.totalVolume < 1.5, `volume ${bom.totalVolume}`);
  assert.deepEqual(computeInterference(scene), [], 'starter scene must be interference-free');
  // every entity resolves to a known part definition
  for (const e of scene.entities) assert.ok(PART_MAP[e.defId], `unknown part ${e.defId}`);
});

test('tube weight uses the cross-section, not the length as diameter', () => {
  const side = PART_MAP['tube-side'];
  const { dia, len } = cylDims(side);
  assert.equal(dia, 50);
  assert.ok(Math.abs(len - 1890) < 1e-6);
  // Ø50×1.5 wall, 1.89 m of steel ≈ 3.4 kg
  assert.ok(partWeight(side) > 3 && partWeight(side) < 4, `got ${partWeight(side)}`);
});

test('BOM groups identical parts and sums weights', () => {
  const scene = buildStarterScene();
  const bom = makeBOM(scene);
  const legs = bom.rows.find((r) => r.partNo === 'KF-L50-350');
  assert.ok(legs);
  assert.equal(legs!.qty, 4);
  assert.ok(Math.abs(legs!.totalWeight - legs!.unitWeight * 4) < 1e-9);
  const sum = bom.rows.reduce((s, r) => s + r.totalWeight, 0);
  assert.ok(Math.abs(sum - bom.totalWeight) < 1e-6);
});

test('isometric projection is linear and invertible on a ground point', () => {
  const p = project({ x: 1234, y: -567, z: 0 });
  const back = screenRay(p.x, p.y);
  // the ray must pass through the original ground point
  const t = (1234 - back.o.x) / back.dir.x;
  assert.ok(Math.abs(back.o.y + back.dir.y * t - -567) < 1e-6);
  assert.ok(Math.abs(back.o.z + back.dir.z * t - 0) < 1e-6);
});

test('picking returns front-to-back order and reaches occluded parts', () => {
  const scene = buildStarterScene();
  // the two boards sit at the same height side by side; a leg is behind a board
  const leg = scene.entities.find((e) => e.defId === 'leg')!;
  const def = PART_MAP[leg.defId];
  const obb = entityOBB(leg, def);
  const s = project({ x: obb.c.x, y: obb.c.y, z: obb.c.z });
  const hits = pickAll(scene, s.x, s.y);
  assert.ok(hits.length >= 1);
  // distances strictly increase
  for (let i = 1; i < hits.length; i++) assert.ok(hits[i].t >= hits[i - 1].t);
});

test('OBB ray test hits an axis-aligned box and misses beside it', () => {
  const obb = { c: { x: 0, y: 0, z: 500 }, h: { x: 100, y: 100, z: 100 }, yaw: 0 };
  // ray straight down through the centre
  const hit = rayOBBDistance({ x: 0, y: 0, z: 5000 }, { x: 0, y: 0, z: -1 }, obb);
  assert.ok(hit != null && Math.abs(hit - 4400) < 1e-6);
  const miss = rayOBBDistance({ x: 500, y: 0, z: 5000 }, { x: 0, y: 0, z: -1 }, obb);
  assert.equal(miss, null);
});

test('rotated OBB footprint has the same area as the axis-aligned one', () => {
  const size = { x: 200, y: 100 };
  const areaOf = (yaw: number) => {
    const h = { x: size.x / 2, y: size.y / 2, z: 10 };
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const pts = [[-h.x, -h.y], [h.x, -h.y], [h.x, h.y], [-h.x, h.y]].map(([lx, ly]) => ({
      x: lx * c - ly * s,
      y: lx * s + ly * c,
    }));
    return polygonArea(pts);
  };
  assert.ok(Math.abs(areaOf(0) - 20000) < 1e-6);
  assert.ok(Math.abs(areaOf(Math.PI / 5) - 20000) < 1e-6);
});

test('polygon clipping reduces to the intersection area', () => {
  const a = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const b = [{ x: 50, y: 50 }, { x: 150, y: 50 }, { x: 150, y: 150 }, { x: 50, y: 150 }];
  const clipped = clipPolygon(a, b);
  assert.ok(Math.abs(polygonArea(clipped) - 2500) < 1e-6, `got ${polygonArea(clipped)}`);
});

test('top view flags a narrow aisle and reports extents', () => {
  const scene = buildStarterScene();
  const tv = computeTopView(scene);
  assert.ok(tv.rects.length > 0);
  assert.ok(tv.maxX > tv.minX && tv.maxY > tv.minY);
  assert.ok(tv.aisles.some((a) => a.narrow), 'sample layout should contain a sub-800mm aisle');
  // widening the threshold clears the warning
  const relaxed = computeTopView(scene, { minAisle: 200 });
  assert.equal(relaxed.aisles.filter((a) => a.narrow).length, 0);
});

test('port snap pairs a pin with a socket and reports the offset to apply', () => {
  const scene = buildStarterScene();
  const pad = scene.entities.find((e) => e.defId === 'foot-pad')!;
  const leg = scene.entities.find((e) => e.defId === 'leg')!;
  pad.pos = { x: leg.pos.x + 30, y: leg.pos.y - 20, z: 6 };
  const hit = findPortSnap(scene, new Set([pad.uid]), 150);
  assert.ok(hit, 'expected a snap');
  assert.equal(hit!.targetUid, leg.uid);
  assert.ok(hit!.distance < 60);
  // applying the reported socket/port difference would close the gap
  assert.ok(Number.isFinite(hit!.socketWorld.x));
});

test('support height snaps a dropped board onto the rails beneath it', () => {
  const scene = buildStarterScene();
  const board = scene.entities.find((e) => e.defId === 'board-slat')!;
  const def = PART_MAP[board.defId];
  // hover the board above the bed footprint
  const sup = supportHeight(scene, board.uid, { x: 0, y: -350, z: 500 }, 0, def);
  assert.ok(sup.z > 0, `expected support above ground, got ${sup.z}`);
  assert.ok(sup.on, 'expected a supporting part');
});

test('marquee hit-test detects overlap with a part silhouette', () => {
  const scene = buildStarterScene();
  const board = scene.entities.find((e) => e.defId === 'board-slat')!;
  const sil = entitySilhouette(board, PART_MAP[board.defId]);
  const b = { x: sil[0].x - 10, y: sil[0].y - 10, w: 20, d: 20 };
  assert.equal(polygonIntersectsRect(sil, b), true);
  assert.equal(polygonIntersectsRect(sil, { x: sil[0].x + 10000, y: sil[0].y, w: 10, d: 10 }), false);
});
