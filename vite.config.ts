import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import path from 'node:path';
import manifest from './manifest.config';

export default defineConfig(({ mode }) => ({
  plugins: [react(), crx({ manifest })],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  define: { __FLAVOR__: JSON.stringify(mode === 'full' ? 'full' : 'store') },
  build: { rollupOptions: { input: {
      dashboard: path.resolve(__dirname, 'src/dashboard/index.html'),
      crm: path.resolve(__dirname, 'src/crm/index.html'),
      templates: path.resolve(__dirname, 'src/templates/index.html'),
    } }, outDir: `dist/${mode === 'full' ? 'full' : 'store'}`, emptyOutDir: true },
  server: { port: 5173, strictPort: true, hmr: { port: 5173 } },
}));
