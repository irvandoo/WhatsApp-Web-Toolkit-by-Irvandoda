import { IS_FULL } from '../shared/credit';
import type { PingResult, RegisteredResult } from '../shared/messages';
import { isBlockedTarget } from '../shared/outbox-logic';
import type { NextItem, OutboxItem } from '../shared/outbox-types';
import { call } from './bridge';
import { sendSilent } from './send-settings';
import { isEngineOn, reportHealth } from './engine-health';
import { insertErrorText, insertIntoComposer, showToast } from './composer-insert';
import { logActivity } from './outbox-activity';
import { shouldLogWait, snippet, whoLabel } from '../shared/outbox-activity';

export interface OutboxState {
  mounted: boolean;
  inFlight: boolean;
  killed: boolean;
  lastReason: string;
  sent: number;
  failed: number;
  drafts: number;
  lastTickAt: number;
}

const POLL_MS = 3000;
const MAX_CARDS = 5;
const KILL_KEY = 'ob:kill';
const COMPOSER_SEL = ['footer [contenteditable="true"][role="textbox"]', '#main footer div[contenteditable="true"]'];

const state: OutboxState = { mounted: false, inFlight: false, killed: false, lastReason: '', sent: 0, failed: 0, drafts: 0, lastTickAt: 0 };
export const getOutboxState = (): OutboxState => ({ ...state });

let timer: ReturnType<typeof setInterval> | undefined;
let lastWait = '';
let wasKilled = false;
let acc: { id: string | null; at: number } = { id: null, at: 0 };

const alive = (): boolean => { try { return !!chrome.runtime?.id; } catch { return false; } };

async function accountId(): Promise<string | null> {
  if (Date.now() - acc.at < 60_000) return acc.id;
  try {
    const p = await call<PingResult>({ type: 'ping' }, 5000);
    acc = { id: p.accountId, at: Date.now() };
  } catch { acc = { id: null, at: Date.now() }; }
  return acc.id;
}

async function killed(): Promise<boolean> {
  try { const r = await chrome.storage.local.get(KILL_KEY); return !!r[KILL_KEY]; } catch { return false; }
}

async function report(itemId: string, status: 'sent' | 'failed', extra: { error?: string; permanent?: boolean; chatId?: string } = {}): Promise<void> {
  try { await chrome.runtime.sendMessage({ kind: 'ob:result', itemId, status, ...extra }); } catch { /* worker asleep: stale-recovery handles it */ }
}

const ERR: Record<string, string> = {
  'send-unavailable': 'Fitur kirim WhatsApp Web tidak tersedia (versi WA berubah?)',
  'send-failed': 'WhatsApp Web menolak/gagal mengirim',
  'chat-not-found': 'Chat tujuan tidak ditemukan di WhatsApp Web',
  'send-rejected': 'Tujuan tidak diizinkan (grup/broadcast/status atau pesan kosong)',
  timeout: 'Waktu habis menunggu WhatsApp Web',
};

