import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@shared': path.resolve(process.cwd(), 'shared'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:8788',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('lucide')) return 'icons';
            if (id.includes('vue')) return 'vue';
          }
          if (id.includes('/shared/mesh') || id.includes('/shared/validate')) return 'voxel-kernel';
        },
      },
    },
  },
  optimizeDeps: {
    include: ['vue', 'vue-router', 'lucide-vue-next'],
  },
});
