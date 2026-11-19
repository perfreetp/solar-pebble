<template>
  <div class="lib">
    <div class="lib-title">设备库 <span class="hint">拖入场景</span></div>
    <div
      v-for="t in types"
      :key="t.key"
      class="dev-card"
      draggable="true"
      @dragstart="onDragStart($event, t.key)"
    >
      <span class="swatch" :style="{ background: t.color }"></span>
      <div class="dev-info">
        <div class="dev-name">{{ t.name }}</div>
        <div class="dev-dim">{{ t.l }}×{{ t.w }}×{{ t.h }}m · 采样高 {{ t.sampleHeight }}m</div>
        <div class="dev-allow">可装:{{ t.allowed.map(a => kindName[a]).join(' / ') }}</div>
      </div>
    </div>
    <div class="lib-tip">
      操作提示:<br />
      · 左键拖设备 / 空白处平移<br />
      · 滚轮缩放 · 双击复位视图<br />
      · 选中后拖拽 XYZ 轴手柄<br />
      · Q / E 旋转(15° 档位)<br />
      · Delete 删除选中设备
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { store, SURFACE_KIND_NAME } from '../store'

const types = computed(() => Object.values(store.deviceTypes))
const kindName = SURFACE_KIND_NAME

function onDragStart(e, key) {
  e.dataTransfer.setData('text/devtype', key)
  e.dataTransfer.effectAllowed = 'copy'
}
</script>

<style scoped>
.lib { padding: 10px; display: flex; flex-direction: column; gap: 8px; height: 100%; overflow-y: auto; }
.lib-title { font-weight: bold; color: var(--fg); display: flex; justify-content: space-between; align-items: center; }
.hint { font-size: 11px; color: var(--fg-dim); font-weight: normal; }
.dev-card {
  display: flex; gap: 8px; align-items: flex-start;
  background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px;
  padding: 8px; cursor: grab;
}
.dev-card:hover { border-color: var(--accent); }
.dev-card:active { cursor: grabbing; }
.swatch { width: 14px; height: 14px; border-radius: 3px; margin-top: 2px; flex: none; }
.dev-name { font-weight: bold; }
.dev-dim, .dev-allow { font-size: 11px; color: var(--fg-dim); }
.lib-tip {
  margin-top: auto; font-size: 11px; color: var(--fg-dim);
  border-top: 1px dashed var(--border); padding-top: 8px; line-height: 1.8;
}
</style>
