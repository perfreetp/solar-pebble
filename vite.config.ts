import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  worker: { format: 'es' },
  server: { port: 5180, host: '127.0.0.1' },
});
