<script setup>
import { ref } from 'vue'
import { repo, STATUSES } from '../store/repo.js'
import { TerrainEngine } from '../terrain/TerrainEngine.js'

const emit = defineEmits(['open-editor'])
const orders = ref(repo.list())
const current = ref(null)
const qcResult = ref(null)
const rejectReason = ref('')
const running = ref(false)

const qcQueue = ref(orders.value.filter((o) => o.status === 'qc'))
const statusMap = Object.fromEntries(STATUSES.map((s) => [s.key, s.label]))

function refresh() {
  orders.value = repo.list()
  qcQueue.value = orders.value.filter((o) => o.status === 'qc')
  if (current.value) current.value = repo.get(current.value.id)
}
function open(o) {
  current.value = o
  qcResult.value = null
  rejectReason.value = ''
}

/** 核心质检：同 seed + 同参数全新生成一份，与提交指纹、逐顶点高度比对 */
async function runQc() {
  running.value = true
  qcResult.value = null
  await new Promise((r) => setTimeout(r, 30)) // 让 UI 刷新
  const o = current.value
  const t0 = performance.now()
  const rerun = new TerrainEngine(o.seed, o.params)
  rerun.generateAll()
  const ms = performance.now() - t0
  const freshFp = rerun.fingerprint()
  // 工单里保存的是建模员提交时的指纹；重跑指纹应与之相等
  const fpMatch = freshFp === o.fingerprint
  qcResult.value = {
    seed: o.seed,
    submittedFp: o.fingerprint,
    rerunFp: freshFp,
    fpMatch,
    rerunMs: ms,
    triCount: rerun.totalTriangles(),
    // 同 seed 双跑自洽性：再跑一份确认确定性
    determinism: (() => {
      const again = new TerrainEngine(o.seed, o.params)
      again.generateAll()
      return again.fingerprint() === freshFp
    })(),
    // 与提交参数对应的标准结果统计
    heightRange: (() => {
      let mn = Infinity
      let mx = -Infinity
      for (const h of rerun.heights) {
        if (h < mn) mn = h
        if (h > mx) mx = h
      }
      return [mn, mx]
    })()
  }
  running.value = false
}

function pass() {
  repo.qcPass(current.value.id, '赵质检')
  refresh()
}
function reject() {
  if (!rejectReason.value.trim()) {
    alert('请填写打回原因')
    return
  }
  repo.qcReject(current.value.id, '赵质检', rejectReason.value, {
    submittedFp: current.value.fingerprint,
    rerunFp: qcResult.value.rerunFp
  })
  refresh()
  qcResult.value = null
  rejectReason.value = ''
}
function paramSummary(p) {
  return `坡${p.slopeGrade}% / 台${p.stepHeight}m / 碎石${p.rubbleDensity} / 沟${p.trenchWidth}m / 水${p.waterDepth}m`
}
</script>

