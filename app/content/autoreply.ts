import { ROT_KEY, sanitizeRotStore, type RotStore } from '../shared/rotation';
import { call } from './bridge';
import { sendSilent } from './send-settings';
import { insertErrorText, insertIntoComposer, type InsertResult } from './composer-insert';
import { IS_FULL } from '../shared/credit';
import type { ExplainCheck, ExplainItem, ExplainResult } from '../shared/messages';
import { phoneFromChatId } from '../shared/crm-logic';
import { decide, isGroupKey, overRateLimit, scopeOf } from '../shared/autoreply-logic';
import {
  AR_GLOBAL_KEY, DEFAULT_AR_GLOBAL, type ArCtx, type ArGlobal, type ArLogEntry, type ArMsg, type ArRule, type InboxItem,
} from '../shared/autoreply-types';
import type { PingResult } from '../shared/messages';
import { setEngine } from '../shared/runmode';
import { isEngineOn, reportHealth } from './engine-health';
import type { TplVars } from '../shared/template-engine';

const POLL_MS = 5000;
const RULES_MS = 15_000;
const LOG_REFRESH_MS = 60_000;
const DRAFT_TTL_MS = 30 * 60_000;

export interface AutoReplyState {
  enabled: boolean;      // global "Auto-reply aktif"
  autoSend: boolean;     // global "Auto-kirim" (only effective in the full flavor)
  canSend: boolean;      // full flavor AND send:text not known to be unavailable
  active: boolean;      // enabled && at least one enabled rule
  pendingSends: number;
  pendingDrafts: number;
}

let global: ArGlobal = { ...DEFAULT_AR_GLOBAL };
let rules: ArRule[] = [];
let log: ArLogEntry[] = [];
let sendAvailable = true;
let pendingSends = 0;
const drafts = new Map<string, { name: string; text: string; at: number }>(); // chatKey -> draft waiting for the chat to be opened
const handled = new Map<string, string>(); // chatKey -> last msgId already decided
const inflight = new Set<string>();
const listeners = new Set<(s: AutoReplyState) => void>();
let sinceTs = Date.now();
let accountId: string | null = null;
let accountName = '';
let mounted = false;
let dead = false;
let queue: Promise<void> = Promise.resolve();

const alive = () => { try { return !dead && !!chrome.runtime?.id; } catch { return false; } };
const send = <T>(m: ArMsg): Promise<T> => chrome.runtime.sendMessage(m) as Promise<T>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function getAutoReplyState(): AutoReplyState {
  return {
    enabled: global.enabled, autoSend: global.autoSend && IS_FULL,
    canSend: IS_FULL && sendAvailable, active: global.enabled && rules.some((r) => r.enabled),
    pendingSends, pendingDrafts: drafts.size,
  };
}
export function onAutoReplyState(cb: (s: AutoReplyState) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
const emit = () => { const s = getAutoReplyState(); listeners.forEach((cb) => { try { cb(s); } catch { /* listener error */ } }); };

export async function setAutoReplyGlobal(patch: Partial<ArGlobal>): Promise<void> {
  const next: ArGlobal = { ...global, ...patch };
  if (!IS_FULL) next.autoSend = false;
  await chrome.storage.local.set({ [AR_GLOBAL_KEY]: next });
  if (patch.enabled === true) void setEngine('autoReply', true); // the user explicitly arms replying; it is never armed otherwise
}

function applyGlobal(v: unknown) {
  const g = (v ?? {}) as Partial<ArGlobal>;
  const was = global.enabled;
  global = { enabled: g.enabled === true, autoSend: IS_FULL && g.autoSend === true };
  if (global.enabled && !was) { sinceTs = Date.now(); handled.clear(); } // only react to messages that arrive after enabling
  emit();
}

// ---------- toast ----------
let toastHost: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(text: string) {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.style.cssText = 'position:fixed;z-index:2147483646;left:50%;bottom:24px;transform:translateX(-50%);pointer-events:none';
    const root = toastHost.attachShadow({ mode: 'open' });
    const st = document.createElement('style');
    st.textContent = '.t{font:13px system-ui,sans-serif;background:#111b21;color:#e9edef;border:1px solid #25d366;border-radius:8px;padding:8px 14px;box-shadow:0 4px 18px rgba(0,0,0,.35);max-width:420px}';
    const d = document.createElement('div');
    d.className = 't'; d.setAttribute('role', 'status');
    root.append(st, d);
    document.documentElement.appendChild(toastHost);
  }
  const d = toastHost.shadowRoot!.querySelector('.t') as HTMLElement;
  d.textContent = text;
  toastHost.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (toastHost) toastHost.style.display = 'none'; }, 6000);
}

