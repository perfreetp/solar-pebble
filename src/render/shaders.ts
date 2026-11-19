/** WGSL 着色器源码 */

export const CAM_STRUCT = /* wgsl */ `
struct Cam {
  center: vec2f,
  scale: f32,
  time: f32,
  viewport: vec2f,
  pad: vec2f,
};
`;

export const terrainShader = /* wgsl */ `
${CAM_STRUCT}

struct TerrainU {
  // 地形纹理覆盖的世界范围 minX, minY, maxX, maxY
  rect: vec4f,
  // 高程范围 min, max (m)
  elevRange: vec2f,
  contourStep: f32,
  gridStep: f32,
  // 滩面比降与向陆方向
  inland: vec2f,
  datum: f32,
  slope: f32,
  showContours: f32,
  showGrid: f32,
  seawardOpacity: f32,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var<uniform> t: TerrainU;
@group(0) @binding(2) var tex: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) ndc: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var p = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  var o: VOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.ndc = p[vi];
  return o;
}

fn screenToWorld(ndc: vec2f) -> vec2f {
  let halfSize = cam.viewport * 0.5;
  let px = vec2f(ndc.x * halfSize.x, -ndc.y * halfSize.y);
  return px / cam.scale + cam.center;
}

fn srgbToLin(c: vec3f) -> vec3f {
  return pow(c, vec3f(2.2));
}

fn hypo(h: f32) -> vec3f {
  // 低滩 → 高滩 的分层色带
  let stops = array<vec3f, 6>(
    vec3f(0.075, 0.145, 0.170),
    vec3f(0.100, 0.205, 0.225),
    vec3f(0.140, 0.265, 0.245),
    vec3f(0.225, 0.315, 0.225),
    vec3f(0.345, 0.345, 0.235),
    vec3f(0.465, 0.405, 0.265)
  );
  let x = clamp(h, 0.0, 1.0) * 5.0;
  let i = u32(floor(x));
  let f = fract(x);
  let a = stops[min(i, 5u)];
  let b = stops[min(i + 1u, 5u)];
  return mix(a, b, f);
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let w = screenToWorld(in.ndc);

  // 地形纹理 UV
  let uv = (w - t.rect.xy) / (t.rect.zw - t.rect.xy);
  var inside = 1.0;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { inside = 0.0; }
  let hN = textureSampleLevel(tex, samp, clamp(uv, vec2f(0.001), vec2f(0.999)), 0.0).r;

  // 潮滩: 高程越低越接近水体色
  let elev = mix(t.elevRange.x, t.elevRange.y, hN);
  var col = hypo(hN);

  // 潮沟影响: 高程低于口门基准的低地加深
  let inland = dot(w, normalize(t.inland));
  let seaMask = smoothstep(0.35, -0.05, uv.y);
  col = mix(col, vec3f(0.043, 0.098, 0.125), seaMask * 0.55 * inside);

  // 等深/等高线: 对高程作导数检测
  let fw = max(fwidth(elev), 1e-5);
  let ghost = abs(fract(elev / t.contourStep + 0.5) - 0.5) * t.contourStep;
  let lineMask = 1.0 - smoothstep(0.0, fw * 1.35, ghost);
  let majorStep = t.contourStep * 5.0;
  let ghostMajor = abs(fract(elev / majorStep + 0.5) - 0.5) * majorStep;
  let majorMask = 1.0 - smoothstep(0.0, fw * 1.6, ghostMajor);
  col = mix(col, vec3f(0.62, 0.78, 0.74), lineMask * 0.16 * t.showContours);
  col = mix(col, vec3f(0.78, 0.88, 0.82), majorMask * 0.30 * t.showContours);

  // 测量网格 (每 gridStep 米一条)
  let g = abs(fract(w / t.gridStep + 0.5) - 0.5) * t.gridStep;
  let gfw = max(fwidth(w.x), 1e-5);
  let gridLine = 1.0 - smoothstep(0.0, gfw * 1.2, min(g.x, g.y));
  col = mix(col, vec3f(0.45, 0.62, 0.66), gridLine * 0.10 * t.showGrid);

  // 滩外 (图谱范围之外) 用更深的底色
  col = mix(vec3f(0.024, 0.045, 0.056), col, inside);

  // 轻微暗角, 提升可读性
  let d = length(in.ndc * vec2f(cam.viewport.x / cam.viewport.y, 1.0));
  col *= 1.0 - 0.06 * smoothstep(0.7, 1.7, d);

  return vec4f(col, 1.0);
}
`;