async function sendAuto(item: OutboxItem, checkRegistered: boolean): Promise<void> {
  let chatId = item.chatId ?? `${item.phone}@c.us`;
  const who = whoLabel(item.name, item.phone);
  const ids = { campaignId: item.campaignId, itemId: item.id, phone: item.phone };
  logActivity('work', 'antre', `Mengambil antrean: ${who}`, ids);
  if (isBlockedTarget(chatId) || isBlockedTarget(item.phone)) {
    logActivity('err', 'gagal', `Dilewati ${who}: tujuan tidak diizinkan (grup/broadcast/status atau kosong)`, ids);
    return report(item.id, 'failed', { error: ERR['send-rejected'], permanent: true });
  }
  if (await killed()) {
    logActivity('warn', 'stop', 'Dihentikan oleh Stop global, pesan tidak dikirim', ids);
    await report(item.id, 'failed', { error: 'Stop global', permanent: true });
    return;
  }
  if (checkRegistered) {
    logActivity('work', 'cek', `Memeriksa apakah +${item.phone} terdaftar di WhatsApp…`, ids);
    try {
      const res = await call<RegisteredResult[]>({ type: 'check:registered', phones: [item.phone] }, 20_000);
      const r = res?.[0];
      if (r?.registered === false) {
        state.failed++;
        logActivity('err', 'gagal', `+${item.phone} tidak terdaftar di WhatsApp, dilewati`, ids);
        return report(item.id, 'failed', { error: 'Nomor tidak terdaftar di WhatsApp', permanent: true });
      }
      if (r?.registered === true) logActivity('ok', 'cek', `+${item.phone} terdaftar di WhatsApp`, ids);
      else logActivity('warn', 'cek', `Status terdaftar +${item.phone} tidak bisa dipastikan, lanjut mengirim`, ids);
      if (r?.chatId && !isBlockedTarget(r.chatId)) chatId = r.chatId;
    } catch { logActivity('warn', 'cek', `Pengecekan nomor gagal, lanjut mengirim ke +${item.phone}`, ids); }
  }
  logActivity('info', 'pesan', `Pesan siap (${item.text.length} karakter): "${snippet(item.text)}"`, ids);
  logActivity('work', 'chat', `Mencari chat ${who} lewat internal WhatsApp (tanpa membuka layar)…`, ids);
  try {
    logActivity('work', 'kirim', `Mengirim pesan ke ${who}…`, ids);
    const r = await sendSilent(chatId, item.text, { timeoutMs: 45_000 });
    if (r && r.ok === false) throw new Error(r.error || 'send-failed');
    state.sent++;
    logActivity('ok', 'ok', `Terkirim ke ${who}${r?.method ? ` (jalur ${r.method}, ${r.verified ? 'terverifikasi muncul di chat' : 'belum terverifikasi'})` : ''}`, ids);
    await report(item.id, 'sent', { chatId });
  } catch (e) {
    const key = e instanceof Error ? e.message : String(e);
    state.failed++;
    logActivity('err', 'gagal', `Gagal mengirim ke ${who}: ${ERR[key] ?? key}`, ids);
    await report(item.id, 'failed', { error: ERR[key] ?? key, permanent: key === 'send-rejected', chatId });
  }
}

// ---------- draft-on-due toast (store flavor): never presses Enter ----------
let host: HTMLElement | null = null;
let box: HTMLElement | null = null;

