<script setup>
import { ref, computed, onMounted } from 'vue'
import TerrainCanvas from '../components/TerrainCanvas.vue'
import { TerrainEngine } from '../terrain/TerrainEngine.js'
import { PARAM_GROUPS, defaultParams } from '../terrain/config.js'
import { repo } from '../store/repo.js'

const props = defineProps({ order: { type: Object, default: null } })

const seedInput = ref(props.order?.seed || 20261120)
const params = ref(props.order ? { ...props.order.params } : defaultParams())
let engine = new TerrainEngine(seedInput.value, params.value)
const engineRef = ref(engine)
// 引擎是普通类实例，用 tick 驱动锁定数/指纹等派生状态刷新
const tick = ref(0)
const bump = () => (tick.value++)
const genInfo = ref({ totalMs: 0, chunks: 0 })
const lastIncrement = ref(null)
const hoverChunk = ref(null)
const gpu = ref({ ok: false })
const wireframe = ref(false)
const showWater = ref(true)
const tool = ref('select-lock')
const brushRadius = ref(1.2)
const brushStrength = ref(0.15)
const order = ref(props.order)
const submissionMsg = ref('')

const tools = [
  { key: 'select-lock', label: '框选锁定', icon: '🔒' },
  { key: 'select-unlock', label: '框选解锁', icon: '🔓' },
  { key: 'raise', label: '刷高', icon: '⛰️' },
  { key: 'flatten', label: '削平', icon: '📏' },
  { key: 'trench', label: '挖沟', icon: '🕳️' }
]

onMounted(() => {
  const t0 = performance.now()
  engine.generateAll()
  genInfo.value = { totalMs: performance.now() - t0, chunks: engine.chunks.length }
})

function regenerateAll() {
  engine = new TerrainEngine(seedInput.value, params.value)
  engineRef.value = engine
  const t0 = performance.now()
  engine.generateAll()
  genInfo.value = { totalMs: performance.now() - t0, chunks: engine.chunks.length }
  lastIncrement.value = null
  bump()
}

function onParamChange() {
  const t0 = performance.now()
  const res = engine.updateParams(params.value)
  const ms = performance.now() - t0
  lastIncrement.value = { ...res, ms }
  bump()
}

function onSelectRect(r) {
  engine.setLockRect(r.x0, r.z0, r.x1, r.z1, r.mode === 'lock')
  bump()
}
function onBrush(b) {
  engine.applyBrush(b.mode, b.x, b.z, b.radius, b.strength)
  bump()
}
function onHoverChunk({ chunk }) {
  hoverChunk.value = chunk
}
function onGpuStatus(s) {
  gpu.value = s
}

const currentChunk = computed(() => {
  void tick.value
  return hoverChunk.value
})
const lockedCount = computed(() => {
  void tick.value
  return engine.chunks.filter((c) => c.locked).length
})
const editedCount = computed(() => {
  void tick.value
  return engine.chunks.filter((c) => c.edited).length
})
const fingerprint = computed(() => {
  void tick.value
  return engine.fingerprint()
})

