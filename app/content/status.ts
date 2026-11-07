import { IS_FULL } from '../shared/credit';
import {
  ENGINE_HELP, HONESTY_BG, HONESTY_RISK, QS_PENDING_KEY, SWITCHABLE, computeIndicator, emergencyStopSend, markFirstRunDone, pauseRun,
  resumeRun, setEnabled, setEngine, isPaused, type EngineId, type HealthMap, type Indicator, type IndicatorItem,
} from '../shared/runmode';
import { initRunGate, getRunState, onHealth, onRunChange, readAllHealth } from './engine-health';
import { openOverlay } from './overlay';
import { LEVEL_COLOR, NAV_PULSE_CSS, STATUS_CSS } from './status-style';

/** Live "Status Otomatis" model (run state + heartbeats -> indicator), plus the popover and first-run toast. */

let health: HealthMap = {};
let ind: Indicator = computeIndicator(getRunState(), health, Date.now(), IS_FULL);
let started = false;
const subs = new Set<(i: Indicator) => void>();

function recompute(): void {
  const next = computeIndicator(getRunState(), health, Date.now(), IS_FULL);
  if (JSON.stringify(next) === JSON.stringify(ind)) return;
  ind = next;
  subs.forEach((f) => { try { f(ind); } catch { /* ignore */ } });
}
const refreshHealth = () => readAllHealth().then((m) => { health = { ...health, ...m }; recompute(); }, () => undefined);

export function startStatus(): void {
  if (started) return;
  started = true;
  void initRunGate().then(recompute);
  void refreshHealth();
  onHealth((id, h) => { if (!health[id] || h.ts >= health[id]!.ts) { health = { ...health, [id]: h }; recompute(); } });
  onRunChange(recompute);
  window.setInterval(() => { void refreshHealth(); recompute(); }, 10_000);
}

export const getIndicator = (): Indicator => ind;
/** Calls cb now and on every change. */
export function onIndicator(cb: (i: Indicator) => void): () => void {
  startStatus();
  subs.add(cb);
  try { cb(ind); } catch { /* ignore */ }
  return () => { subs.delete(cb); };
}
export const levelColor = (i: Indicator): string => LEVEL_COLOR[i.level];
export const levelTooltip = (i: Indicator): string => `${i.title}. ${i.detail}`;

/** Document-level pulse rule for the navbar dot (idempotent). */
export function ensureNavPulseStyle(): void {
  if (document.getElementById('wwt-status-pulse')) return;
  const s = document.createElement('style');
  s.id = 'wwt-status-pulse';
  s.textContent = NAV_PULSE_CSS;
  (document.head ?? document.documentElement).appendChild(s);
}

