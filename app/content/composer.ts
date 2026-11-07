import type { Contact, Template } from '../shared/crm-types';
import type { ChatInfo } from '../shared/messages';
import { type TplVars } from '../shared/template-engine';
import { ROT_KEY, renderWithRotation, sanitizeRotStore } from '../shared/rotation';
import { listChats } from './sync';
import { insertErrorText, insertIntoComposer, showToast } from './composer-insert';

const SEL = ['footer [contenteditable="true"][role="textbox"]', '#main footer div[contenteditable="true"]'];
const isComposer = (el: Element | null): el is HTMLElement => !!el && SEL.some((s) => el.matches(s));
const findComposer = (t: EventTarget | null): HTMLElement | null => {
  if (!(t instanceof Element)) return null;
  const ce = t.closest('[contenteditable="true"]');
  return isComposer(ce) ? ce : null;
};

let mounted = false;
let dead = false;
let templates: Template[] = [];
let chatsCache: { at: number; list: ChatInfo[] } = { at: 0, list: [] };
let contactsCache: { at: number; list: Contact[] } = { at: 0, list: [] };

const alive = () => { try { return !dead && !!chrome.runtime?.id; } catch { return false; } };

async function loadTemplates() {
  if (!alive()) return;
  try {
    const r = await chrome.runtime.sendMessage({ kind: 'tpl:list' });
    if (Array.isArray(r)) templates = r as Template[];
  } catch { /* context invalidated or worker asleep */ }
}

// ---------- popup (Shadow DOM) ----------
let host: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let items: Template[] = [];
let sel = 0;
let activeComposer: HTMLElement | null = null;