export const creekShader = /* wgsl */ `
${CAM_STRUCT}

struct CreekU {
  // 各级透明度
  alpha: vec4f,
  // 选中高亮强度
  highlight: f32,
  minHalfPx: f32,
  // 可选: 只显示某些级别 (bit 掩码)
  levelMask: f32,
  aa: f32,
};

@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var<uniform> u: CreekU;

struct VIn {
  @location(0) pos: vec2f,
  @location(1) a: vec2f,
  @location(2) b: vec2f,
  @location(3) radii: vec2f,
  @location(4) color: vec3f,
  @location(5) info: vec3f, // level, alpha, selected
};

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec2f,
  @location(1) a: vec2f,
  @location(2) b: vec2f,
  @location(3) radii: vec2f,
  @location(4) color: vec3f,
  @location(5) info: vec3f,
};

fn worldToClip(w: vec2f) -> vec4f {
  let px = (w - cam.center) * cam.scale;
  let ndc = vec2f(px.x / (cam.viewport.x * 0.5), -px.y / (cam.viewport.y * 0.5));
  return vec4f(ndc, 0.0, 1.0);
}

@vertex
fn vs(v: VIn) -> VOut {
  var o: VOut;
  o.pos = worldToClip(v.pos);
  o.world = v.pos;
  o.a = v.a;
  o.b = v.b;
  o.radii = v.radii;
  o.color = v.color;
  o.info = v.info;
  return o;
}

fn segDist(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let l2 = dot(ab, ab);
  let t = select(0.0, clamp(dot(p - a, ab) / l2, 0.0, 1.0), l2 > 1e-9);
  return length(p - (a + ab * t));
}

@fragment
fn fs(v: VOut) -> @location(0) vec4f {
  let level = u32(v.info.x + 0.5);
  let lvlAlpha = u.alpha[level];
  let alpha = v.info.y * lvlAlpha;
  if (alpha <= 0.002) { discard; }

  let ab = v.b - v.a;
  let l2 = max(dot(ab, ab), 1e-9);
  let t = clamp(dot(v.world - v.a, ab) / l2, 0.0, 1.0);
  let r = mix(v.radii.x, v.radii.y, t);
  let d = segDist(v.world, v.a, v.b);
  let edge = d - r;

  // 世界单位 → 像素单位的导数, 做 1px 抗锯齿
  let fw = max(fwidth(edge), 1e-6);
  let coverage = 1.0 - smoothstep(-fw, fw, edge);
  if (coverage <= 0.004) { discard; }

  var col = v.color;
  // 选中: 描金边
  if (v.info.z > 0.5) {
    let rim = smoothstep(-fw * 2.2, -fw * 0.4, edge);
    col = mix(vec3f(1.0, 0.82, 0.4), col, rim);
    col = mix(col, col * 1.25, 0.35);
  }

  // 沿宽度方向做轻微明暗, 增强沟槽立体感
  let across = clamp(abs(dot(v.world - v.a, normalize(vec2f(-ab.y, ab.x))) ) / max(r, 1e-5), 0.0, 1.0);
  let shade = 1.0 - 0.22 * across * across;
  col *= shade;

  return vec4f(col * coverage, coverage * alpha);
}
`;

export const blitShader = /* wgsl */ `
${CAM_STRUCT}

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var src: texture_2d<f32>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var p = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  var o: VOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.uv = vec2f(p[vi].x * 0.5 + 0.5, 0.5 - p[vi].y * 0.5);
  return o;
}

@fragment
fn fs(v: VOut) -> @location(0) vec4f {
  return textureSample(src, samp, v.uv);
}
`;

