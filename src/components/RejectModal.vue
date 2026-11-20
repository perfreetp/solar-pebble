<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-head">
        <div>
          <h3 class="fs-16 w-600">打回返工</h3>
          <p class="fs-11 t-fg3" style="margin-top: 3px">
            {{ order?.title }}
          </p>
        </div>
        <button class="btn btn-ghost btn-icon" @click="$emit('close')"><X :size="15" /></button>
      </div>

      <div class="modal-body">
        <div v-if="order" class="rework-banner">
          <span class="fs-11 t-fg3">打回后该单返工次数</span>
          <span class="rework-count num">+1</span>
          <span class="fs-11 t-fg3">→ 累计 <b class="t-red">{{ (order.reworkCount || 0) + 1 }}</b> 次</span>
        </div>

        <div class="field">
          <label>问题说明 *（师傅会在建模台看到）</label>
          <textarea
            v-model="text"
            class="textarea"
            rows="5"
            placeholder="写清楚哪里不对、期望怎么改。例：B 区连廊与主舱法兰错位 2 格，气闸框不闭合；散热板有悬空，需用桁架落到舱体上。"
          ></textarea>
        </div>

        <div class="quick-tags">
          <span class="fs-10 t-fg4">常见问题：</span>
          <button v-for="t in tags" :key="t" class="qtag" @click="appendTag(t)">{{ t }}</button>
        </div>

        <div v-if="error" class="err-row">
          <AlertTriangle :size="12" /> {{ error }}
        </div>
      </div>

      <div class="modal-foot">
        <button class="btn" @click="$emit('close')">取消</button>
        <button class="btn btn-danger" :disabled="submitting || !text.trim()" @click="submit">
          <Loader v-if="submitting" :size="13" class="spin" />
          <Undo2 v-else :size="13" />
          打回并计返工
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { X, Undo2, AlertTriangle, Loader } from 'lucide-vue-next';
import { apiClient, toast } from '../state.js';

const props = defineProps({
  order: { type: Object, required: true },
});
const emit = defineEmits(['close', 'rejected']);

const text = ref('');
const error = ref('');
const submitting = ref(false);

const tags = ['悬空体未连接', '壁厚不足', '气闸未对位', '素材混用', '尺寸不符', '破面/漏面'];

function appendTag(t) {
  text.value = text.value ? `${text.value.replace(/[；;]\s*$/, '')}；${t}` : t;
}

async function submit() {
  if (!text.value.trim()) {
    error.value = '请填写问题说明';
    return;
  }
  submitting.value = true;
  error.value = '';
  try {
    await apiClient.setStatus(props.order.id, { status: 'rejected', note: text.value.trim() });
    toast(`已打回，返工次数累计 ${(props.order.reworkCount || 0) + 1} 次`, 'warn', 3600);
    emit('rejected');
  } catch (err) {
    error.value = err.message;
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.rework-banner {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 10px 13px;
  border-radius: var(--r-1);
  background: var(--red-soft);
  border: 1px solid rgba(229, 98, 106, 0.22);
  margin-bottom: 14px;
}
.rework-count {
  font-size: 18px;
  font-weight: 700;
  color: var(--red);
}
.quick-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  margin-top: 10px;
}
.qtag {
  height: 22px;
  padding: 0 8px;
  border-radius: 11px;
  border: 1px solid var(--line-2);
  font-size: 10.5px;
  color: var(--fg-2);
  transition: 0.12s;
}
.qtag:hover { border-color: rgba(229, 98, 106, 0.4); color: #f19aa0; }
.err-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  font-size: 11.5px;
  color: var(--red);
}
.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
