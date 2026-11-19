/**
 * 极简 CDP 客户端：启动 headless Chrome（SwiftShader 软件 WebGPU），
 * 打开页面并收集 console / pageerror，等待页面自定义测试结果。
 * SwiftShader 适配器在共享测试机上偶发获取失败，故对“仅 GPU 不可用”重试至多 3 次。
 * 用法：node tests/cdp-check.js <url>
 */
import { spawn } from 'node:child_process'
import http from 'node:http'

const URL = process.argv[2] || 'http://127.0.0.1:5181/'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const MAX_ATTEMPTS = 3

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const getJson = (port, path) =>
  new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => resolve(JSON.parse(d)))
    }).on('error', reject)
  })

async function attempt(port) {
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=C:/Users/Administrator/AppData/Local/Temp/cdp-chrome-profile-${port}`,
      'about:blank'
    ],
    { stdio: 'ignore' }
  )
  try {
    let target
    for (let i = 0; i < 40; i++) {
      await sleep(500)
      try {
        const list = await getJson(port, '/json/list')
        target = list.find((t) => t.type === 'page')
        if (target) break
      } catch {}
    }
    if (!target) throw new Error('Chrome 启动超时')

    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((res, rej) => {
      ws.onopen = res
      ws.onerror = rej
    })
    let id = 0
    const pending = new Map()
    const logs = []
    const errors = []
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id)
        pending.delete(msg.id)
        msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result)
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')
        logs.push(`[${msg.params.type}] ${text}`)
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text)
      }
    }
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const mid = ++id
        pending.set(mid, { resolve, reject })
        ws.send(JSON.stringify({ id: mid, method, params }))
      })

    await send('Runtime.enable')
    await send('Page.enable')
    await send('Page.navigate', { url: URL })

    let result = null
    for (let i = 0; i < 50; i++) {
      await sleep(500)
      const r = await send('Runtime.evaluate', {
        expression: 'window.__SMOKE__ ?? null',
        returnByValue: true
      })
      if (r.result.value) {
        result = r.result.value
        break
      }
    }
    return { result, logs, errors }
  } finally {
    chrome.kill()
    await sleep(800) // 等端口与 profile 句柄释放
  }
}

let last
for (let n = 1; n <= MAX_ATTEMPTS; n++) {
  last = await attempt(9230 + n)
  const gpuFlake =
    last.result &&
    !last.result.pass &&
    last.errors.length === 0 &&
    last.result.checks?.some((c) => !c.ok && c.name === 'WebGPU 可用') &&
    last.result.checks?.filter((c) => !c.ok).length === 1
  if (last.result?.pass || !gpuFlake) break
  console.log(`第 ${n} 次运行仅 WebGPU 适配器获取失败（环境抖动），重试…`)
}

const { result, logs, errors } = last
console.log('--- console ---')
console.log(logs.join('\n') || '(无)')
console.log('--- exceptions ---')
console.log(errors.join('\n') || '(无)')
console.log('--- smoke result ---')
console.log(JSON.stringify(result, null, 2))

const ok = result && result.pass && errors.length === 0
console.log(ok ? '\nCDP 冒烟测试通过 ✅' : '\nCDP 冒烟测试失败 ❌')
process.exit(ok ? 0 : 1)
