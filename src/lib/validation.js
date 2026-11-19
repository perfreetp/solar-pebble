// Batch QA checks. Each check returns findings with a severity:
//   blocking — the batch cannot be released while one exists
//   warning  — releasable only after the reviewer reviews and accepts it
//
// Everything here is pure and deterministic: identical specimens always yield
// identical findings, so a resubmission's diff is meaningful.

import { contrastRatio } from './color.js';
import { distToPolygonBoundary, polyArea } from './geometry.js';

export const SEVERITY = { blocking: 'blocking', warning: 'warning' };

export const CHECK_INFO = {
  symmetry: { label: '左右对称偏差', unit: '%' },
  density: { label: '斑点密度', unit: '' },
  contrast: { label: '颜色对比度', unit: '' }
};

/** Thresholds, in one place so the UI can explain itself. */
export const THRESHOLDS = {
  symmetry: { warn: 3.2, block: 7.0 }, // mean radial deviation, in %
  spotCoverage: { min: 0.004, max: 0.14, warnMin: 0.012, warnMax: 0.09 },
  spotBalance: { warn: 1.5, block: 2.2 }, // max/min coverage ratio across the four wings
  contrast: { warn: 1.7, block: 1.3 }, // spot vs its cell
  palette: { warn: 0.34, block: 0.18 } // luminance span across all cell fills
};

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function radii(wing) {
  return wing.poly.map((p) => Math.hypot(p[0], p[1]));
}

function cellsById(wing) {
  const m = new Map();
  for (const c of wing.cells) m.set(`${c.i}|${c.j}`, c);
  return m;
}

function spotsById(wing) {
  const m = new Map();
  for (const s of wing.spots) m.set(s.id.replace(`${wing.key}-`, ''), s);
  return m;
}

/**
 * Symmetry: compare the left and right wings in their own local frames. Because
 * each wing frame has +x pointing outward, a perfectly symmetric pair has
 * identical local geometry. Seeded per-side variation shows up as deviation.
 */
function checkSymmetry(specimen) {
  const findings = [];
  for (const kind of ['fore', 'hind']) {
    const right = specimen.wings.find((w) => w.key === `${kind}-right`);
    const left = specimen.wings.find((w) => w.key === `${kind}-left`);
    if (!right || !left) continue;
    const rR = radii(right);
    const rL = radii(left);
    const n = Math.min(rR.length, rL.length);
    let dev = 0;
    let scale = 0;
    for (let i = 0; i < n; i++) {
      dev += Math.abs(rR[i] - rL[i]);
      scale += (rR[i] + rL[i]) / 2;
    }
    const outlineDev = (dev / Math.max(1e-9, scale)) * 100;

    // spot layout deviation, normalised by wing size
    const maxR = right.maxR || 1;
    const sr = spotsById(right);
    const sl = spotsById(left);
    const spotDevs = [];
    for (const [key, a] of sr) {
      const b = sl.get(key);
      if (!b) {
        spotDevs.push(1);
        continue;
      }
      spotDevs.push(Math.hypot(a.x - b.x, a.y - b.y) / maxR);
    }
    for (const key of sl.keys()) if (!sr.has(key)) spotDevs.push(1);
    const spotDev = mean(spotDevs) * 100;
    const spotMissing = Math.abs(sr.size - sl.size);

    // cell topology must match exactly, otherwise the mirrored artwork diverges
    const cr = cellsById(right);
    const cl = cellsById(left);
    let cellMismatch = 0;
    for (const k of cr.keys()) if (!cl.has(k)) cellMismatch++;

    const score = outlineDev * 0.75 + spotDev * 0.25;
    const label = kind === 'fore' ? '前翅' : '后翅';
    const sev = score >= THRESHOLDS.symmetry.block ? SEVERITY.blocking : score >= THRESHOLDS.symmetry.warn ? SEVERITY.warning : null;
    if (sev) {
      findings.push({
        check: 'symmetry',
        key: `symmetry-${kind}`,
        title: `${label}左右不对称`,
        severity: sev,
        value: score,
        threshold: sev === SEVERITY.blocking ? THRESHOLDS.symmetry.block : THRESHOLDS.symmetry.warn,
        detail: `轮廓径向偏差 ${outlineDev.toFixed(2)}%，斑点位置偏差 ${spotDev.toFixed(2)}%，左右斑点数量差 ${spotMissing}，翅室不匹配 ${cellMismatch}。`,
        hint: '调低「对称扰动」，或用选择工具手动修正斑点位置。'
      });
    }
    if (cellMismatch > 0) {
      findings.push({
        check: 'symmetry',
        key: `symmetry-topology-${kind}`,
        title: `${label}左右翅室结构不一致`,
        severity: SEVERITY.blocking,
        value: cellMismatch,
        threshold: 0,
        detail: `左右${label}有 ${cellMismatch} 个翅室无法一一对应，无法对称生产。`,
        hint: '重新生成或降低翅脉密度，使左右翅室重新对齐。'
      });
    }
  }
  return findings;
}

