/**
 * 示例模型生成器 —— 给种子订单生成一个像样的起点洞体，
 * 让师傅打开编辑器就能直接改，而不是面对空网格。
 *
 * 造型思路：熔岩管按“岩壳 + 管腔”来建 —— 沿 X 掘进的椭圆柱形管腔，
 * 外面包一层 4–7 格厚的岩壳，壳外不放体素。这样模型本身就像一条管，
 * 走得进、看得清，也符合后续“内壁衬里”的施工逻辑。
 * 管底做成分段平台，管顶留 5 格以上覆盖，再撒几处塌落碎石。
 */

import { VoxelModel } from '../shared/voxel.js';

function noise1(t, seed) {
  return Math.sin(t * 1.7 + seed) * 0.5 + Math.sin(t * 0.43 + seed * 2.1) * 0.32 + Math.sin(t * 4.1 + seed * 3.7) * 0.18;
}

function noise2(x, y, seed) {
  return (
    Math.sin(x * 0.7 + y * 0.35 + seed) * 0.5 +
    Math.sin(x * 0.21 - y * 0.9 + seed * 1.7) * 0.3 +
    Math.sin(x * 1.9 + y * 1.3 + seed * 0.6) * 0.2
  );
}

export function tubeProfile(model, options = {}) {
  const { sizeX, sizeY, sizeZ } = model;
  const cy = sizeY / 2;
  const floorZ = options.floorZ ?? Math.round(sizeZ * 0.14);
  const seed = options.seed ?? 3.1;
  const radiusY = options.radiusY ?? Math.min(sizeY * 0.33, 44);
  const radiusZ = options.radiusZ ?? Math.min(sizeZ * 0.36, 26);

  return function profileAt(x) {
    const t = x / sizeX;
    const wob = noise1(x * 0.085, seed);
    // 管腔截面：两端略收，中段最宽
    const taper = 0.72 + 0.28 * Math.sin(Math.min(1, Math.max(0, (t - 0.04) / 0.92)) * Math.PI);
    const ry = radiusY * taper * (0.94 + 0.06 * wob);
    const rz = radiusZ * (0.78 + 0.22 * taper) * (0.95 + 0.05 * Math.sin(x * 0.19 + seed));
    const centerY = cy + wob * 2.2;
    const base = floorZ + Math.round(wob * 1.2);
    return { ry, rz, centerY, base };
  };
}

/**
 * @param {object} grid
 * @param {{shell?:number, floorZ?:number, seed?:number, radiusY?:number, radiusZ?:number}} options
 */
