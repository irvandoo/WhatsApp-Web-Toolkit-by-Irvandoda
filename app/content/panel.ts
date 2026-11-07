import { CREDIT } from '../shared/credit';
import { call } from './bridge';
import { jsHeapMB } from './memory';
import { restoreSession, saveSession } from './session';
import type { Account, RuntimeMsg, SessionMeta } from '../shared/messages';
import { listChats, ping, syncAll, syncChat, type SyncProgress } from './sync';
import { icon } from './panel-icons';
import { PANEL_CSS } from './panel-style';
import { mountNavButton } from './nav-button';
import { mountOverlayListener, openOverlay, type OverlayPage } from './overlay';

type Props = Record<string, string>;

const POS_KEY = 'wwt-fab-y';
const TABS = [
  { id: 'sync', label: 'Sync', ic: 'sync' },
  { id: 'mem', label: 'Memori', ic: 'memory' },
  { id: 'acc', label: 'Akun', ic: 'user' },
  { id: 'mod', label: 'Modul', ic: 'grid' },
  { id: 'ses', label: 'Sesi', ic: 'session' },
  { id: 'abt', label: 'Tentang', ic: 'info' },
] as const;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) el.setAttribute(k, v);
  for (const k of kids) el.append(k);
  return el;
}
const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
const send = async <T,>(m: RuntimeMsg): Promise<T | undefined> => {
  try { if (!alive()) return undefined; return (await chrome.runtime.sendMessage(m)) as T; } catch { return undefined; }
};

