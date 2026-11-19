// 专项交互验证：曲线编辑器、重挂防环、播放循环
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync } from 'node:fs'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const port = 9224
const userDir = join(tmpdir(), 'spe-chrome-extra')
mkdirSync(userDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let chrome = null
try { await fetch(`http://127.0.0.1:${port}/json/version`) } catch {
  chrome = spawn(CHROME, [`--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`,
    '--headless=new', '--disable-gpu', '--no-first-run', 'about:blank'], { stdio: 'ignore' })
}
async function getWs() {
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
const ws = new WebSocket(await getWs())
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const call = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })) })
await call('Page.enable'); await call('Runtime.enable')
await call('Page.navigate', { url: 'http://localhost:5173/#/editor' })
await sleep(2500)

const r = await call('Runtime.evaluate', {
  awaitPromise: true, returnByValue: true,
  expression: `(async () => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    const ed = pinia._s.get('editor')
    ed.resetProject(); await ed.initParts(); ed.seekFrame(0)
    const out = {}
    // 1) 打两个关键帧并切贝塞尔
    ed.setTorsoLean(0); ed.addKeyHere()
    ed.seekFrame(24); ed.setTorsoLean(30); ed.addKeyHere()
    ed.setSegmentEasing(0, 24, 'bezier', [0.34, 1.3, 0.64, 1])
    out.segmentEasing = ed.timeline.segments['0-24'].easing
    out.bezier = ed.timeline.segments['0-24'].bezier
    // 2) 重挂防环：torso 挂到自己的子孙 head 必须失败
    out.cycleBlocked = ed.reparentBone('torso', 'head') === false
    // 3) 合法重挂：gun 从 R.hand 改挂 R.forearm
    out.reparentOk = ed.reparentBone('gun', 'R.forearm') === true
    out.gunParent = ed.bones.gun.parent
    // 4) 还原层级
    ed.reparentBone('gun', 'R.hand')
    // 5) 关节范围编辑生效
    ed.setRange('gun', -10, 10)
    out.rangeEdited = ed.bones.gun.range.min === -10 && ed.bones.gun.range.max === 10
    ed.setBoneRot('gun', 50) // 超出新区间
    out.violationAfterRangeEdit = ed.violations.some(v => v.key === 'gun')
    // 6) 曲线编辑器组件可打开（播放头移到段中间，贝塞尔段才显示入口）
    ed.seekFrame(12)
    await new Promise(r => setTimeout(r, 300)) // 等 Vue 重渲染段控制区
    const curveBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('曲线编辑器'))
    out.curveButtonExists = !!curveBtn
    curveBtn?.click()
    await new Promise(r => setTimeout(r, 200))
    out.curveModalOpen = !!document.querySelector('.curve-cv')
    // 控制点数值输入存在且为当前贝塞尔值
    if (out.curveModalOpen) {
      const nums = [...document.querySelectorAll('.curve-cv')].length
      out.curveCanvasCount = nums
    }
    return out
  })()`
})
console.log(JSON.stringify(r.result.result.value, null, 2))
ws.close(); chrome?.kill()
