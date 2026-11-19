<template>
  <div class="panel">
    <div class="panel-title">绑骨与层级</div>
    <div class="panel-body">
      <label class="field">
        <span>导入分层部件图（文件名含 头/躯干/上臂/前臂/手/枪，L/R 区分左右）</span>
        <input type="file" accept="image/*" multiple @change="onImport" />
      </label>
      <div v-if="store.importLog.length" class="import-log">
        <div v-for="(l, i) in store.importLog" :key="i" class="muted">· {{ l }}</div>
      </div>

      <label class="field">
        <span>部件骨骼（点击选中）</span>
        <select :value="store.selectedKey" @change="store.selectBone($event.target.value)" size="9" class="bone-select">
          <option v-for="b in boneList" :key="b.key" :value="b.key">
            {{ b.label }}　{{ b.parent ? '↳ ' + store.bones[b.parent].label : '（根）' }}
            <template v-if="store.violationSet.has(b.key)"> ⚠超限</template>
          </option>
        </select>
      </label>

      <template v-if="bone">
        <label class="field">
          <span>父节点（可重挂，防止成环）</span>
          <select :value="bone.parent ?? ''" @change="onReparent($event.target.value)">
            <option value="">（设为根节点）</option>
            <option v-for="b in reparentCandidates" :key="b.key" :value="b.key">{{ b.label }}</option>
          </select>
        </label>

        <div class="grid2">
          <label class="field"><span>锚点 X</span>
            <input type="number" :value="bone.anchor.x" @input="store.moveAnchor(bone.key, +$event.target.value, bone.anchor.y)" />
          </label>
          <label class="field"><span>锚点 Y</span>
            <input type="number" :value="bone.anchor.y" @input="store.moveAnchor(bone.key, bone.anchor.x, +$event.target.value)" />
          </label>
          <label class="field"><span>图片偏移 X</span>
            <input type="number" :value="bone.offset.x" @input="setOffset('x', +$event.target.value)" />
          </label>
          <label class="field"><span>图片偏移 Y</span>
            <input type="number" :value="bone.offset.y" @input="setOffset('y', +$event.target.value)" />
          </label>
        </div>

        <label class="field">
          <span>关节活动范围（度）— {{ bone.range.label }}</span>
          <div class="row">
            <input type="number" :value="bone.range.min" @input="store.setRange(bone.key, +$event.target.value, bone.range.max)" />
            <span class="muted">至</span>
            <input type="number" :value="bone.range.max" @input="store.setRange(bone.key, bone.range.min, +$event.target.value)" />
          </div>
        </label>

        <label class="field">
          <span>单独替换该部件图片</span>
          <input type="file" accept="image/*" @change="onReplace($event)" />
        </label>
        <label class="field">
          <span>部件美术朝向角 bias（度，素材朝向与骨骼 0° 方向不一致时调整）</span>
          <input type="number" step="1" :value="store.parts[bone.key]?.bias ?? 0"
                 @input="store.setPartBias(bone.key, +$event.target.value)" />
        </label>
        <div class="muted small">当前素材：{{ store.parts[bone.key]?.src || '无' }}（{{ store.parts[bone.key]?.w }}×{{ store.parts[bone.key]?.h }}）</div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useEditorStore } from '../stores/editor.js'

const store = useEditorStore()
const bone = computed(() => store.selectedBone)
const boneList = computed(() => Object.values(store.bones))
const reparentCandidates = computed(() =>
  boneList.value.filter((b) => b.key !== bone.value.key && !isDescendant(b.key, b.key))
)

function isDescendant(rootKey, candidateKey) {
  // candidate 是否在 rootKey 的子树中
  const walk = (k) => {
    for (const b of boneList.value) {
      if (b.parent === k) {
        if (b.key === candidateKey) return true
        if (walk(b.key)) return true
      }
    }
    return false
  }
  return walk(rootKey)
}

function onReparent(v) {
  const ok = store.reparentBone(bone.value.key, v || null)
  if (!ok) alert('重挂失败：不能挂到自己的子节点下（会形成环）')
  store.persist()
}
function setOffset(axis, v) {
  const b = bone.value
  b.offset[axis] = v
  store.persist()
}
async function onImport(e) {
  const files = [...e.target.files]
  if (files.length) await store.importFiles(files)
  e.target.value = ''
}
async function onReplace(e) {
  const f = e.target.files[0]
  if (f) await store.assignPart(bone.value.key, f)
  e.target.value = ''
}
</script>

<style scoped>
.bone-select { width: 100%; font-family: inherit; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.import-log {
  background: #f8fafc; border: 1px solid var(--line); border-radius: 7px;
  padding: 8px; margin-bottom: 12px; font-size: 12px; max-height: 90px; overflow: auto;
}
.small { font-size: 12px; }
</style>
