import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(root + 'dist', { recursive: true });
for (const [entry, name] of [['single-file.js', '__screenSingleFile'], ['single-file-frames.js', '__screenSingleFileFrames']]) {
  await build({ entryPoints: [require.resolve('single-file-core/' + entry)], bundle: true,
    format: 'iife', globalName: name, platform: 'browser', target: 'es2022',
    outfile: root + 'dist/' + entry, legalComments: 'inline' });
}
console.log('SingleFile browser bundles built.');
