<template>
  <div class="qc-view">
    <aside class="qc-side">
      <div class="qc-side-head">
        <div>
          <h1 class="fs-18 w-600">质检台</h1>
          <p class="fs-11 t-fg3">合并前体检 · 抽查与返工</p>
        </div>
        <span class="queue-count">{{ queue.length }}</span>
      </div>

      <div class="qc-tabs">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="qc-tab"
          :class="{ on: tab === t.key }"
          @click="tab = t.key"
        >
          {{ t.label }}
          <span class="qc-tab-n">{{ tabCount(t.key) }}</span>
        </button>
      </div>

      <div class="qc-list scroll">
        <button
          v-for="o in visibleList"
          :key="o.id"
          class="qc-item"
          :class="{ on: activeId === o.id }"
          @click="selectOrder(o.id)"
        >
          <div class="row g6">
            <span class="mono fs-10 t-fg3">{{ o.code }}</span>
            <StatusPill :status="o.status" />
            <span v-if="o.reworkCount" class="tag rework-tag">返工 {{ o.reworkCount }}</span>
          </div>
          <div class="qc-item-title">{{ o.title }}</div>
          <div class="qc-item-meta">
            <span v-if="o.assigneeInfo" class="row g4">
              <span class="avatar xs" :style="avatarStyle(o.assigneeInfo)">{{ o.assigneeInfo.avatar }}</span>
              {{ o.assigneeName }}
            </span>
            <span v-else class="t-amber">未分派</span>
            <span class="grow"></span>
            <span class="fs-10 t-fg4">{{ formatTime(o.submittedAt || o.createdAt) }}</span>
          </div>
          <div v-if="o.analysis" class="qc-item-check" :class="o.analysis.ok ? 'ok' : 'bad'">
            <component :is="o.analysis.ok ? CheckCircle2 : XOctagon" :size="10" />
            {{ o.analysis.ok ? '体检通过' : `体检 ${o.analysis.issues.filter(i => i.severity === 'error').length} 项阻塞` }}
          </div>
        </button>

        <div v-if="!visibleList.length" class="empty">
          <ScanSearch :size="24" :stroke-width="1.4" />
          <span class="fs-12">{{ tab === 'queue' ? '暂无待质检工单' : '没有记录' }}</span>
          <span v-if="tab === 'queue'" class="fs-10 t-fg4">师傅提交后会出现在这里</span>
        </div>
      </div>
    </aside>

    <section class="qc-main">
      <div v-if="!activeId" class="empty" style="height: 100%">
        <div class="qc-empty-art">
          <ScanSearch :size="34" :stroke-width="1.2" />
        </div>
        <span class="fs-14 w-500">左侧选择一个工单开始抽查</span>
        <span class="fs-11 t-fg3">体检会自动跑一遍：悬空体素簇（&gt;5 格）与薄壁（&lt;2 格）</span>
      </div>

      <template v-else-if="detail">
        <header class="qc-detail-head">
          <div class="col g6" style="min-width: 0">
            <div class="row g8">
              <span class="mono fs-11 t-fg3">{{ detail.code }}</span>
              <StatusPill :status="detail.status" />
              <span class="tag">{{ appState.priorities[detail.priority] }}</span>
              <span v-if="detail.reworkCount" class="tag rework-tag">
                <RotateCcw :size="9" /> 已返工 {{ detail.reworkCount }} 次
              </span>
            </div>
            <h2 class="fs-16 w-600 truncate">{{ detail.title }}</h2>
          </div>
          <div class="row g6">
            <button class="btn btn-sm" @click="openEditor">
              <Box :size="12" /> 打开模型
            </button>
            <template v-if="detail.status === 'submitted'">
              <button class="btn btn-danger btn-sm" @click="rejectOpen = true">
                <Undo2 :size="12" /> 打回返工
              </button>
              <button class="btn btn-teal btn-sm" :disabled="busy" @click="pass">
                <CheckCircle2 :size="12" /> 判定通过
              </button>
            </template>
          </div>
        </header>

        <div class="qc-detail-body scroll">
          <!-- 概览 -->
          <div class="qc-cards">
            <div class="qc-card">
              <span class="qc-card-k">模型体素</span>
              <span class="qc-card-v num">{{ detail.modelCells?.toLocaleString('zh-CN') || '—' }}</span>
            </div>
            <div class="qc-card">
              <span class="qc-card-k">网格</span>
              <span class="qc-card-v num">{{ detail.grid.sizeX }}×{{ detail.grid.sizeY }}×{{ detail.grid.sizeZ }}</span>
            </div>
            <div class="qc-card">
              <span class="qc-card-k">体素尺寸</span>
              <span class="qc-card-v num">{{ detail.grid.voxelSize }} m</span>
            </div>
            <div class="qc-card">
              <span class="qc-card-k">外形</span>
              <span class="qc-card-v num">{{ dims }}</span>
            </div>
          </div>

          <!-- 缩略 3D -->
          <div class="qc-preview">
            <div class="qc-preview-head">
              <span class="row g5 fs-11 t-fg2"><Cuboid :size="12" /> 模型预览</span>
              <span class="fs-10 t-fg4">{{ previewCells }} 格已渲染 · 只读</span>
            </div>
            <div class="qc-canvas-wrap">
              <canvas ref="qcCanvas" class="qc-canvas"></canvas>
              <div v-if="previewLoading" class="preview-mask">
                <Loader :size="16" class="spin" /> 载入模型
              </div>
              <div v-else-if="previewError" class="preview-mask error">{{ previewError }}</div>
            </div>
          </div>

          <!-- 体检结果 -->
          <div class="qc-panel">
            <div class="qc-panel-head">
              <div class="row g6">
                <ShieldCheck :size="13" :class="analysisOk ? 't-green' : 't-red'" />
                <span class="fs-12 w-600">合并前体检</span>
              </div>
              <span class="fs-10 t-fg4">
                悬空阈值 &gt;{{ params.floatingMin }} 格 · 薄壁阈值 &lt;{{ params.minWall }} 格
              </span>
            </div>
            <div v-if="analyzing" class="empty" style="padding: 26px">
              <Loader :size="16" class="spin" /> <span class="fs-11 t-fg3">体检计算中…</span>
            </div>
            <template v-else-if="analysis">
              <div class="qc-verdict" :class="analysis.ok ? 'ok' : 'bad'">
                <component :is="analysis.ok ? ShieldCheck : ShieldX" :size="20" />
                <div class="col" style="gap: 2px">
                  <span class="fs-14 w-600">{{ analysis.ok ? '未发现阻塞合并的问题' : '存在问题，应打回处理' }}</span>
                  <span class="fs-11" style="opacity: 0.8">
                    {{ analysis.issues.length ? analysis.issues.map((i) => i.title).join(' / ') : '连通性完整，壁厚达标' }}
                  </span>
                </div>
              </div>

              <div class="qc-issue-table">
                <div
                  v-for="iss in analysis.issues"
                  :key="iss.code"
                  class="qc-issue-row"
                  :class="iss.severity"
                >
                  <span class="qc-issue-sev">{{ SEVERITY[iss.severity] }}</span>
                  <span class="fs-12 w-500">{{ iss.title }}</span>
                  <span class="fs-11 t-fg3 grow">{{ iss.detail }}</span>
                  <span v-if="iss.cells" class="mono fs-10 t-fg4">{{ iss.cells.toLocaleString('zh-CN') }} 格</span>
                </div>
                <div v-if="!analysis.issues.length" class="qc-issue-row info">
                  <span class="qc-issue-sev ok">通过</span>
                  <span class="fs-12 t-fg2">没有发现悬空体素簇、薄壁或零碎体素。</span>
                </div>
              </div>

              <div v-if="analysis.floating.length" class="qc-locate">
                <div class="track-wide" style="padding-bottom: 6px">悬空簇定位（点按跳到预览）</div>
                <div class="locate-chips">
                  <button
                    v-for="(f, i) in analysis.floating"
                    :key="'f' + i"
                    class="locate-chip error"
                    @click="focusPreview(f.bbox)"
                  >
                    <span class="loc-dot"></span>
                    {{ f.count }} 格
                    <span class="mono t-fg4">{{ f.bbox.x0 }},{{ f.bbox.y0 }},{{ f.bbox.z0 }}</span>
                  </button>
                </div>
              </div>
              <div v-if="analysis.thinAreas.length" class="qc-locate">
                <div class="track-wide" style="padding-bottom: 6px">薄壁区域（前 {{ analysis.thinAreas.length }} 处）</div>
                <div class="locate-chips">
                  <button
                    v-for="(t, i) in analysis.thinAreas"
                    :key="'t' + i"
                    class="locate-chip warn"
                    @click="focusPreview(t.bbox)"
                  >
                    <span class="loc-dot"></span>
                    {{ t.count }} 格 · 最薄 {{ t.minThickness }}
                  </button>
                </div>
              </div>
            </template>
          </div>

          <!-- 交付前检查清单 -->
          <div class="qc-panel">
            <div class="qc-panel-head">
              <div class="row g6">
                <ListChecks :size="13" class="t-fg3" />
                <span class="fs-12 w-600">抽查清单</span>
              </div>
              <div class="row g8">
                <span class="fs-10 t-fg4">{{ checkedCount }}/{{ CHECKLIST.length }}</span>
                <button class="btn btn-teal btn-sm" :disabled="inspecting" @click="autoCheckAll">
                  <Loader v-if="inspecting" :size="11" class="spin" />
                  <Wand2 v-else :size="11" />
                  自动核验全部
                </button>
              </div>
            </div>
            <div class="checklist">
              <label v-for="c in CHECKLIST" :key="c.key" class="check-row">
                <button
                  class="check"
                  :class="{ on: checks[c.key] }"
                  @click.prevent="toggleCheck(c.key)"
                >
                  <Check v-if="checks[c.key]" :size="10" :stroke-width="3" />
                </button>
                <span class="col" style="gap: 1px">
                  <span class="fs-12" :class="checks[c.key] ? 't-fg2' : 't-fg0'">{{ c.label }}</span>
                  <span class="fs-10 t-fg4">{{ c.hint }}</span>
                </span>
                <span class="grow"></span>
                <button
                  v-if="c.auto"
                  class="btn btn-ghost btn-sm"
                  :disabled="inspecting"
                  @click.prevent="autoCheck(c.auto)"
                >自动核验</button>
              </label>
            </div>
          </div>

          <!-- 结构核验数据 -->
          <div v-if="inspection" class="qc-panel">
            <div class="qc-panel-head">
              <div class="row g6">
                <Ruler :size="13" class="t-fg3" />
                <span class="fs-12 w-600">结构核验</span>
              </div>
              <span class="fs-10 t-fg4">由模型几何直接算出</span>
            </div>
            <div class="inspect-grid">
              <div v-for="item in inspection.items" :key="item.key" class="inspect-item">
                <span class="ins-k">{{ item.label }}</span>
                <span class="ins-v num">{{ item.value }}</span>
                <span class="ins-d">{{ item.detail }}</span>
              </div>
            </div>
            <div v-if="inspection.requirements && inspection.requirements.length" class="req-compare">
              <div class="track-wide" style="padding-bottom: 6px">需求对照</div>
              <div v-for="(r, i) in inspection.requirements" :key="i" class="req-cmp-row">
                <span class="req-cmp-k">{{ r.k }}</span>
                <span class="req-cmp-v">{{ r.v }}</span>
              </div>
            </div>
          </div>

          <!-- 历史 -->
          <div v-if="detail.qcNotes?.length" class="qc-panel">
            <div class="qc-panel-head">
              <div class="row g6"><History :size="13" class="t-fg3" /><span class="fs-12 w-600">历史质检</span></div>
            </div>
            <div class="qc-notes">
              <div v-for="(n, i) in [...detail.qcNotes].reverse()" :key="i" class="qc-note" :class="n.kind">
                <div class="row g6">
                  <component :is="n.kind === 'pass' ? CheckCircle2 : XCircle" :size="12" />
                  <span class="fs-11 w-600">{{ n.kind === 'pass' ? '通过' : '打回' }}</span>
                  <span class="fs-10 t-fg3">{{ memberName(n.by) }} · {{ formatDate(n.at) }}</span>
                </div>
                <p class="qc-note-text">{{ n.text }}</p>
              </div>
            </div>
          </div>
        </div>
      </template>
    </section>

    <RejectModal
      v-if="rejectOpen"
      :order="detail"
      @close="rejectOpen = false"
      @rejected="onRejected"
    />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  ScanSearch, CheckCircle2, XOctagon, Check, Loader, ShieldCheck, ShieldX,
  ListChecks, History, XCircle, Box, Undo2, RotateCcw, Cuboid, Wand2, Ruler,
} from 'lucide-vue-next';
import {
  appState, apiClient, avatarStyle, formatDate, formatTime, memberName, toast, refreshOrders,
} from '../state.js';
import StatusPill from '../components/StatusPill.vue';
import RejectModal from '../components/RejectModal.vue';
import { VoxelRenderer } from '../editor/VoxelRenderer.js';
import { VoxelModel } from '../../shared/voxel.js';

