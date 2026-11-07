import { PURGE_QUEUE_KEY, type SlotExec, type SlotMsg, type SlotState } from '../shared/slots';
import { drainPurge } from '../shared/slots-logic';
import type { PingResult } from '../shared/messages';
import { closeOverlay } from './overlay';
import { currentSlotId, purgeSlotData, switchTo } from './switcher';
import { ping } from './sync';
import { isEngineOn, reportHealth } from './engine-health';

const HEALTH_OF: Record<SlotState, { state: 'jalan' | 'siaga' | 'error'; detail: string }> = {
  online: { state: 'jalan', detail: 'WhatsApp tersambung' },
  qr: { state: 'error', detail: 'WhatsApp belum login (scan QR di HP)' },
  'logged-out': { state: 'error', detail: 'WhatsApp sudah keluar, login ulang' },
  offline: { state: 'error', detail: 'WhatsApp offline atau internet putus' },
  loading: { state: 'siaga', detail: 'WhatsApp sedang memuat' },
  unknown: { state: 'siaga', detail: 'Menunggu WhatsApp Web siap' },
};

/**
 * Live status of the slot held by THIS tab + executor for background requests (holds / purge / switch)
 * + drain of the purge queue. All WhatsApp Web selectors/texts live in SELECTORS below; they are
 * best-effort and UNVERIFIED against every WA release - when WA changes its markup, only this list needs edits.
 */
export const SELECTORS = {
  qr: [
    '[data-testid="qrcode"]', '[data-ref] canvas', 'canvas[aria-label*="QR" i]', 'canvas[aria-label*="scan" i]',
    'div[data-ref][data-testid]', '[aria-label*="Scan me" i]', '[aria-label*="Pindai" i]',
  ],
  qrText: [/scan (?:the )?qr/i, /scan to log ?in/i, /pindai (?:kode )?qr/i, /tautkan perangkat/i, /link (?:a )?device/i, /use whatsapp on your computer/i, /gunakan whatsapp di komputer/i],
  loading: ['progress', '[role="progressbar"]', '[data-testid="intro-md-beta-logo-dark"]', '[data-testid="startup-progress"]'],
  loadingText: [/memuat chat/i, /loading your chats/i, /mengunduh pesan/i, /downloading messages/i, /memuat pesan/i],
  offlineText: [/mencoba menyambung/i, /trying to connect/i, /computer not connected/i, /komputer tidak tersambung/i, /phone not connected/i, /ponsel tidak tersambung/i],
  chatList: ['#pane-side', '[data-testid="chat-list"]', '#side'],
  /** containers whose text is scanned (kept small: never the whole chat list) */
  textScope: 'h1, h2, h3, [role="alert"], [role="status"], [role="progressbar"], [aria-live]',
} as const;

export interface DomSignals { qr: boolean; loading: boolean; offline: boolean; chatList: boolean }

const any = (doc: ParentNode, sels: readonly string[]) => sels.some((s) => { try { return !!doc.querySelector(s); } catch { return false; } });
function scopeText(doc: ParentNode): string {
  let out = '';
  try {
    for (const n of doc.querySelectorAll(SELECTORS.textScope)) {
      out += ' ' + (n.textContent ?? '').slice(0, 300);
      if (out.length > 3000) break;
    }
  } catch {
    try { for (const n of doc.querySelectorAll('h1, h2, h3, [role="alert"], [role="status"], [aria-live]')) out += ' ' + (n.textContent ?? '').slice(0, 300); } catch { /* ignore */ }
  }
  return out;
}

export function detectDom(doc: ParentNode = document): DomSignals {
  const text = scopeText(doc);
  const chatList = any(doc, SELECTORS.chatList);
  const qrEl = any(doc, SELECTORS.qr);
  return {
    // a chat list on screen always beats weak text hints
    qr: qrEl || (!chatList && SELECTORS.qrText.some((r) => r.test(text))),
    loading: any(doc, SELECTORS.loading) || SELECTORS.loadingText.some((r) => r.test(text)),
    offline: SELECTORS.offlineText.some((r) => r.test(text)),
    chatList,
  };
}

/** Combine DOM signals with the adapter ping (null = adapter not reachable) and navigator.onLine. */
export function decideState(dom: DomSignals, p: Pick<PingResult, 'store' | 'accountId'> | null, navOnline: boolean): SlotState {
  if (dom.qr && !dom.chatList) return 'qr';
  const ready = !!p?.store && !!p.accountId;
  if (ready || dom.chatList) {
    if (!navOnline || dom.offline) return 'offline';
    return dom.loading && !ready ? 'loading' : 'online';
  }
  if (!navOnline || dom.offline) return 'offline';
  if (dom.loading) return 'loading';
  return 'unknown';
}