function download(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

const exportState = ref(null)
function doExport() {
  const seed = seedInput.value
  const { blob: png, meta } = engine.exportHeightPng()
  const obj = engine.exportObj()
  download(png, `heightmap_${seed}_257.png`)
  download(obj, `terrain_${seed}.obj`)
  exportState.value = {
    png: `heightmap_${seed}_257.png`,
    obj: `terrain_${seed}.obj`,
    fingerprint: engine.fingerprint(),
    at: new Date().toLocaleTimeString()
  }
}

function submitForQc() {
  if (!order.value) {
    submissionMsg.value = '当前为自由编辑（无工单），可先在「需求单」建单后打开'
    return
  }
  const { blob, meta } = engine.exportHeightPng()
  const obj = engine.exportObj()
  const exports = {
    heightmap: `heightmap_${order.value.seed}_257.png`,
    obj: `terrain_${order.value.seed}.obj`,
    meta,
    triCount: engine.totalTriangles()
  }
  // 触发浏览器下载，工单里记录文件名与指纹
  download(blob, exports.heightmap)
  download(obj, exports.obj)
  repo.submitQc(order.value.id, engine.fingerprint(), exports, order.value.assignee || '建模员')
  order.value = repo.get(order.value.id)
  submissionMsg.value = `已提交质检，指纹 ${engine.fingerprint()}`
}

const featureName = { slope: '坡道', step: '台阶', rubble: '碎石', trench: '沟槽', water: '涉水' }
</script>

<template>
  <div class="editor-page">
    <!-- 左：参数面板 -->
    <section class="panel left">
      <div class="block">
        <h3>生成参数</h3>
        <label>种子 seed</label>
        <div class="row">
          <input v-model="seedInput" type="number" @change="regenerateAll" />
          <button title="随机种子" @click="seedInput = Math.floor(100000 + Math.random() * 900000); regenerateAll()">🎲</button>
        </div>
        <p class="muted tiny">同 seed + 同参数，每次生成结果完全一致</p>
      </div>

      <div class="block" v-for="g in PARAM_GROUPS" :key="g.key">
        <label>{{ g.label }} <span class="mono">{{ params[g.key] }}{{ g.unit }}</span></label>
        <input
          type="range"
          :min="g.min"
          :max="g.max"
          :step="g.step"
          v-model.number="params[g.key]"
          @change="onParamChange"
        />
        <div class="muted tiny">{{ g.desc }}</div>
      </div>

      <div class="block">
        <button class="primary" style="width: 100%" @click="regenerateAll">↻ 整片重新生成</button>
        <div v-if="lastIncrement" class="inc-box">
          上次增量重算：<b>{{ lastIncrement.regenerated.length }}</b> 块，
          跳过锁定 <b>{{ lastIncrement.skippedLocked.length }}</b> 块，
          耗时 <span class="mono">{{ lastIncrement.ms.toFixed(2) }}ms</span>
          <div class="muted tiny">
            影响要素：{{ lastIncrement.changedFeatures.map((f) => featureName[f]).join('、') || '无' }}
          </div>
        </div>
      </div>
    </section>

    <!-- 中：画布 -->
    <section class="panel center">
      <div class="toolbar">
        <div class="tool-group">
          <button
            v-for="t in tools"
            :key="t.key"
            :class="{ primary: tool === t.key }"
            @click="tool = t.key"
          >{{ t.icon }} {{ t.label }}</button>
        </div>
        <div class="tool-group">
          <button :class="{ primary: wireframe }" @click="wireframe = !wireframe">🔺 线框</button>
          <button :class="{ primary: showWater }" @click="showWater = !showWater">💧 水面</button>
        </div>
      </div>

      <TerrainCanvas
        :engine="engineRef"
        :wireframe="wireframe"
        :show-water="showWater"
        :tool="tool"
        :brush-radius="brushRadius"
        :brush-strength="brushStrength"
        @select-rect="onSelectRect"
        @brush="onBrush"
        @hover-chunk="onHoverChunk"
        @gpu-status="onGpuStatus"
      />

      <div class="brush-bar" v-if="!tool.startsWith('select')">
        <label>笔刷半径 {{ brushRadius.toFixed(1) }}m</label>
        <input type="range" min="0.4" max="3" step="0.1" v-model.number="brushRadius" style="width: 160px" />
        <label>强度 {{ brushStrength.toFixed(2) }}m</label>
        <input type="range" min="0.03" max="0.5" step="0.01" v-model.number="brushStrength" style="width: 160px" />
      </div>
    </section>

    <!-- 右：状态与导出 -->
    <section class="panel right">
      <div class="block" v-if="order">
        <h3>当前工单</h3>
        <div class="mono tiny">{{ order.id }}</div>
        <div>{{ order.title }}</div>
        <span class="tag" :class="order.status" style="margin-top: 6px">{{ order.status }}</span>
      </div>

      <div class="block">
        <h3>当前区块</h3>
        <template v-if="currentChunk">
          <div class="stat-row"><span>区块坐标</span><b class="mono">({{ currentChunk.cx }}, {{ currentChunk.cz }})</b></div>
          <div class="stat-row"><span>三角面数</span><b class="mono">{{ currentChunk.triCount.toLocaleString() }}</b></div>
          <div class="stat-row"><span>程序生成耗时</span><b class="mono">{{ currentChunk.genMs.toFixed(2) }} ms</b></div>
          <div class="stat-row"><span>状态</span>
            <b>
              <span v-if="currentChunk.locked" style="color: var(--warn)">🔒 已锁定</span>
              <span v-else style="color: var(--ok)">未锁定</span>
              <span v-if="currentChunk.edited" style="color: var(--pink)"> · 手工编辑</span>
            </b>
          </div>
          <div class="stat-row"><span>覆盖要素</span>
            <b>{{ [...currentChunk.featureTags].map((f) => featureName[f]).join('、') || '平地' }}</b>
          </div>
        </template>
        <p v-else class="muted tiny">鼠标移入画布查看区块信息</p>
      </div>

      <div class="block">
        <h3>整片场地</h3>
        <div class="stat-row"><span>场地尺寸</span><b class="mono">40m × 40m</b></div>
        <div class="stat-row"><span>网格分辨率</span><b class="mono">257 × 257</b></div>
        <div class="stat-row"><span>总三角面数</span><b class="mono">{{ engine.totalTriangles().toLocaleString() }}</b></div>
        <div class="stat-row"><span>全量生成耗时</span><b class="mono">{{ genInfo.totalMs.toFixed(2) }} ms</b></div>
        <div class="stat-row"><span>锁定 / 编辑区块</span><b class="mono">{{ lockedCount }} / {{ editedCount }} / 64</b></div>
        <div class="stat-row"><span>高度指纹</span><b class="mono">{{ fingerprint }}</b></div>
      </div>

      <div class="block">
        <h3>导出（仿真用）</h3>
        <button class="primary" style="width: 100%; margin-bottom: 8px" @click="doExport">⬇ 导出高度图 PNG + OBJ</button>
        <div v-if="exportState" class="inc-box tiny">
          <div>📄 {{ exportState.png }}（16bit 灰度 257²）</div>
          <div>📦 {{ exportState.obj }}（{{ engine.totalTriangles().toLocaleString() }} 三角面）</div>
          <div>指纹：<span class="mono">{{ exportState.fingerprint }}</span></div>
        </div>
        <button v-if="order" class="ok" style="width: 100%; margin-top: 10px" @click="submitForQc">
          ✅ 提交质检（同 seed 重跑比对）
        </button>
        <p v-if="submissionMsg" class="tiny" style="color: var(--ok)">{{ submissionMsg }}</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.editor-page {
  display: grid;
  grid-template-columns: 260px 1fr 300px;
  gap: 12px;
  padding: 14px;
  height: 100%;
  min-height: 0;
}
.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px;
  overflow: auto;
  min-height: 0;
}
.center { padding: 10px; display: flex; flex-direction: column; gap: 10px; overflow: hidden; }
.block { margin-bottom: 16px; }
h3 { margin: 0 0 10px; font-size: 14px; }
.tiny { font-size: 12px; }
input[type='range'] { padding: 0; accent-color: var(--accent); }
.inc-box {
  margin-top: 10px; padding: 9px;
  background: var(--panel-2); border-radius: 7px;
  font-size: 12px; line-height: 1.7;
}
.toolbar { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
.tool-group { display: flex; gap: 6px; flex-wrap: wrap; }
.brush-bar {
  display: flex; align-items: center; gap: 10px;
  background: var(--panel-2); border-radius: 8px; padding: 8px 12px;
}
.stat-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 13px; border-bottom: 1px dashed var(--border); }
.stat-row span { color: var(--muted); }
</style>