export function mountPanel(): void {
  if (document.getElementById('wwt-panel')) return;
  mountOverlayListener();
  const host = h('div', { id: 'wwt-panel' });
  const root = host.attachShadow({ mode: 'closed' });
  const wrap = h('div', { class: 'root' });

  // ---- FAB
  const badge = h('span', { class: 'badge', hidden: '' });
  const fab = h('button', { class: 'fab', type: 'button', 'aria-label': `Buka ${CREDIT.product}`, 'aria-expanded': 'false', title: CREDIT.product }, icon('brand', 26), badge);

  // ---- panel skeleton
  const pill = h('span', { class: 'pill bad' });
  const pillTxt = h('span', {}, 'Memeriksa');
  pill.append(pillTxt);
  const closeBtn = h('button', { class: 'x', type: 'button', 'aria-label': 'Tutup panel' }, icon('close'));
  const header = h('header', {},
    h('div', { class: 'logo' }, icon('brand', 20)),
    h('div', { class: 'ttl' }, h('b', {}, 'WA Web Toolkit'), h('small', {}, 'by Irvandoda')),
    pill, closeBtn);
  const nav = h('nav', { role: 'tablist', 'aria-label': 'Modul' });
  const main = h('main');
  const live = h('footer', { 'aria-live': 'polite' });
  const panel = h('div', { class: 'panel', role: 'dialog', 'aria-label': CREDIT.product }, header, nav, main, live);
  wrap.append(fab, panel);
  root.append(h('style', {}, PANEL_CSS), wrap);
  document.documentElement.appendChild(host);

  const say = (s: string) => { live.textContent = s; };
  const btn = (label: string, ic: string | null, cls = '') => {
    const b = h('button', { class: `btn ${cls}`.trim(), type: 'button' });
    if (ic) b.append(icon(ic, 16));
    b.append(label);
    return b;
  };
  const kv = (k: string, v: string) => { const val = h('span', {}, v); return { row: h('div', { class: 'kv' }, h('span', {}, k), val), val }; };

  // ---- Sync tab
  const bSync1 = btn('Sync chat terbuka', 'sync', 'pri'), bSyncAll = btn('Sync semua', 'sync'), bStop = btn('Stop', 'stop', 'dan');
  bStop.disabled = true;
  const chatList = h('div', {}, h('div', { class: 'empty' }, 'Belum ada sync berjalan.'));
  const syncCount = kv('Chat diproses', '0');
  const syncMsgs = kv('Total pesan termuat', '0');
  const secSync = h('section', {},
    h('p', {}, 'Muat riwayat chat lama lalu arsipkan secara lokal. Berjalan pelan agar aman bagi akun.'),
    h('div', { class: 'row' }, bSync1, bSyncAll, bStop),
    h('div', { class: 'card' }, syncCount.row, syncMsgs.row), chatList);

  // ---- Memori tab
  const heapKv = kv('JS heap', '-');
  const heapFill = h('i');
  const saverKv = kv('Mode hemat', '-');
  const bTrim = btn('Bersihkan memori', 'broom', 'pri');
  const secMem = h('section', {},
    h('div', { class: 'card' }, heapKv.row, h('div', { class: 'bar', role: 'img', 'aria-label': 'Penggunaan JS heap' }, heapFill), saverKv.row),
    h('p', {}, 'Mode hemat mematikan animasi saat tab tersembunyi. Bersihkan memori memangkas pesan yang dimuat di chat yang tidak sedang dibuka.'),
    h('div', { class: 'row' }, bTrim));

  // ---- Akun tab
  const accId = kv('ID akun', '-'), accName = kv('Nama', '-'), accUnread = kv('Belum dibaca', '-');
  const openers: [string, OverlayPage][] = [['Buka Hub', 'dashboard'], ['Buka CRM', 'crm'], ['Buka Template', 'templates'], ['Buka Analitik', 'analytics']];
  const openRow = h('div', { class: 'row' });
  for (const [label, page] of openers) {
    const b = btn(label, 'external');
    b.addEventListener('click', () => { close(); openOverlay(page); });
    openRow.append(b);
  }
  const secAcc = h('section', {}, h('div', { class: 'card' }, accId.row, accName.row, accUnread.row), openRow);

  // ---- Modul tab
  const tiles = h('div', { class: 'tiles' });
  for (const t of ['POS', 'Blast', 'Ekstrak grup']) tiles.append(h('div', { class: 'tile' }, h('b', {}, t), h('small', {}, 'Segera')));
  const modRow = h('div', { class: 'row' });
  for (const [label, page] of [['Hub', 'dashboard'], ['CRM', 'crm'], ['Template', 'templates'], ['Analitik', 'analytics']] as [string, OverlayPage][]) {
    const b = btn(label, 'external');
    b.addEventListener('click', () => { close(); openOverlay(page); });
    modRow.append(b);
  }
  const secMod = h('section', {},
    h('h3', {}, 'CRM & Template'),
    h('div', { class: 'card' },
      h('p', {}, 'Template: ketik ', h('code', {}, '/kode'), ' di kolom pesan lalu pilih template. Variabel seperti nama akan diisi otomatis.'),
      h('p', {}, 'CRM: bar CRM muncul di atas chat yang terbuka. Atur tahap, tag, dan pengingat langsung dari sana.')),
    h('h3', {}, 'Buka modul'), modRow,
    h('h3', {}, 'Akan datang'), tiles);

  // ---- Sesi tab
  const bSave = btn('Simpan sesi', 'session'), bRestore = btn('Pulihkan sesi', 'session', 'dan');
  const secSes = h('section', {},
    h('div', { class: 'warnbox' }, icon('warn'), h('div', {}, 'Eksperimental. Penyimpanan WhatsApp memakai kunci yang tidak selalu bisa disalin, jadi hasilnya bisa gagal. Memulihkan akan menghapus data penyimpanan WhatsApp Web saat ini.')),
    h('div', { class: 'row' }, bSave, bRestore));

  // ---- Tentang tab
  const link = (text: string, href: string) => h('a', { class: 'lnk', href, target: '_blank', rel: 'noopener noreferrer' }, text);
  const secAbt = h('section', {},
    h('div', { class: 'card' },
      h('b', {}, CREDIT.product),
      h('p', {}, `Dibuat oleh ${CREDIT.name} (${CREDIT.nickname}).`),
      h('div', { class: 'kv' }, h('span', {}, 'Email'), link(CREDIT.email, `mailto:${CREDIT.email}`)),
      h('div', { class: 'kv' }, h('span', {}, 'Web'), link('irvandoda.web.id', CREDIT.web))),
    h('p', {}, 'Alat bantu independen, bukan produk resmi WhatsApp atau Meta.'));

  const sections: Record<string, HTMLElement> = { sync: secSync, mem: secMem, acc: secAcc, mod: secMod, ses: secSes, abt: secAbt };
  const tabBtns: HTMLButtonElement[] = [];
  for (const t of TABS) {
    const tb = h('button', { class: 'tab', type: 'button', role: 'tab', id: `wwt-tab-${t.id}`, 'aria-controls': `wwt-sec-${t.id}`, 'aria-selected': 'false', tabindex: '-1' }, icon(t.ic, 18), t.label);
    tb.addEventListener('click', () => select(t.id));
    nav.append(tb);
    tabBtns.push(tb);
    const s = sections[t.id];
    s.setAttribute('role', 'tabpanel');
    s.id = `wwt-sec-${t.id}`;
    s.setAttribute('aria-labelledby', `wwt-tab-${t.id}`);
    s.hidden = true;
    main.append(s);
  }
  let tab = 'sync';
  function select(id: string) {
    tab = id;
    TABS.forEach((t, i) => {
      const on = t.id === id;
      tabBtns[i].setAttribute('aria-selected', String(on));
      tabBtns[i].tabIndex = on ? 0 : -1;
      sections[t.id].hidden = !on;
    });
    void refresh();
  }
  nav.addEventListener('keydown', (e) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const n = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : -1;
    if (n < 0) return;
    e.preventDefault();
    select(TABS[n].id);
    tabBtns[n].focus();
  });

  // ---- sync state (survives panel close)
  let ctl: AbortController | null = null;
  const rows = new Map<string, { fill: HTMLElement; info: HTMLElement }>();
  const totals = new Map<string, SyncProgress>();
  const running = () => !!ctl && !ctl.signal.aborted;
  function setRunning(on: boolean) {
    fab.classList.toggle('run', on);
    bStop.disabled = !on;
    bSync1.disabled = on;
    bSyncAll.disabled = on;
  }
  const prog = (p: SyncProgress) => {
    totals.set(p.chatId, p);
    let r = rows.get(p.chatId);
    if (!r) {
      if (!rows.size) chatList.textContent = '';
      const fill = h('i');
      const info = h('span', {});
      chatList.append(h('div', { class: 'chat' }, h('div', { class: 'kv' }, h('span', { class: 'nm' }, p.name || p.chatId), info), h('div', { class: 'bar' }, fill)));
      r = { fill, info };
      rows.set(p.chatId, r);
    }
    r.info.textContent = `${p.total} pesan · ronde ${p.rounds}${p.done ? (p.error ? ' · gagal' : p.reachedStart ? ' · awal tercapai' : ' · selesai') : ''}`;
    r.fill.className = p.done ? (p.error ? 'bad' : '') : 'ind';
    r.fill.style.width = p.done ? '100%' : '';
    if (p.error) say(`${p.name}: ${p.error}`);
    let msgs = 0, done = 0;
    totals.forEach((t) => { msgs += t.total; if (t.done) done++; });
    syncCount.val.textContent = `${done} / ${totals.size}`;
    syncMsgs.val.textContent = String(msgs);
  };
  const resetSync = () => { rows.clear(); totals.clear(); chatList.textContent = ''; syncCount.val.textContent = '0'; syncMsgs.val.textContent = '0'; };

  bStop.addEventListener('click', () => { ctl?.abort(); say('Menghentikan sync…'); });
  bTrim.addEventListener('click', async () => {
    try { const r = await call<{ trimmed: number }>({ type: 'memory:trim' }); say(`Memori: ${r.trimmed} chat dipangkas`); void refresh(); }
    catch (e) { say(String(e)); }
  });
  bSync1.addEventListener('click', async () => {
    if (running()) return;
    const title = document.querySelector<HTMLElement>('#main header span[title]')?.title;
    const chats = await listChats().catch(() => []);
    const chat = chats.find((c) => c.name === title);
    if (!chat) return say('Buka sebuah chat dulu (atau Store belum terdeteksi).');
    resetSync();
    ctl = new AbortController();
    setRunning(true);
    try { await syncChat(chat, ctl.signal, prog); say('Selesai.'); } finally { setRunning(false); }
  });
  bSyncAll.addEventListener('click', async () => {
    if (running()) return;
    const chats = await listChats().catch(() => []);
    if (!chats.length) return say('Daftar chat kosong / Store tidak terdeteksi.');
    resetSync();
    ctl = new AbortController();
    setRunning(true);
    try { await syncAll(chats, ctl.signal, prog); say(ctl.signal.aborted ? 'Dihentikan.' : 'Selesai.'); } finally { setRunning(false); }
  });
  bSave.addEventListener('click', async () => {
    try {
      const id = (await ping()).accountId;
      if (!id) return say('Akun belum terdeteksi.');
      say('Menyimpan sesi (EKSPERIMENTAL)…');
      const r = await saveSession(id, new Date().toLocaleString());
      say(r.ok ? `Sesi tersimpan (${Math.round(r.bytes / 1024)} KB).` : `Gagal (${r.reason}): ${r.details.slice(0, 5).join(', ')}${r.details.length > 5 ? ' …' : ''}`);
    } catch (e) { say(String(e)); }
  });
  bRestore.addEventListener('click', async () => {
    try {
      const id = (await ping()).accountId;
      const list = (await chrome.runtime.sendMessage({ kind: 'session:list', accountId: id ?? undefined } satisfies RuntimeMsg)) as SessionMeta[];
      const last = Array.isArray(list) ? list.sort((a, b) => b.createdAt - a.createdAt)[0] : undefined;
      if (!last) return say('Belum ada sesi tersimpan untuk akun ini.');
      if (!confirm(`EKSPERIMENTAL: ini menghapus semua data penyimpanan WhatsApp Web saat ini dan menggantinya dengan sesi "${last.label}". Lanjutkan?`)) return;
      await restoreSession(last.id, { confirm: true });
    } catch (e) { say(String(e)); }
  });

  // ---- status refresh (only while open)
  let busy = false;
  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      let p: Awaited<ReturnType<typeof ping>> | null = null;
      try { p = await ping(); } catch { /* adapter not ready */ }
      pill.className = `pill ${p ? (p.store ? 'ok' : 'warn') : 'bad'}`;
      pillTxt.textContent = p ? (p.store ? 'Siap' : 'Store belum terdeteksi') : 'Adapter belum siap';
      const heap = jsHeapMB();
      heapKv.val.textContent = heap ? `${heap} MB` : 'tidak tersedia';
      const pct = heap ? Math.min(100, (heap / 2048) * 100) : 0;
      heapFill.style.width = `${pct}%`;
      heapFill.className = heap && heap > 1536 ? 'bad' : heap && heap > 1024 ? 'warn' : '';
      saverKv.val.textContent = document.documentElement.dataset.wwtSaver === '1' ? 'aktif (tab tersembunyi)' : 'siaga';
      accId.val.textContent = p?.accountId ?? 'belum terdeteksi';
      if (tab === 'acc' && p?.accountId) {
        const list = await send<Account[]>({ kind: 'account:list' });
        const a = Array.isArray(list) ? list.find((x) => x.id === p!.accountId) : undefined;
        accName.val.textContent = a?.name || '-';
        accUnread.val.textContent = a ? String(a.unread) : '-';
      }
    } finally { busy = false; }
  }

  // ---- unread badge (cheap, every 30s, also when closed)
  async function refreshBadge() {
    if (!alive()) return;
    try {
      const id = (await ping()).accountId;
      const list = await send<Account[]>({ kind: 'account:list' });
      const a = id && Array.isArray(list) ? list.find((x) => x.id === id) : undefined;
      const n = a?.unread ?? 0;
      badge.hidden = n <= 0;
      badge.textContent = n > 99 ? '99+' : String(n);
    } catch { badge.hidden = true; }
  }
  setTimeout(() => void refreshBadge(), 5000);
  window.setInterval(() => void refreshBadge(), 30_000);

  // ---- theme
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  const applyTheme = () => {
    const dark = document.body?.classList.contains('dark') || document.documentElement.classList.contains('dark') || (!!mq?.matches && !document.body?.classList.contains('light'));
    wrap.classList.toggle('dark', dark);
  };
  applyTheme();
  mq?.addEventListener?.('change', applyTheme);
  if (document.body) new MutationObserver(applyTheme).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // ---- navbar entry (preferred) — the floating button is only a fallback
  const navBtn = mountNavButton({
    label: CREDIT.product,
    onClick: () => { if (isOpen) close(); else open(); },
    onPresence: (present) => wrap.classList.toggle('nav', present),
  });

  // ---- open / close
  let timer: number | undefined;
  let isOpen = false;
  const reduce = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  function open() {
    isOpen = true;
    applyTheme();
    panel.classList.add('show');
    fab.setAttribute('aria-expanded', 'true');
    navBtn.setPressed(true);
    if (reduce()) panel.classList.add('in'); else requestAnimationFrame(() => panel.classList.add('in'));
    select(tab);
    timer = window.setInterval(() => { if (!alive()) return close(); void refresh(); }, 3000);
    closeBtn.focus();
  }
  function close(refocus = false) {
    isOpen = false;
    if (timer) clearInterval(timer);
    timer = undefined;
    panel.classList.remove('in');
    fab.setAttribute('aria-expanded', 'false');
    navBtn.setPressed(false);
    const hide = () => { if (!isOpen) panel.classList.remove('show'); };
    if (reduce()) hide(); else setTimeout(hide, 170);
    if (refocus) { if (navBtn.present()) navBtn.focus(); else fab.focus(); }
  }
  closeBtn.addEventListener('click', () => close(true));
  document.addEventListener('keydown', (e) => { if (isOpen && e.key === 'Escape') close(true); }, true);
  document.addEventListener('mousedown', (e) => { if (isOpen && !e.composedPath().includes(host) && !(e.target as Element | null)?.closest?.('[data-wwt-nav]')) close(); }, true);

  // ---- FAB drag (vertical) + position persistence
  const SIZE = 48, MARGIN = 16;
  const clampY = (y: number) => Math.max(MARGIN, Math.min(window.innerHeight - SIZE - MARGIN, y));
  let fabY = Math.round(window.innerHeight * 0.4); // mid-right: never over the composer's send/voice button
  try { const v = parseFloat(localStorage.getItem(POS_KEY) ?? ''); if (Number.isFinite(v)) fabY = v; } catch { /* storage blocked */ }
  const place = () => { fabY = clampY(fabY); fab.style.top = `${fabY}px`; };
  place();
  window.addEventListener('resize', place);
  let startY = 0, startTop = 0, dragging = false, moved = false;
  fab.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    startY = e.clientY; startTop = fabY; dragging = true; moved = false;
    try { fab.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  fab.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    if (!moved && Math.abs(dy) < 4) return;
    moved = true;
    fab.classList.add('drag');
    fabY = clampY(startTop + dy);
    fab.style.top = `${fabY}px`;
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    fab.classList.remove('drag');
    if (moved) { try { localStorage.setItem(POS_KEY, String(Math.round(fabY))); } catch { /* ignore */ } }
  };
  fab.addEventListener('pointerup', endDrag);
  fab.addEventListener('pointercancel', endDrag);
  fab.addEventListener('click', () => {
    if (moved) { moved = false; return; } // a drag is not a click
    if (isOpen) close(); else open();
  });
}
