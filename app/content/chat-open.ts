import type { ChatOpenExec, ChatOpenResult, PingResult } from '../shared/messages';
import { call } from './bridge';
import { closeOverlay } from './overlay';

/** Executes 'chatx:open' from the background: refuses when this tab holds another account, otherwise opens the chat room. */
export function mountChatOpen(): void {
  try {
    chrome.runtime.onMessage.addListener((m: ChatOpenExec, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id || m?.kind !== 'chatx:open') return false;
      (async (): Promise<ChatOpenResult> => {
        const p = await call<PingResult>({ type: 'ping' }, 5000).catch(() => null);
        if (!p) return { ok: false, error: 'adapter' };
        if (m.accountId && p.accountId && m.accountId !== p.accountId) return { ok: false, error: 'wrong-account' };
        const r = await call<ChatOpenResult>({ type: 'chat:open', chatId: m.chatId, phone: m.phone }, 15_000).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
        if (r.ok) { try { closeOverlay(); } catch { /* overlay not open */ } }
        return r;
      })().then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    });
  } catch { /* extension context gone */ }
}