const router = useRouter();

const SEVERITY = { error: '阻塞', warn: '警告', info: '提示' };

const tab = ref('queue');
const activeId = ref(null);
const detail = ref(null);
const analysis = ref(null);
const analyzing = ref(false);
const busy = ref(false);
const rejectOpen = ref(false);
const previewLoading = ref(false);
const previewError = ref('');
const previewCells = ref(0);
const qcCanvas = ref(null);
const params = reactive({ floatingMin: 5, minWall: 2 });
const checks = reactive({});

const CHECKLIST = [
  { key: 'dims', label: '外形尺寸符合要求', hint: '对照需求项的跨度、直径、长度', auto: 'dims' },
  { key: 'layers', label: '分层高度与功能分区一致', hint: '主舱 3 层、设备层净高是否够', auto: 'layers' },
  { key: 'materials', label: '内壁与舱体材质分组正确', hint: '洞体/内壁/舱体/设备四组没有混用', auto: 'materials' },
  { key: 'airlock', label: '气闸与接口对位', hint: '气闸框闭合、廊道与竖井中心线对齐' },
  { key: 'mirror', label: '镜像对称结构一致', hint: '开启镜像后两侧形体是否对称', auto: 'mirror' },
  { key: 'export', label: '已试导出 obj 并检查面数', hint: '面数在交付预算内，无明显破面', auto: 'export' },
];