const CHIP_TEXT: Record<IndicatorItem['status'], string> = { jalan: 'Jalan', siaga: 'Siaga', mati: 'Mati', error: 'Perlu dicek' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

/** Plain list of engine rows (used by the Toolkit panel's Status tab). */
export function renderItemRows(into: HTMLElement, i: Indicator): void {
  into.textContent = '';
  for (const it of i.items) {
    const t = el('div', 't');
    t.append(el('b', '', it.label), el('small', '', it.detail));
    const row = el('div', 'st-row');
    row.append(t, el('span', `chip ${it.status}`, CHIP_TEXT[it.status]));
    into.append(row);
  }
}

export function openQuickStart(): void { try { openOverlay('quickstart'); } catch { /* ignore */ } }

// ---------------- popover ----------------
let popHost: HTMLElement | null = null;
let popUnsub: (() => void) | null = null;
let outside: ((e: Event) => void) | null = null;
let keyHandler: ((e: KeyboardEvent) => void) | null = null;

export function closeStatusPopover(): void {
  popUnsub?.(); popUnsub = null;
  if (outside) document.removeEventListener('pointerdown', outside, true);
  if (keyHandler) document.removeEventListener('keydown', keyHandler, true);
  outside = null; keyHandler = null;
  popHost?.remove(); popHost = null;
}
export const isStatusPopoverOpen = (): boolean => !!popHost;

export function toggleStatusPopover(anchor?: HTMLElement): void {
  if (popHost) return closeStatusPopover();
  const host = el('div');
  host.id = 'wwt-status-pop';
  const root = host.attachShadow({ mode: 'open' });
  const style = el('style');
  style.textContent = STATUS_CSS;
  const pop = el('div', 'pop');
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Status Otomatis');
  root.append(style, pop);
  document.documentElement.appendChild(host);
  popHost = host;
  const r = anchor?.getBoundingClientRect();
  if (r && r.width > 0) { pop.style.left = `${Math.round(r.right + 8)}px`; pop.style.top = `${Math.max(8, Math.round(r.top - 40))}px`; }
  else { pop.style.right = '16px'; pop.style.bottom = '80px'; }

  let menu = false;
  const render = (i: Indicator) => {
    const run = getRunState();
    pop.textContent = '';
    const hd = el('div', 'hd');
    const dot = el('span', `dot ${i.level}`);
    dot.style.background = LEVEL_COLOR[i.level];
    const tx = el('div');
    tx.append(el('div', 'ti', i.title), el('div', 'de', i.detail));
    const x = el('button', 'x', '×');
    x.setAttribute('aria-label', 'Tutup');
    x.addEventListener('click', closeStatusPopover);
    hd.append(dot, tx, x);
    pop.append(hd);

    if (IS_FULL) {
      const paused = isPaused(run, Date.now());
      const big = el('button', paused ? 'big' : 'big sec', paused ? 'Lanjutkan' : run.enabled ? 'Jeda semua' : 'Nyalakan Mode Otomatis');
      big.addEventListener('click', () => {
        if (paused) void resumeRun();
        else if (!run.enabled) void setEnabled(true);
        else { menu = !menu; render(ind); }
      });
      pop.append(big);
      if (menu && !paused && run.enabled) {
        const m = el('div', 'menu');
        const opts: [string, Parameters<typeof pauseRun>[0]][] = [['15 menit', 15], ['1 jam', 60], ['Sampai besok', 'tomorrow'], ['Sampai saya lanjutkan', 'manual']];
        for (const [label, kind] of opts) {
          const b = el('button', '', label);
          b.addEventListener('click', () => { menu = false; void pauseRun(kind); });
          m.append(b);
        }
        pop.append(m);
      }
      const stop = el('button', 'dan', 'Hentikan kirim otomatis');
      stop.title = 'Darurat: matikan kirim terjadwal/blast dan balas otomatis sekarang juga';
      stop.addEventListener('click', () => { void emergencyStopSend(); });
      pop.append(stop);
    }

    pop.append(el('h4', '', 'Yang berjalan'));
    for (const it of i.items) {
      const row = el('div', 'row');
      const t = el('div', 't');
      t.append(el('b', '', it.label), el('small', '', it.detail), el('small', '', ENGINE_HELP[it.id]));
      row.append(t, el('span', `chip ${it.status}`, CHIP_TEXT[it.status]));
      if (IS_FULL && SWITCHABLE.includes(it.id)) {
        const sw = el('input', 'sw');
        sw.type = 'checkbox';
        sw.checked = run.engines[it.id];
        sw.setAttribute('aria-label', `${it.label}: nyala/mati`);
        sw.addEventListener('change', () => { void setEngine(it.id as EngineId, sw.checked); });
        row.append(sw);
      }
      pop.append(row);
    }

    pop.append(el('div', 'note', HONESTY_BG), el('div', 'note w', HONESTY_RISK));
    if (!IS_FULL) pop.append(el('div', 'note', 'Edisi Toko: semua pengiriman hanya berupa draf. Anda yang menekan Kirim.'));
    if (IS_FULL) {
      const f = el('label', 'row');
      const cb = el('input', 'sw');
      cb.type = 'checkbox';
      cb.checked = run.enabled;
      cb.addEventListener('change', () => { void setEnabled(cb.checked); });
      const t = el('div', 't');
      t.append(el('b', '', 'Mode Otomatis'), el('small', '', 'Saklar utama: mati berarti tidak ada yang berjalan sendiri.'));
      f.append(t, cb);
      pop.append(f);
    }
    const qs = el('button', 'lnk', 'Panduan cepat');
    qs.addEventListener('click', () => { closeStatusPopover(); openQuickStart(); });
    pop.append(qs);
  };
  popUnsub = onIndicator(render);
  outside = (e: Event) => { if (!e.composedPath().includes(host) && !(anchor && e.composedPath().includes(anchor))) closeStatusPopover(); };
  keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeStatusPopover(); };
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', keyHandler, true);
}

// ---------------- first-run toast ----------------
let toastHost: HTMLElement | null = null;
export async function maybeShowFirstRunToast(): Promise<void> {
  try {
    await initRunGate();
    let qs = false;
    try { qs = !!(await chrome.storage.local.get(QS_PENDING_KEY))[QS_PENDING_KEY]; } catch { /* ignore */ }
    const needFirst = IS_FULL && !getRunState().firstRunDone;
    if ((!needFirst && !qs) || toastHost) return;
    const host = el('div');
    host.id = 'wwt-status-toast';
    const root = host.attachShadow({ mode: 'open' });
    const style = el('style');
    style.textContent = STATUS_CSS;
    const box = el('div', 'toast');
    box.setAttribute('role', 'status');
    box.append(
      el('b', '', IS_FULL ? 'Berjalan di latar belakang' : 'Selamat datang di Toolkit'),
      el('p', '', IS_FULL
        ? 'Toolkit bekerja otomatis selama tab WhatsApp Web terbuka. Pantau lewat ikon Status; Anda bisa menjeda kapan saja.'
        : 'Edisi Toko hanya menyiapkan draf. Klik di sini untuk panduan cepat.'),
    );
    const row = el('div', 'b');
    const done = async () => {
      host.remove(); toastHost = null;
      try { await chrome.storage.local.remove(QS_PENDING_KEY); } catch { /* ignore */ }
      if (IS_FULL) void markFirstRunDone();
    };
    const ok = el('button', 'pri', 'Mengerti');
    ok.addEventListener('click', () => { void done(); });
    const g = el('button', '', 'Panduan cepat');
    g.addEventListener('click', () => { void done(); openQuickStart(); });
    row.append(ok, g);
    box.append(row);
    root.append(style, box);
    document.documentElement.appendChild(host);
    toastHost = host;
  } catch { /* never block the page */ }
}