/** 航拍底图: 按世界范围对齐的贴图, 支持透明度与亮度 */
export const basemapShader = /* wgsl */ `
${CAM_STRUCT}

struct BaseU {
  // 图像覆盖的世界范围
  rect: vec4f,
  opacity: f32,
  brightness: f32,
  contrast: f32,
  grayscale: f32,
  // 图像是否翻转 y (常见航片 y 向下)
  flipY: f32,
  _p: vec3f,
};

@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var<uniform> u: BaseU;
@group(0) @binding(2) var tex: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  // 覆盖 rect 的两个三角形
  var idx = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0)
  );
  let f = idx[vi];
  let w = vec2f(mix(u.rect.x, u.rect.z, f.x), mix(u.rect.y, u.rect.w, f.y));
  let px = (w - cam.center) * cam.scale;
  let ndc = vec2f(px.x / (cam.viewport.x * 0.5), -px.y / (cam.viewport.y * 0.5));
  var o: VOut;
  o.pos = vec4f(ndc, 0.0, 1.0);
  o.world = w;
  return o;
}

@fragment
fn fs(v: VOut) -> @location(0) vec4f {
  var uv = (v.world - u.rect.xy) / (u.rect.zw - u.rect.xy);
  if (u.flipY > 0.5) { uv.y = 1.0 - uv.y; }
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { discard; }
  var c = textureSample(tex, samp, uv).rgb;
  if (u.grayscale > 0.5) {
    let lum = dot(c, vec3f(0.299, 0.587, 0.114));
    c = vec3f(lum);
  }
  c = clamp((c - 0.5) * u.contrast + 0.5, vec3f(0.0), vec3f(1.0)) * u.brightness;
  // 轻微的蓝绿调, 与滩涂调查底图风格一致
  c = mix(c, c * vec3f(0.94, 1.02, 1.0), 0.6);
  return vec4f(c, u.opacity * 0.92);
}
`;

/** 矢量叠加: 选中锚点 / 锁定标记 / 沟头点 */
export const markerShader = /* wgsl */ `
${CAM_STRUCT}

@group(0) @binding(0) var<uniform> cam: Cam;

struct VIn {
  // 世界坐标 (锚点)
  @location(0) pos: vec2f,
  // 角点偏移 (单位圆内 -1..1)
  @location(1) corner: vec2f,
  // 像素直径
  @location(2) size: f32,
  @location(3) color: vec4f,
  // 形状: 0=圆环, 1=实心点, 2=方框
  @location(4) shape: f32,
};

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) color: vec4f,
  @location(2) shape: f32,
};

@vertex
fn vs(v: VIn) -> VOut {
  var o: VOut;
  let px = (v.pos - cam.center) * cam.scale;
  let ndc = vec2f(px.x / (cam.viewport.x * 0.5), -px.y / (cam.viewport.y * 0.5));
  let half = v.size / cam.viewport;
  o.pos = vec4f(ndc + v.corner * half, 0.0, 1.0);
  o.local = v.corner;
  o.color = v.color;
  o.shape = v.shape;
  return o;
}

@fragment
fn fs(v: VOut) -> @location(0) vec4f {
  let d = length(v.local);
  let aa = max(fwidth(d) * 1.5, 0.004);
  if (v.shape > 1.5) {
    // 方框
    let m = max(abs(v.local.x), abs(v.local.y));
    let edge = smoothstep(0.92 + aa, 0.92 - aa, m) - smoothstep(0.55 + aa, 0.55 - aa, m);
    let a = edge * v.color.a;
    if (a < 0.01) { discard; }
    return vec4f(v.color.rgb, a);
  }
  let ring = 1.0 - smoothstep(0.96 - aa, 0.96 + aa, d);
  if (v.shape > 0.5) {
    let a = ring * v.color.a;
    if (a < 0.01) { discard; }
    return vec4f(v.color.rgb, a);
  }
  let inner = 1.0 - smoothstep(0.56 - aa, 0.56 + aa, d);
  let a = ring * v.color.a - inner * 0.55;
  if (a < 0.01) { discard; }
  return vec4f(v.color.rgb, max(a, 0.0));
}
`;
