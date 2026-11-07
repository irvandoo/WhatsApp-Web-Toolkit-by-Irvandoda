import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import path from 'node:path';
import manifest from './manifest.config';

// Sources live in ./app. The `store` build is emitted straight into the repository root
// so the root folder can be loaded in Chrome as-is ("Load unpacked"); `full` goes to dist/full.
export default defineConfig(({ mode }) => {
  const full = mode === 'full';
  const app = path.resolve(__dirname, 'app');
  return {
    root: app,
    publicDir: path.resolve(app, 'public'),
    plugins: [react(), crx({ manifest })],
    resolve: { alias: { '@': app } },
    define: { __FLAVOR__: JSON.stringify(full ? 'full' : 'store') },
    cacheDir: path.resolve(__dirname, 'node_modules/.vite'),
    build: {
      outDir: full ? path.resolve(__dirname, 'dist/full') : __dirname,
      emptyOutDir: full, // root build is cleaned by scripts/clean-root.mjs
      rollupOptions: {
        input: {
          dashboard: path.resolve(app, 'dashboard/index.html'),
          crm: path.resolve(app, 'crm/index.html'),
          templates: path.resolve(app, 'templates/index.html'),
        },
      },
    },
    server: { port: 5173, strictPort: true, hmr: { port: 5173 } },
  };
});
