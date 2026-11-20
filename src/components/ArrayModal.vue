<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal narrow">
      <div class="modal-head">
        <div>
          <h3 class="fs-16 w-600">阵列复制</h3>
          <p class="fs-11 t-fg3" style="margin-top: 3px">
            把选区沿一个轴向等距复制多份，用于连廊、重复舱段、照明带这类重复结构。
          </p>
        </div>
        <button class="btn btn-ghost btn-icon" @click="$emit('close')"><X :size="15" /></button>
      </div>
      <div class="modal-body">
        <div class="field" style="margin-bottom: 14px">
          <label>复制来源</label>
          <div class="segmented" style="width: 100%">
            <button
              :class="{ on: source === 'selection' }"
              style="flex: 1; justify-content: center"
              :disabled="!selection.active"
              @click="source = 'selection'"
            >
              当前选区{{ selection.active ? `（${selection.count} 格）` : '（未选）' }}
            </button>
            <button
              :class="{ on: source === 'clipboard' }"
              style="flex: 1; justify-content: center"
              :disabled="!clipboard"
              @click="source = 'clipboard'"
            >
              剪贴板{{ clipboard ? `（${clipboard.count} 格）` : '（空）' }}
            </button>
          </div>
        </div>

        <div class="field" style="margin-bottom: 14px">
          <label>阵列方向</label>
          <div class="axis-row">
            <button
              v-for="a in axes"
              :key="a.key"
              class="axis-btn"
              :class="{ on: axis === a.key }"
              @click="axis = a.key"
            >
              <span class="axis-g">{{ a.glyph }}</span>
              <span>{{ a.label }}</span>
            </button>
          </div>
        </div>

        <div class="two-col">
          <div class="field">
            <label>复制份数</label>
            <input v-model.number="count" class="input input-mono" type="number" min="1" max="64" />
          </div>
          <div class="field">
            <label>间距（格）</label>
            <input v-model.number="spacing" class="input input-mono" type="number" min="1" max="256" />
          </div>
        </div>

        <div class="preview">
          <span class="fs-11 t-fg3">预计新增</span>
          <span class="num fs-18" style="color: var(--lunar)">{{ estimate.toLocaleString('zh-CN') }}</span>
          <span class="fs-11 t-fg3">格</span>
          <span class="grow"></span>
          <span class="fs-10 t-fg4">超出网格范围的部分会被裁掉</span>
        </div>

        <div class="tip-row">
          <span class="kbd">↑</span>
          <span class="fs-10 t-fg3">按整份尺寸排布可以无缝拼接；间距大于等于选区厚度时不会重叠</span>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" @click="$emit('close')">取消</button>
        <button
          class="btn btn-primary"
          :disabled="!canRun"
          @click="$emit('confirm', { source, axis, count, spacing })"
        >
          <Rows3 :size="13" /> 生成阵列
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { X, Rows3 } from 'lucide-vue-next';

const props = defineProps({
  selection: { type: Object, default: () => ({ active: false, count: 0 }) },
  clipboard: { type: Object, default: null },
});
const emit = defineEmits(['close', 'confirm']);

const axes = [
  { key: 'x', label: 'X 向', glyph: '→' },
  { key: 'y', label: 'Y 向', glyph: '↑' },
  { key: 'z', label: 'Z 向（层）', glyph: '⤒' },
];

const source = ref(props.clipboard ? 'clipboard' : 'selection');
const axis = ref('x');
const count = ref(3);
const spacing = ref(1);

const canRun = computed(() => {
  if (source.value === 'selection' && !props.selection.active) return false;
  if (source.value === 'clipboard' && !props.clipboard) return false;
  return count.value >= 1;
});

const estimate = computed(() => {
  const cells = source.value === 'clipboard' ? props.clipboard?.count || 0 : props.selection.count || 0;
  return cells * count.value;
});
</script>

<style scoped>
.axis-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.axis-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 38px;
  border-radius: var(--r-1);
  border: 1px solid var(--line-2);
  background: var(--bg-2);
  font-size: 11.5px;
  color: var(--fg-2);
  transition: 0.12s;
}
.axis-btn:hover { border-color: var(--line-3); color: var(--fg-0); }
.axis-btn.on {
  background: var(--lunar-soft);
  border-color: rgba(226, 160, 77, 0.4);
  color: var(--lunar);
}
.axis-g {
  font-family: var(--font-mono);
  font-size: 14px;
  line-height: 1;
}
.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 14px;
}
.preview {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 11px 13px;
  border-radius: var(--r-1);
  background: var(--bg-1);
  border: 1px dashed var(--line-2);
}
.tip-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
}
</style>
