import { createApp } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';
import './styles/main.css';
import App from './App.vue';

const routes = [
  { path: '/', redirect: '/orders' },
  { path: '/orders', name: 'orders', component: () => import('./views/OrdersView.vue'), meta: { title: '接单与分派' } },
  { path: '/build/:id', name: 'build', component: () => import('./views/EditorView.vue'), meta: { title: '建模工作台' } },
  { path: '/qc', name: 'qc', component: () => import('./views/QcView.vue'), meta: { title: '质检抽查' } },
  { path: '/dashboard', name: 'dashboard', component: () => import('./views/DashboardView.vue'), meta: { title: '产能看板' } },
];

const app = createApp(App);
app.use(createRouter({ history: createWebHashHistory(), routes }));
app.mount('#app');
