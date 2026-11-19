import { spawn } from 'node:child_process'
import http from 'node:http'
const PORT = 9223
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const flags = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const getJson = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d)))
  }).on('error', rej)
})
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run',
  '--user-data-dir=C:/Users/Administrator/AppData/Local/Temp/cdp-probe-profile',
  ...flags, 'about:blank'
], { stdio: 'ignore' })
try {
  let target
  for (let i = 0; i < 40; i++) {
    await sleep(500)
    try {
      const list = await getJson('/json/list')
      target = list.find((t) => t.type === 'page')
      if (target) break
    } catch {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result) }
  }
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: mid, method, params })) })
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: 'http://127.0.0.1:5181/gpu-probe.html' })
  let val = 'timeout'
  for (let i = 0; i < 20; i++) {
    await sleep(500)
    const r = await send('Runtime.evaluate', { expression: "document.getElementById('out').textContent", returnByValue: true })
    val = r.result.value
    if (val && val !== 'PROBE:running') break
  }
  console.log(flags.join(' ') || '(no flags)', '=>', val)
} finally {
  chrome.kill()
}
