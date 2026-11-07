// Zips the root `store` build for Chrome Web Store upload -> release/wa-toolkit-store-v<version>.zip
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const out = path.join(root, 'release', `wa-toolkit-store-v${version}.zip`);
mkdirSync(path.dirname(out), { recursive: true });
rmSync(out, { force: true });
const files = ['manifest.json', 'service-worker-loader.js', 'assets', 'popup', 'options', 'dashboard', 'crm', 'templates', 'public', '_locales'];
// Use Windows' bsdtar (can write zip); GNU tar from Git Bash cannot and mistakes 'D:' for a host.
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'tar.exe') : 'tar';
execFileSync(tar, ['-a', '-c', '-f', out, ...files], { cwd: root, stdio: 'inherit' });
console.log('Created', out);
