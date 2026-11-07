/** In-page modal overlay (closed shadow DOM) that frames extension pages over WhatsApp Web. */
export type OverlayPage = 'dashboard' | 'crm' | 'templates' | 'analytics';
const PAGES: { id: OverlayPage; label: string; d: string }[] = [
  { id: 'dashboard', label: 'Hub Akun', d: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>' },
  { id: 'crm', label: 'CRM', d: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.5 3.2-5.5 6.5-5.5s5.9 2 6.5 5.5M17 11a3 3 0 1 0 0-6M18.5 14.7c1.8.6 3 2.3 3.3 5"/>' },
  { id: 'templates', label: 'Template', d: '<path d="M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V5a1 1 0 0 1 1-1z"/><path d="M8 9h8M8 12h5"/>' },
  { id: 'analytics', label: 'Analitik', d: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>' },
];
const TITLES: Record<OverlayPage, string> = { dashboard: 'Hub Akun', crm: 'CRM', templates: 'Template', analytics: 'Analitik' };
const LOAD_TIMEOUT = 5000;

const CSS = `
:host{all:initial}
*{box-sizing:border-box}
.bd{--bg:#fff;--fg:#111b21;--mut:#667781;--bd:#e2e8ea;--hov:rgba(18,140,126,.1);--g:#128c7e;
 position:fixed;inset:0;z-index:2147483600;display:grid;place-items:center;background:rgba(11,20,26,.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
 font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg);opacity:0;transition:opacity .18s ease}
.bd.dark{--bg:#111b21;--fg:#e9edef;--mut:#8696a0;--bd:#26343c;--hov:rgba(37,211,102,.14);--g:#25d366}
.bd.in{opacity:1}
.card{width:min(1180px,94vw);height:88vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--bd);border-radius:16px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.45);transform:translateY(10px) scale(.985);transition:transform .2s ease}
.bd.in .card{transform:none}
header{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--bd);flex:none}
.mk{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#128c7e,#25d366);display:grid;place-items:center;color:#fff;flex:none}
h2{margin:0;font-size:15px;font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
button{font:inherit;color:inherit;cursor:pointer}
.hb{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 10px;border:1px solid var(--bd);background:transparent;border-radius:9px}
.ib{width:34px;padding:0;justify-content:center}
.hb:hover,.rail button:hover{background:var(--hov)}
button:focus-visible{outline:2px solid var(--g);outline-offset:2px}
.body{flex:1;display:flex;min-height:0}
.rail{width:62px;flex:none;border-right:1px solid var(--bd);padding:8px 6px;display:flex;flex-direction:column;gap:4px}
.rail button{border:0;background:transparent;border-radius:10px;padding:8px 2px;display:flex;flex-direction:column;align-items:center;gap:3px;font-size:10px;color:var(--mut)}
.rail button[aria-current=page]{background:var(--hov);color:var(--g);font-weight:700}
.stage{position:relative;flex:1;min-width:0;background:var(--bg)}
iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:var(--bg)}
iframe.h{visibility:hidden}
.sk{position:absolute;inset:0;padding:24px;display:flex;flex-direction:column;gap:14px}
.sk i{display:block;height:18px;border-radius:8px;background:linear-gradient(90deg,var(--hov),var(--bd),var(--hov));background-size:200% 100%;animation:sh 1.2s linear infinite}
.sk i:nth-child(1){width:35%;height:26px}.sk i:nth-child(3){width:80%}.sk i:nth-child(4){height:120px}
@keyframes sh{to{background-position:-200% 0}}
.fb{position:absolute;inset:0;display:grid;place-content:center;gap:14px;text-align:center;padding:24px;justify-items:center}
.fb button{background:var(--g);color:#fff;border:0;height:38px;padding:0 16px;border-radius:10px;font-weight:600}
[hidden]{display:none!important}
@media (max-width:640px){.card{width:100vw;height:100vh;border-radius:0}.hb span{display:none}}
@media (prefers-reduced-motion:reduce){.bd,.card{transition:none}.sk i{animation:none}}
`;

const svg = (d: string, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };

interface State {
  host: HTMLElement;
  el: { bd: HTMLElement; title: HTMLElement; frame: HTMLIFrameElement; sk: HTMLElement; fb: HTMLElement; rail: HTMLButtonElement[]; close: HTMLElement };
  page: OverlayPage;
  prevFocus: Element | null;
  timer?: number;
  onKey: (e: KeyboardEvent) => void;
}
let st: State | null = null;
let listenerInstalled = false;

const isDark = () => document.body?.classList.contains('dark') || document.documentElement.classList.contains('dark') ||
  (!!window.matchMedia?.('(prefers-color-scheme: dark)').matches && !document.body?.classList.contains('light'));
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function load(s: State, page: OverlayPage): void {
  s.page = page;
  const { el } = s;
  el.title.textContent = TITLES[page];
  el.rail.forEach((b) => { if (b.dataset.page === page) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  el.sk.hidden = false; el.fb.hidden = true; el.frame.classList.add('h');
  window.clearTimeout(s.timer);
  s.timer = window.setTimeout(() => { if (!el.sk.hidden) { el.sk.hidden = true; el.fb.hidden = false; } }, LOAD_TIMEOUT);
  el.frame.onload = () => {
    window.clearTimeout(s.timer);
    el.sk.hidden = true; el.fb.hidden = true; el.frame.classList.remove('h');
  };
  try { el.frame.src = chrome.runtime.getURL(`${page}/index.html`); } catch { el.sk.hidden = true; el.fb.hidden = false; }
}

function openTab(page: OverlayPage): void {
  try { if (alive()) void chrome.runtime.sendMessage({ kind: 'ui:open', page }); } catch { /* ignore */ }
}

export function openOverlay(page: OverlayPage): void {
  if (!PAGES.some((p) => p.id === page)) return;
  if (st) { load(st, page); return; }
  const host = document.createElement('div');
  host.id = 'wwt-overlay';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style'); style.textContent = CSS;
  const bd = document.createElement('div'); bd.className = 'bd' + (isDark() ? ' dark' : '');
  // Only constant strings are interpolated here.
  bd.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-labelledby="t">
<header><div class="mk">${svg('<path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.7-1.2A9 9 0 1 0 12 3z"/>', 16)}</div><h2 id="t"></h2>
<button class="hb" type="button" data-a="tab" title="Buka di tab baru">${svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', 16)}<span>Buka di tab</span></button>
<button class="hb ib" type="button" data-a="min" aria-label="Minimalkan" title="Minimalkan">${svg('<path d="M5 12h14"/>', 16)}</button>
<button class="hb ib" type="button" data-a="x" aria-label="Tutup" title="Tutup (Esc)">${svg('<path d="M6 6l12 12M18 6L6 18"/>', 16)}</button></header>
<div class="body"><nav class="rail" aria-label="Modul">${PAGES.map((p) => `<button type="button" data-page="${p.id}" title="${p.label}" aria-label="${p.label}">${svg(p.d, 20)}<span>${p.label}</span></button>`).join('')}</nav>
<div class="stage"><iframe title="Modul" referrerpolicy="no-referrer"></iframe>
<div class="sk" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
<div class="fb" hidden><div>Tampilan tidak dapat dimuat di halaman ini.</div><button type="button" data-a="tab">Buka di tab</button></div></div></div></div>`;
  root.append(style, bd);
  const q = <T extends Element>(sel: string) => bd.querySelector(sel) as T;
  const s: State = {
    host, page,
    prevFocus: document.activeElement,
    el: { bd, title: q('h2'), frame: q<HTMLIFrameElement>('iframe'), sk: q('.sk'), fb: q('.fb'), rail: Array.from(bd.querySelectorAll<HTMLButtonElement>('.rail button')), close: q('[data-a=x]') },
    onKey: () => undefined,
  };
  s.onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeOverlay(); return; }
    if (e.key !== 'Tab') return;
    const f = Array.from(bd.querySelectorAll<HTMLElement>('button')).filter((b) => !b.closest('[hidden]'));
    if (!f.length) return;
    const act = root.activeElement as HTMLElement | null;
    const first = f[0], last = f[f.length - 1];
    if (!act || (e.shiftKey && act === first)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (!e.shiftKey && act === last) { e.preventDefault(); first.focus(); }
  };
  bd.addEventListener('mousedown', (e) => { if (e.target === bd) closeOverlay(); });
  bd.addEventListener('click', (e) => {
    const t = (e.target as Element).closest('button');
    if (!t) return;
    if (t.dataset.page) { load(s, t.dataset.page as OverlayPage); return; }
    if (t.dataset.a === 'x' || t.dataset.a === 'min') closeOverlay();
    else if (t.dataset.a === 'tab') openTab(s.page);
  });
  document.addEventListener('keydown', s.onKey, true);
  document.documentElement.appendChild(host);
  st = s;
  load(s, page);
  if (reduced()) bd.classList.add('in'); else requestAnimationFrame(() => bd.classList.add('in'));
  s.el.close.focus();
}

export function closeOverlay(): void {
  const s = st;
  if (!s) return;
  st = null;
  window.clearTimeout(s.timer);
  document.removeEventListener('keydown', s.onKey, true);
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
