<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal wide">
      <div class="modal-head">
        <div>
          <h3 class="fs-16 w-600">合并导出 · OBJ</h3>
          <p class="fs-11 t-fg3" style="margin-top: 3px">
            合并成一个网格，按面数减面。导出包内含 obj + mtl + 尺寸元数据 + 导入说明。
          </p>
        </div>
        <button class="btn btn-ghost btn-icon" @click="$emit('close')"><X :size="15" /></button>
      </div>

      <div class="modal-body">
        <div v-if="loading" class="empty">
          <Loader :size="18" class="spin" />
          <span class="fs-12 t-fg3">正在统计面数…</span>
        </div>

        <template v-else-if="preview">
          <!-- 减面档位 -->
          <div class="field" style="margin-bottom: 16px">
            <label>减面档位</label>
            <div class="levels">
              <button
                v-for="lv in preview.levels"
                :key="lv.coarsen"
                class="level"
                :class="{ on: coarsen === lv.coarsen, recommended: lv.coarsen === recommended }"
                @click="coarsen = lv.coarsen"
              >
                <span class="lv-head">
                  <span class="lv-name">{{ lv.coarsen === 1 ? '原始精度' : `减面 ${lv.coarsen}×` }}</span>
                  <span v-if="lv.coarsen === recommended" class="lv-rec">推荐</span>
                </span>
                <span class="lv-num num">{{ fmt(lv.quads) }}</span>
                <span class="lv-sub">四边形 · {{ fmt(lv.triangles) }} 三角面</span>
                <span class="lv-sub2 mono">体素 {{ lv.voxelSize }} m</span>
                <span class="lv-bar"><i :style="{ width: barWidth(lv) }"></i></span>
              </button>
            </div>
          </div>

          <!-- 统计 -->
          <div class="summary-grid">
            <div class="sum-item">
              <span class="sum-k">导出面数</span>
              <span class="sum-v num">{{ fmt(selected.quads) }}</span>
            </div>
            <div class="sum-item">
              <span class="sum-k">三角面</span>
              <span class="sum-v num">{{ fmt(selected.triangles) }}</span>
            </div>
            <div class="sum-item">
              <span class="sum-k">外形尺寸</span>
              <span class="sum-v num">
                {{ selected.dimensions.width.toFixed(1) }} × {{ selected.dimensions.depth.toFixed(1) }} ×
                {{ selected.dimensions.height.toFixed(1) }} m
              </span>
            </div>
            <div class="sum-item">
              <span class="sum-k">网格</span>
              <span class="sum-v num">{{ selected.grid.join(' × ') }}</span>
            </div>
          </div>

          <!-- 层范围 -->
          <div class="field" style="margin: 16px 0">
            <label>导出层（默认全部层；分层导出便于分件加工）</label>
            <div class="layer-choice">
              <button
                class="btn btn-sm"
                :class="{ 'btn-teal': mode === 'all' }"
                @click="mode = 'all'"
              >全部 {{ session?.layerCount.value }} 层</button>
              <button
                class="btn btn-sm"
                :class="{ 'btn-teal': mode === 'range' }"
                @click="mode = 'range'"
              >当前可编辑层 {{ session?.layerMin.value }}–{{ session?.layerMax.value }}</button>
              <button
                class="btn btn-sm"
                :class="{ 'btn-teal': mode === 'custom' }"
                @click="mode = 'custom'"
              >指定层</button>
            </div>
            <div v-if="mode === 'custom'" class="row g6" style="margin-top: 8px">
              <input v-model="customLayers" class="input" placeholder="例：1-24, 30-48（层号从 1 开始）" />
            </div>
          </div>

          <div class="warn-row" v-if="!analysisOk">
            <AlertTriangle :size="13" />
            <span>体检未通过（存在悬空体素簇）。导出仍可继续，但建议先回建模台处理。</span>
          </div>

          <div class="file-list">
            <div class="track-wide" style="padding-bottom: 6px">导出包内容</div>
            <div class="file-row"><FileCode2 :size="11" /> <span class="mono">{{ fileName }}.obj</span><span class="t-fg4">网格</span></div>
            <div class="file-row"><Palette :size="11" /> <span class="mono">{{ fileName }}.mtl</span><span class="t-fg4">材质与颜色</span></div>
            <div class="file-row"><Braces :size="11" /> <span class="mono">{{ fileName }}.metadata.json</span><span class="t-fg4">尺寸/材质/订单</span></div>
            <div class="file-row"><FileText :size="11" /> <span class="mono">{{ fileName }}.readme.txt</span><span class="t-fg4">导入说明</span></div>
          </div>
        </template>

        <div v-else-if="error" class="empty">
          <AlertTriangle :size="18" class="t-red" />
          <span class="fs-12 t-red">{{ error }}</span>
        </div>
      </div>

      <div class="modal-foot">
        <span v-if="session?.stats.dirty && dirty" class="fs-11 t-amber grow">
          <AlertTriangle :size="11" style="display: inline; vertical-align: -1px" /> 有未保存改动，导出用当前视图里的模型
        </span>
        <span v-else class="grow"></span>
        <button class="btn" @click="$emit('close')">取消</button>
        <button class="btn btn-primary" :disabled="exporting || !preview" @click="doExport">
          <Loader v-if="exporting" :size="13" class="spin" />
          <Download v-else :size="13" />
          {{ exporting ? '打包中…' : '导出 zip' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { X, Loader, AlertTriangle, Download, FileCode2, Palette, Braces, FileText } from 'lucide-vue-next';
import { apiClient, toast } from '../state.js';

const props = defineProps({
  orderId: { type: String, required: true },
  session: { type: Object, default: null },
});
const emit = defineEmits(['close', 'exported']);

const loading = ref(true);
const preview = ref(null);
const coarsen = ref(1);
const mode = ref('all');
const customLayers = ref('');
const exporting = ref(false);
const error = ref('');

const dirty = computed(() => props.session?.stats.dirty);

const analysisOk = computed(() => {
  const a = props.session?.analysis.value;
  return !a || a.ok;
});

const selected = computed(() => {
  const lv = preview.value?.levels.find((l) => l.coarsen === coarsen.value);
  return lv || preview.value?.levels[0] || { quads: 0, triangles: 0, dimensions: { width: 0, depth: 0, height: 0 }, grid: [0, 0, 0] };
});

const recommended = computed(() => {
  const levels = preview.value?.levels || [];
  // 建议：不超过 30 万四边形时取最高精度，否则取面数最接近 20 万的档
  const under = levels.filter((l) => l.quads <= 300000);
  if (under.length) return under[0].coarsen;
  return levels.length ? levels[levels.length - 1].coarsen : 1;
});

const fileName = computed(() => {
  const suffix = coarsen.value > 1 ? `c${coarsen.value}x` : 'full';
  return `LT-${props.orderId.replace('ORD-', '')}-${suffix}`;
});

function fmt(n) {
  if (n === undefined || n === null) return '—';
  return n.toLocaleString('zh-CN');
}

function barWidth(lv) {
  const max = preview.value?.levels?.[0]?.quads || 1;
  return `${Math.max(3, (lv.quads / max) * 100)}%`;
}

/** 解析 "1-24, 30-48" 成层号数组 */
function parseLayers(text) {
  const out = new Set();
  for (const part of String(text).split(/[,，\s]+/)) {
    if (!part) continue;
    const m = part.match(/^(\d+)\s*[-–~]\s*(\d+)$/);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i);
    } else if (/^\d+$/.test(part)) {
      out.add(Number(part));
    }
  }
  return [...out].sort((a, b) => a - b);
}

