/**
 * WebGPU 能力检测与适配器初始化。
 * 不支持时返回 null，由界面给出降级提示（核心引擎仍可独立运行）。
 */
export async function initWebGPU() {
  if (!navigator.gpu) {
    return { ok: false, reason: '当前浏览器不支持 WebGPU（需 Chrome/Edge 113+ 等）' }
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
  if (!adapter) return { ok: false, reason: '未找到可用 GPU 适配器' }
  const device = await adapter.requestDevice()
  const context = null // 由渲染器绑定 canvas 后创建
  return {
    ok: true,
    adapter,
    device,
    info: adapter.info ? `${adapter.info.vendor || ''} ${adapter.info.architecture || ''}`.trim() : 'GPU'
  }
}

export function webGpuSupported() {
  return typeof navigator !== 'undefined' && !!navigator.gpu
}
