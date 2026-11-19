// Application state. Plain Svelte 5 runes in a module — imported by every view.
//
// The two hard invariants of this tool live here:
//
// 1. Determinism. A specimen is a pure function of (species, params, seed,
//    variant). Regenerating with the same inputs always reproduces the same
//    artwork. `specimenFingerprint` is shown in the UI so a maker can verify it.
//
// 2. Manual work survives regeneration. Cell colours and locks are stored in
//    `overrides.cells` keyed by stable cell id; spot offsets in
//    `overrides.spots`. `regenerate()` rebuilds the specimen from parameters and
//    then re-applies those overrides, so locked cells keep their colour and
//    moved spots keep their offset.

import { generateSpecimen, defaultParamsFor, clampParams, applyOverrides, emptyOverrides, cellColor, computeStats } from '../lib/generator.js';
import { buildScene } from '../lib/scene.js';
import { runChecks, summarize } from '../lib/validation.js';
import { fingerprint } from '../lib/rng.js';

export const VARIANTS = 4;

let uid = 0;
const nextId = (p) => `${p}-${(++uid).toString(36)}${Date.now().toString(36).slice(-3)}`;

export function createAppState() {
  const state = $state({
    // ---- generator ----
    speciesId: 'swallowtail',
    params: defaultParamsFor('swallowtail'),
    seed: 'SW-0001',
    variants: [], // four generated specimens
    activeVariant: 0,
    generating: false,
    seedHistory: [],

    // ---- editing ----
    tool: 'select', // select | pan | pickColor
    selection: { cellId: null, spotId: null, wing: null },
    hover: { cellId: null, spotId: null },
    overrides: emptyOverrides(),
    overridesByVariant: {}, // variantIndex -> overrides
    lockedCount: 0,
    editedCount: 0,
    undoDepth: 0,
    redoDepth: 0,
    undoLabel: '',
    redoLabel: '',

    // ---- viewport ----
    view: { scale: 1, tx: 0, ty: 0 },
    layers: { shape: true, cells: true, veins: true, spots: true, detail: true },
    rendererBackend: 'pending', // webgpu | canvas2d
    zoom: 1,
    fitToken: 0,

    // ---- batch ----
    batch: {
      entries: [], // {id, specimen, overrides, submittedAt, checks, review}
      id: 'B-' + new Date().toISOString().slice(0, 10).replace(/-/g, '')
    },
    batchSelected: null,

    // ---- review ----
    reviewFilter: 'all', // all | blocking | warning
    reviewer: '复核员 A',
    toast: null,
    showBoxes: true,
    log: []
  });

  // ------------------------------------------------------------------
  // derived
  // ------------------------------------------------------------------
  const activeSpecimen = $derived(state.variants[state.activeVariant] || null);

  function currentOverrides() {
    return state.overridesByVariant[state.activeVariant] || emptyOverrides();
  }

  function setCurrentOverrides(next) {
    state.overridesByVariant = { ...state.overridesByVariant, [state.activeVariant]: next };
    state.overrides = next;
    recountOverrides();
  }

  // ------------------------------------------------------------------
  // undo / redo over the override maps (the only *manual* state)
  // ------------------------------------------------------------------
  /** Deep copy that unwraps Svelte state proxies (structuredClone can't). */
  function plainCopy(v) {
    return JSON.parse(JSON.stringify(v ?? null));
  }

  const undoStacks = new Map(); // variantIndex -> {past: [], future: []}
  function historyFor(v = state.activeVariant) {
    if (!undoStacks.has(v)) undoStacks.set(v, { past: [], future: [] });
    return undoStacks.get(v);
  }

  /**
   * Commit an override change. `coalesceKey` merges rapid same-target changes
   * (dragging a spot, sweeping a colour slider) into one undo step.
   */
  function commitOverrides(next, { label = '', coalesceKey = null } = {}) {
    const h = historyFor();
    const prev = currentOverrides();
    const now = Date.now();
    const last = h.past[h.past.length - 1];
    const mergeable = coalesceKey && last && last.coalesceKey === coalesceKey && now - last.at < 900;
    if (mergeable) {
      last.at = now;
      last.label = label || last.label;
    } else {
      h.past.push({ overrides: plainCopy(prev), label, coalesceKey, at: now });
    }
    h.future = [];
    setCurrentOverrides(next);
    syncActive();
    refreshHistoryFlags();
  }

  function undo() {
    const h = historyFor();
    if (!h.past.length) return false;
    const entry = h.past.pop();
    h.future.push({ overrides: plainCopy(currentOverrides()), label: entry.label, at: Date.now() });
    setCurrentOverrides(entry.overrides);
    syncActive();
    refreshHistoryFlags();
    pushLog(`撤销${entry.label ? '：' + entry.label : ''}`);
    return true;
  }

  function redo() {
    const h = historyFor();
    if (!h.future.length) return false;
    const entry = h.future.pop();
    h.past.push({ overrides: plainCopy(currentOverrides()), label: entry.label, at: Date.now() });
    setCurrentOverrides(entry.overrides);
    syncActive();
    refreshHistoryFlags();
    pushLog(`重做${entry.label ? '：' + entry.label : ''}`);
    return true;
  }

  function refreshHistoryFlags() {
    const h = historyFor();
    state.undoDepth = h.past.length;
    state.redoDepth = h.future.length;
    state.undoLabel = h.past[h.past.length - 1]?.label || '';
    state.redoLabel = h.future[h.future.length - 1]?.label || '';
  }

  /** Drop history whenever the underlying geometry is regenerated. */
  function resetHistory() {
    undoStacks.clear();
    refreshHistoryFlags();
  }

  function recountOverrides() {
    let locked = 0;
    let edited = 0;
    for (const ov of Object.values(state.overridesByVariant)) {
      for (const c of Object.values(ov.cells || {})) {
        if (c.locked) locked++;
        if (c.hue != null) edited++;
      }
      edited += Object.keys(ov.spots || {}).length;
    }
    state.lockedCount = locked;
    state.editedCount = edited;
  }

  // ------------------------------------------------------------------
  // generation
  // ------------------------------------------------------------------
  function generateAll({ keepOverrides = false } = {}) {
    state.generating = true;
    const prevOverrides = keepOverrides ? state.overridesByVariant : {};
    const seed = state.seed;
    const next = [];
    for (let v = 0; v < VARIANTS; v++) {
      const spec = generateSpecimen({ speciesId: state.speciesId, params: state.params, seed, variant: v });
      const ov = prevOverrides[v] || emptyOverrides();
      applyOverrides(spec, keepOverrides ? ov : emptyOverrides());
      next.push(spec);
    }
    state.variants = next;
    state.overridesByVariant = keepOverrides ? { ...prevOverrides } : {};
    state.overrides = currentOverrides();
    resetHistory();
    state.activeVariant = Math.min(state.activeVariant, VARIANTS - 1);
    state.selection = { cellId: null, spotId: null, wing: null };
    state.hover = { cellId: null, spotId: null };
    recountOverrides();
    state.generating = false;
    const fp = next[state.activeVariant]?.fingerprint || '';
    pushLog(keepOverrides ? `按参数重算（保留手工改动）· ${speciesName()} · 种子 ${seed}` : `生成 4 个变体 · ${speciesName()} · 种子 ${seed} · ${fp.slice(0, 8)}`);
  }

  /** Regenerate the active variant in place, re-applying manual work. */
  function regenerateActive() {
    const ov = currentOverrides();
    const spec = generateSpecimen({ speciesId: state.speciesId, params: state.params, seed: state.seed, variant: state.activeVariant });
    applyOverrides(spec, ov);
    const next = state.variants.slice();
    next[state.activeVariant] = spec;
    state.variants = next;
    pushLog(`按新参数重算变体 ${state.activeVariant + 1} · 保留 ${Object.keys(ov.cells || {}).length} 个翅室与 ${Object.keys(ov.spots || {}).length} 个斑点改动`);
    return spec;
  }

  function setSpecies(id) {
    state.speciesId = id;
    state.params = defaultParamsFor(id);
    state.seedHistory = [];
    generateAll();
  }

  function setParams(patch) {
    state.params = clampParams({ ...state.params, ...patch });
  }

  function randomSeed() {
    const prefix = { swallowtail: 'SW', nymphalid: 'NY', pierid: 'PR' }[state.speciesId] || 'SP';
    const n = Math.floor(Math.random() * 9000) + 1000;
    return `${prefix}-${n}`;
  }

  function newSeed() {
    state.seedHistory = [state.seed, ...state.seedHistory].slice(0, 12);
    state.seed = randomSeed();
    generateAll();
  }

  /**
   * Re-generation check: draw the same specimen twice from scratch and compare
   * the full geometry fingerprints. Any difference means the generator leaked
   * non-deterministic state, which would make the seed promise a lie.
   */
  function verifyDeterminism() {
    const a = generateSpecimen({ speciesId: state.speciesId, params: state.params, seed: state.seed, variant: state.activeVariant });
    const b = generateSpecimen({ speciesId: state.speciesId, params: state.params, seed: state.seed, variant: state.activeVariant });
    const geom = (spec) =>
      fingerprint(
        spec.wings.map((w) => ({
          key: w.key,
          poly: w.poly.map((p) => p.map((v) => +v.toFixed(9))),
          veins: w.veins.map((v) => v.pts.map((p) => p.map((x) => +x.toFixed(9)))),
          cells: w.cells.map((c) => [c.id, c.poly.map((p) => p.map((v) => +v.toFixed(9)))]),
          spots: w.spots.map((s2) => [s2.id, +s2.x.toFixed(9), +s2.y.toFixed(9), +s2.rx.toFixed(9), s2.color.map((c2) => +c2.toFixed(6))])
        }))
      );
    const ga = geom(a);
    const gb = geom(b);
    const ok = ga === gb && a.fingerprint === b.fingerprint;
    pushLog(ok ? `确定性校验通过 · 指纹 ${ga.slice(0, 10)}（两次生成完全一致）` : `确定性校验失败 · ${ga.slice(0, 8)} vs ${gb.slice(0, 8)}`);
    return { ok, a: ga, b: gb, paramFp: a.fingerprint };
  }

  // ------------------------------------------------------------------
  // view / selection setters (components mutate state through these)
  // ------------------------------------------------------------------
  function setTool(tool) {
    state.tool = tool;
  }
  function setActiveVariant(i) {
    if (i === state.activeVariant || !state.variants[i]) return;
    state.selection = { cellId: null, spotId: null, wing: null };
    state.hover = { cellId: null, spotId: null };
    state.activeVariant = i;
    state.overrides = currentOverrides();
    refreshHistoryFlags();
  }
  function setSelection(sel) {
    state.selection = { cellId: null, spotId: null, wing: null, ...(sel || {}) };
  }
  function setHover(hover) {
    state.hover = { cellId: null, spotId: null, ...(hover || {}) };
  }
  function setLayers(layers) {
    state.layers = { ...state.layers, ...layers };
  }
  function setView(view) {
    state.view = view;
    state.zoom = view.scale;
  }
  function setRendererBackend(backend) {
    state.rendererBackend = backend;
  }
  function setReviewFilter(f) {
    state.reviewFilter = f;
  }
  function setSpaceKey(v) {
    state.spaceKey = v;
  }
  function setSeedDraftParams(params) {
    state.params = params;
  }

  function speciesName() {
    return { swallowtail: '凤蝶', nymphalid: '蛱蝶', pierid: '粉蝶' }[state.speciesId] || state.speciesId;
  }

  // ------------------------------------------------------------------
  // editing
  // ------------------------------------------------------------------
  function overrideForCell(cellId) {
    const ov = currentOverrides();
    return ov.cells?.[cellId] || null;
  }

  function setCellColor(cellId, hsl) {
    const ov = currentOverrides();
    const next = { cells: { ...ov.cells }, spots: { ...ov.spots } };
    next.cells[cellId] = { ...(next.cells[cellId] || {}), hue: hsl[0], sat: hsl[1], light: hsl[2] };
    commitOverrides(next, { label: `改色 ${shortId(cellId)}`, coalesceKey: `cell:${cellId}` });
    pushLog(`手绘翅室 ${shortId(cellId)} 改为 ${Math.round(hsl[0])}° / ${Math.round(hsl[1] * 100)}% / ${Math.round(hsl[2] * 100)}%`);
  }

  function toggleCellLock(cellId) {
    const ov = currentOverrides();
    const next = { cells: { ...ov.cells }, spots: { ...ov.spots } };
    const cur = next.cells[cellId] || {};
    const locked = !cur.locked;
    if (locked) {
      // store the current visible colour so the lock truly freezes it
      const found = findCell(cellId);
      const col = found ? cellColor(found.specimen, found.wing, found.cell) : null;
      next.cells[cellId] = { ...cur, locked: true, hue: cur.hue ?? col?.[0], sat: cur.sat ?? col?.[1], light: cur.light ?? col?.[2] };
    } else {
      const { locked: _l, ...rest } = cur;
      if (rest.hue == null) delete next.cells[cellId];
      else next.cells[cellId] = rest;
    }
    commitOverrides(next, { label: `${locked ? '锁定' : '解锁'} ${shortId(cellId)}` });
    pushLog(locked ? `锁定翅室 ${shortId(cellId)}` : `解锁翅室 ${shortId(cellId)}`);
    return locked;
  }

  function isCellLocked(cellId) {
    return !!overrideForCell(cellId)?.locked;
  }

  function moveSpot(spotId, dx, dy) {
    const ov = currentOverrides();
    const next = { cells: { ...ov.cells }, spots: { ...ov.spots } };
    const cur = next.spots[spotId] || { dx: 0, dy: 0, sizeMul: 1 };
    next.spots[spotId] = { ...cur, dx: (cur.dx || 0) + dx, dy: (cur.dy || 0) + dy };
    commitOverrides(next, { label: '移动斑点', coalesceKey: `spot:${spotId}` });
  }

  function resizeSpot(spotId, sizeMul) {
    const ov = currentOverrides();
    const next = { cells: { ...ov.cells }, spots: { ...ov.spots } };
    const cur = next.spots[spotId] || { dx: 0, dy: 0, sizeMul: 1 };
    next.spots[spotId] = { ...cur, sizeMul: clampNum((cur.sizeMul ?? 1) * sizeMul, 0.18, 5) };
    commitOverrides(next, { label: '调整斑点大小', coalesceKey: `spot:${spotId}` });
  }

  function resetSpot(spotId) {
    const ov = currentOverrides();
    if (!ov.spots[spotId]) return;
    const next = { cells: { ...ov.cells }, spots: { ...ov.spots } };
    delete next.spots[spotId];
    commitOverrides(next, { label: '还原斑点' });
  }

  function resetCell(cellId) {
    const ov = currentOverrides();
    if (!ov.cells[cellId]) return;
    const next = { cells: { ...ov.cells }, spots: { ...ov.spots } };
    delete next.cells[cellId];
    commitOverrides(next, { label: `还原翅室 ${shortId(cellId)}` });
    pushLog(`还原翅室 ${shortId(cellId)}`);
  }

  function clearAllOverrides() {
    if (!state.lockedCount && !state.editedCount) return;
    commitOverrides(emptyOverrides(), { label: '清空手工改动' });
    pushLog('清空变体 ' + (state.activeVariant + 1) + ' 的所有手工改动');
  }

  function syncActive() {
    const ov = currentOverrides();
    const spec = state.variants[state.activeVariant];
    if (!spec) return;
    applyOverrides(spec, ov);
    // nudge so Svelte re-renders derived scene
    state.variants = state.variants.slice();
  }

  function findCell(cellId) {
    const spec = state.variants[state.activeVariant];
    if (!spec) return null;
    for (const wing of spec.wings) {
      const cell = wing.cells.find((c) => c.id === cellId);
      if (cell) return { specimen: spec, wing, cell };
    }
    return null;
  }

  function findSpot(spotId) {
    const spec = state.variants[state.activeVariant];
    if (!spec) return null;
    for (const wing of spec.wings) {
      const spot = wing.spots.find((s) => s.id === spotId);
      if (spot) return { specimen: spec, wing, spot };
    }
    return null;
  }

  // ------------------------------------------------------------------
  // batch
  // ------------------------------------------------------------------
  function submitToBatch(variantIndex) {
    const idx = variantIndex ?? state.activeVariant;
    const spec = state.variants[idx];
    if (!spec) return null;
    // Submitting an identical specimen (same fingerprint + same overrides) is a
    // duplicate: re-open the existing entry instead of adding a second one.
    const ovSig = (ov) => {
      const cells = Object.keys(ov?.cells || {}).sort().map((k) => [k, ov.cells[k]]);
      const spots = Object.keys(ov?.spots || {}).sort().map((k) => [k, ov.spots[k]]);
      return JSON.stringify([cells, spots]);
    };
    const ovKey = ovSig(state.overridesByVariant[idx]);
    const dup = state.batch.entries.find((e) => e.specimen.fingerprint === spec.fingerprint && ovSig(e.overrides) === ovKey);
    if (dup) {
      state.batchSelected = dup.id;
      pushLog(`变体 ${idx + 1} 已在批次中（条目 ${dup.id.slice(-4)}），未重复提交`);
      return dup;
    }
    const ov = state.overridesByVariant[idx] || emptyOverrides();
    const submission = generateSpecimen({ speciesId: state.speciesId, params: state.params, seed: state.seed, variant: idx });
    applyOverrides(submission, ov);
    const checks = runChecks(submission, cellColor);
    const entry = {
      id: nextId('E'),
      specimen: submission,
      overrides: plainCopy(ov),
      checks,
      summary: summarize(checks),
      submittedAt: new Date().toISOString(),
      review: {
        status: 'pending', // pending | approved | rejected
        items: checks.map((c) => ({ key: c.key, severity: c.severity, title: c.title, verdict: 'pending', note: '', at: null })),
        reviewedBy: null,
        reviewedAt: null,
        note: ''
      },
      history: [],
      version: 1
    };
    state.batch = { ...state.batch, entries: [...state.batch.entries, entry] };
    state.batchSelected = entry.id;
    pushLog(`提交变体 ${idx + 1} 到批次 · ${entry.summary.blocking} 阻断 / ${entry.summary.warning} 警告`);
    return entry;
  }

  function resubmit(entryId) {
    const entry = state.batch.entries.find((e) => e.id === entryId);
    if (!entry) return;
    // load the entry back into the generator and switch to the batch view
    state.speciesId = entry.specimen.speciesId;
    state.params = { ...entry.specimen.params };
    state.seed = entry.specimen.seed;
    state.activeVariant = entry.specimen.variant;
    const spec = generateSpecimen({ speciesId: state.speciesId, params: state.params, seed: state.seed, variant: state.activeVariant });
    applyOverrides(spec, entry.overrides);
    state.variants = state.variants.length ? state.variants.slice() : [];
    state.variants[state.activeVariant] = spec;
    state.variants = state.variants.slice();
    state.overridesByVariant = { ...state.overridesByVariant, [state.activeVariant]: entry.overrides };
    state.overrides = entry.overrides;
    pushLog(`退回条目 ${entry.id.slice(-4)} 到制作员 · 载入原参数与手工改动`);
  }

  function removeEntry(entryId) {
    state.batch = { ...state.batch, entries: state.batch.entries.filter((e) => e.id !== entryId) };
  }

  // ------------------------------------------------------------------
  // review
  // ------------------------------------------------------------------
  function setVerdict(entryId, key, verdict, note = '') {
    const entries = state.batch.entries.map((e) => {
      if (e.id !== entryId) return e;
      const items = e.review.items.map((it) => (it.key === key ? { ...it, verdict, note, at: new Date().toISOString() } : it));
      const status = computeReviewStatus(items);
      return { ...e, review: { ...e.review, items, status, reviewedBy: state.reviewer, reviewedAt: new Date().toISOString() } };
    });
    state.batch = { ...state.batch, entries };
  }

  function computeReviewStatus(items) {
    const blocking = items.filter((i) => i.severity === 'blocking' || false);
    if (items.some((i) => i.verdict === 'rejected')) return 'rejected';
    if (items.every((i) => i.verdict === 'approved')) return 'approved';
    return 'pending';
  }

  function reviewEntry(entryId, status, note = '') {
    const entries = state.batch.entries.map((e) => {
      if (e.id !== entryId) return e;
      const items = e.review.items.map((it) => ({ ...it, verdict: status === 'approved' ? 'approved' : 'rejected', at: new Date().toISOString() }));
      return { ...e, review: { ...e.review, items, status, reviewedBy: state.reviewer, reviewedAt: new Date().toISOString(), note } };
    });
    state.batch = { ...state.batch, entries };
  }

  function batchSummary() {
    const entries = state.batch.entries;
    const blocking = entries.reduce((n, e) => n + e.summary.blocking, 0);
    const warning = entries.reduce((n, e) => n + e.summary.warning, 0);
    const rejected = entries.filter((e) => e.review.status === 'rejected').length;
    const pending = entries.filter((e) => e.review.status === 'pending').length;
    const approved = entries.filter((e) => e.review.status === 'approved').length;
    const unreviewedChecks = entries.reduce((n, e) => n + e.review.items.filter((i) => i.verdict === 'pending').length, 0);
    const canRelease = entries.length > 0 && blocking === 0 && rejected === 0 && pending === 0 && unreviewedChecks === 0;
    return { total: entries.length, blocking, warning, rejected, pending, approved, unreviewedChecks, canRelease };
  }

  function pushLog(msg) {
    state.log = [{ id: nextId('L'), at: new Date().toISOString(), msg }, ...state.log].slice(0, 80);
  }

  function toast(msg, kind = 'info') {
    state.toast = { id: nextId('T'), msg, kind };
    setTimeout(() => {
      if (state.toast?.msg === msg) state.toast = null;
    }, 2600);
  }

  // boot
  generateAll();
  state.overridesByVariant = {};

  return {
    state,
    get activeSpecimen() {
      return activeSpecimen;
    },
    generateAll,
    regenerateActive,
    setSpecies,
    setParams,
    newSeed,
    setSeed: (s) => {
      state.seed = s;
      generateAll();
    },
    submitToBatch,
    resubmit,
    removeEntry,
    setVerdict,
    reviewEntry,
    batchSummary,
    setCellColor,
    toggleCellLock,
    isCellLocked,
    moveSpot,
    resizeSpot,
    resetSpot,
    resetCell,
    clearAllOverrides,
    undo,
    redo,
    findCell,
    findSpot,
    currentOverrides,
    pushLog,
    toast,
    speciesName,
    verifyDeterminism,
    setTool,
    setActiveVariant,
    setSelection,
    setHover,
    setLayers,
    setView,
    setRendererBackend,
    setReviewFilter,
    setSpaceKey,
    requestExport: null
  };
}

function clampNum(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function shortId(id) {
  return id.replace(/^(fore|hind)-(left|right)-/, '').replace(/-/g, '·');
}
