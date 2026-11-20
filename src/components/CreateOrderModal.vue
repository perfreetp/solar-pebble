<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal wide">
      <div class="modal-head">
        <div>
          <h3 class="fs-16 w-600">接单 · 录入建模要求</h3>
          <p class="fs-11 t-fg3" style="margin-top: 3px">
            录入得越具体，建模师傅返工越少。需求项会在建模台侧栏常驻显示。
          </p>
        </div>
        <button class="btn btn-ghost btn-icon" @click="$emit('close')"><X :size="15" /></button>
      </div>

      <div class="modal-body">
        <div class="form-grid">
          <div class="field span-2">
            <label>工单标题 *</label>
            <input v-model="form.title" class="input" placeholder="例：静海 3 号坑 · 主舱段与竖井接口" />
          </div>

          <div class="field">
            <label>委托方</label>
            <input v-model="form.client" class="input" placeholder="例：深空栖息地总体组" />
          </div>

          <div class="field">
            <label>优先级</label>
            <div class="segmented" style="width: 100%">
              <button
                v-for="(label, key) in appState.priorities"
                :key="key"
                :class="{ on: form.priority === key }"
                style="flex: 1; justify-content: center"
                @click="form.priority = key"
              >{{ label }}</button>
            </div>
          </div>

          <div class="field">
            <label>交期</label>
            <input v-model="form.dueAt" type="datetime-local" class="input input-mono" />
          </div>

          <div class="field">
            <label>分派建模师傅（可稍后分派）</label>
            <select v-model="form.assignee" class="select">
              <option value="">暂不分派</option>
              <option v-for="m in modelers" :key="m.id" :value="m.id">
                {{ m.name }} · {{ m.title }}
              </option>
            </select>
          </div>

          <div class="field span-2">
            <label>尺寸与场地设定</label>
            <div class="grid-settings">
              <div class="gs-item">
                <span class="gs-k">体素网格</span>
                <div class="row g4">
                  <input v-model.number="form.sizeX" class="input input-mono gs-num" type="number" min="16" max="256" />
                  <span class="t-fg4">×</span>
                  <input v-model.number="form.sizeY" class="input input-mono gs-num" type="number" min="16" max="256" />
                  <span class="t-fg4">×</span>
                  <input v-model.number="form.sizeZ" class="input input-mono gs-num" type="number" min="8" max="256" />
                  <span class="fs-11 t-fg3" style="margin-left: 4px">格</span>
                </div>
              </div>
              <div class="gs-item">
                <span class="gs-k">体素边长</span>
                <div class="row g6">
                  <input v-model.number="form.voxelSize" class="input input-mono gs-num" type="number" min="0.1" max="4" step="0.1" />
                  <span class="fs-11 t-fg3">米 / 格</span>
                </div>
              </div>
              <div class="gs-item gs-result">
                <span class="gs-k">实际尺寸</span>
                <span class="num fs-13" style="color: var(--lunar)">
                  {{ dims.width }} × {{ dims.depth }} × {{ dims.height }} m
                </span>
              </div>
            </div>
          </div>

          <div class="field span-2">
            <div class="row between" style="margin-bottom: 5px">
              <label style="margin: 0">功能与尺度要求</label>
              <div class="row g4">
                <button class="btn btn-ghost btn-sm" @click="addPreset('habitat')">
                  <Sparkles :size="11" /> 舱段模板
                </button>
                <button class="btn btn-ghost btn-sm" @click="addPreset('cave')">
                  <Mountain :size="11" /> 洞体模板
                </button>
              </div>
            </div>
            <div class="req-editor">
              <div v-for="(r, i) in form.requirements" :key="i" class="req-row">
                <input v-model="r.k" class="input req-k" placeholder="要求项，如 主舱直径" />
                <input v-model="r.v" class="input req-v" placeholder="数值或说明，如 12 m 分 3 层" />
                <button class="btn btn-ghost btn-icon" @click="form.requirements.splice(i, 1)">
                  <X :size="12" />
                </button>
              </div>
              <button class="add-req" @click="addReq">
                <Plus :size="12" /> 增加一条要求
              </button>
            </div>
          </div>

          <div class="field span-2">
            <label>设计说明 / 重点提示</label>
            <textarea
              v-model="form.brief"
              class="textarea"
              rows="4"
              placeholder="例：气闸必须与竖井中心线对齐，观测舷窗沿熔岩管轴线布置，内壁衬里不得与舱壁穿模。"
            ></textarea>
          </div>
        </div>

        <div v-if="error" class="form-error">
          <AlertTriangle :size="13" /> {{ error }}
        </div>
      </div>

      <div class="modal-foot">
        <span class="fs-11 t-fg3 grow">
          接单后进入 <b class="t-fg2">待开工</b>，师傅在建模台点“开始建模”后状态转为建模中。
        </span>
        <button class="btn" @click="$emit('close')">取消</button>
        <button class="btn btn-primary" :disabled="submitting || !form.title.trim()" @click="submit">
          <Loader v-if="submitting" :size="13" class="spin" />
          <Check v-else :size="13" />
          {{ submitting ? '提交中…' : '接单并创建' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { X, Plus, Check, Loader, AlertTriangle, Sparkles, Mountain } from 'lucide-vue-next';
import { appState, apiClient, toast } from '../state.js';

const emit = defineEmits(['close', 'created']);

const form = reactive({
  title: '',
  client: '',
  priority: 'normal',
  dueAt: defaultDue(),
  assignee: '',
  sizeX: 144,
  sizeY: 144,
  sizeZ: 96,
  voxelSize: 0.5,
  requirements: [
    { k: '洞段长度', v: '' },
    { k: '主舱直径', v: '' },
  ],
  brief: '',
});

const submitting = ref(false);
const error = ref('');

const modelers = computed(() => appState.members.filter((m) => m.role === 'modeler'));

const dims = computed(() => ({
  width: +(form.sizeX * form.voxelSize).toFixed(1),
  depth: +(form.sizeY * form.voxelSize).toFixed(1),
  height: +(form.sizeZ * form.voxelSize).toFixed(1),
}));

function defaultDue() {
  const d = new Date(Date.now() + 72 * 3600_000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function addReq() {
  form.requirements.push({ k: '', v: '' });
}

const PRESETS = {
  habitat: [
    { k: '主舱直径', v: '12 m，分 3 层' },
    { k: '可容纳人数', v: '24 人 · 90 天' },
    { k: '气闸', v: '与竖井中心线对齐' },
    { k: '舷窗', v: '沿熔岩管轴线布置观测带' },
  ],
  cave: [
    { k: '洞体跨度', v: '22–26 m' },
    { k: '洞段长度', v: '≥ 180 m' },
    { k: '管顶覆盖', v: '保留 ≥ 3 格' },
    { k: '地面', v: '平整 3 段平台' },
  ],
};

function addPreset(kind) {
  const existing = new Set(form.requirements.map((r) => r.k));
  for (const p of PRESETS[kind]) {
    if (!existing.has(p.k)) form.requirements.push({ ...p });
  }
}

async function submit() {
  if (!form.title.trim()) {
    error.value = '请填写工单标题';
    return;
  }
  submitting.value = true;
  error.value = '';
  try {
    const payload = {
      title: form.title.trim(),
      client: form.client.trim() || '未指定委托方',
      priority: form.priority,
      dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null,
      assignee: form.assignee || null,
      requirements: form.requirements.filter((r) => r.k.trim() && r.v.trim()).map((r) => ({ k: r.k.trim(), v: r.v.trim() })),
      brief: form.brief.trim(),
      grid: {
        sizeX: clamp(form.sizeX, 16, 256),
        sizeY: clamp(form.sizeY, 16, 256),
        sizeZ: clamp(form.sizeZ, 8, 256),
        voxelSize: clamp(form.voxelSize, 0.1, 4),
      },
    };
    const order = await apiClient.createOrder(payload);
    toast(`已创建 ${order.code}`, 'ok');
    emit('created', order);
  } catch (err) {
    error.value = err.message;
  } finally {
    submitting.value = false;
  }
}

function clamp(v, lo, hi) {
  const n = Number(v) || lo;
  return Math.max(lo, Math.min(hi, n));
}
</script>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.span-2 { grid-column: span 2; }

.grid-settings {
  display: grid;
  grid-template-columns: 1.5fr 1fr 1.2fr;
  gap: 10px;
  padding: 12px;
  background: var(--bg-1);
  border: 1px solid var(--line-1);
  border-radius: var(--r-2);
}
.gs-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.gs-k {
  font-size: 10px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--fg-3);
  font-weight: 600;
}
.gs-num {
  width: 64px;
  height: 28px;
  padding: 0 6px;
  text-align: center;
  font-size: 12px;
}
.gs-result {
  justify-content: flex-end;
}

.req-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.req-row {
  display: grid;
  grid-template-columns: 140px 1fr 28px;
  gap: 6px;
  align-items: center;
}
.req-k { height: 28px; font-size: 12px; }
.req-v { height: 28px; font-size: 12px; }
.add-req {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  align-self: flex-start;
  height: 26px;
  padding: 0 8px;
  margin-top: 2px;
  border-radius: var(--r-1);
  font-size: 11.5px;
  color: var(--fg-3);
  border: 1px dashed var(--line-2);
}
.add-req:hover { color: var(--lunar); border-color: rgba(226, 160, 77, 0.4); }

.form-error {
  margin-top: 14px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 12px;
  border-radius: var(--r-1);
  background: var(--red-soft);
  border: 1px solid rgba(229, 98, 106, 0.3);
  color: #f19aa0;
  font-size: 12px;
}

.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 720px) {
  .form-grid { grid-template-columns: 1fr; }
  .span-2 { grid-column: span 1; }
  .grid-settings { grid-template-columns: 1fr; }
}
</style>
