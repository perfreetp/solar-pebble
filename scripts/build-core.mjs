import { build } from 'esbuild';

await build({
  entryPoints: ['src/core/index.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'dist-test/core.mjs',
  platform: 'node',
  target: 'node20',
  logLevel: 'warning',
});