const inspection = ref(null);
const inspecting = ref(false);
const exportInfo = ref(null);

const tabs = [
  { key: 'queue', label: '待质检' },
  { key: 'rejected', label: '已打回' },
  { key: 'passed', label: '已通过' },
];

const queue = computed(() => appState.orders.filter((o) => o.status === 'submitted'));

const visibleList = computed(() => {
  if (tab.value === 'queue') return queue.value;
  if (tab.value === 'rejected') return appState.orders.filter((o) => o.status === 'rejected');
  return appState.orders.filter((o) => ['approved', 'delivered'].includes(o.status));
});

function tabCount(key) {
  if (key === 'queue') return queue.value.length;
  if (key === 'rejected') return appState.orders.filter((o) => o.status === 'rejected').length;
  return appState.orders.filter((o) => ['approved', 'delivered'].includes(o.status)).length;
}

const analysisOk = computed(() => !analysis.value || analysis.value.ok);
const dims = computed(() => {
  const g = detail.value?.grid;
  if (!g) return '—';
  return `${(g.sizeX * g.voxelSize).toFixed(0)}×${(g.sizeY * g.voxelSize).toFixed(0)}×${(g.sizeZ * g.voxelSize).toFixed(0)} m`;
});
const checkedCount = computed(() => Object.values(checks).filter(Boolean).length);

