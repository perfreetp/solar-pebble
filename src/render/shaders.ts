// WGSL 着色器：相机共享的体素实例渲染 + 半透明覆盖层

export const CAMERA_WGSL = /* wgsl */ `
struct CameraUniforms {
  viewProj : mat4x4<f32>,
};
@group(0) @binding(0) var<uniform> camera : CameraUniforms;
`;

/** 实例化立方体：每实例 1 个 1x1x1 立方体，顶点缓冲自带法线 */
export const VOXEL_WGSL = CAMERA_WGSL + /* wgsl */ `
struct VertexInput {
  @location(0) position : vec3<f32>,
  @location(1) normal   : vec3<f32>,
};
struct VoxelInstance {
  offset : vec3<f32>,
  color  : vec3<f32>,
};
struct VertexOutput {
  @builtin(position) clip : vec4<f32>,
  @location(0) worldNormal : vec3<f32>,
  @location(1) voxelColor : vec3<f32>,
};

@group(1) @binding(0) var<uniform> dummy : vec4<f32>;
@group(1) @binding(1) var<storage, read> instances : array<VoxelInstance>;

@vertex
fn vs_main(@builtin(instance_index) ii : u32,
           input : VertexInput) -> VertexOutput {
  let inst = instances[ii];
  var out : VertexOutput;
  let world = input.position + inst.offset;
  out.clip = camera.viewProj * vec4<f32>(world, 1.0);
  out.worldNormal = input.normal;
  out.voxelColor = inst.color;
  return out;
}

@fragment
fn fs_main(in : VertexOutput) -> @location(0) vec4<f32> {
  let n = normalize(in.worldNormal);
  let keyLight = normalize(vec3<f32>(0.45, 0.85, 0.35));
  let fillLight = normalize(vec3<f32>(-0.5, 0.2, -0.6));
  let ambient = 0.34;
  let diffuse = max(dot(n, keyLight), 0.0) * 0.62
              + max(dot(n, fillLight), 0.0) * 0.18;
  // 简单的边缘描边感：掠射角压暗
  let shade = ambient + diffuse;
  return vec4<f32>(in.voxelColor * shade, 1.0);
}
`;

/** 覆盖层：世界坐标线段/三角面，半透明不发光 */
export const OVERLAY_WGSL = CAMERA_WGSL + /* wgsl */ `
struct OverlayVertex {
  @location(0) position : vec3<f32>,
  @location(1) color    : vec3<f32>,
  @location(2) alpha    : f32,
};
struct OverlayOutput {
  @builtin(position) clip : vec4<f32>,
  @location(0) color : vec4<f32>,
};

@vertex
fn vs_main(input : OverlayVertex) -> OverlayOutput {
  var out : OverlayOutput;
  out.clip = camera.viewProj * vec4<f32>(input.position, 1.0);
  out.color = vec4<f32>(input.color, input.alpha);
  return out;
}

@fragment
fn fs_main(in : OverlayOutput) -> @location(0) vec4<f32> {
  return in.color;
}
`;