/** Unread chats from the tab title "(3) WhatsApp" - free and robust. */
export const unreadFromTitle = (title: string): number => {
  const m = /^\((\d{1,5})\)/.exec(title.trim());
  return m ? +m[1] : 0;
};

const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
const HEARTBEAT_MS = 5000;

export function mountSlotStatus(): void {
  if (!alive()) return;
  const sid = currentSlotId();
  let last: { state: SlotState; at: number } | null = null;
  let busy = false, stopped = false, lastCheck = 0;
  const timers: number[] = [];

  async function check(force = false) {
    if (busy || stopped) return;
    if (!alive()) return stop();
    const now = Date.now();
    if (!force && now - lastCheck < 1000) return;
    lastCheck = now;
    if (!isEngineOn('accountStatus')) { reportHealth('accountStatus', { state: 'mati', detail: 'Dimatikan atau dijeda' }); return; }
    busy = true;
    try {
      const dom = detectDom();
      let p: PingResult | null = null;
      if (!(dom.qr && !dom.chatList)) { try { p = await ping(); } catch { p = null; } }
      const state = decideState(dom, p, navigator.onLine);
      reportHealth('accountStatus', { ...HEALTH_OF[state], code: state, ready: !!p?.store });
      if (!force && last && last.state === state && Date.now() - last.at < HEARTBEAT_MS) return;
      last = { state, at: Date.now() };
      const msg: SlotMsg = { kind: 'slot:status', id: sid, state, ts: Date.now(), accountId: p?.accountId ?? null, unread: unreadFromTitle(document.title) };
      await chrome.runtime.sendMessage(msg);
    } catch (e) {
      if (!alive() || /context invalidated/i.test(String(e))) stop();
    } finally { busy = false; }
  }
  function stop() {
    stopped = true;
    timers.forEach(clearInterval);
    document.removeEventListener('visibilitychange', onVis);
    mo?.disconnect();
  }
  const onVis = () => { if (document.visibilityState === 'visible') void check(); };
  document.addEventListener('visibilitychange', onVis);
  timers.push(window.setInterval(() => void check(true), HEARTBEAT_MS));
  // cheap DOM watcher: debounced, only sends when the state actually changed
  let deb = 0;
  const mo = typeof MutationObserver === 'function' ? new MutationObserver(() => { clearTimeout(deb); deb = window.setTimeout(() => void check(), 1500); }) : null;
  try { mo?.observe(document.body ?? document.documentElement, { childList: true, subtree: true }); } catch { /* ignore */ }
  setTimeout(() => void check(true), 1500);

  // requests from the background
  try {
    chrome.runtime.onMessage.addListener((m: unknown, sender, sendResponse) => {
      const x = m as SlotExec | null;
      if (sender.id !== chrome.runtime.id || !x || typeof x.kind !== 'string' || !x.kind.startsWith('slotx:')) return false;
      if (x.kind === 'slotx:holds') { sendResponse({ holds: x.id === sid }); return false; }
      if (x.kind === 'slotx:switch') {
        try { closeOverlay(); } catch { /* ignore */ }
        sendResponse({ ok: true });
        setTimeout(() => switchTo(x.id), 50);
        return false;
      }
      if (x.kind === 'slotx:purge') {
        if (x.id === sid) { sendResponse({ ok: false, refused: 'active' }); return false; }
        purgeSlotData(x.id).then((n) => sendResponse({ ok: true, removed: n }), (e) => sendResponse({ ok: false, error: String(e) }));
        return true;
      }
      return false;
    });
  } catch { /* context gone */ }

  void drainPurgeQueue(sid);
}

/** Purge slots queued while no WhatsApp tab was available (never this tab's own slot). */
export async function drainPurgeQueue(activeSid: string): Promise<string[]> {
  try {
    const got = await chrome.storage.local.get(PURGE_QUEUE_KEY);
    const { run, keep } = drainPurge(got[PURGE_QUEUE_KEY], activeSid);
    if (!run.length) return [];
    // write back first so concurrent tabs do not double-run (purge is idempotent anyway)
    await chrome.storage.local.set({ [PURGE_QUEUE_KEY]: keep });
    for (const id of run) await purgeSlotData(id);
    return run;
  } catch { return []; }
}
