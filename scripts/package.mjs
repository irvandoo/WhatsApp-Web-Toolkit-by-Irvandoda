// Creates download-ready zips in ./release:
//   wa-toolkit-full-v<ver>.zip   (all features; built into the repo root -> "Load unpacked" / extract & load)
//   wa-toolkit-store-v<ver>.zip  (Chrome Web Store build from dist/store)
// usage: node scripts/package.mjs [full|store|all]
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT_ARTIFACTS } from './artifacts.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const which = process.argv[2] ?? 'all';
// Windows' bsdtar can write zip; GNU tar from Git Bash cannot (and mistakes 'D:' for a host).
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'tar.exe') : 'tar';
mkdirSync(path.join(root, 'release'), { recursive: true });

function zip(name, cwd, entries) {
  const out = path.join(root, 'release', name);
  rmSync(out, { force: true });
  execFileSync(tar, ['-a', '-c', '-f', out, ...entries], { cwd, stdio: 'inherit' });
  console.log('Created', out);
}
if (which === 'full' || which === 'all') {
  const { version } = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  zip(`wa-toolkit-full-v${version}.zip`, root, ROOT_ARTIFACTS.filter((f) => f !== '.vite' && f !== 'icons' && existsSync(path.join(root, f))));
}
if (which === 'store' || which === 'all') {
  const dir = path.join(root, 'dist', 'store');
  const { version } = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  zip(`wa-toolkit-store-v${version}.zip`, dir, readdirSync(dir).filter((f) => f !== '.vite'));
}