/** Spot density: overall coverage and balance across the four wings. */
function checkDensity(specimen) {
  const findings = [];
  const t = THRESHOLDS.spotCoverage;
  const perWing = [];
  let totalSpotArea = 0;
  let totalArea = 0;
  for (const wing of specimen.wings) {
    const area = polyArea(wing.poly);
    let spotArea = 0;
    for (const s of wing.spots) spotArea += Math.PI * s.rx * s.ry;
    totalSpotArea += spotArea;
    totalArea += area;
    perWing.push({ wing, coverage: spotArea / Math.max(1e-9, area), count: wing.spots.length, area });
  }
  const coverage = totalSpotArea / Math.max(1e-9, totalArea);

  if (coverage <= 0.0005) {
    findings.push({
      check: 'density',
      key: 'density-empty',
      title: '缺少斑点',
      severity: SEVERITY.blocking,
      value: coverage * 100,
      threshold: t.min * 100,
      detail: '整只标本没有任何可见斑点，无法作为翅纹素材。',
      hint: '提高「斑点密度」或「斑点大小」后重新生成。'
    });
  } else if (coverage < t.warnMin) {
    findings.push({
      check: 'density',
      key: 'density-low',
      title: '斑点覆盖率偏低',
      severity: SEVERITY.warning,
      value: coverage * 100,
      threshold: t.warnMin * 100,
      detail: `斑点覆盖率为 ${(coverage * 100).toFixed(2)}%，低于建议值 ${(t.warnMin * 100).toFixed(1)}%。`,
      hint: '可略微提高斑点密度，或在复核中确认这种极简风格。'
    });
  } else if (coverage > t.max) {
    findings.push({
      check: 'density',
      key: 'density-high',
      title: '斑点覆盖率过高',
      severity: SEVERITY.blocking,
      value: coverage * 100,
      threshold: t.max * 100,
      detail: `斑点覆盖率为 ${(coverage * 100).toFixed(2)}%，超过上限 ${(t.max * 100).toFixed(1)}%，印制后细节会糊在一起。`,
      hint: '降低斑点密度或斑点大小。'
    });
  } else if (coverage > t.warnMax) {
    findings.push({
      check: 'density',
      key: 'density-high-warn',
      title: '斑点覆盖率偏高',
      severity: SEVERITY.warning,
      value: coverage * 100,
      threshold: t.warnMax * 100,
      detail: `斑点覆盖率为 ${(coverage * 100).toFixed(2)}%，高于建议值 ${(t.warnMax * 100).toFixed(1)}%。`,
      hint: '确认放大印刷时斑点不会粘连。'
    });
  }

  const covs = perWing.map((p) => p.coverage).filter((c) => c > 0.0005);
  if (covs.length >= 2) {
    const ratio = Math.max(...covs) / Math.max(1e-9, Math.min(...covs));
    const sev = ratio >= THRESHOLDS.spotBalance.block ? SEVERITY.blocking : ratio >= THRESHOLDS.spotBalance.warn ? SEVERITY.warning : null;
    if (sev) {
      const minWing = perWing.reduce((a, b) => (a.coverage < b.coverage ? a : b));
      const maxWing = perWing.reduce((a, b) => (a.coverage > b.coverage ? a : b));
      const name = (k) => ({ 'fore-right': '前翅右', 'fore-left': '前翅左', 'hind-right': '后翅右', 'hind-left': '后翅左' })[k];
      findings.push({
        check: 'density',
        key: 'density-balance',
        title: '四片翅斑点密度不均衡',
        severity: sev,
        value: ratio,
        threshold: sev === SEVERITY.blocking ? THRESHOLDS.spotBalance.block : THRESHOLDS.spotBalance.warn,
        detail: `最高 ${(maxWing.coverage * 100).toFixed(2)}%（${name(maxWing.wing.key)}）是最低 ${(minWing.coverage * 100).toFixed(2)}%（${name(
          minWing.wing.key
        )}）的 ${ratio.toFixed(2)} 倍。`,
        hint: '检查「前后翅比例」与斑点密度，或手动补/减斑点。'
      });
    }
  }
  return findings;
}

/**
 * Colour contrast, three ways:
 *   1. every spot must separate from the cell it sits in (print legibility);
 *   2. the set of cell fills must span enough luminance to read as a pattern
 *      (a wing whose cells are all within a few % of light looks flat);
 *   3. the margin band must separate from the outermost cells.
 */
