import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  server: {
    port: 5188,
    proxy: {
      '/api': 'http://localhost:9077',
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
});