// ---------- composer (draft only, never presses Enter) ----------
function openChatName(): string {
  const h = document.querySelector('#main header');
  const s = h?.querySelector('span[title]') ?? h?.querySelector('span[dir="auto"]');
  return (s?.getAttribute('title') || s?.textContent || '').trim();
}
/** Inserts only into an EMPTY composer so we never clobber what the owner is typing. Verified read-back; false = not inserted. */
async function putDraft(text: string): Promise<InsertResult> {
  const r = await insertIntoComposer(text, { mode: 'empty-only' });
  if (!r.ok && r.reason !== 'composer-not-found' && r.reason !== 'composer-not-empty') toast(insertErrorText(r));
  return r;
}

// ---------- data ----------
async function loadRules() {
  try { const r = await send<ArRule[] | { error: string }>({ kind: 'ar:rules' }); if (Array.isArray(r)) { rules = r; emit(); } } catch { /* worker asleep */ }
}
async function loadLog() {
  try { const r = await send<ArLogEntry[] | { error: string }>({ kind: 'ar:log:list', limit: 300 }); if (Array.isArray(r)) log = r; } catch { /* ignore */ }
}
async function record(e: Omit<ArLogEntry, 'id' | 'ts'>) {
  const entry: ArLogEntry = { ...e, id: crypto.randomUUID(), ts: Date.now() };
  log.unshift(entry);
  if (log.length > 500) log.length = 500;
  try { await send({ kind: 'ar:log', entry }); } catch { /* ignore */ }
}

function varsFor(ctx: ArCtx, item: InboxItem): TplVars {
  const v: TplVars = {
    tanggal: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
    tahap: ctx.stage, telepon: ctx.phone || phoneFromChatId(item.chatId),
  };
  const nama = ctx.name || item.name;
  if (nama) v.nama = nama;
  if (item.isGroup) { v.pengirim = item.authorName || phoneFromChatId(item.author ?? '') || ''; v.grup = item.groupName || item.name; if (!v.pengirim) delete v.pengirim; }
  else if (nama) v.pengirim = nama;
  if (accountName) v.akun = accountName;
  return v;
}

// ---------- sending ----------
async function freshItem(chatId: string): Promise<InboxItem | undefined> {
  const items = await call<InboxItem[]>({ type: 'inbox:poll', sinceTs: 0, includeGroups: true }, 15_000);
  return items.find((i) => i.chatId === chatId);
}

function schedule(item: InboxItem, chatKey: string, rule: ArRule, text: string, delayMs: number) {
  pendingSends++; emit();
  const run = async () => {
    try {
      await sleep(delayMs);
      const skipWith = (reason: string) => record({ accountId: accountId ?? '', chatKey, chatName: item.name, ruleId: rule.id, ruleName: rule.name, action: 'skipped', reason, text });
      if (!alive()) return;
      await loadRules();
      const live = rules.find((r) => r.id === rule.id);
      if (!global.enabled || !getAutoReplyState().autoSend || !isEngineOn('autoReply')) return void (await skipWith('Auto-kirim dimatikan/dijeda sebelum terkirim'));
      if (!live || !live.enabled || live.mode !== 'auto') return void (await skipWith('aturan dinonaktifkan sebelum terkirim'));
      const fresh = await freshItem(item.chatId);
      if (!fresh || fresh.msgId !== item.msgId) return void (await skipWith('ada pesan baru, dibatalkan'));
      if ((fresh.lastOutTs ?? 0) >= item.ts) return void (await skipWith('sudah dibalas manual'));
      if (overRateLimit(live, log, Date.now(), isGroupKey(item.chatId))) return void (await skipWith('batas per jam tercapai'));
      try {
        const r = await sendSilent(item.chatId, text, { group: isGroupKey(item.chatId) });
        await record({ accountId: accountId ?? '', chatKey, chatName: item.name, ruleId: rule.id, ruleName: rule.name, action: 'sent', reason: `terkirim otomatis (${r.method}${r.verified ? ', terverifikasi' : ', belum terverifikasi'})`, text, author: item.author });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/send-unavailable/.test(msg) && sendAvailable) { sendAvailable = false; emit(); toast('Kirim senyap tidak tersedia di WhatsApp Web ini: balasan dijadikan draft. Jalankan Diagnostik pengirim di halaman Auto-Reply.'); } // one notice, then draft-only
        await skipWith(`gagal kirim: ${msg}`);
      }
      await sleep(3000 + Math.random() * 4000); // spacing between consecutive sends
    } finally { pendingSends--; inflight.delete(chatKey); emit(); }
  };
  queue = queue.then(run, run);
}

