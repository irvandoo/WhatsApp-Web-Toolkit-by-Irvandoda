import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import path from 'node:path';
import fs from 'node:fs';
import { transformSync } from 'esbuild';
import manifest from './manifest.config';

// The document_start MAIN-world virtualizer must be ONE synchronous classic script (crxjs' loader would
// load it with an async dynamic import, i.e. after WhatsApp's own scripts). Compile it to a plain IIFE
// into public/ (served verbatim, referenced from the manifest).
function classicInjected(): Plugin {
  const build = () => {
    const src = fs.readFileSync(path.resolve(__dirname, 'app/injected/virtual-session.ts'), 'utf8');
    const out = transformSync(src, { loader: 'ts', format: 'iife', target: 'es2020', minify: true }).code;
    fs.writeFileSync(path.resolve(__dirname, 'app/public/virtual-session.js'), out);
  };
  build();
  return { name: 'wwt-classic-injected', buildStart: build };
}

// Sources live in ./app. The `full` build (all features) is emitted straight into the repository root
// so the root folder can be loaded in Chrome as-is ("Load unpacked"); the Chrome Web Store build goes to dist/store.
export default defineConfig(({ mode }) => {
  const full = mode === 'full';
  const app = path.resolve(__dirname, 'app');
  return {
    root: app,
    publicDir: path.resolve(app, 'public'),
    plugins: [classicInjected(), react(), crx({ manifest })],
    resolve: { alias: { '@': app } },
    define: { __FLAVOR__: JSON.stringify(full ? 'full' : 'store') },
    cacheDir: path.resolve(__dirname, 'node_modules/.vite'),
    build: {
      outDir: full ? __dirname : path.resolve(__dirname, 'dist/store'),
      emptyOutDir: !full, // the root build is cleaned by scripts/clean-root.mjs instead
      rollupOptions: {
        input: {
          dashboard: path.resolve(app, 'dashboard/index.html'),
          crm: path.resolve(app, 'crm/index.html'),
          templates: path.resolve(app, 'templates/index.html'),
          analytics: path.resolve(app, 'analytics/index.html'),
          autoreply: path.resolve(app, 'autoreply/index.html'),
          groups: path.resolve(app, 'groups/index.html'),
          pos: path.resolve(app, 'pos/index.html'),
          blast: path.resolve(app, 'blast/index.html'),
          presets: path.resolve(app, 'presets/index.html'),
        },
      },
    },
    server: { port: 5173, strictPort: true, hmr: { port: 5173 } },
  };
});