<template>
  <div class="qc-page">
    <div class="page-head">
      <div>
        <h2>质检台</h2>
        <p class="muted">拿同一 seed、同一组参数重跑过程式生成，比对高度指纹；不一致直接打回</p>
      </div>
      <button @click="refresh">↻ 刷新</button>
    </div>

    <div class="qc-layout">
      <div class="card queue">
        <h3>待质检队列（{{ qcQueue.length }}）</h3>
        <div
          v-for="o in qcQueue"
          :key="o.id"
          :class="['queue-item', { on: current && current.id === o.id }]"
          @click="open(o)"
        >
          <div class="mono tiny">{{ o.id }}</div>
          <div>{{ o.title }}</div>
          <div class="muted tiny">{{ o.assignee }} · seed {{ o.seed }}</div>
        </div>
        <p v-if="!qcQueue.length" class="muted" style="padding: 20px 0; text-align: center">暂无待质检工单</p>

        <h3 style="margin-top: 20px">最近质检记录</h3>
        <div v-for="o in orders.filter((x) => x.qc).slice(0, 6)" :key="o.id" class="queue-item done">
          <div class="row" style="justify-content: space-between">
            <span class="mono tiny">{{ o.id }}</span>
            <span :style="{ color: o.qc.pass ? 'var(--ok)' : 'var(--bad)' }">
              {{ o.qc.pass ? '✓ 通过' : '✗ 打回' }}
            </span>
          </div>
          <div class="muted tiny">{{ o.title }} · 返工 {{ o.reworkCount }} 次</div>
        </div>
      </div>

      <div class="card detail" v-if="current">
        <h3>{{ current.title }}</h3>
        <div class="grid2">
          <div>
            <label>工单号 / 负责人</label>
            <div class="mono">{{ current.id }} · {{ current.assignee }}</div>
          </div>
          <div>
            <label>seed</label>
            <div class="mono">{{ current.seed }}</div>
          </div>
        </div>
        <div style="margin-top: 10px">
          <label>参数</label>
          <div class="mono tiny param-box">{{ paramSummary(current.params) }}</div>
        </div>
        <div v-if="current.exports" style="margin-top: 10px">
          <label>提交产物</label>
          <div class="tiny">📄 {{ current.exports.heightmap }} ｜ 📦 {{ current.exports.obj }} ｜
            三角面 {{ current.exports.triCount?.toLocaleString() }}</div>
          <div class="tiny">提交指纹：<span class="mono">{{ current.fingerprint }}</span></div>
        </div>

        <div style="margin: 16px 0">
          <button class="primary" :disabled="running" @click="runQc">
            {{ running ? '重跑中…' : '▶ 用同 seed 重跑并比对' }}
          </button>
          <button style="margin-left: 8px" @click="emit('open-editor', current)">在编辑器中打开</button>
        </div>

        <div v-if="qcResult" class="result" :class="{ bad: !qcResult.fpMatch, ok: qcResult.fpMatch }">
          <h4>{{ qcResult.fpMatch ? '✅ 一致性校验通过' : '❌ 结果不一致，需打回' }}</h4>
          <div class="stat-row"><span>提交指纹</span><b class="mono">{{ qcResult.submittedFp }}</b></div>
          <div class="stat-row"><span>重跑指纹</span><b class="mono">{{ qcResult.rerunFp }}</b></div>
          <div class="stat-row"><span>指纹一致</span>
            <b :style="{ color: qcResult.fpMatch ? 'var(--ok)' : 'var(--bad)' }">{{ qcResult.fpMatch ? '是' : '否' }}</b>
          </div>
          <div class="stat-row"><span>双跑确定性</span>
            <b :style="{ color: qcResult.determinism ? 'var(--ok)' : 'var(--bad)' }">
              {{ qcResult.determinism ? '逐位一致' : '不确定' }}
            </b>
          </div>
          <div class="stat-row"><span>重跑耗时</span><b class="mono">{{ qcResult.rerunMs.toFixed(2) }} ms</b></div>
          <div class="stat-row"><span>三角面数</span><b class="mono">{{ qcResult.triCount.toLocaleString() }}</b></div>
          <div class="stat-row"><span>高度范围</span>
            <b class="mono">[{{ qcResult.heightRange[0].toFixed(3) }}, {{ qcResult.heightRange[1].toFixed(3) }}] m</b>
          </div>
        </div>

        <div v-if="qcResult" style="margin-top: 14px">
          <template v-if="qcResult.fpMatch">
            <button class="ok" @click="pass">确认通过，归档</button>
          </template>
          <template v-else>
            <label>打回原因（必填）</label>
            <textarea v-model="rejectReason" rows="2" placeholder="例如：提交高度图与同 seed 重跑结果不符，疑似手工改动未标注"></textarea>
            <button class="danger" style="margin-top: 8px" @click="reject">打回返工</button>
          </template>
        </div>
      </div>

      <div class="card detail muted" v-else style="display: grid; place-items: center">
        <div style="text-align: center">
          <div style="font-size: 40px">🔍</div>
          <p>从左侧队列选择一个待质检工单</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.qc-page { padding: 22px 26px; height: 100%; overflow: auto; }
.page-head { display: flex; justify-content: space-between; align-items: flex-start; }
h2 { margin: 0 0 4px; }
.qc-layout { display: grid; grid-template-columns: 340px 1fr; gap: 14px; margin-top: 16px; }
.queue-item {
  padding: 10px; border: 1px solid var(--border); border-radius: 8px;
  margin-bottom: 8px; cursor: pointer;
}
.queue-item:hover { border-color: var(--accent); }
.queue-item.on { border-color: var(--accent); background: rgba(59, 130, 246, 0.1); }
.queue-item.done { cursor: default; }
.param-box { background: var(--panel-2); padding: 8px; border-radius: 6px; }
.result { border-radius: 10px; padding: 14px; border: 1px solid var(--border); }
.result.ok { border-color: var(--ok); background: rgba(52, 211, 153, 0.07); }
.result.bad { border-color: var(--bad); background: rgba(248, 113, 113, 0.07); }
.stat-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed var(--border); }
.stat-row span { color: var(--muted); }
h4 { margin: 0 0 10px; }
.tiny { font-size: 12px; }
</style>