// ---------- rotation state (chrome.storage.local 'wwt-rot', keyed by rule id) ----------
async function loadRot(): Promise<RotStore> {
  try { return sanitizeRotStore((await chrome.storage.local.get(ROT_KEY))[ROT_KEY]); } catch { return {}; }
}
async function saveRot(s: RotStore): Promise<void> {
  try { await chrome.storage.local.set({ [ROT_KEY]: s }); } catch { /* ignore */ }
}

// ---------- main loop ----------
async function handleItem(item: InboxItem) {
  if (!accountId) return;
  const chatKey = `${accountId}|${item.chatId}`;
  if (handled.get(chatKey) === item.msgId || inflight.has(chatKey)) return;
  handled.set(chatKey, item.msgId);
  if (handled.size > 5000) handled.clear();

  let ctx: ArCtx | undefined;
  try { const r = await send<ArCtx | { error: string }>({ kind: 'ar:ctx', chatKey }); if (r && !('error' in r)) ctx = r; } catch { /* ignore */ }
  if (!ctx) { handled.delete(chatKey); return; } // retry next tick; fail closed
  const lastOut = Math.max(item.lastOutTs ?? 0, ctx.lastOutTs ?? 0) || null;
  const now = Date.now();
  const rot = await loadRot();
  const d = decide({
    rotation: rot, rules, now, log, lastOutboundTs: lastOut, vars: varsFor(ctx, item),
    canAutoSend: IS_FULL && sendAvailable && getAutoReplyState().autoSend,
    inbound: {
      chatKey, text: item.text, ts: item.ts, isGroup: !!item.isGroup, isNewLead: ctx.isNewLead, optOut: ctx.optOut,
      author: item.author, groupName: item.groupName, mentionedMe: item.mentionedMe, quotedMe: item.quotedMe, isBot: item.isBot,
      fromMe: !!item.author && !!accountId && item.author.split('@')[0] === accountId.split('@')[0],
    },
  });
  if (d.rule && d.rotState) { rot[d.rule.id] = d.rotState; void saveRot(rot); }
  const base = { accountId, chatKey, chatName: (item.isGroup ? item.groupName : '') || ctx.name || item.name, ruleId: d.rule?.id ?? '', ruleName: d.rule?.name ?? '', author: item.isGroup ? item.author : undefined };
  if (d.action === 'skip') {
    if (d.rule) await record({ ...base, action: 'skipped', reason: d.reason, text: '' });
    return;
  }
  const text = d.text ?? '';
  if (d.action === 'send' && d.rule) {
    inflight.add(chatKey);
    schedule(item, chatKey, d.rule, text, d.delayMs ?? 8000);
    return;
  }
  // draft
  const nama = ctx.name || item.name;
  const sameChat = openChatName() === item.name && !!item.name;
  if (sameChat && (await putDraft(text)).ok) {
    await record({ ...base, action: 'draft', reason: 'draft diisi ke chat yang terbuka', text });
    toast(`Draft balasan untuk ${nama} sudah diisi — periksa lalu kirim`);
  } else {
    drafts.set(chatKey, { name: item.name, text, at: now });
    await record({ ...base, action: 'draft', reason: 'draft siap, menunggu chat dibuka', text });
    toast(`Draft balasan untuk ${nama} siap — buka chat`);
    emit();
  }
}