export function generateCaveSeed(grid = { sizeX: 144, sizeY: 144, sizeZ: 96, voxelSize: 0.5 }, options = {}) {
  const model = new VoxelModel(grid);
  const { sizeX, sizeY, sizeZ } = model;
  const shell = options.shell ?? 6;
  const profileAt = tubeProfile(model, options);
  const floorZ = options.floorZ ?? Math.round(sizeZ * 0.14);

  for (let x = 2; x < sizeX - 2; x++) {
    const { ry, rz, centerY, base } = profileAt(x);
    const outerY = ry + shell;
    const outerZ = rz + shell;
    const yLo = Math.max(0, Math.floor(centerY - outerY - 1));
    const yHi = Math.min(sizeY - 1, Math.ceil(centerY + outerY + 1));
    const zHi = Math.min(sizeZ - 1, Math.ceil(base + outerZ + 1));

    for (let y = yLo; y <= yHi; y++) {
      const dy = (y - centerY) / ry;
      const floorTop = base - 1;
      for (let z = 0; z <= zHi; z++) {
        // 管底以下的岩层（做地基）
        if (z < base) {
          if (z < floorTop) {
            model.set(x, y, z, z === 0 ? 3 : z === floorTop - 1 ? 2 : 1);
            continue;
          }
        }
        const dz = (z - base) / rz;
        const d = Math.sqrt(dy * dy + dz * dz);
        const outerDy = (y - centerY) / (ry + shell);
        const outerDz = (z - base) / (rz + shell);
        const dOuter = Math.sqrt(outerDy * outerDy + outerDz * outerDz);
        const inTube = d < 1;
        const inShell = dOuter <= 1 && !inTube;
        if (inTube) {
          // 管腔留空；但低于基准面时补底（避免坑洞）
          if (z < floorTop) model.set(x, y, z, 1);
          continue;
        }
        if (inShell) {
          // 岩壳：外表面用角砾岩，内表面用玄武岩，最外层散点月壤
          let mat = 1;
          if (dOuter > 0.93) mat = Math.abs(noise2(x * 0.4, y * 0.4 + z * 0.3, 2.2)) > 0.35 ? 2 : 1;
          else if (d < 1.12) mat = 1;
          model.set(x, y, z, mat);
          continue;
        }
        if (z < base && dOuter > 1) {
          // 管外、低于管底的围岩：只在管子两侧一小段保留，模拟嵌在岩体里
          continue;
        }
      }
    }
  }

  // 两端封头：加厚 3 格，避免洞口 1 格薄壁
  for (const [xa, xb] of [[0, 3], [sizeX - 4, sizeX - 1]]) {
    for (let x = xa; x <= xb; x++) {
      const { ry, rz, centerY, base } = profileAt(Math.max(2, Math.min(sizeX - 3, x)));
      const yLo = Math.max(0, Math.floor(centerY - ry - shell - 1));
      const yHi = Math.min(sizeY - 1, Math.ceil(centerY + ry + shell + 1));
      for (let y = yLo; y <= yHi; y++) {
        for (let z = 0; z <= Math.min(sizeZ - 1, Math.ceil(base + rz + shell + 1)); z++) {
          const outerDy = (y - centerY) / (ry + shell + 1);
          const outerDz = (z - base) / (rz + shell + 1);
          if (outerDy * outerDy + outerDz * outerDz <= 1) model.set(x, y, z, z === 0 ? 3 : 1);
        }
      }
    }
  }

  // 管底找平：轴线附近铺两格厚平台，便于摆放舱段
  for (let x = 4; x < sizeX - 4; x++) {
    const { centerY, base } = profileAt(x);
    for (let y = Math.round(centerY - 9); y <= Math.round(centerY + 9); y++) {
      if (!model.inside(x, y, 0)) continue;
      for (let z = 0; z < base - 1; z++) {
        if (model.get(x, y, z) === 0) model.set(x, y, z, z === base - 2 ? 2 : 1);
      }
      model.set(x, y, base - 1, 2);
    }
  }

  // 内壁衬里：只在管腔中段（约 60% 长度）铺，且以暖色密封衬里为主，
  // 顶拱正中每隔一段换钢衬板并加照明带。这样“洞体 / 内壁 / 设备”三色可辨。
  const linX0 = Math.round(sizeX * 0.22);
  const linX1 = Math.round(sizeX * 0.8);
  for (let x = linX0; x < linX1; x++) {
    const { ry, rz, centerY, base } = profileAt(x);
    const band = Math.floor((x - linX0) / 10) % 5;
    for (let y = Math.max(0, Math.floor(centerY - ry)); y <= Math.min(sizeY - 1, Math.ceil(centerY + ry)); y++) {
      for (let z = Math.max(0, base); z <= Math.min(sizeZ - 1, Math.ceil(base + rz)); z++) {
        const d = Math.sqrt(((y - centerY) / ry) ** 2 + ((z - base) / rz) ** 2);
        if (d < 0.93 || d > 1.01) continue;
        if (model.get(x, y, z) === 0) continue;
        const onCrown = z > base + rz * 0.72;
        const onUpper = z > base + rz * 0.4;
        let mat = 4;
        if (onCrown) {
          if (x % 10 === 0) mat = 14; // 照明带
          else if (band === 0) mat = 6; // 钢衬板间隔段
        } else if (onUpper && band === 2) {
          mat = 6;
        }
        model.set(x, y, z, mat);
      }
    }
    // 衬里下方加一圈锚固点，制造设备层的暖色细节
    if (x % 16 === 0) {
      const zA = Math.round(base + 1);
      for (const sy of [-1, 1]) {
        const yA = Math.round(centerY + sy * (ry - 2));
        if (model.get(x, yA, zA) !== 0) model.set(x, yA, zA, 16);
      }
    }
  }

  // 舱段：管内放一段圆柱舱，让“内壁 + 舱体”两种材质分层一眼可见
  {
    const cx = Math.round(sizeX * 0.42);
    const { centerY, base, rz } = profileAt(cx);
    const rad = Math.min(11, Math.round(rz * 0.6));
    stampCylinderHabitat(model, {
      x0: cx - 26,
      y0: Math.round(centerY),
      z0: base + Math.floor(rad * 0.55),
      length: 52,
      radius: rad,
      axis: 'x',
    });
  }

  // 半剖：切掉靠近观察侧的一半岩壳，露出管腔截面（摄影机默认从 -Y 方向看）
  let cyAvg = 0;
  let n = 0;
  for (let x = 0; x < sizeX; x++) {
    cyAvg += profileAt(x).centerY;
    n++;
  }
  cyAvg /= n;
  const xa = Math.round(sizeX * 0.06);
  const xb = Math.round(sizeX * 0.94);
  for (let x = xa; x <= xb; x++) {
    const { base, rz: rzz } = profileAt(x);
    for (let y = 0; y < Math.floor(cyAvg); y++) {
      for (let z = 0; z <= Math.min(sizeZ - 1, Math.ceil(base + rzz + 8)); z++) {
        if (model.get(x, y, z) !== 0) model.set(x, y, z, 0);
      }
    }
  }

  // 塌落体：坐在管底上的碎石堆
  const falls = [
    { x: Math.round(sizeX * 0.27), dy: 4, r: 5 },
    { x: Math.round(sizeX * 0.56), dy: -3, r: 7 },
    { x: Math.round(sizeX * 0.79), dy: 2, r: 4 },
  ];
  for (const f of falls) {
    const { centerY, base } = profileAt(f.x);
    const cyFall = Math.round(centerY + f.dy);
    for (let y = -f.r; y <= f.r; y++) {
      for (let x = -f.r; x <= f.r; x++) {
        const d = Math.sqrt(x * x + y * y);
        if (d > f.r) continue;
        const px = f.x + x;
        const py = cyFall + y;
        let ground = -1;
        for (let z = Math.min(sizeZ - 2, base + 8); z >= 0; z--) {
          if (model.get(px, py, z) !== 0) {
            ground = z;
            break;
          }
        }
        if (ground < 0) continue;
        const h = Math.round((1 - d / f.r) * f.r * 0.5) + 1;
        for (let dz = 1; dz <= h; dz++) {
          const z = ground + dz;
          if (z >= sizeZ - 2) break;
          const bump = noise2(px * 0.9, py * 0.9 + dz, 1.1);
          if (bump > 0.62 && dz === h) continue;
          model.set(px, py, z, Math.abs(bump) > 0.4 ? 2 : 1);
        }
      }
    }
  }

  return model;
}