let renderer = null;
let rafId = 0;

function toggleCheck(key) {
  checks[key] = !checks[key];
}

/** 拉取结构核验数据（尺寸 / 对称度 / 材质组 / 分层 / 面数）。 */
async function runInspection() {
  if (!detail.value) return;
  inspecting.value = true;
  try {
    const [insp, exp] = await Promise.all([
      apiClient.inspect(detail.value.id),
      apiClient.exportPreview(detail.value.id).catch(() => null),
    ]);
    inspection.value = insp;
    exportInfo.value = exp;
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    inspecting.value = false;
  }
}

/** 单项自动核验：用几何数据直接判定，并给出可读说明。 */
async function autoCheck(key) {
  if (!inspection.value) await runInspection();
  const insp = inspection.value;
  if (!insp) return;
  if (key === 'dims') {
    const dimItem = insp.items.find((i) => i.key === 'dims');
    const hasReqs = (insp.requirements || []).length > 0;
    checks.dims = true;
    toast(`实测 ${dimItem ? dimItem.value : ''}${hasReqs ? '，请对照下方需求项确认' : '（该单未录尺寸要求）'}`, 'ok', 4200);
  } else if (key === 'layers') {
    const layerItem = insp.items.find((i) => i.key === 'layers');
    checks.layers = true;
    toast(`有效层数 ${layerItem ? layerItem.value : ''} · ${layerItem ? layerItem.detail : ''}`, 'ok', 4200);
  } else if (key === 'materials') {
    const gi = insp.items.find((i) => i.key === 'materials');
    checks.materials = !!gi && gi.value !== '无';
    toast(checks.materials ? `材质分组：${gi.value}` : '模型里没有材质，检查未通过', checks.materials ? 'ok' : 'warn', 4200);
  } else if (key === 'mirror') {
    const m = insp.mirror;
    if (!m) {
      toast('模型过窄，无法判定对称度', 'warn');
      return;
    }
    checks.mirror = m.rate > 0.9;
    toast(
      `镜像对称度 ${(m.rate * 100).toFixed(1)}%${checks.mirror ? ' · 结构基本对称' : ' · 两侧差异较大，建议人工复核'}`,
      checks.mirror ? 'ok' : 'warn',
      4200
    );
  } else if (key === 'export') {
    if (!exportInfo.value) {
      toast('拿不到面数统计', 'warn');
      return;
    }
    const base = exportInfo.value.levels[0];
    checks.export = base.quads <= 300000;
    toast(
      `原始精度 ${base.quads.toLocaleString('zh-CN')} 个四边形${checks.export ? '，在交付预算内' : '，超出 30 万预算，建议减面'}`,
      checks.export ? 'ok' : 'warn',
      4200
    );
  }
}

