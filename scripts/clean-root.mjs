// Removes previously generated extension files from the repo root (never touches sources).
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['assets', 'popup', 'options', 'dashboard', 'crm', 'templates', 'public', 'icons', '_locales', 'manifest.json', 'service-worker-loader.js', '.vite']) {
  rmSync(path.join(root, f), { recursive: true, force: true });
}