function ensureToastHost(): HTMLElement {
  if (box && host?.isConnected) return box;
  host = document.createElement('div');
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483646';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host{all:initial}
    .col{display:flex;flex-direction:column;gap:8px;max-width:340px;font:13px system-ui,sans-serif}
    .card{background:#fff;color:#111;border:1px solid #ccc;border-left:4px solid #128c7e;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.25);padding:10px}
    @media (prefers-color-scheme:dark){.card{background:#233138;color:#e9edef;border-color:#3b4a54;border-left-color:#25d366}}
    .t{font-weight:600;margin-bottom:4px}.p{opacity:.8;white-space:pre-wrap;max-height:80px;overflow:auto;margin-bottom:6px}
    .w{font-size:11px;opacity:.65;margin-bottom:6px}
    .b{display:flex;gap:6px;flex-wrap:wrap}
    button{font:inherit;cursor:pointer;border:1px solid #bbb;border-radius:6px;background:transparent;color:inherit;padding:3px 8px}
    button.pri{background:#128c7e;border-color:#128c7e;color:#fff}`;
  box = document.createElement('div');
  box.className = 'col';
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', 'Pesan terjadwal siap dikirim manual');
  root.append(style, box);
  document.documentElement.appendChild(host);
  return box;
}

function showDraft(item: OutboxItem): void {
  logActivity('info', 'draf', `Draf untuk ${whoLabel(item.name, item.phone)} siap, menunggu Anda mengirim`, { campaignId: item.campaignId, itemId: item.id, phone: item.phone });
  const b = ensureToastHost();
  const card = document.createElement('div');
  card.className = 'card';
  const el = (tag: string, cls: string, text: string) => { const n = document.createElement(tag); n.className = cls; n.textContent = text; return n; };
  card.append(
    el('div', 't', `Pesan terjadwal untuk ${item.name || '+' + item.phone}`),
    el('div', 'p', item.text),
    el('div', 'w', `Buka chat +${item.phone} dulu, lalu klik "Sisipkan". Anda sendiri yang menekan Kirim.`),
  );
  const row = el('div', 'b', '');
  const mk = (label: string, cls: string, fn: (btn: HTMLButtonElement) => void) => {
    const btn = document.createElement('button');
    btn.textContent = label; btn.className = cls;
    btn.addEventListener('click', () => fn(btn));
    row.appendChild(btn);
  };
  mk('Sisipkan ke chat terbuka', 'pri', (btn) => {
    btn.disabled = true;
    void insertIntoComposer(item.text, { mode: 'append' }).then((r) => {
      btn.disabled = false;
      btn.textContent = r.ok ? 'Tersisip' : r.reason === 'composer-not-found' ? 'Chat belum dibuka' : 'Gagal rapi, pakai Salin';
      if (!r.ok) showToast(insertErrorText(r));
    });
  });
  mk('Salin', '', (btn) => { void navigator.clipboard?.writeText(item.text).then(() => { btn.textContent = 'Tersalin'; }, () => { btn.textContent = 'Gagal salin'; }); });
  mk('Sudah saya kirim', '', () => { void report(item.id, 'sent'); card.remove(); state.drafts = Math.max(0, state.drafts - 1); });
  mk('Tutup', '', () => { card.remove(); state.drafts = Math.max(0, state.drafts - 1); });
  card.appendChild(row);
  b.appendChild(card);
  state.drafts++;
}

// ---------- loop ----------
const health = (st: 'jalan' | 'kerja' | 'siaga' | 'mati' | 'error', detail: string, total?: number): void =>
  reportHealth('outbox', { state: st, detail, done: state.sent + state.failed, failed: state.failed, total });

async function tick(): Promise<void> {
  if (state.inFlight) return;
  if (!alive()) return teardown();
  if (!isEngineOn('outbox')) { health('mati', 'Dimatikan atau dijeda'); return; }
  state.lastTickAt = Date.now();
  if (!IS_FULL && (box?.childElementCount ?? 0) >= MAX_CARDS) return;
  state.inFlight = true;
  try {
    state.killed = await killed();
    if (state.killed) {
      state.lastReason = 'Dihentikan (Stop global)'; health('mati', state.lastReason);
      if (!wasKilled) logActivity('warn', 'stop', 'Dihentikan oleh Stop global: tidak ada pesan yang dikirim');
      wasKilled = true;
      return;
    }
    wasKilled = false;
    const r = (await chrome.runtime.sendMessage({ kind: 'ob:next', accountId: await accountId() })) as NextItem | undefined;
    if (!r || !r.item) {
      state.lastReason = r?.reason ?? '';
      if (shouldLogWait(lastWait, state.lastReason)) logActivity('info', 'tunggu', `Menunggu: ${state.lastReason}`);
      lastWait = state.lastReason;
      health('jalan', state.drafts > 0 ? `${state.drafts} draf menunggu Anda` : state.lastReason || (state.sent ? `Terkirim ${state.sent}, gagal ${state.failed}` : 'Tidak ada antrean kirim'));
      return;
    }
    state.lastReason = '';
    lastWait = '';
    if (r.mode === 'auto') {
      const total = r.campaign?.total;
      health('kerja', `Mengirim ke ${r.item.name || '+' + r.item.phone}`, total);
      await sendAuto(r.item, !!r.campaign?.safety.checkRegistered);
      health('jalan', `Terkirim ${state.sent}, gagal ${state.failed}`, total);
    } else { showDraft(r.item); health('jalan', `${state.drafts} draf menunggu Anda`); }
  } catch { /* worker asleep / context invalidated */ }
  finally { state.inFlight = false; }
}

function teardown(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  host?.remove();
  host = null; box = null;
  state.mounted = false;
}

export function mountOutbox(): void {
  if (state.mounted) return;
  state.mounted = true;
  timer = setInterval(() => { void tick(); }, POLL_MS);
}
