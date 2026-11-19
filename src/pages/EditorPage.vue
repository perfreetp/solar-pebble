<template>
  <div class="editor-grid">
    <div class="col-main">
      <div class="panel title-bar">
        <input v-model="store.project.title" class="title-input" @change="store.persist()" />
        <span class="muted small">工程 {{ store.project.id }} · {{ store.project.width }}×{{ store.project.height }}</span>
      </div>
      <CanvasStage ref="stageRef" />
      <Timeline @open-curve="openCurve" />
    </div>
    <div class="col-side">
      <RigPanel v-if="store.mode === 'rig'" />
      <PosePanel v-else />
      <PresetPanel />
      <ExportPanel />
    </div>
    <CurveEditor ref="curveRef" />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import CanvasStage from '../components/CanvasStage.vue'
import Timeline from '../components/Timeline.vue'
import RigPanel from '../components/RigPanel.vue'
import PosePanel from '../components/PosePanel.vue'
import PresetPanel from '../components/PresetPanel.vue'
import ExportPanel from '../components/ExportPanel.vue'
import CurveEditor from '../components/CurveEditor.vue'
import { useEditorStore } from '../stores/editor.js'

const store = useEditorStore()
const curveRef = ref(null)
function openCurve(seg) {
  curveRef.value.open(seg)
}
</script>

<style scoped>
.editor-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 14px;
  align-items: start;
}
.col-main { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.col-side { display: flex; flex-direction: column; gap: 14px; }
.title-bar { display: flex; align-items: center; gap: 14px; padding: 10px 14px; }
.title-input { font-size: 16px; font-weight: 700; border: 1px solid transparent; background: transparent; max-width: 340px; }
.title-input:hover, .title-input:focus { border-color: var(--line); background: #fff; }
.small { font-size: 12px; }
@media (max-width: 1180px) {
  .editor-grid { grid-template-columns: 1fr; }
}
</style>
