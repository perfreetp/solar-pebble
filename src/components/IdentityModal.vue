<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal narrow">
      <div class="modal-head">
        <div>
          <h3 class="fs-16 w-600">切换当前操作人</h3>
          <p class="fs-11 t-fg3" style="margin-top: 3px">车间共用终端：选择你这次坐班对应的人。</p>
        </div>
        <button class="btn-icon btn btn-ghost" @click="$emit('close')"><X :size="15" /></button>
      </div>
      <div class="modal-body" style="padding: 10px">
        <button
          v-for="m in members"
          :key="m.id"
          class="member-row"
          :class="{ on: m.id === appState.me?.id }"
          @click="pick(m)"
        >
          <span class="avatar" :style="avatarStyle(m)">{{ m.avatar }}</span>
          <span class="grow col" style="align-items: flex-start">
            <span class="fs-13 w-600">{{ m.name }}</span>
            <span class="fs-11 t-fg3">{{ m.title }}</span>
          </span>
          <Check v-if="m.id === appState.me?.id" :size="14" class="t-lunar" />
        </button>
      </div>
      <div class="modal-foot">
        <span class="fs-11 t-fg3 grow">身份会记在本机浏览器里，随时可切换。</span>
        <button class="btn" @click="$emit('close')">关闭</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { Check, X } from 'lucide-vue-next';
import { appState, avatarStyle, switchMember, toast } from '../state.js';

const emit = defineEmits(['close']);
const members = computed(() => appState.members);

function pick(m) {
  switchMember(m.id);
  toast(`已切换为 ${m.name} · ${m.title}`, 'ok', 2200);
  emit('close');
}
</script>

<style scoped>
.member-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border-radius: var(--r-1);
  text-align: left;
  transition: 0.12s;
}
.member-row:hover {
  background: var(--bg-3);
}
.member-row.on {
  background: rgba(226, 160, 77, 0.08);
  box-shadow: inset 0 0 0 1px rgba(226, 160, 77, 0.22);
}
</style>
