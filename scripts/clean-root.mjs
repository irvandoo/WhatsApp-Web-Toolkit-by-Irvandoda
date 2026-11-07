// Removes previously generated extension files from the repo root (never touches sources).
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ROOT_ARTIFACTS } from './artifacts.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ROOT_ARTIFACTS) rmSync(path.join(root, f), { recursive: true, force: true });