/** When the owner opens a chat that has a waiting draft, fill the (empty) composer. */
async function flushDrafts() {
  if (!drafts.size) return;
  const open = openChatName();
  for (const [k, d] of drafts) {
    if (Date.now() - d.at > DRAFT_TTL_MS) { drafts.delete(k); emit(); continue; }
    if (open && open === d.name) {
      const r = await putDraft(d.text);
      if (r.ok) { drafts.delete(k); emit(); toast(`Draft balasan untuk ${d.name} sudah diisi — periksa lalu kirim`); }
      else if (r.reason === 'mismatch' || r.reason === 'error') { drafts.delete(k); emit(); } // already toasted; do not retry forever
    }
  }
}

/** Replies sent in the last hour (for the status indicator). */
const logCountSent = (): number => log.filter((e) => e.action === 'sent' && Date.now() - e.ts < 3_600_000).length;
let busy = false;
let gateOff = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    if (!alive()) return teardown();
    if (!global.enabled) { reportHealth('autoReply', { state: 'mati', detail: 'Belum diaktifkan' }); return; }
    if (!isEngineOn('autoReply')) { gateOff = true; reportHealth('autoReply', { state: 'mati', detail: 'Dimatikan atau dijeda' }); return; }
    if (gateOff) { gateOff = false; sinceTs = Date.now(); handled.clear(); } // never answer what arrived while paused
    await flushDrafts();
    if (!rules.some((r) => r.enabled)) { reportHealth('autoReply', { state: 'siaga', detail: 'Belum ada aturan aktif' }); return; }
    const p = await call<PingResult>({ type: 'ping' }, 5000);
    if (!p.accountId || !p.store) { reportHealth('autoReply', { state: 'siaga', detail: 'Menunggu WhatsApp siap' }); return; }
    accountId = p.accountId;
    const wantGroups = rules.some((r) => r.enabled && scopeOf(r) !== 'personal');
    const items = await call<InboxItem[]>({ type: 'inbox:poll', sinceTs, includeGroups: wantGroups }, 15_000);
    if (items.length) reportHealth('autoReply', { state: 'kerja', detail: `Memproses ${items.length} pesan masuk`, total: items.length });
    for (const it of items) await handleItem(it);
    const sentN = logCountSent();
    reportHealth('autoReply', { state: 'jalan', detail: sentN ? `Memantau pesan masuk. Terkirim sesi ini: ${sentN}` : 'Memantau pesan masuk' });
  } catch (e) {
    if (/context invalidated/i.test(String(e))) teardown();
  } finally { busy = false; }
}

let timers: ReturnType<typeof setInterval>[] = [];
function teardown() {
  dead = true;
  timers.forEach(clearInterval);
  timers = [];
  document.removeEventListener('visibilitychange', onVis);
  try { chrome.storage.onChanged.removeListener(onStorage); } catch { /* ignore */ }
  toastHost?.remove(); toastHost = null;
}
function onVis() { if (document.visibilityState === 'visible') void tick(); }
function onStorage(ch: Record<string, chrome.storage.StorageChange>, area: string) {
  if (area === 'local' && ch[AR_GLOBAL_KEY]) applyGlobal(ch[AR_GLOBAL_KEY].newValue);
}

export function mountAutoReply(): void {
  if (mounted) return;
  mounted = true;
  void (async () => {
    try { const r = await chrome.storage.local.get(AR_GLOBAL_KEY); applyGlobal(r[AR_GLOBAL_KEY]); } catch { /* ignore */ }
    await loadRules();
    await loadLog();
    try {
      const accs = await chrome.runtime.sendMessage({ kind: 'account:list' });
      const p = await call<PingResult>({ type: 'ping' }, 5000).catch(() => null);
      if (Array.isArray(accs) && p?.accountId) accountName = (accs.find((a: { id: string }) => a.id === p.accountId) as { name?: string } | undefined)?.name ?? '';
    } catch { /* ignore */ }
  })();
  chrome.storage.onChanged.addListener(onStorage);
  document.addEventListener('visibilitychange', onVis);
  timers.push(setInterval(() => { void tick(); }, POLL_MS));
  timers.push(setInterval(() => { if (alive()) void loadRules(); }, RULES_MS));
  timers.push(setInterval(() => { if (alive()) void loadLog(); }, LOG_REFRESH_MS));
}

/**
 * Dry run for "Mengapa tidak membalas?": evaluates every precondition and what decide() would do for the newest
 * inbound messages right now. Sends nothing, writes nothing.
 */