async function autoCheckAll() {
  if (!inspection.value) await runInspection();
  for (const c of CHECKLIST) {
    if (c.auto) await autoCheck(c.auto);
  }
}

async function selectOrder(id) {
  activeId.value = id;
  detail.value = null;
  analysis.value = null;
  for (const k of Object.keys(checks)) delete checks[k];
  try {
    detail.value = await apiClient.order(id);
    inspection.value = null;
    exportInfo.value = null;
    runAnalysis();
    runInspection();
    await loadPreview();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function runAnalysis() {
  if (!detail.value) return;
  analyzing.value = true;
  try {
    analysis.value = await apiClient.analyze(detail.value.id, {
      floatingMin: params.floatingMin,
      minWall: params.minWall,
    });
    if (renderer) {
      renderer.markers = analysis.value.floating.map((f) => ({
        kind: 'floating', severity: 'error', bbox: f.bbox, label: '悬空',
      })).concat(
        analysis.value.thinAreas.map((t) => ({
          kind: 'thin', severity: 'warn', bbox: t.bbox, label: '薄壁',
        }))
      );
      renderer.requestDraw?.();
      scheduleDraw();
    }
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    analyzing.value = false;
  }
}

async function loadPreview() {
  previewLoading.value = true;
  previewError.value = '';
  try {
    const payload = await apiClient.model(detail.value.id);
    const model = VoxelModel.fromJSON(payload.data);
    previewCells.value = model.occupied;
    await new Promise((r) => requestAnimationFrame(r));
    if (!renderer) {
      renderer = new VoxelRenderer(qcCanvas.value);
    } else {
      renderer.resizeObserver.disconnect();
    }
    // 预览框是宽扁的，正等轴测会把模型压得很小；
    // 换个偏侧向的机位、收窄 FOV，模型在框里占比更大。
    renderer.camera.yaw = -Math.PI / 2 + 0.26;
    renderer.camera.pitch = 0.3;
    renderer.camera.fov = 34;
    renderer.setModel(model);
    renderer.frameAll();
    // 只读预览：隐藏网格线，聚焦全层
    renderer.opts.showGrid = true;
    renderer.opts.showMarkers = true;
    scheduleDraw();
    if (analysis.value) {
      renderer.markers = analysis.value.floating.map((f) => ({
        kind: 'floating', severity: 'error', bbox: f.bbox, label: '悬空',
      })).concat(analysis.value.thinAreas.map((t) => ({
        kind: 'thin', severity: 'warn', bbox: t.bbox, label: '薄壁',
      })));
    }
  } catch (err) {
    previewError.value = err.message;
  } finally {
    previewLoading.value = false;
  }
}

function scheduleDraw() {
  if (!renderer) return;
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    if (renderer) {
      try {
        renderer.render();
      } catch (err) {
        previewError.value = err.message;
      }
    }
  });
}

