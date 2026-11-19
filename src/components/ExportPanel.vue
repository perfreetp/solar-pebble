<template>
  <div class="panel">
    <div class="panel-title">导出课件素材</div>
    <div class="panel-body">
      <p class="muted small">
        将逐帧离屏渲染为 PNG 序列帧，并与完整关键帧数据一起打包为 ZIP；JSON 可重新导入恢复工程。
      </p>
      <div class="row" style="flex-wrap:wrap; gap:8px">
        <button class="primary" :disabled="busy || !store.keyframeList.length" @click="doExportZip">
          导出 PNG 序列帧 + JSON（ZIP）
        </button>
        <button :disabled="busy" @click="doExportJSON">仅导出关键帧 JSON</button>
        <button @click="saveProject">保存工程到本地</button>
        <button @click="loadProject">导入工程 JSON</button>
      </div>
      <div v-if="busy || progress" class="progress">
        <div class="bar" :style="{ width: progress + '%' }"></div>
        <span>{{ busy ? `离屏渲染中 ${progress}%` : `上次导出完成（${progress}%）` }}</span>
      </div>
      <input ref="fileRef" type="file" accept="application/json" hidden @change="onLoad" />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useEditorStore } from '../stores/editor.js'
import { exportSequence, exportJSONOnly, downloadBlob } from '../engine/export.js'

const store = useEditorStore()
const busy = ref(false)
const progress = ref(0)
const fileRef = ref(null)

async function doExportZip() {
  busy.value = true
  progress.value = 0
  try {
    const { blob, count } = await exportSequence(
      { ...store.project, bones: store.bones, parts: store.parts, timeline: store.timeline },
      { onProgress: (p) => { progress.value = p } }
    )
    downloadBlob(blob, `${store.project.title || 'pose'}_png序列帧.zip`)
    alert(`已导出 ${count} 帧 PNG 与 keyframes.json`)
  } catch (err) {
    alert('导出失败：' + err.message)
  } finally {
    busy.value = false
  }
}
function doExportJSON() {
  const blob = exportJSONOnly({ ...store.project, bones: store.bones, parts: store.parts, timeline: store.timeline })
  downloadBlob(blob, `${store.project.title || 'pose'}_keyframes.json`)
}
function saveProject() {
  store.persist()
  // 显式下载一份工程 JSON（无图片数据，仅骨架/时间轴）
  const dump = {
    format: 'shooting-pose-editor',
    version: 1,
    project: { id: store.project.id, title: store.project.title, width: store.project.width, height: store.project.height },
    skeleton: store.bones,
    timeline: store.timeline
  }
  downloadBlob(new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' }), '工程备份.json')
}
function loadProject() { fileRef.value.click() }
function onLoad(e) {
  const f = e.target.files[0]
  if (!f) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result)
      if (data.skeleton) store.project.bones = data.skeleton
      if (data.timeline) store.project.timeline = data.timeline
      if (data.project?.title) store.project.title = data.project.title
      store.seekFrame(0)
      store.persist()
      alert('工程已载入（部件图需重新导入，当前使用内置占位部件）')
    } catch {
      alert('JSON 解析失败')
    }
  }
  reader.readAsText(f)
  e.target.value = ''
}
</script>

<style scoped>
.progress { margin-top: 12px; position: relative; height: 26px; background: #eef1f6; border-radius: 7px; overflow: hidden; }
.progress .bar { position: absolute; inset: 0 auto 0 0; background: linear-gradient(90deg, #3b82f6, #2563eb); transition: width .15s; }
.progress span { position: relative; line-height: 26px; padding-left: 10px; font-size: 12px; font-weight: 600; color: #1e3a8a; }
.small { font-size: 12px; }
</style>
