<template>
  <div class="bom-mask" @click.self="$emit('close')">
    <div class="bom">
      <div class="bom-head">
        <b>支架长度清单</b>
        <span class="dim">支架长度 = 采样要求高度 − 安装面标高(最短 0.3m)</span>
        <button @click="exportCsv">导出 CSV</button>
        <button @click="$emit('close')">关闭</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>#</th><th>设备名称</th><th>类型</th><th>坐标 (X, Y)</th><th>安装面</th>
            <th>标高(m)</th><th>采样要求(m)</th><th>支架长度(m)</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(d, i) in store.devices" :key="d.id">
            <td>{{ i + 1 }}</td>
            <td>{{ d.name }}</td>
            <td>{{ store.deviceTypes[d.type]?.name }}</td>
            <td>({{ d.x.toFixed(1) }}, {{ d.y.toFixed(1) }})</td>
            <td>{{ d.surface }}</td>
            <td>{{ d.z.toFixed(1) }}</td>
            <td>{{ store.deviceTypes[d.type]?.sampleHeight.toFixed(1) }}</td>
            <td><b>{{ bracketLength(d).toFixed(1) }}</b></td>
          </tr>
          <tr v-if="!store.devices.length"><td colspan="8" class="dim">暂无设备</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { store, bracketLength, showToast } from '../store'

defineEmits(['close'])

function exportCsv() {
  const head = '序号,设备名称,类型,X(m),Y(m),安装面,标高(m),采样要求(m),支架长度(m)'
  const rows = store.devices.map((d, i) => {
    const t = store.deviceTypes[d.type]
    return [i + 1, d.name, t?.name, d.x.toFixed(1), d.y.toFixed(1), d.surface, d.z.toFixed(1), t?.sampleHeight.toFixed(1), bracketLength(d).toFixed(1)].join(',')
  })
  const csv = '﻿' + [head, ...rows].join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = `支架长度清单_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
  showToast('支架长度清单已导出')
}
</script>

<style scoped>
.bom-mask {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: center; justify-content: center; z-index: 50;
}
.bom {
  background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
  padding: 16px; max-width: 860px; max-height: 80vh; overflow: auto;
}
.bom-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.bom-head button { margin-left: auto; }
.bom-head button + button { margin-left: 0; }
.dim { color: var(--fg-dim); font-size: 11px; }
</style>
