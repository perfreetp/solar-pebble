// 无头浏览器冒烟：通过 CDP 连接 headless Chrome，捕获控制台/异常并驱动核心交互
// 用法：node scripts/headless-check.mjs
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = 'http://localhost:5173'
const port = 9222
const userDir = join(tmpdir(), 'spe-chrome-profile')
mkdirSync(userDir, { recursive: true })

let chrome = null
try {
  await fetch(`http://127.0.0.1:${port}/json/version`)
  console.log('复用已运行的调试 Chrome')
} catch {
  chrome = spawn(CHROME, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDir}`,
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--window-size=1440,1000', 'about:blank'
  ], { stdio: 'ignore' })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function getPageWs() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch { /* 等待浏览器启动 */ }
    await sleep(200)
  }
  throw new Error('未找到页面调试目标')
}

const ws = new WebSocket(await getPageWs())
await new Promise((r) => (ws.onopen = r))
let msgId = 0
const pending = new Map()
const events = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  else if (m.method) events.push(m)
}
function send(method, params = {}) {
  const id = ++msgId
  return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })) })
}
const call = send
const errors = []
function check(cond, name) {
  if (cond) console.log('  ✓', name)
  else { errors.push(name); console.log('  ✗', name) }
}

await call('Page.enable')
await call('Runtime.enable')
await call('Log.enable')
await call('Page.navigate', { url: BASE })
await sleep(3000)

// 收集运行期错误
const runtimeErrors = events.filter(
  (e) => e.method === 'Runtime.exceptionThrown' || e.method === 'Log.entryAdded'
)
check(runtimeErrors.length === 0, `页面加载无运行时异常（实际 ${runtimeErrors.length} 条）`)
for (const e of runtimeErrors) {
  const detail = e.params?.exceptionDetails?.exception?.description
    || e.params?.exceptionDetails?.text
    || e.params?.entry?.text
    || JSON.stringify(e.params)
  console.log('    !', detail.slice(0, 400))
}

async function evalJs(expression) {
  const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.error || r.result?.exceptionDetails) {
    check(false, 'JS 执行: ' + expression.slice(0, 60))
    console.log('    !', JSON.stringify(r.error || r.result.exceptionDetails).slice(0, 400))
    return null
  }
  return r.result.result.value
}

// ---- 运行环境 ----
const offscreen = await evalJs(`(()=>({
  worker: typeof Worker !== 'undefined',
  offscreen: 'OffscreenCanvas' in window,
  bitmap: typeof createImageBitmap === 'function'
}))()`)
check(offscreen.offscreen && offscreen.worker && offscreen.bitmap, '浏览器支持 Worker / OffscreenCanvas / ImageBitmap')

// ---- Pinia 状态：部件已加载 ----
const partCount = await evalJs(`document.querySelector('#app').__vue_app__ ?
  (()=>{ const pinia=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    return Object.keys(pinia.state.value.editor.project.parts).length })() : 0`)
check(partCount === 9, `9 个内置部件（ImageBitmap）已生成，实际 ${partCount}`)

// ---- 派单流程：教练提交 -> 管理员分派 -> 制作 -> 质检打回 -> 通过 ----
const flow = await evalJs(`(async () => {
  localStorage.removeItem('spe_workflow_v1')
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const wf = pinia._s.get('workflow')
  wf.$reset()
  const t = wf.createTicket({ title: 'CDP测试工单', courseName: '测试课', requirement: '躯干前倾' })
  const steps = []
  steps.push(wf.act(t.id, 'submit').ok)
  wf.switchRole('admin'); steps.push(wf.act(t.id, 'assign', {}).ok)
  wf.switchRole('maker'); steps.push(wf.act(t.id, 'start').ok); steps.push(wf.act(t.id, 'submit').ok)
  wf.switchRole('qc'); steps.push(wf.act(t.id, 'reject', { reason: '测试打回' }).ok)
  wf.switchRole('maker'); steps.push(wf.act(t.id, 'start').ok); steps.push(wf.act(t.id, 'submit').ok)
  wf.switchRole('qc'); steps.push(wf.act(t.id, 'pass').ok)
  const saved = JSON.parse(localStorage.getItem('spe_workflow_v1'))
  const savedT = saved.tickets.find(x => x.id === t.id)
  return { steps, status: savedT.status, rework: savedT.reworkCount, dash: wf.dashboard[0] }
})()`)
check(flow.steps.every(Boolean) && flow.status === 'done', '派单状态机全链路流转成功')
check(flow.rework === 1, `打回记录返工次数=1（实际 ${flow.rework}）`)
check(flow.dash && flow.dash.done >= 1 && flow.dash.reworks === 1, '看板统计完成量与返工率正确')

// ---- 编辑器：打关键帧、超限标红、插值、预设 ----
const edit = await evalJs(`(async () => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const ed = pinia._s.get('editor')
  ed.resetProject()
  await ed.initParts()
  ed.seekFrame(0)
  ed.setTorsoLean(10); ed.setArmRaise(60); ed.setBreathAmp(6)
  ed.addKeyHere()
  ed.seekFrame(24)
  ed.setTorsoLean(25); ed.addKeyHere()
  ed.setSegmentEasing(0, 24, 'easeInOut')
  const mid = ed.evaluateAt(12)
  // 超限
  ed.seekFrame(24); ed.setBoneRot('R.forearm', -90)
  const vio = ed.recomputeViolations() || ed.violations.map(v => v.key)
  // 预设
  const { createPreset, listPresets, applyPreset } = await import('/src/engine/presets.js')
  const p = createPreset('CDP预设', ed.timeline, 0, 24)
  applyPreset(listPresets()[0], ed.timeline, 48)
  return {
    keys: [...ed.timeline.keys],
    midLean: mid.extras.torsoLean,
    easing: ed.timeline.segments['0-24'].easing,
    violations: ed.violations.map(v => v.key),
    presetKeys: listPresets().length,
    applied: ed.timeline.keys.includes(48)
  }
})()`)
check(edit.keys.includes(0) && edit.keys.includes(24), '24fps 时间轴关键帧写入成功')
check(Math.abs(edit.midLean - 17.5) < 0.2, `缓入缓出中点数值插值正确（${edit.midLean.toFixed(2)}）`)
check(edit.violations.includes('R.forearm'), '关节超限时检测并标红')
check(edit.presetKeys >= 1 && edit.applied, '姿势预设保存并套用到其他动作段')

// ---- OffscreenCanvas 导出序列帧（ZIP + JSON）----
const exp = await evalJs(`(async () => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const ed = pinia._s.get('editor')
  const mod = await import('/src/engine/export.js')
  const { blob, count, json } = await mod.exportSequence(
    { ...ed.project, bones: ed.bones, parts: ed.parts, timeline: ed.timeline }, {})
  return { size: blob.size, count, hasJson: json.format === 'shooting-pose-editor', fps: json.fps }
})()`)
check(exp.count >= 1 && exp.size > 1000, `OffscreenCanvas 导出 PNG 序列帧 ZIP（${exp.count} 帧, ${exp.size}B）`)
check(exp.hasJson && exp.fps === 24, 'ZIP 内含带关键帧数据的 JSON（fps=24）')

// ---- 预览页 Worker ----
await evalJs(`location.hash = '#/preview'`)
await sleep(2000)
const workerOk = await evalJs(`(() => {
  const text = document.body.innerText
  return text.includes('OffscreenCanvas') && (text.includes('硬件离屏') || text.includes('回退'))
})()`)
check(workerOk, '预览页正常渲染（Worker + OffscreenCanvas 或回退路径）')

// 截图留档
const shotPath = join(tmpdir(), 'spe-preview-shot.png')
const shot = await call('Page.captureScreenshot', { format: 'png' })
writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'))
console.log('  截图已保存：', shotPath)

ws.close()
chrome?.kill()
console.log(errors.length ? `\n失败 ${errors.length} 项：${errors.join('; ')}` : '\n无头浏览器检查全部通过')
process.exit(errors.length ? 1 : 0)