export async function explainAutoReply(): Promise<ExplainResult> {
  const checks: ExplainCheck[] = [];
  const add = (label: string, ok: boolean, detail: string) => checks.push({ label, ok, detail });
  add('Sakelar "Auto-reply aktif" menyala', global.enabled, global.enabled ? 'ya' : 'MATI. Nyalakan di bagian atas halaman Auto-reply (bawaannya mati).');
  add('Mode Otomatis tidak dijeda', isEngineOn('autoReply'), isEngineOn('autoReply') ? 'ya' : 'Mesin auto-reply dimatikan/dijeda. Buka Status di navbar lalu lanjutkan.');
  const on = rules.filter((r) => r.enabled);
  add('Ada aturan yang aktif', on.length > 0, `${on.length} aktif dari ${rules.length} aturan${on.length ? ': ' + on.map((r) => `${r.name} (${scopeOf(r)}, ${r.trigger})`).join('; ') : '. Nyalakan sakelar pada aturan.'}`);
  const p = await call<PingResult>({ type: 'ping' }, 5000).catch(() => null);
  add('Adapter WhatsApp siap', !!p, p ? 'ya' : 'Adapter tidak menjawab. Muat ulang tab WhatsApp.');
  add('Daftar chat WhatsApp terbaca', !!p?.store, p?.store ? 'ya' : 'Belum terbaca (WhatsApp masih memuat, atau nama modul internal berubah).');
  add('Akun Anda terdeteksi', !!p?.accountId, p?.accountId ? p.accountId : 'Tidak terdeteksi. Mesin menunggu terus tanpa pesan galat. Jalankan Diagnostik pengirim dan kirim hasilnya.');
  add('Mode kirim', true, IS_FULL ? (getAutoReplyState().autoSend ? 'kirim otomatis' : 'draf saja (sakelar Auto-kirim mati)') : 'draf saja (build store)');
  const items: ExplainItem[] = [];
  let polled: InboxItem[] = [];
  try { if (p?.store) polled = await call<InboxItem[]>({ type: 'inbox:poll', sinceTs: 0, includeGroups: true }, 15_000); } catch { /* reported below */ }
  add('Pesan teks masuk terbaca dari WhatsApp', polled.length > 0, polled.length ? `${polled.length} chat punya pesan masuk teks terakhir` : 'Tidak ada. Pesan harus berupa teks biasa, dan chat harus punya pesan masuk terakhir.');
  const now = Date.now();
  for (const it of polled.sort((a, b) => b.ts - a.ts).slice(0, 8)) {
    let decision = '-', reason = '';
    try {
      const chatKey = `${p?.accountId ?? ''}|${it.chatId}`;
      const r = await send<ArCtx | { error: string }>({ kind: 'ar:ctx', chatKey });
      if (!r || 'error' in r) { reason = 'konteks CRM tidak terbaca'; }
      else {
        const lastOut = Math.max(it.lastOutTs ?? 0, r.lastOutTs ?? 0) || null;
        const d = decide({
          rotation: {}, rules, now, log, lastOutboundTs: lastOut, vars: varsFor(r, it), canAutoSend: IS_FULL && sendAvailable && getAutoReplyState().autoSend,
          inbound: { chatKey, text: it.text, ts: it.ts, isGroup: !!it.isGroup, isNewLead: r.isNewLead, optOut: r.optOut, author: it.author, groupName: it.groupName, mentionedMe: it.mentionedMe, quotedMe: it.quotedMe, isBot: it.isBot, fromMe: false },
        });
        decision = d.action === 'skip' ? 'tidak dibalas' : d.action === 'send' ? 'akan DIKIRIM' : 'akan jadi DRAF';
        reason = d.rule ? `aturan "${d.rule.name}": ${d.reason}` : d.reason;
      }
    } catch (e) { reason = String(e); }
    const after = it.ts > sinceTs;
    if (!after) reason = `diterima SEBELUM auto-reply dinyalakan, sengaja diabaikan (${reason})`;
    items.push({ name: it.name || it.chatId, isGroup: !!it.isGroup, text: it.text.slice(0, 80), ageMin: Math.round((now - it.ts) / 60000), afterActivation: after, decision, reason });
  }
  return { checks, items };
}
