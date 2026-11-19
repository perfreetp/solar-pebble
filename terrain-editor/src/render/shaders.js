/**
 * 共享 WGSL 代码：相机 uniform、顶点/片元结构。
 */
export const COMMON_WGSL = /* wgsl */ `
struct Camera {
  viewProj: mat4x4<f32>,
  eye: vec3<f32>,
  _pad: f32,
};
@group(0) @binding(0) var<uniform> camera: Camera;

struct TerrainUniforms {
  heightMin: f32,
  heightMax: f32,
  wireframe: f32,
  showSlope: f32,
};
@group(0) @binding(1) var<uniform> tu: TerrainUniforms;

fn heightColor(h: f32) -> vec3<f32> {
  let t = clamp((h - tu.heightMin) / (tu.heightMax - tu.heightMin), 0.0, 1.0);
  // 低→高：深绿 → 黄绿 → 土黄 → 白
  let c0 = vec3<f32>(0.10, 0.28, 0.12);
  let c1 = vec3<f32>(0.35, 0.55, 0.20);
  let c2 = vec3<f32>(0.62, 0.52, 0.30);
  let c3 = vec3<f32>(0.92, 0.92, 0.90);
  if (t < 0.35) { return mix(c0, c1, t / 0.35); }
  if (t < 0.7) { return mix(c1, c2, (t - 0.35) / 0.35); }
  return mix(c2, c3, (t - 0.7) / 0.3);
}
`

export const TERRAIN_VERT = /* wgsl */ `
${COMMON_WGSL}

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) color: vec3<f32>,
  @location(2) bary: vec3<f32>,
};

@vertex
fn vs_main(
  @location(0) xz: vec2<f32>,
  @location(1) h: f32,
  @location(2) bary: vec3<f32>
) -> VSOut {
  var out: VSOut;
  let world = vec3<f32>(xz.x, h, xz.y);
  out.world = world;
  out.pos = camera.viewProj * vec4<f32>(world, 1.0);
  out.color = heightColor(h);
  out.bary = bary;
  return out;
}
`

export const TERRAIN_FRAG = /* wgsl */ `
${COMMON_WGSL}

struct FSIn {
  @builtin(position) pos: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) color: vec3<f32>,
  @location(2) bary: vec3<f32>,
};

fn edgeFactor(bary: vec3<f32>) -> f32 {
  let d = min(bary.x, min(bary.y, bary.z));
  let width = 0.035;
  return 1.0 - smoothstep(0.0, width, d);
}

@fragment
fn fs_main(in: FSIn) -> @location(0) vec4<f32> {
  // 简单坡度光照：对 x/z 方向有限差分近似法线
  let base = in.color;
  let e = edgeFactor(in.bary);
  if (tu.wireframe > 0.5) {
    return vec4<f32>(mix(base * 0.55, vec3<f32>(0.05, 0.08, 0.12), e), 1.0);
  }
  let shade = clamp(0.78 + 0.22 * normalize(vec3<f32>(0.3, 1.0, 0.4)).y, 0.6, 1.0);
  return vec4<f32>(base * shade, 1.0);
}
`

export const LINE_VERT = /* wgsl */ `
${COMMON_WGSL}
struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) color: vec4<f32>,
};
@vertex
fn vs_main(@location(0) p: vec3<f32>, @location(1) color: vec4<f32>) -> VSOut {
  var out: VSOut;
  out.pos = camera.viewProj * vec4<f32>(p, 1.0);
  out.color = color;
  return out;
}
`

export const LINE_FRAG = /* wgsl */ `
struct FSIn { @location(0) color: vec4<f32> };
@fragment
fn fs_main(in: FSIn) -> @location(0) vec4<f32> { return in.color; }
`
