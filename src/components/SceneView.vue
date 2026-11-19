<template>
  <div ref="el" class="scene-host" @dragover.prevent @drop="onDrop"></div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { IsoScene } from '../iso/IsoScene'
import { store, actions } from '../store'

const el = ref(null)
let scene = null

function onKey(e) {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return
  if (e.key === 'q' || e.key === 'Q') actions.rotateSelected(-1)
  else if (e.key === 'e' || e.key === 'E') actions.rotateSelected(1)
  else if ((e.key === 'Delete' || e.key === 'Backspace') && store.selectedId) {
    actions.removeDevice(store.selectedId)
  } else if (e.key === 'f' || e.key === 'F') scene?.fitView()
}

function onDrop(e) {
  const type = e.dataTransfer.getData('text/devtype')
  if (!type || !scene) return
  const r = el.value.getBoundingClientRect()
  scene.dropDevice(type, e.clientX - r.left, e.clientY - r.top)
}

onMounted(() => {
  scene = new IsoScene(el.value)
  window.__scene = scene
  watch(() => store.renderTick, () => scene.renderAll())
  watch(() => store.view, () => scene.renderAll())
  watch(() => store.locateTick, () => { if (store.locateId) scene.locateDevice(store.locateId) })
  watch(() => store.basemap, () => scene.renderAll())
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  scene?.destroy()
})

defineExpose({ exportImage: () => scene?.exportImage(), fitView: () => scene?.fitView() })
</script>

<style scoped>
.scene-host { width: 100%; height: 100%; overflow: hidden; position: relative; }
</style>
