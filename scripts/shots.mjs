// 截编辑器/派单/看板页面存档：node scripts/shots.mjs
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const port = 9223
const userDir = join(tmpdir(), 'spe-chrome-shots')
mkdirSync(userDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let chrome = null
try { await fetch(`http://127.0.0.1:${port}/json/version`) } catch {
  chrome = spawn(CHROME, [`--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`,
    '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1500,1000', 'about:blank'], { stdio: 'ignore' })
}
async function getPageWs() {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const p = list.find((t) => t.type === 'page')
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl
    } catch { /* wait */ }
    await sleep(200)
  }
  throw new Error('no target')
}
const ws = new WebSocket(await getPageWs())
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
function call(method, params = {}) {
  return new Promise((resolve) => { const mid = ++id; pending.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params })) })
}
await call('Page.enable'); await call('Runtime.enable')

async function shot(hash, file, setupExpr) {
  await call('Page.navigate', { url: 'http://localhost:5173/#' + hash })
  await sleep(2500)
  if (setupExpr) {
    await call('Runtime.evaluate', { expression: setupExpr, awaitPromise: true })
    await sleep(800)
  }
  const r = await call('Page.captureScreenshot', { format: 'png' })
  const out = join(tmpdir(), file)
  writeFileSync(out, Buffer.from(r.result.data, 'base64'))
  console.log('saved', out)
}

// 编辑器：标准站姿（零旋转）+ 一组前倾持枪关键帧
await shot('/editor', 'spe-shot-editor.png', `(async () => {
  localStorage.removeItem('spe_project_v1')
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const ed = pinia._s.get('editor')
  ed.resetProject(); await ed.initParts(); ed.seekFrame(0)
  ed.mode = 'rig'
})()`)

// 离屏预览（干净工程，验证 Offscreen 渲染人形）
await shot('/preview', 'spe-shot-preview2.png', `(async () => {
  localStorage.removeItem('spe_project_v1')
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const ed = pinia._s.get('editor')
  ed.resetProject(); await ed.initParts(); ed.seekFrame(0)
})()`)

// 派单流程：预置一条完整工单链
await shot('/workflow', 'spe-shot-workflow.png', `(async () => {
  localStorage.removeItem('spe_workflow_v1')
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const wf = pinia._s.get('workflow'); wf.$reset()
  const t = wf.createTicket({ title: '手枪据枪站姿精讲', courseName: '基础射击·第3课', requirement: '躯干前倾15度，持枪臂水平抬起，配合呼吸起伏' })
  wf.act(t.id, 'submit'); wf.switchRole('admin'); wf.act(t.id, 'assign', {})
  wf.switchRole('maker'); wf.act(t.id, 'start'); wf.act(t.id, 'submit')
  wf.switchRole('qc'); wf.act(t.id, 'reject', { reason: '持枪臂抬起到位角度不足' })
  wf.switchRole('maker'); wf.act(t.id, 'start'); wf.act(t.id, 'submit')
  wf.switchRole('qc'); wf.act(t.id, 'pass')
})()`)

await shot('/dashboard', 'spe-shot-dashboard.png')
ws.close(); chrome?.kill()
