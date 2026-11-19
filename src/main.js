import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import { useEditorStore } from './stores/editor.js'
import './styles.css'

const routes = [
  { path: '/', redirect: '/workflow' },
  { path: '/workflow', component: () => import('./pages/WorkflowPage.vue') },
  { path: '/dashboard', component: () => import('./pages/DashboardPage.vue') },
  { path: '/editor', component: () => import('./pages/EditorPage.vue') },
  { path: '/preview', component: () => import('./pages/PreviewPage.vue') }
]

const router = createRouter({ history: createWebHashHistory(), routes })
const pinia = createPinia()
const app = createApp(App).use(pinia).use(router)

// 预载内置占位部件（ImageBitmap），保证 Worker 与导出渲染可用
await useEditorStore(pinia).initParts()
app.mount('#app')
