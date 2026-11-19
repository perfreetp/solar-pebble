<template>
  <div class="review">
    <div class="banner" :class="store.plan.status">{{ statusText }}</div>

    <!-- 运维视角:退回条目定位 -->
    <template v-if="store.role === 'editor'">
      <template v-if="rejected.length">
        <div class="sec-title">退回条目(点击定位到设备)</div>
        <div v-for="d in rejected" :key="d.id" class="item rejected" @click="actions.locate(d.id)">
          <b>{{ d.name }}</b>
          <span class="loc">📍 ({{ d.x.toFixed(1) }}, {{ d.y.toFixed(1) }}, {{ d.z.toFixed(1) }})</span>
          <div class="comment">站长意见:{{ d.review.comment || '未填写' }}</div>
        </div>
      </template>
      <div v-else class="dim pad">
        {{ store.plan.status === 'pending' ? '方案已提交,等待站长审核。' : store.plan.status === 'approved' ? '方案已通过审核。' : '暂无退回条目。' }}
      </div>
    </template>

    <!-- 站长视角:逐条审核 -->
    <template v-if="store.role === 'chief'">
      <template v-if="store.plan.status === 'pending'">
        <div class="sec-title">逐条审核({{ reviewedCount }}/{{ store.devices.length }})</div>
        <div v-for="d in store.devices" :key="d.id" class="item" @click="actions.locate(d.id)">
          <div class="item-head">
            <b>{{ d.name }}</b>
            <span class="loc">{{ d.surface }} · {{ d.z.toFixed(1) }}m</span>
          </div>
          <div class="item-ops" @click.stop>
            <label><input type="radio" :name="d.id" :checked="d.review?.result === 'approved'" @change="actions.setReview(d.id, 'approved')" /> 通过</label>
            <label><input type="radio" :name="d.id" :checked="d.review?.result === 'rejected'" @change="actions.setReview(d.id, 'rejected', d.review?.comment)" /> 退回</label>
            <input
              v-if="d.review?.result === 'rejected'"
              class="cmt" type="text" placeholder="退回意见"
              :value="d.review.comment"
              @input="actions.setReview(d.id, 'rejected', $event.target.value)"
            />
          </div>
        </div>
        <button class="primary finish" @click="actions.finishReview()">完成审核</button>
      </template>
      <div v-else class="dim pad">当前无待审核方案(状态:{{ statusText }})。</div>
    </template>

    <div class="sec-title">流转记录</div>
    <div v-for="(h, i) in [...store.plan.history].reverse()" :key="i" class="hist">
      <span class="dim">{{ h.time }}</span> {{ h.by }} · {{ h.action }}
      <div class="dim">{{ h.detail }}</div>
    </div>
    <div v-if="!store.plan.history.length" class="dim pad">暂无记录</div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { store, actions } from '../store'

const rejected = computed(() => store.devices.filter(d => d.review?.result === 'rejected'))
const reviewedCount = computed(() => store.devices.filter(d => d.review).length)
const statusText = computed(() => ({
  draft: '草拟中', pending: '待审核', approved: '已通过', returned: '已退回整改',
}[store.plan.status]))
</script>

<style scoped>
.review { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.banner { padding: 6px 10px; border-radius: 6px; text-align: center; font-weight: bold; background: var(--panel-2); }
.banner.pending { color: var(--orange); }
.banner.approved { color: #a5d6a7; }
.banner.returned { color: var(--red); }
.banner.draft { color: var(--accent); }
.sec-title { color: var(--fg-dim); font-size: 12px; border-bottom: 1px solid var(--border); padding-bottom: 4px; margin-top: 6px; }
.item { background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; cursor: pointer; }
.item:hover { border-color: var(--accent); }
.item.rejected { border-color: #6b4d1d; }
.item-head { display: flex; justify-content: space-between; }
.item-ops { display: flex; gap: 10px; align-items: center; margin-top: 4px; flex-wrap: wrap; }
.loc { color: var(--fg-dim); font-size: 11px; }
.comment { color: var(--orange); font-size: 12px; margin-top: 2px; }
.cmt { flex: 1; min-width: 120px; }
.finish { align-self: flex-end; }
.hist { font-size: 12px; border-left: 2px solid var(--border); padding-left: 8px; }
.dim { color: var(--fg-dim); font-size: 11px; }
.pad { padding: 8px 0; }
</style>
