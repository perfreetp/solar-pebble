<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">◎</span>
        <span>射击姿势骨骼动画编辑器</span>
      </div>
      <nav class="nav">
        <RouterLink to="/workflow">派单流程</RouterLink>
        <RouterLink to="/editor">动画编辑器</RouterLink>
        <RouterLink to="/preview">离屏预览</RouterLink>
        <RouterLink to="/dashboard">完成看板</RouterLink>
      </nav>
      <div class="role-switch">
        <span class="role-label">当前角色</span>
        <select :value="wf.currentRole" @change="wf.switchRole($event.target.value)">
          <option v-for="r in ROLES" :key="r.id" :value="r.id">{{ r.label }}</option>
        </select>
        <span class="role-user">{{ wf.currentUser.name }}</span>
      </div>
    </header>
    <main class="page">
      <RouterView />
    </main>
  </div>
</template>

<script setup>
import { ROLES, useWorkflowStore } from './stores/workflow.js'
const wf = useWorkflowStore()
</script>
