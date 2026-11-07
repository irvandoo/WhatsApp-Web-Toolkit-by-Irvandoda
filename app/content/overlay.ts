/** In-page modal overlay (closed shadow DOM) that frames extension pages over WhatsApp Web. */
import { STORE_KEY, clampGeo, clampMove, defaultGeo, keyAdjust, maximizedGeo, parseStore, presetGeo, resizeEdge, type Edge, type Geo, type SizePreset } from '../shared/overlay-geometry';
export type OverlayPage = 'dashboard' | 'crm' | 'templates' | 'analytics' | 'autoreply' | 'blast' | 'pos' | 'groups' | 'presets' | 'quickstart';
const PAGES: { id: OverlayPage; label: string; d: string }[] = [
  { id: 'dashboard', label: 'Hub Akun', d: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>' },
  { id: 'crm', label: 'CRM', d: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.5 3.2-5.5 6.5-5.5s5.9 2 6.5 5.5M17 11a3 3 0 1 0 0-6M18.5 14.7c1.8.6 3 2.3 3.3 5"/>' },
  { id: 'templates', label: 'Template', d: '<path d="M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V5a1 1 0 0 1 1-1z"/><path d="M8 9h8M8 12h5"/>' },
  { id: 'autoreply', label: 'Auto-reply', d: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>' },
  { id: 'blast', label: 'Blast & Jadwal', d: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z"/><path d="M15 9a4 4 0 0 1 0 6M18 7a7 7 0 0 1 0 10"/>' },
  { id: 'pos', label: 'POS', d: '<path d="M3 4h2l2.4 11h10.2l2-8H6.2"/><circle cx="9" cy="20" r="1.2"/><circle cx="17" cy="20" r="1.2"/>' },
  { id: 'groups', label: 'Ekstrak Grup', d: '<circle cx="8" cy="8" r="3"/><path d="M2 20c.5-3 2.7-5 6-5s5.5 2 6 5M16 11a3 3 0 1 0 0-6M17 15c2.3.3 4 2 4.5 5"/>' },
  { id: 'presets', label: 'Preset Industri', d: '<path d="M12 3l2.1 5.4L20 10l-5.9 1.6L12 17l-2.1-5.4L4 10l5.9-1.6L12 3Z"/>' },
  { id: 'quickstart', label: 'Mulai cepat', d: '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>' },
  { id: 'analytics', label: 'Analitik', d: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>' },
];
const TITLES: Record<OverlayPage, string> = { dashboard: 'Hub Akun', crm: 'CRM', templates: 'Template', analytics: 'Analitik', autoreply: 'Auto-reply', blast: 'Blast & Jadwal', pos: 'POS', groups: 'Ekstrak Grup', presets: 'Preset Industri', quickstart: 'Mulai cepat' };
const LOAD_TIMEOUT = 5000;

const CSS = `
:host{all:initial}
*{box-sizing:border-box}
.bd{--bg:#f6f8f7;--fg:#26332e;--mut:#66756f;--bd:#e3e9e6;--hov:rgba(63,174,107,.12);--g:#3fae6b;--gfg:#fff;--sh:0 18px 48px rgba(38,51,46,.16);
 position:fixed;inset:0;z-index:2147483600;background:rgba(38,51,46,.18);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);
 font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg);opacity:0;transition:opacity .18s ease}
.bd.dark{--bg:#141b18;--fg:#dfe8e3;--mut:#9aaaa3;--bd:#27322d;--hov:rgba(88,196,135,.14);--g:#58c487;--gfg:#10231a;--sh:0 18px 48px rgba(0,0,0,.35);background:rgba(10,16,13,.32)}
.bd.in{opacity:1}
.card{position:absolute;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--bd);border-radius:14px;overflow:hidden;box-shadow:var(--sh);transform:translateY(8px) scale(.985);transition:transform .2s ease;outline:none}
.card.max{border-radius:0}
.card:focus-visible{box-shadow:0 0 0 2px var(--g),var(--sh)}
.bd.in .card{transform:none}
.bd.busy iframe{pointer-events:none}.bd.busy{user-select:none}
header{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--bd);flex:none;cursor:grab;touch-action:none;position:relative}
.bd.busy header{cursor:grabbing}
.card.max header{cursor:default}
.mk{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#58c487,#3fae6b);display:grid;place-items:center;color:#fff;flex:none}
h2{margin:0;font-size:15px;font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
button{font:inherit;color:inherit;cursor:pointer}
.hb{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border:1px solid var(--bd);background:transparent;border-radius:9px;flex:none}
.ib{width:32px;padding:0;justify-content:center}
.hb:hover,.rail button:hover,.menu button:hover{background:var(--hov)}
button:focus-visible{outline:2px solid var(--g);outline-offset:2px}
.menu{position:absolute;right:92px;top:46px;z-index:5;min-width:160px;background:var(--bg);border:1px solid var(--bd);border-radius:10px;padding:4px;box-shadow:var(--sh);display:flex;flex-direction:column}
.menu button{border:0;background:transparent;text-align:left;padding:8px 10px;border-radius:7px}
.menu hr{border:0;border-top:1px solid var(--bd);margin:4px 0;width:100%}
.body{flex:1;display:flex;min-height:0;min-width:0}
.rail{width:62px;flex:none;border-right:1px solid var(--bd);padding:8px 6px;display:flex;flex-direction:column;gap:4px;overflow-y:auto}
.rail button{border:0;background:transparent;border-radius:10px;padding:8px 2px;display:flex;flex-direction:column;align-items:center;gap:3px;font-size:10px;color:var(--mut)}
.rail button[aria-current=page]{background:var(--hov);color:var(--g);font-weight:700}
.card.nar .rail{width:46px;padding:8px 4px}.card.nar .rail span,.card.nar .hb span{display:none}
.stage{position:relative;flex:1;min-width:0;overflow:hidden;background:var(--bg)}
iframe{position:absolute;inset:0;width:100%;height:100%;max-width:100%;border:0;background:var(--bg)}
iframe.h{visibility:hidden}
.sk{position:absolute;inset:0;padding:24px;display:flex;flex-direction:column;gap:14px}
.sk i{display:block;height:18px;border-radius:8px;background:linear-gradient(90deg,var(--hov),var(--bd),var(--hov));background-size:200% 100%;animation:sh 1.2s linear infinite}
.sk i:nth-child(1){width:35%;height:26px}.sk i:nth-child(3){width:80%}.sk i:nth-child(4){height:120px}
@keyframes sh{to{background-position:-200% 0}}
.fb{position:absolute;inset:0;display:grid;place-content:center;gap:14px;text-align:center;padding:24px;justify-items:center}
.fb button{background:var(--g);color:var(--gfg);border:0;height:38px;padding:0 16px;border-radius:10px;font-weight:600}
.rz{position:absolute;z-index:4;touch-action:none}
.card.max .rz{display:none}
.rz[data-e=n]{top:0;left:14px;right:14px;height:8px;cursor:ns-resize}
.rz[data-e=s]{bottom:0;left:14px;right:14px;height:8px;cursor:ns-resize}
.rz[data-e=e]{right:0;top:14px;bottom:14px;width:8px;cursor:ew-resize}
.rz[data-e=w]{left:0;top:14px;bottom:14px;width:8px;cursor:ew-resize}
.rz[data-e=ne]{top:0;right:0;width:14px;height:14px;cursor:nesw-resize}
.rz[data-e=sw]{bottom:0;left:0;width:14px;height:14px;cursor:nesw-resize}
.rz[data-e=nw]{top:0;left:0;width:14px;height:14px;cursor:nwse-resize}
.rz[data-e=se]{bottom:0;right:0;width:14px;height:14px;cursor:nwse-resize}
[hidden]{display:none!important}
@media (prefers-reduced-motion:reduce){.bd,.card{transition:none}.sk i{animation:none}}
`;

const svg = (d: string, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };

interface State {
  host: HTMLElement;
  el: { bd: HTMLElement; title: HTMLElement; frame: HTMLIFrameElement; sk: HTMLElement; fb: HTMLElement; rail: HTMLButtonElement[]; close: HTMLElement; win: HTMLElement; menu: HTMLElement; max: HTMLElement };
  geo: Geo;
  maximized: boolean;
  busy: boolean;
  onResize: () => void;
  page: OverlayPage;
  prevFocus: Element | null;
  timer?: number;
  onKey: (e: KeyboardEvent) => void;
}
let st: State | null = null;
let listenerInstalled = false;

const vp = (): { vw: number; vh: number } => ({ vw: window.innerWidth || 1280, vh: window.innerHeight || 800 });
function readStore(): Record<string, Geo> {
  const { vw, vh } = vp();
  try { return parseStore(localStorage.getItem(STORE_KEY), vw, vh); } catch { return {}; }
}
function writeGeo(page: string, g: Geo | null): void {
  try {
    const all = readStore();
    if (g) all[page] = g; else delete all[page];
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch { /* storage unavailable */ }
}
const MAX_ICON = '<rect x="5" y="5" width="14" height="14" rx="2"/>';
const RESTORE_ICON = '<rect x="4" y="8" width="12" height="12" rx="2"/><path d="M8 8V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-3"/>';

function paint(s: State): void {
  const { win } = s.el;
  const g = s.geo;
  win.style.left = `${g.x}px`; win.style.top = `${g.y}px`; win.style.width = `${g.w}px`; win.style.height = `${g.h}px`;
  win.classList.toggle('nar', g.w < 760);
  win.classList.toggle('max', s.maximized);
  const label = s.maximized ? 'Pulihkan' : 'Maksimalkan';
  s.el.max.setAttribute('aria-label', label); s.el.max.title = label;
  s.el.max.innerHTML = svg(s.maximized ? RESTORE_ICON : MAX_ICON, 16);
}
function setGeo(s: State, g: Geo, persist: boolean): void {
  s.geo = g;
  paint(s);
  if (persist && !s.maximized) writeGeo(s.page, g);
}
function applyPage(s: State): void {
  const { vw, vh } = vp();
  s.maximized = false;
  s.geo = readStore()[s.page] ?? defaultGeo(s.page, vw, vh);
  paint(s);
}
function setMaximized(s: State, on: boolean): void {
  const { vw, vh } = vp();
  s.maximized = on;
  if (on) s.geo = maximizedGeo(vw, vh); else s.geo = readStore()[s.page] ?? defaultGeo(s.page, vw, vh);
  paint(s);
}
function applyPreset(s: State, p: SizePreset | 'reset'): void {
  const { vw, vh } = vp();
  s.maximized = false;
  if (p === 'reset') { writeGeo(s.page, null); s.geo = defaultGeo(s.page, vw, vh); paint(s); }
  else setGeo(s, presetGeo(p, s.page, vw, vh), true);
  s.el.menu.hidden = true;
}

const isDark = () => document.body?.classList.contains('dark') || document.documentElement.classList.contains('dark') ||
  (!!window.matchMedia?.('(prefers-color-scheme: dark)').matches && !document.body?.classList.contains('light'));
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function load(s: State, page: OverlayPage, hash?: string): void {
  s.page = page;
  const { el } = s;
  el.title.textContent = TITLES[page];
  if (s.el.win && s.geo.w) applyPage(s);
  el.rail.forEach((b) => { if (b.dataset.page === page) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  el.sk.hidden = false; el.fb.hidden = true; el.frame.classList.add('h');
  window.clearTimeout(s.timer);
  s.timer = window.setTimeout(() => { if (!el.sk.hidden) { el.sk.hidden = true; el.fb.hidden = false; } }, LOAD_TIMEOUT);
  el.frame.onload = () => {
    window.clearTimeout(s.timer);
    el.sk.hidden = true; el.fb.hidden = true; el.frame.classList.remove('h');
  };
  try { el.frame.src = chrome.runtime.getURL(`${page}/index.html`) + (hash ? `#${hash.replace(/^#/, '')}` : ''); } catch { el.sk.hidden = true; el.fb.hidden = false; }
}

function openTab(page: OverlayPage): void {
  try { if (alive()) void chrome.runtime.sendMessage({ kind: 'ui:open', page }); } catch { /* ignore */ }
}

export function openOverlay(page: OverlayPage, hash?: string): void {
  if (!PAGES.some((p) => p.id === page)) return;
  if (hash && !/^#?[\w-]{1,32}$/.test(hash)) hash = undefined;
  if (st) { load(st, page, hash); return; }
  const host = document.createElement('div');
  host.id = 'wwt-overlay';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style'); style.textContent = CSS;
  const bd = document.createElement('div'); bd.className = 'bd' + (isDark() ? ' dark' : '');
  // Only constant strings are interpolated here.
  bd.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-labelledby="t" tabindex="-1">
<header><div class="mk">${svg('<path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.7-1.2A9 9 0 1 0 12 3z"/>', 16)}</div><h2 id="t"></h2>
<button class="hb" type="button" data-a="tab" title="Buka di tab baru">${svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', 16)}<span>Buka di tab</span></button>
<button class="hb" type="button" data-a="size" aria-haspopup="menu" aria-expanded="false" title="Ukuran jendela">${svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', 16)}<span>Ukuran</span></button>
<button class="hb ib" type="button" data-a="max" aria-label="Maksimalkan" title="Maksimalkan"></button>
<button class="hb ib" type="button" data-a="min" aria-label="Minimalkan" title="Minimalkan">${svg('<path d="M5 12h14"/>', 16)}</button>
<button class="hb ib" type="button" data-a="x" aria-label="Tutup" title="Tutup (Esc)">${svg('<path d="M6 6l12 12M18 6L6 18"/>', 16)}</button><div class="menu" role="menu" hidden><button type="button" role="menuitem" data-p="compact">Kompak</button><button type="button" role="menuitem" data-p="medium">Sedang</button><button type="button" role="menuitem" data-p="wide">Lebar</button><hr><button type="button" role="menuitem" data-p="reset">Reset ukuran</button></div></header>
<div class="body"><nav class="rail" aria-label="Modul">${PAGES.map((p) => `<button type="button" data-page="${p.id}" title="${p.label}" aria-label="${p.label}">${svg(p.d, 20)}<span>${p.label}</span></button>`).join('')}</nav>
<div class="stage"><iframe title="Modul" referrerpolicy="no-referrer"></iframe>
<div class="sk" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
<div class="fb" hidden><div>Tampilan tidak dapat dimuat di halaman ini.</div><button type="button" data-a="tab">Buka di tab</button></div></div></div>${(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as Edge[]).map((e) => `<div class="rz" data-e="${e}"></div>`).join('')}</div>`;
  root.append(style, bd);
  const q = <T extends Element>(sel: string) => bd.querySelector(sel) as T;
  const s: State = {
    host, page,
    prevFocus: document.activeElement,
    el: { bd, title: q('h2'), frame: q<HTMLIFrameElement>('iframe'), sk: q('.sk'), fb: q('.fb'), rail: Array.from(bd.querySelectorAll<HTMLButtonElement>('.rail button')), close: q('[data-a=x]'), win: q('.card'), menu: q('.menu'), max: q('[data-a=max]') },
    geo: { x: 0, y: 0, w: 0, h: 0 }, maximized: false, busy: false,
    onKey: () => undefined, onResize: () => undefined,
  };
  s.onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!s.el.menu.hidden) { s.el.menu.hidden = true; q('[data-a=size]').setAttribute('aria-expanded', 'false'); } else closeOverlay(); return; }
    if (e.key !== 'Tab') return;
    const f = Array.from(bd.querySelectorAll<HTMLElement>('button')).filter((b) => !b.closest('[hidden]'));
    if (!f.length) return;
    const act = root.activeElement as HTMLElement | null;
    const first = f[0], last = f[f.length - 1];
    if (!act || (e.shiftKey && act === first)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (!e.shiftKey && act === last) { e.preventDefault(); first.focus(); }
  };
  bd.addEventListener('mousedown', (e) => { if (e.target === bd && !s.busy) closeOverlay(); });
  const sizeBtn = q<HTMLElement>('[data-a=size]');
  interface Drag { kind: 'move' | Edge; sx: number; sy: number; start: Geo; id: number }
  let drag: Drag | null = null;
  const begin = (e: PointerEvent, kind: Drag['kind'], el: Element): void => {
    if (s.maximized || (e.button ?? 0) !== 0) return;
    drag = { kind, sx: e.clientX, sy: e.clientY, start: { ...s.geo }, id: e.pointerId };
    s.busy = true; bd.classList.add('busy');
    try { el.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
    e.preventDefault();
  };
  const moveTo = (e: PointerEvent): void => {
    if (!drag) return;
    const { vw, vh } = vp();
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    const g = drag.kind === 'move' ? clampMove({ ...drag.start, x: drag.start.x + dx, y: drag.start.y + dy }, vw, vh) : resizeEdge(drag.start, drag.kind, dx, dy, vw, vh);
    setGeo(s, g, false);
  };
  const end = (): void => {
    if (!drag) return;
    drag = null;
    bd.classList.remove('busy');
    writeGeo(s.page, s.geo);
    window.setTimeout(() => { s.busy = false; }, 0);
  };
  bd.querySelectorAll<HTMLElement>('.rz').forEach((h) => {
    h.addEventListener('pointerdown', (e) => begin(e, h.dataset.e as Edge, h));
    h.addEventListener('pointermove', moveTo);
    h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
  });
  const head = q<HTMLElement>('header');
  head.addEventListener('pointerdown', (e) => { if ((e.target as Element).closest('button,.menu')) return; begin(e, 'move', head); });
  head.addEventListener('pointermove', moveTo);
  head.addEventListener('pointerup', end); head.addEventListener('pointercancel', end);
  head.addEventListener('dblclick', (e) => { if (!(e.target as Element).closest('button,.menu')) setMaximized(s, !s.maximized); });
  s.el.win.addEventListener('keydown', (e) => {
    if (!e.altKey || e.target !== s.el.win || s.maximized) return;
    const { vw, vh } = vp();
    const g = keyAdjust(s.geo, e.key, e.shiftKey, vw, vh);
    if (g) { e.preventDefault(); setGeo(s, g, true); }
  });
  s.onResize = () => {
    const { vw, vh } = vp();
    if (s.maximized) s.geo = maximizedGeo(vw, vh); else s.geo = clampGeo(s.geo, vw, vh);
    paint(s);
  };
  window.addEventListener('resize', s.onResize);
  bd.addEventListener('click', (e) => {
    const t = (e.target as Element).closest('button');
    if (!t) return;
    if (t.dataset.page) { load(s, t.dataset.page as OverlayPage); return; }
    if (t.dataset.p) { applyPreset(s, t.dataset.p as SizePreset | 'reset'); sizeBtn.setAttribute('aria-expanded', 'false'); return; }
    if (t.dataset.a === 'size') { s.el.menu.hidden = !s.el.menu.hidden; sizeBtn.setAttribute('aria-expanded', String(!s.el.menu.hidden)); return; }
    s.el.menu.hidden = true; sizeBtn.setAttribute('aria-expanded', 'false');
    if (t.dataset.a === 'max') setMaximized(s, !s.maximized);
    else if (t.dataset.a === 'x' || t.dataset.a === 'min') closeOverlay();
    else if (t.dataset.a === 'tab') openTab(s.page);
  });
  document.addEventListener('keydown', s.onKey, true);
  document.documentElement.appendChild(host);
  st = s;
  applyPage(s);
  load(s, page, hash);
  if (reduced()) bd.classList.add('in'); else requestAnimationFrame(() => bd.classList.add('in'));
  s.el.close.focus();
}

/** Test/automation hooks. */
export function getOverlayGeometry(): Geo | null { return st ? { ...st.geo } : null; }
export function setOverlayGeometry(g: Geo): void { if (st) { const { vw, vh } = vp(); st.maximized = false; setGeo(st, clampGeo(g, vw, vh), true); } }

export function closeOverlay(): void {
  const s = st;
  if (!s) return;
  st = null;
  window.clearTimeout(s.timer);
  document.removeEventListener('keydown', s.onKey, true);
  window.removeEventListener('resize', s.onResize);
  s.host.remove();
  const p = s.prevFocus as HTMLElement | null;
  try { if (p && p.isConnected) p.focus(); } catch { /* ignore */ }
}

/** Lets the popup open the overlay via chrome.tabs.sendMessage. */
export function mountOverlayListener(): void {
  if (listenerInstalled) return;
  listenerInstalled = true;
  try {
    chrome.runtime.onMessage.addListener((m: unknown, sender) => {
      const msg = m as { kind?: string; page?: string } | null;
      if (!msg || msg.kind !== 'ui:overlay' || sender.id !== chrome.runtime.id) return false;
      if (typeof msg.page !== 'string' || !PAGES.some((p) => p.id === msg.page)) return false;
      openOverlay(msg.page as OverlayPage);
      return false;
    });
  } catch { /* extension context invalidated */ }
}