function ensureHost() {
  if (host) return;
  host = document.createElement('div');
  host.style.cssText = 'position:fixed;z-index:2147483646;display:none';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host{all:initial}
    .box{font:13px system-ui,sans-serif;background:#fff;color:#111;border:1px solid #ccc;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.25);min-width:260px;max-width:360px;max-height:240px;overflow:auto}
    @media (prefers-color-scheme:dark){.box{background:#233138;color:#e9edef;border-color:#3b4a54}}
    .it{padding:6px 10px;cursor:pointer;display:flex;flex-direction:column;gap:2px}
    .it.on{background:rgba(0,168,132,.2)}
    .sc{font-weight:600}.ti{opacity:.7;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .hint{padding:4px 10px;font-size:11px;opacity:.6;border-top:1px solid rgba(128,128,128,.3)}`;
  listEl = document.createElement('div');
  listEl.className = 'box';
  root.append(style, listEl);
  document.documentElement.appendChild(host);
}

function paint() {
  if (!listEl) return;
  listEl.replaceChildren();
  items.forEach((t, i) => {
    const d = document.createElement('div');
    d.className = 'it' + (i === sel ? ' on' : '');
    const a = document.createElement('span'); a.className = 'sc'; a.textContent = '/' + t.shortcut;
    const b = document.createElement('span'); b.className = 'ti'; b.textContent = t.title + (t.category ? ` · ${t.category}` : '');
    d.append(a, b);
    d.addEventListener('mousedown', (e) => { e.preventDefault(); void pick(t); });
    listEl!.appendChild(d);
  });
  const h = document.createElement('div');
  h.className = 'hint'; h.textContent = '↑↓ pilih · Enter/Tab sisipkan · Esc tutup';
  listEl.appendChild(h);
}

function show(c: HTMLElement) {
  ensureHost();
  const r = c.getBoundingClientRect();
  host!.style.left = `${Math.max(8, r.left)}px`;
  host!.style.bottom = `${Math.max(8, window.innerHeight - r.top + 8)}px`;
  host!.style.display = 'block';
  activeComposer = c;
  paint();
}
function hide() { if (host) host.style.display = 'none'; items = []; activeComposer = null; }
const isOpen = () => !!host && host.style.display !== 'none' && items.length > 0;

// ---------- context ----------
function chatName(): string {
  const h = document.querySelector('#main header');
  const s = h?.querySelector('span[title]') ?? h?.querySelector('span[dir="auto"]');
  return (s?.getAttribute('title') || s?.textContent || '').trim();
}

async function buildVars(): Promise<TplVars> {
  const nama = chatName();
  let telepon = '', tahap = '';
  const now = Date.now();
  try {
    if (now - chatsCache.at > 30_000) chatsCache = { at: now, list: await listChats() };
    const ch = chatsCache.list.find((c) => c.name === nama && !c.isGroup);
    if (ch) telepon = ch.id.split('@')[0].replace(/\D/g, '');
  } catch { /* bridge unavailable */ }
  try {
    if (alive() && now - contactsCache.at > 30_000) {
      const r = await chrome.runtime.sendMessage({ kind: 'crm:contact:list' });
      contactsCache = { at: now, list: Array.isArray(r) ? (r as Contact[]) : [] };
    }
    const c = contactsCache.list.find((x) => (telepon && x.phone === telepon) || (!telepon && x.name === nama));
    if (c) tahap = c.stage ?? '';
  } catch { /* CRM not available */ }
  const tanggal = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const v: TplVars = { tanggal, tahap };
  if (nama) v.nama = nama;
  if (telepon) v.telepon = telepon;
  return v;
}

// ---------- insertion ----------
async function pick(t: Template) {
  const c = activeComposer;
  hide();
  if (!c || !alive()) return;
  const vars = await buildVars();
  let store = sanitizeRotStore(undefined);
  try { store = sanitizeRotStore((await chrome.storage.local.get(ROT_KEY))[ROT_KEY]); } catch { /* ignore */ }
  const r = renderWithRotation(t, vars, store[t.id]);
  if (t.variants?.some((v) => v.trim())) { store[t.id] = r.state; try { await chrome.storage.local.set({ [ROT_KEY]: store }); } catch { /* ignore */ } }
  const ins = await insertIntoComposer(r.text, { mode: 'replace', composer: c });
  if (!ins.ok) { showToast(insertErrorText(ins)); return; }
  try { await chrome.runtime.sendMessage({ kind: 'tpl:use', id: t.id }); } catch { /* ignore */ }
}

// ---------- events ----------
function onInput(e: Event) {
  if (!alive()) return teardown();
  const c = findComposer(e.target);
  if (!c) return;
  const m = /^\/([a-z0-9_-]{0,24})$/i.exec((c.innerText ?? '').replace(/​/g, '').trim());
  if (!m) return hide();
  const q = m[1].toLowerCase();
  items = templates
    .filter((t) => !q || t.shortcut.includes(q) || t.title.toLowerCase().includes(q))
    .sort((a, b) => Number(b.shortcut.startsWith(q)) - Number(a.shortcut.startsWith(q)))
    .slice(0, 8);
  sel = 0;
  if (items.length) show(c); else hide();
}

function onKey(e: KeyboardEvent) {
  if (!isOpen() || !findComposer(e.target)) return;
  const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
  if (e.key === 'ArrowDown') { stop(); sel = (sel + 1) % items.length; paint(); }
  else if (e.key === 'ArrowUp') { stop(); sel = (sel - 1 + items.length) % items.length; paint(); }
  else if (e.key === 'Enter' || e.key === 'Tab') { stop(); void pick(items[sel]); }
  else if (e.key === 'Escape') { stop(); hide(); }
}

let timer: ReturnType<typeof setInterval> | undefined;
const onStorage = () => { void loadTemplates(); };

function teardown() {
  dead = true;
  hide();
  clearInterval(timer);
  document.removeEventListener('input', onInput, true);
  document.removeEventListener('keydown', onKey, true);
  host?.remove();
  host = null;
}

export function mountComposer(): void {
  if (mounted) return;
  mounted = true;
  void loadTemplates();
  document.addEventListener('input', onInput, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('mousedown', (e) => { if (host && !e.composedPath().includes(host)) hide(); }, true);
  try { chrome.storage.onChanged.addListener(onStorage); } catch { /* ignore */ }
  timer = setInterval(() => { if (alive()) void loadTemplates(); else teardown(); }, 60_000);
}