function focusPreview(box) {
  if (!renderer) return;
  renderer.focusBox(box);
  scheduleDraw();
}

async function pass() {
  busy.value = true;
  try {
    detail.value = await apiClient.setStatus(detail.value.id, { status: 'approved', note: '抽查通过' });
    toast('质检通过', 'ok');
    await refreshOrders();
    activeId.value = null;
    detail.value = null;
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    busy.value = false;
  }
}

async function onRejected() {
  rejectOpen.value = false;
  await refreshOrders();
  if (detail.value) {
    detail.value = await apiClient.order(detail.value.id);
  }
  activeId.value = null;
  detail.value = null;
  toast('已打回，返工次数 +1', 'warn');
}

function openEditor() {
  if (detail.value) router.push(`/build/${detail.value.id}`);
}

watch(
  () => appState.orders.map((o) => o.status).join(','),
  () => {
    if (!activeId.value && queue.value.length) selectOrder(queue.value[0].id);
  }
);

onMounted(async () => {
  await refreshOrders().catch(() => {});
  if (queue.value.length) selectOrder(queue.value[0].id);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId);
  renderer?.dispose();
});
</script>

<style scoped>
.qc-view {
  display: flex;
  height: 100%;
  min-height: 0;
}

.qc-side {
  width: 292px;
  flex-shrink: 0;
  border-right: 1px solid var(--line-1);
  background: var(--bg-1);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.qc-side-head {
  padding: 18px 16px 12px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.queue-count {
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: 11px;
  background: var(--violet-soft);
  color: #b6a9f0;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  display: grid;
  place-items: center;
  box-shadow: inset 0 0 0 1px rgba(154, 140, 224, 0.26);
}

.qc-tabs {
  display: flex;
  gap: 2px;
  padding: 0 12px 10px;
}
.qc-tab {
  flex: 1;
  height: 26px;
  border-radius: var(--r-1);
  font-size: 11px;
  color: var(--fg-3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  transition: 0.12s;
}
.qc-tab:hover { color: var(--fg-0); background: var(--bg-3); }
.qc-tab.on { color: var(--fg-0); background: var(--bg-4); }
.qc-tab-n { font-family: var(--font-mono); font-size: 9.5px; opacity: 0.6; }

.qc-list {
  flex: 1;
  min-height: 0;
  border-top: 1px solid var(--line-1);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.qc-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px 11px;
  border-radius: var(--r-1);
  border: 1px solid transparent;
  text-align: left;
  transition: 0.12s;
}
.qc-item:hover { background: var(--bg-2); }
.qc-item.on {
  background: var(--bg-3);
  border-color: var(--line-2);
}
.qc-item-title {
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.4;
  color: var(--fg-0);
}
.qc-item-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  color: var(--fg-3);
}
.avatar.xs { width: 16px; height: 16px; font-size: 7px; }
.rework-tag { background: var(--red-soft); color: #f08b91; }
.qc-item-check {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
}
.qc-item-check.ok { color: var(--green); }
.qc-item-check.bad { color: var(--red); }

.qc-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-0);
}
.qc-empty-art {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--bg-2);
  border: 1px solid var(--line-2);
  color: var(--fg-3);
  margin-bottom: 6px;
}

.qc-detail-head {
  height: 60px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 20px;
  border-bottom: 1px solid var(--line-1);
  background: var(--bg-1);
}
.qc-detail-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px 20px 40px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 1080px;
  width: 100%;
}

.qc-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.qc-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  background: var(--bg-1);
  border: 1px solid var(--line-1);
  border-radius: var(--r-1);
}
.qc-card-k {
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-4);
}
.qc-card-v { font-size: 13px; font-weight: 500; color: var(--fg-0); }

