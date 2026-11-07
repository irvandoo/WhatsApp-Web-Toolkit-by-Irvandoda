// Contrast audit (WCAG) for the design tokens in app/shared/ui/theme.css, light + dark.
// usage: node scripts/contrast-audit.mjs   (exit code 1 when a required pair fails)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(path.join(root, 'app/shared/ui/theme.css'), 'utf8');

function parseBlock(block) {
  const out = {};
  for (const m of block.matchAll(/(--wt-[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const lightBlock = css.slice(css.indexOf(':root{'), css.indexOf('@media (prefers-color-scheme:dark)'));
const darkBlock = css.slice(css.indexOf('@media (prefers-color-scheme:dark)'), css.indexOf('*{box-sizing'));
const light = parseBlock(lightBlock);
const dark = { ...light, ...parseBlock(darkBlock) };

function parseColor(v) {
  v = v.trim();
  let m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) { let h = m[1]; if (h.length === 3) h = [...h].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1); }
  m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) { const p = m[1].split(',').map((x) => parseFloat(x)); return [p[0], p[1], p[2], p[3] ?? 1]; }
  return null;
}
const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
const lum = (c) => { const f = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [text token, background token(s) it can sit on, minimum ratio, label]
const PAIRS = [
  ['--wt-text', ['--wt-bg', '--wt-surface', '--wt-surface-2', '--wt-accent-soft'], 4.5, 'teks utama'],
  ['--wt-text-muted', ['--wt-bg', '--wt-surface', '--wt-surface-2'], 4.5, 'teks sekunder'],
  ['--wt-accent-ink', ['--wt-surface', '--wt-bg', '--wt-accent-soft', '--wt-surface-2'], 4.5, 'tombol/tautan hijau'],
  ['--wt-ok', ['--wt-ok-soft', '--wt-surface'], 4.5, 'status ok'],
  ['--wt-warn', ['--wt-warn-soft', '--wt-surface'], 4.5, 'status peringatan'],
  ['--wt-bad', ['--wt-bad-soft', '--wt-surface'], 4.5, 'status gagal'],
  ['--wt-info', ['--wt-info-soft', '--wt-surface'], 4.5, 'status info'],
  ['--wt-text-muted', ['--wt-ok-soft', '--wt-warn-soft', '--wt-bad-soft', '--wt-info-soft'], 4.5, 'teks sekunder di atas tint'],
];
let fails = 0;
for (const [mode, tokens] of [['terang', light], ['gelap', dark]]) {
  const base = parseColor(tokens['--wt-surface']);
  const solid = (name) => { const c = parseColor(tokens[name]); if (!c) throw new Error(`token tidak terbaca: ${name} = ${tokens[name]}`); return c[3] < 1 ? over(c, base).concat(1) : c; };
  for (const [fgT, bgs, min, label] of PAIRS) for (const bgT of bgs) {
    const r = ratio(solid(fgT), solid(bgT));
    const ok = r >= min;
    if (!ok) fails++;
    console.log(`${ok ? 'OK  ' : 'GAGAL'} [${mode}] ${label}: ${fgT} di atas ${bgT} = ${r.toFixed(2)} (min ${min})`);
  }
}
console.log(fails ? `\n${fails} pasangan gagal` : '\nSemua pasangan lolos');
process.exit(fails ? 1 : 0);
