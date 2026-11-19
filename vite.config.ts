import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  server: {
    port: 5180,
    host: '127.0.0.1',
    watch: {
      ignored: ['**/.edge-test/**', '**/.e2e/**', '**/dist/**', '**/scripts/.smoke.mjs'],
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
