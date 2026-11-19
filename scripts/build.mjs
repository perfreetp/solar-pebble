import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const out = 'dist';
if (existsSync(out)) await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  format: 'esm',
  target: ['chrome120', 'edge120'],
  sourcemap: true,
  logLevel: 'info',
  legalComments: 'none',
};

await build({
  ...common,
  entryPoints: { app: 'src/app.ts' },
  outdir: out,
  minify: !watch,
  define: { 'process.env.NODE_ENV': '"production"' },
});

await cp('index.html', `${out}/index.html`);
console.log('构建完成 → dist/');
