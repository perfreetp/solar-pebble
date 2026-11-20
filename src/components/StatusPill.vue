<template>
  <span class="pill" :class="`pill-${tone}`">
    <i class="dot"></i>
    {{ label }}
  </span>
</template>

<script setup>
import { computed } from 'vue';
import { statusMeta } from '../state.js';

const props = defineProps({
  status: { type: String, required: true },
});

const meta = computed(() => statusMeta(props.status));
const label = computed(() => meta.value.label);
const tone = computed(() => meta.value.tone || 'neutral');
</script>