/** 圆柱舱段：外壳（径向 3 格）+ 舷窗带 + 环向加强框，并补齐切线处的单格薄边。 */
export function stampCylinderHabitat(model, { x0, y0, z0, length, radius, axis = 'x' }) {
  const shell = 3;
  const cells = [];
  for (let i = 0; i < length; i++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const d = Math.sqrt(dy * dy + dz * dz);
        if (d > radius || d < radius - shell) continue;
        cells.push([i, dy, dz]);
      }
    }
  }
  // 体素化圆柱在切线处会退化成 1 格宽的“刀口”，向空侧补一层保证 2 格以上壁厚
  const have = new Set(cells.map(([i, dy, dz]) => `${i},${dy},${dz}`));
  const extra = [];
  for (const [i, dy, dz] of cells) {
    for (const [ox, oy, oz] of [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const ny2 = dy + oy;
      const nz2 = dz + oz;
      const d2 = Math.sqrt(ny2 * ny2 + nz2 * nz2);
      if (d2 > radius + 0.75) continue;
      const k = `${i},${ny2},${nz2}`;
      if (!have.has(k)) {
        have.add(k);
        extra.push([i, ny2, nz2]);
      }
    }
  }

  for (const [i, dy, dz] of cells.concat(extra)) {
    const x = x0 + (axis === 'x' ? i : 0);
    const y = y0 + (axis === 'x' ? dy : i);
    const z = z0 + dz;
    if (z < 0) continue;
    const d = Math.sqrt(dy * dy + dz * dz);
    let mat = 7;
    if (i % 24 === 0) mat = 11;
    else if (Math.abs(dz) < 1.2 && i % 5 < 3 && d > radius - 1.6) mat = 10;
    model.set(x, y, z, mat);
  }
}
