<template>
  <div class="panel">
    <div class="panel-title">姿势数值微调</div>
    <div class="panel-body">
      <div class="fine-card">
        <label class="field">
          <span>躯干前倾角度（度，正=前倾，范围 {{ r('torso') }}）</span>
          <div class="num-input">
            <input type="range" min="-30" max="45" step="0.5" :value="store.torsoLean" @input="store.setTorsoLean(+$event.target.value)" />
            <input type="number" step="0.5" :value="store.torsoLean.toFixed(1)" @input="store.setTorsoLean(+$event.target.value)" />
          </div>
        </label>

        <label class="field">
          <span>持枪臂（右上臂）抬起到位（度，范围 {{ r('R.upperArm') }}）</span>
          <div class="num-input">
            <input type="range" min="-170" max="160" step="0.5" :value="store.armRaise" @input="store.setArmRaise(+$event.target.value)" />
            <input type="number" step="0.5" :value="store.armRaise.toFixed(1)" @input="store.setArmRaise(+$event.target.value)" />
          </div>
        </label>

        <label class="field">
          <span>呼吸起伏幅度（像素）</span>
          <div class="num-input">
            <input type="range" min="0" max="20" step="0.5" :value="store.breathAmp" @input="store.setBreathAmp(+$event.target.value)" />
            <input type="number" min="0" max="20" step="0.5" :value="store.breathAmp" @input="store.setBreathAmp(+$event.target.value)" />
          </div>
        </label>
      </div>

      <template v-if="bone">
        <div class="divider"></div>
        <label class="field">
          <span>{{ bone.label }} 局部旋转（度，范围 {{ bone.range.min }}~{{ bone.range.max }}）</span>
          <div class="num-input">
            <input type="range" :min="bone.range.min - 30" :max="bone.range.max + 30" step="0.5"
                   :value="curRot" @input="store.setBoneRot(bone.key, +$event.target.value)" />
            <input type="number" step="0.5" :value="curRot.toFixed(1)" @input="store.setBoneRot(bone.key, +$event.target.value)" />
          </div>
        </label>
        <div v-if="store.violationSet.has(bone.key)" class="vio-warn">
          ⚠ 已超出「{{ bone.range.label }}」活动范围，画布中该部件已标红
        </div>
      </template>

      <div class="divider"></div>
      <div class="row" style="flex-wrap:wrap">
        <button class="primary" @click="store.addKeyHere">◆ 打关键帧（{{ Math.round(store.currentFrame) }}F）</button>
        <button :disabled="!store.onKeyframe" class="danger" @click="store.removeKeyHere">删除本帧</button>
      </div>
      <p class="muted small" style="margin-top:8px">
        24fps 时间轴；姿态修改落在关键帧上时自动写入，落在过渡段时请先打关键帧。
      </p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useEditorStore } from '../stores/editor.js'
const store = useEditorStore()
const bone = computed(() => store.selectedBone)
const curRot = computed(() => store.pose[bone.value?.key]?.rot ?? 0)
function r(key) {
  const b = store.bones[key]
  return `${b.range.min}°~${b.range.max}°`
}
</script>

<style scoped>
.fine-card { background: #f8fafc; border: 1px solid var(--line); border-radius: 8px; padding: 10px; }
.divider { height: 1px; background: var(--line); margin: 12px 0; }
.vio-warn { background: var(--red-soft); color: var(--red); border-radius: 7px; padding: 7px 9px; font-size: 12.5px; font-weight: 600; }
.small { font-size: 12px; }
.num-input input[type="range"] { flex: 1; }
.num-input input[type="number"] { width: 78px; flex: none; }
</style>
