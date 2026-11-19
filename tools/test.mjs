#!/usr/bin/env node
// Headless assertions for the generator / validation / export invariants.
// Run: node tools/test.mjs

import { generateSpecimen, defaultParamsFor, applyOverrides, emptyOverrides, cellColor, computeStats, VARIANT_OFFSETS, PARAM_META } from '../src/lib/generator.js';
import { runChecks, summarize, THRESHOLDS } from '../src/lib/validation.js';
import { buildScene, artboardToWing, wingToArtboard } from '../src/lib/scene.js';
import { specimenToSvg, wingToSvg } from '../src/lib/svgExport.js';
import { fingerprint } from '../src/lib/rng.js';
import { contrastRatio } from '../src/lib/color.js';

let pass = 0;
let fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    pass++;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (e) {
    fail++;
    failures.push({ name, error: e });
    process.stdout.write(`  ✗ ${name}\n      ${e.message}\n`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function close(a, b, eps, msg) {
  if (Math.abs(a - b) > eps) throw new Error(`${msg || 'not close'}: ${a} vs ${b} (eps ${eps})`);
}

const SPECIES = ['swallowtail', 'nymphalid', 'pierid'];
const SEEDS = ['A17', 'K33', 'M09', 'Zz-99'];

function geomFp(spec) {
  return fingerprint(
    spec.wings.map((w) => ({
      k: w.key,
      poly: w.poly.map((p) => p.map((v) => +v.toFixed(9))),
      veins: w.veins.map((v) => v.pts.map((p) => p.map((x) => +x.toFixed(9)))),
      cells: w.cells.map((c) => [c.id, c.poly.map((p) => p.map((v) => +v.toFixed(9)))]),
      spots: w.spots.map((s) => [s.id, +s.x.toFixed(9), +s.y.toFixed(9), +s.rx.toFixed(9), s.color.map((c) => +c.toFixed(6))]),
      // placement matters: 翅长/翅宽 are applied to the wing transform
      tf: [w.transform.a, w.transform.b, w.transform.c, w.transform.d, w.transform.e, w.transform.f].map((v) => +v.toFixed(9))
    }))
  );
}

console.log('\n确定性 (determinism)');
test('same species+params+seed+variant produces identical geometry', () => {
  for (const sp of SPECIES) {
    const p = defaultParamsFor(sp);
    for (const seed of SEEDS) {
      for (let v = 0; v < 4; v++) {
        const a = generateSpecimen({ speciesId: sp, params: p, seed, variant: v });
        const b = generateSpecimen({ speciesId: sp, params: p, seed, variant: v });
        assert(geomFp(a) === geomFp(b), `${sp}/${seed}/v${v} not reproducible`);
        assert(a.fingerprint === b.fingerprint, `${sp}/${seed}/v${v} fingerprint differs`);
      }
    }
  }
});

test('each assembly step is order-independent (regenerating one variant twice)', () => {
  const spec = generateSpecimen({ speciesId: 'nymphalid', params: defaultParamsFor('nymphalid'), seed: 'Q1', variant: 2 });
  const again = generateSpecimen({ speciesId: 'nymphalid', params: defaultParamsFor('nymphalid'), seed: 'Q1', variant: 2 });
  // perturbing another specimen in between must not affect this one
  generateSpecimen({ speciesId: 'pierid', params: defaultParamsFor('pierid'), seed: 'Q2', variant: 1 });
  const third = generateSpecimen({ speciesId: 'nymphalid', params: defaultParamsFor('nymphalid'), seed: 'Q1', variant: 2 });
  assert(geomFp(again) === geomFp(third), 'generation leaked state between calls');
});

test('different seeds produce different geometry', () => {
  const p = defaultParamsFor('swallowtail');
  const fps = new Set();
  for (const seed of SEEDS) fps.add(geomFp(generateSpecimen({ speciesId: 'swallowtail', params: p, seed, variant: 0 })));
  assert(fps.size === SEEDS.length, 'two seeds collided');
});

test('the four variants are visually distinct', () => {
  const p = defaultParamsFor('nymphalid');
  const fps = new Set();
  for (let v = 0; v < VARIANT_OFFSETS.length; v++) {
    fps.add(geomFp(generateSpecimen({ speciesId: 'nymphalid', params: p, seed: 'V1', variant: v })));
  }
  assert(fps.size === VARIANT_OFFSETS.length, 'variants are not distinct');
});

test('variant 0 is exactly the user parameter set', () => {
  const p = defaultParamsFor('pierid');
  const s = generateSpecimen({ speciesId: 'pierid', params: p, seed: 'V0', variant: 0 });
  for (const [k, v] of Object.entries(p)) close(s.params[k], v, 1e-6, `param ${k} drifted in variant 0`);
});

console.log('\n结构 (structure)');
test('every wing has cells, spots, veins and cells tessellate the wing', () => {
  for (const sp of SPECIES) {
    const spec = generateSpecimen({ speciesId: sp, params: defaultParamsFor(sp), seed: 'S1', variant: 0 });
    for (const wing of spec.wings) {
      assert(wing.cells.length > 0, `${sp}/${wing.key} has no cells`);
      assert(wing.veins.length >= 4, `${sp}/${wing.key} has too few veins`);
      const cellArea = wing.cells.reduce((n, c) => n + c.area, 0);
      const wingArea = wing.poly.reduce((s, p, i, arr) => {
        const q = arr[(i + 1) % arr.length];
        return s + (p[0] * q[1] - q[0] * p[1]);
      }, 0) / 2;
      const ratio = cellArea / Math.abs(wingArea);
      assert(ratio > 0.82 && ratio <= 1.02, `${sp}/${wing.key} cells cover ${(ratio * 100).toFixed(1)}% of the wing`);
      assert(wing.spots.every((s) => s.rx > 0 && s.ry > 0), 'non-positive spot radius');
    }
  }
});

test('left and right wings are exact mirrors at asymmetry = 0', () => {
  for (const sp of SPECIES) {
    const p = { ...defaultParamsFor(sp), asymmetry: 0 };
    const spec = generateSpecimen({ speciesId: sp, params: p, seed: 'M1', variant: 0 });
    for (const kind of ['fore', 'hind']) {
      const L = spec.wings.find((w) => w.key === `${kind}-left`);
      const R = spec.wings.find((w) => w.key === `${kind}-right`);
      assert(L.cells.length === R.cells.length, `${kind} cell count differs`);
      for (let i = 0; i < L.poly.length; i++) {
        close(L.poly[i][0], R.poly[i][0], 1e-9, `${kind} mirror x`);
        close(L.poly[i][1], R.poly[i][1], 1e-9, `${kind} mirror y`);
      }
      assert(L.spots.length === R.spots.length, `${kind} spot count differs`);
      for (let i = 0; i < L.spots.length; i++) {
        close(L.spots[i].x, R.spots[i].x, 1e-9, `${kind} spot x`);
        close(L.spots[i].y, R.spots[i].y, 1e-9, `${kind} spot y`);
      }
    }
  }
});

test('cell ids are stable between regenerations (overrides can key on them)', () => {
  const p = defaultParamsFor('swallowtail');
  const a = generateSpecimen({ speciesId: 'swallowtail', params: p, seed: 'ID1', variant: 0 });
  const b = generateSpecimen({ speciesId: 'swallowtail', params: p, seed: 'ID1', variant: 0 });
  for (let i = 0; i < a.wings.length; i++) {
    const idsA = a.wings[i].cells.map((c) => c.id).join(',');
    const idsB = b.wings[i].cells.map((c) => c.id).join(',');
    assert(idsA === idsB, 'cell ids are not stable');
  }
});

test('every parameter changes the rendered artwork', () => {
  const base = defaultParamsFor('nymphalid');
  const a = generateSpecimen({ speciesId: 'nymphalid', params: base, seed: 'P1', variant: 0 });
  const fa = geomFp(a);
  for (const m of PARAM_META) {
    if (m.key === 'asymmetry') continue; // 0 is the default; covered by the symmetry test
    const target = m.key === 'hueBase' ? (base[m.key] + 100) % 360 : base[m.key] + (m.max - base[m.key]) * 0.6;
    const b = generateSpecimen({ speciesId: 'nymphalid', params: { ...base, [m.key]: target }, seed: 'P1', variant: 0 });
    // some parameters (edge band) only change the rendered scene, not the mesh
    const sceneA = buildScene(a, { selection: false });
    const sceneB = buildScene(b, { selection: false });
    // compare geometry AND colour of every paint layer: some parameters (edge
    // band width) move vertices without changing the palette
    const sceneFp = (sc) =>
      fingerprint(
        ['fill', 'cells', 'band', 'veins', 'outline', 'spots'].map((k) =>
          sc[k] ? [Array.from(sc[k].positions.slice(0, 2400), (v) => +v.toFixed(4)), Array.from(sc[k].colors.slice(0, 400))] : null
        )
      );
    assert(geomFp(b) !== fa || sceneFp(sceneA) !== sceneFp(sceneB), `changing ${m.label} (${m.key}) had no visible effect`);
  }
});

console.log('\n手工改动 (overrides)');
test('overrides survive a full regeneration with new parameters', () => {
  const p = defaultParamsFor('swallowtail');
  const spec = generateSpecimen({ speciesId: 'swallowtail', params: p, seed: 'O1', variant: 0 });
  const cell = spec.wings[1].cells.find((c) => !c.margin);
  const spot = spec.wings[1].spots[0];
  const overrides = {
    cells: { [cell.id]: { hue: 200, sat: 0.8, light: 0.45, locked: true } },
    spots: { [spot.id]: { dx: 0.04, dy: -0.02, sizeMul: 1.5 } }
  };
  const regen = generateSpecimen({ speciesId: 'swallowtail', params: { ...p, hueBase: 210, wingWidth: 0.9 }, seed: 'O1', variant: 0 });
  applyOverrides(regen, overrides);
  const c2 = regen.wings[1].cells.find((c) => c.id === cell.id);
  assert(c2, 'locked cell disappeared');
  assert(c2.locked, 'lock flag lost');
  assert(c2.color && Math.abs(c2.color[0] - 200) < 1e-9, 'manual colour lost');
  const s2 = regen.wings[1].spots.find((s) => s.id === spot.id);
  assert(s2 && s2.edited, 'spot override lost');
});

test('untouched cells take the new parameters', () => {
  const p = defaultParamsFor('nymphalid');
  const a = generateSpecimen({ speciesId: 'nymphalid', params: p, seed: 'O2', variant: 0 });
  const target = a.wings[2].cells.find((c) => !c.margin);
  const b = generateSpecimen({ speciesId: 'nymphalid', params: { ...p, hueBase: 210 }, seed: 'O2', variant: 0 });
  applyOverrides(b, { cells: { [target.id]: { hue: 5, sat: 0.9, light: 0.5, locked: true } }, spots: {} });
  const untouched = b.wings[2].cells.find((c) => !c.margin && c.id !== target.id);
  const col = cellColor(b, b.wings[2], untouched);
  assert(Math.abs(col[0] - p.hueBase) > 30 || Math.abs(col[0] - 210) < 60, 'untouched cell did not follow the new hue');
});

test('a locked cell keeps its frozen colour even when params change', () => {
  const p = defaultParamsFor('pierid');
  const a = generateSpecimen({ speciesId: 'pierid', params: p, seed: 'O3', variant: 0 });
  const cell = a.wings[0].cells[2];
  const overrides = { cells: { [cell.id]: { locked: true, hue: 300, sat: 0.5, light: 0.5 } }, spots: {} };
  const b = generateSpecimen({ speciesId: 'pierid', params: { ...p, hueBase: 40, lightness: 0.3 }, seed: 'O3', variant: 0 });
  applyOverrides(b, overrides);
  const c2 = b.wings[0].cells.find((c) => c.id === cell.id);
  assert(c2.color[0] === 300 && c2.color[1] === 0.5 && c2.color[2] === 0.5, 'locked colour drifted');
});

console.log('\n质检 (validation)');
test('default templates produce no blocking findings', () => {
  for (const sp of SPECIES) {
    for (const seed of SEEDS) {
      const spec = generateSpecimen({ speciesId: sp, params: defaultParamsFor(sp), seed, variant: 0 });
      const f = runChecks(spec, cellColor);
      const s = summarize(f);
      assert(s.blocking === 0, `${sp}/${seed} has ${s.blocking} blocking: ${f.filter((x) => x.severity === 'blocking').map((x) => x.key)}`);
    }
  }
});

test('no spots is flagged blocking', () => {
  const spec = generateSpecimen({ speciesId: 'pierid', params: { ...defaultParamsFor('pierid'), spotDensity: 0 }, seed: 'N0', variant: 0 });
  const f = runChecks(spec, cellColor);
  assert(f.some((x) => x.key === 'density-empty' && x.severity === 'blocking'), 'empty wing was not flagged');
});

test('excess asymmetry is flagged blocking and scales with the parameter', () => {
  const low = generateSpecimen({ speciesId: 'swallowtail', params: { ...defaultParamsFor('swallowtail'), asymmetry: 0.001 }, seed: 'Y1', variant: 0 });
  const high = generateSpecimen({ speciesId: 'swallowtail', params: { ...defaultParamsFor('swallowtail'), asymmetry: 0.06 }, seed: 'Y1', variant: 0 });
  const lowSym = runChecks(low, cellColor).filter((x) => x.check === 'symmetry');
  const highSym = runChecks(high, cellColor).filter((x) => x.check === 'symmetry');
  assert(lowSym.length === 0, 'tiny asymmetry was flagged');
  assert(highSym.length > 0 && highSym.every((x) => x.severity === 'blocking'), 'large asymmetry was not blocking');
});

test('findings are stable across repeated runs', () => {
  const spec = generateSpecimen({ speciesId: 'nymphalid', params: { ...defaultParamsFor('nymphalid'), spotDensity: 0.02 }, seed: 'D1', variant: 0 });
  const a = JSON.stringify(runChecks(spec, cellColor));
  const b = JSON.stringify(runChecks(spec, cellColor));
  assert(a === b, 'validation is not deterministic');
});

test('every finding carries severity, detail, hint and a numeric value', () => {
  const spec = generateSpecimen({ speciesId: 'swallowtail', params: { ...defaultParamsFor('swallowtail'), spotDensity: 0, asymmetry: 0.05, marginBand: 0 }, seed: 'D2', variant: 0 });
  for (const f of runChecks(spec, cellColor)) {
    assert(['blocking', 'warning'].includes(f.severity), 'bad severity');
    assert(f.title && f.detail && f.hint, 'incomplete finding');
    assert(Number.isFinite(f.value), 'non-numeric value');
  }
});

console.log('\n渲染与导出 (render & export)');
test('scene layers are finite and ordered', () => {
  const spec = generateSpecimen({ speciesId: 'nymphalid', params: defaultParamsFor('nymphalid'), seed: 'R1', variant: 0 });
  const scene = buildScene(spec, { selection: false });
  for (const key of ['fill', 'cells', 'band', 'veins', 'outline', 'spots']) {
    const layer = scene[key];
    assert(layer, `missing layer ${key}`);
    assert(layer.positions.length === layer.colors.length / 2, `${key} buffer length mismatch`);
    for (let i = 0; i < layer.positions.length; i++) assert(Number.isFinite(layer.positions[i]), `${key} non-finite vertex`);
    assert(layer.vertexCount % 3 === 0, `${key} vertex count is not a triangle multiple`);
  }
  assert(scene.triangleCount > 1000, 'suspiciously empty scene');
});

test('artboard <-> wing transforms round-trip', () => {
  const spec = generateSpecimen({ speciesId: 'pierid', params: defaultParamsFor('pierid'), seed: 'T1', variant: 0 });
  for (const wing of spec.wings) {
    for (const p of [[0, 0], [0.3, 0.4], [-0.1, 0.6]]) {
      const art = wingToArtboard(wing, p);
      const back = artboardToWing(wing, art);
      close(back[0], p[0], 1e-9, 'x round-trip');
      close(back[1], p[1], 1e-9, 'y round-trip');
    }
  }
});

test('SVG export contains one group per layer and valid structure', () => {
  const spec = generateSpecimen({ speciesId: 'swallowtail', params: defaultParamsFor('swallowtail'), seed: 'E1', variant: 0 });
  const svg = specimenToSvg(spec);
  assert(svg.startsWith('<svg'), 'missing svg root');
  assert(svg.trim().endsWith('</svg>'), 'unterminated svg');
  assert(svg.includes('id="body"'), 'missing body group');
  for (const key of ['shape', 'cells', 'veins', 'spots']) {
    assert(svg.includes(`id="fore-right-${key}"`), `missing fore-right ${key} group`);
  }
  assert((svg.match(/<path/g) || []).length > 100, 'too few paths');
  assert(!svg.includes('NaN'), 'NaN in svg output');
});

test('single-wing SVG is in wing-local coordinates', () => {
  const spec = generateSpecimen({ speciesId: 'nymphalid', params: defaultParamsFor('nymphalid'), seed: 'E2', variant: 0 });
  const wing = spec.wings[0];
  const groups = wingToSvg(spec, wing, { coords: 'local' });
  const shape = groups.find(([k]) => k === 'shape')[1];
  const fill = shape.match(/id="wing-fill" d="M([-\d.]+) ([-\d.]+)/);
  assert(fill, 'no wing-fill path');
  const scale = Math.sqrt(Math.abs(wing.transform.a * wing.transform.d - wing.transform.b * wing.transform.c));
  close(Number(fill[1]), wing.poly[0][0] * scale, 0.01, 'local x');
  close(Number(fill[2]), wing.poly[0][1] * scale, 0.01, 'local y');
  // and the artboard placement offset must not appear
  const artOffset = wing.transform.e;
  assert(Math.abs(Number(fill[1]) - artOffset) > 5, 'local output still carries the artboard offset');
});

test('cell colour is deterministic and honours manual overrides', () => {
  const spec = generateSpecimen({ speciesId: 'pierid', params: defaultParamsFor('pierid'), seed: 'C1', variant: 0 });
  const wing = spec.wings[1];
  const cell = wing.cells[0];
  const c1 = cellColor(spec, wing, cell);
  const c2 = cellColor(spec, wing, cell);
  assert(c1[0] === c2[0] && c1[1] === c2[1] && c1[2] === c2[2], 'cell colour is not deterministic');
  const manual = structuredClone(spec);
  manual.wings[1].cells[0].color = [123, 0.5, 0.5];
  const c3 = cellColor(manual, manual.wings[1], manual.wings[1].cells[0]);
  assert(c3[0] === 123, 'manual colour ignored');
});

test('spot colours separate from their cell by the configured minimum', () => {
  for (const sp of SPECIES) {
    const spec = generateSpecimen({ speciesId: sp, params: defaultParamsFor(sp), seed: 'X1', variant: 0 });
    for (const wing of spec.wings) {
      for (const spot of wing.spots) {
        const cell = wing.cells.find((c) => c.id === spot.cellId);
        if (!cell) continue;
        const ratio = contrastRatio(spot.color, cellColor(spec, wing, cell));
        assert(ratio >= 1.25, `${sp}/${wing.key} spot contrast ${ratio.toFixed(2)} too low`);
      }
    }
  }
});

test('default parameters stay inside their declared ranges', () => {
  for (const sp of SPECIES) {
    const p = defaultParamsFor(sp);
    for (const m of PARAM_META) {
      assert(p[m.key] >= m.min && p[m.key] <= m.max, `${sp}.${m.key}=${p[m.key]} outside [${m.min}, ${m.max}]`);
    }
  }
});

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) {
  for (const f of failures) {
    console.log(`FAILED: ${f.name}`);
    console.log(f.error.stack.split('\n').slice(0, 4).join('\n'));
    console.log('');
  }
  process.exit(1);
}