.qc-preview {
  border: 1px solid var(--line-1);
  border-radius: var(--r-2);
  overflow: hidden;
  background: var(--bg-1);
}
.qc-preview-head {
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 13px;
  border-bottom: 1px solid var(--line-1);
}
.qc-canvas-wrap {
  height: 340px;
  position: relative;
  background: radial-gradient(100% 100% at 50% 0%, #131720, #08090c);
}
.qc-canvas {
  width: 100%;
  height: 100%;
  display: block;
}
.preview-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(8, 9, 12, 0.8);
  color: var(--fg-3);
  font-size: 11px;
}
.preview-mask.error { color: var(--red); }

.qc-panel {
  border: 1px solid var(--line-1);
  border-radius: var(--r-2);
  background: var(--bg-1);
  overflow: hidden;
}
.qc-panel-head {
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  border-bottom: 1px solid var(--line-1);
}

.qc-verdict {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 14px;
  padding: 14px 16px;
  border-radius: var(--r-2);
}
.qc-verdict.ok {
  background: linear-gradient(100deg, rgba(79, 195, 173, 0.13), rgba(79, 195, 173, 0.05));
  border: 1px solid rgba(79, 195, 173, 0.26);
  color: #8fe7d5;
}
.qc-verdict.bad {
  background: linear-gradient(100deg, rgba(229, 98, 106, 0.13), rgba(229, 98, 106, 0.04));
  border: 1px solid rgba(229, 98, 106, 0.28);
  color: #f19aa0;
}

.qc-issue-table {
  padding: 0 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.qc-issue-row {
  display: flex;
  align-items: baseline;
  gap: 9px;
  padding: 8px 10px;
  background: var(--bg-2);
  border-radius: var(--r-1);
  border-left: 2px solid var(--fg-4);
}
.qc-issue-row.error { border-left-color: var(--red); }
.qc-issue-row.warn { border-left-color: var(--amber); }
.qc-issue-row.info { border-left-color: var(--fg-4); }
.qc-issue-sev {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 1px 5px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--fg-3);
  flex-shrink: 0;
}
.qc-issue-row.error .qc-issue-sev { background: var(--red-soft); color: var(--red); }
.qc-issue-row.warn .qc-issue-sev { background: var(--amber-soft); color: var(--amber); }
.qc-issue-sev.ok { background: var(--green-soft); color: var(--green); }

.qc-locate { padding: 0 14px 14px; }
.locate-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.locate-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 9px;
  border-radius: 12px;
  font-size: 10.5px;
  border: 1px solid transparent;
  transition: 0.12s;
}
.locate-chip.error { background: var(--red-soft); color: #f19aa0; }
.locate-chip.warn { background: var(--amber-soft); color: var(--amber); }
.locate-chip:hover { filter: brightness(1.2); }
.loc-dot { width: 4px; height: 4px; border-radius: 50%; background: currentColor; }

.checklist {
  display: flex;
  flex-direction: column;
}

.inspect-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: var(--line-1);
  border-bottom: 1px solid var(--line-1);
}
.inspect-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 13px;
  background: var(--bg-1);
}
.ins-k {
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-4);
}
.ins-v { font-size: 13px; font-weight: 600; color: var(--fg-0); }
.ins-d { font-size: 10px; color: var(--fg-3); line-height: 1.45; }

.req-compare { padding: 12px 14px; }
.req-cmp-row {
  display: flex;
  gap: 10px;
  font-size: 11.5px;
  padding: 3px 0;
  align-items: baseline;
}
.req-cmp-k { color: var(--fg-3); min-width: 82px; flex-shrink: 0; }
.req-cmp-v { color: var(--fg-1); font-family: var(--font-mono); font-size: 11px; }
.check-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--line-1);
  cursor: pointer;
}
.check-row:last-child { border-bottom: none; }
.check-row:hover { background: rgba(255, 255, 255, 0.02); }

.qc-notes {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.qc-note {
  padding: 9px 11px;
  border-radius: var(--r-1);
  background: var(--bg-2);
  border-left: 2px solid var(--red);
}
.qc-note.pass { border-left-color: var(--green); }
.qc-note-text {
  margin-top: 4px;
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--fg-2);
  padding-left: 18px;
}

.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 1150px) {
  .qc-cards { grid-template-columns: repeat(2, 1fr); }
  .qc-side { width: 250px; }
}
</style>