function checkContrast(specimen, cellColorOf) {
  const findings = [];
  let minSpotContrast = Infinity;
  let minSpotWhere = null;
  const allCellColors = [];
  let minBandContrast = Infinity;
  let bandWhere = null;

  for (const wing of specimen.wings) {
    const cellById = new Map(wing.cells.map((c) => [c.id, c]));
    const cellColors = new Map();
    for (const cell of wing.cells) {
      const col = cellColorOf(specimen, wing, cell);
      cellColors.set(cell.id, col);
      if (!cell.margin) allCellColors.push(col);
    }
    for (const spot of wing.spots) {
      const cell = cellById.get(spot.cellId);
      if (!cell) continue;
      const ratio = contrastRatio(spot.color, cellColors.get(cell.id));
      if (ratio < minSpotContrast) {
        minSpotContrast = ratio;
        minSpotWhere = { wing, cell, spot };
      }
    }
    // band vs the cells directly inside it
    if (wing.bandColor) {
      for (const cell of wing.cells) {
        if (!cell.margin) continue;
        const ratio = contrastRatio(wing.bandColor, cellColors.get(cell.id));
        if (ratio < minBandContrast) {
          minBandContrast = ratio;
          bandWhere = { wing, cell };
        }
      }
    }
  }

  const wingName = (k) => ({ 'fore-right': '前翅右', 'fore-left': '前翅左', 'hind-right': '后翅右', 'hind-left': '后翅左' })[k];

  if (Number.isFinite(minSpotContrast)) {
    const sev = minSpotContrast < THRESHOLDS.contrast.block ? SEVERITY.blocking : minSpotContrast < THRESHOLDS.contrast.warn ? SEVERITY.warning : null;
    if (sev) {
      findings.push({
        check: 'contrast',
        key: 'contrast-spot',
        title: '斑点与底色对比不足',
        severity: sev,
        value: minSpotContrast,
        threshold: sev === SEVERITY.blocking ? THRESHOLDS.contrast.block : THRESHOLDS.contrast.warn,
        detail: `${wingName(minSpotWhere.wing.key)} ${minSpotWhere.cell.id} 中的斑点与所在翅室对比度仅 ${minSpotContrast.toFixed(2)}:1。`,
        hint: '选中该翅室改深，或选中斑点换成对比更强的颜色。',
        ref: { wing: minSpotWhere.wing.key, cellId: minSpotWhere.cell.id, spotId: minSpotWhere.spot.id }
      });
    }
  }

  if (allCellColors.length >= 3) {
    const ls = allCellColors.map((c) => c[2]);
    const span = Math.max(...ls) - Math.min(...ls);
    const sev = span < THRESHOLDS.palette.block ? SEVERITY.blocking : span < THRESHOLDS.palette.warn ? SEVERITY.warning : null;
    if (sev) {
      findings.push({
        check: 'contrast',
        key: 'contrast-palette',
        title: '翅面整体明度跨度过小',
        severity: sev,
        value: span,
        threshold: sev === SEVERITY.blocking ? THRESHOLDS.palette.block : THRESHOLDS.palette.warn,
        detail: `所有翅室填色的明度只相差 ${(span * 100).toFixed(1)}%，纹样在缩略图与印品上会糊成一片。`,
        hint: '扩大「明度」或「色相范围」，或给关键翅室手动指定颜色。',
        ref: { wing: null, cellId: null }
      });
    }
  }

  if (Number.isFinite(minBandContrast)) {
    const sev = minBandContrast < 1.15 ? SEVERITY.warning : null;
    if (sev) {
      findings.push({
        check: 'contrast',
        key: 'contrast-band',
        title: '边缘带与翅面区分不明显',
        severity: sev,
        value: minBandContrast,
        threshold: 1.15,
        detail: `${wingName(bandWhere.wing.key)} 边缘带与 ${bandWhere.cell.id} 对比度 ${minBandContrast.toFixed(2)}:1，边缘轮廓会看不清。`,
        hint: '调低「边缘带宽度」或提高整体明度差。',
        ref: { wing: bandWhere.wing.key, cellId: bandWhere.cell.id }
      });
    }
  }
  return findings;
}

/**
 * Run every check. `cellColorOf` is injected so manual cell colours
 * participate in the contrast check exactly as they render.
 */
export function runChecks(specimen, cellColorOf) {
  const findings = [...checkSymmetry(specimen), ...checkDensity(specimen), ...checkContrast(specimen, cellColorOf)];
  // stable order: blocking first, then by check name/key
  const rank = { blocking: 0, warning: 1 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.check.localeCompare(b.check) || a.key.localeCompare(b.key));
  return findings;
}

export function summarize(findings) {
  return {
    blocking: findings.filter((f) => f.severity === SEVERITY.blocking).length,
    warning: findings.filter((f) => f.severity === SEVERITY.warning).length,
    total: findings.length
  };
}