function layersPayload() {
  if (mode.value === 'all') return null;
  if (mode.value === 'range') {
    const s = props.session;
    if (!s) return null;
    return s.layerRangeList();
  }
  return parseLayers(customLayers.value);
}

async function doExport() {
  exporting.value = true;
  try {
    const layers = layersPayload();
    const body = { coarsen: coarsen.value };
    // 模型与源模型不一致（有未保存改动或降采样）时，带上当前数据
    if (props.session && (dirty.value || coarsen.value > 1)) {
      body.data = props.session.model.value.toJSON();
    }
    if (layers && layers.length) body.layers = layers;
    const res = await apiClient.exportOrder(props.orderId, body);
    const blob = res instanceof Blob ? res : await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName.value}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(`已导出 ${fileName.value}.zip · ${fmt(selected.value.quads)} 面`, 'ok', 4200);
    emit('exported', { coarsen: coarsen.value, quads: selected.value.quads });
    emit('close');
  } catch (err) {
    toast(err.message, 'err', 4200);
  } finally {
    exporting.value = false;
  }
}

onMounted(async () => {
  try {
    preview.value = await apiClient.exportPreview(props.orderId);
    coarsen.value = recommended.value;
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
});

watch(customLayers, () => {});
</script>

<style scoped>
.levels {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.level {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 11px;
  border-radius: var(--r-2);
  border: 1px solid var(--line-2);
  background: var(--bg-1);
  text-align: left;
  transition: 0.13s;
  position: relative;
}
.level:hover { border-color: var(--line-3); background: var(--bg-2); }
.level.on {
  border-color: var(--lunar);
  background: var(--lunar-soft);
  box-shadow: inset 0 0 0 1px rgba(226, 160, 77, 0.22);
}
.lv-head {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 4px;
}
.lv-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--fg-1);
}
.lv-rec {
  font-size: 8.5px;
  padding: 1px 4px;
  border-radius: 2px;
  background: var(--teal-soft);
  color: var(--teal);
  font-weight: 600;
}
.lv-num {
  font-size: 17px;
  font-weight: 600;
  color: var(--fg-0);
  line-height: 1.1;
}
.lv-sub { font-size: 9.5px; color: var(--fg-3); }
.lv-sub2 { font-size: 9.5px; color: var(--fg-4); }
.lv-bar {
  margin-top: 6px;
  height: 3px;
  background: var(--bg-4);
  border-radius: 2px;
  overflow: hidden;
  display: block;
}
.lv-bar > i {
  display: block;
  height: 100%;
  background: var(--lunar-dim);
  border-radius: 2px;
}
.level.on .lv-bar > i { background: var(--lunar); }

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  background: var(--line-1);
  border: 1px solid var(--line-1);
  border-radius: var(--r-1);
  overflow: hidden;
}
.sum-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  background: var(--bg-1);
}
.sum-k {
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-4);
}
.sum-v { font-size: 12.5px; color: var(--fg-0); font-weight: 500; }

.layer-choice { display: flex; gap: 6px; flex-wrap: wrap; }

.warn-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 11px;
  border-radius: var(--r-1);
  background: var(--amber-soft);
  border: 1px solid rgba(232, 185, 63, 0.28);
  color: var(--amber);
  font-size: 11.5px;
  margin-bottom: 14px;
}

.file-list {
  padding: 10px 12px;
  background: var(--bg-1);
  border: 1px solid var(--line-1);
  border-radius: var(--r-1);
}
.file-row {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  color: var(--fg-2);
  padding: 2px 0;
}
.file-row .t-fg4 { margin-left: auto; font-size: 10px; }

.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 720px) {
  .levels { grid-template-columns: repeat(2, 1fr); }
  .summary-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
