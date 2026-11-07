import type { RuntimeMsg } from '../shared/messages';
import { listChats, ping } from './sync';

const EVERY_MS = 15_000;

/** Periodically report live account status to the background registry. Stops if the extension context dies. */
export function mountAccountReporter(): void {
  let timer: number | undefined;
  let busy = false;
  const stop = () => { if (timer) clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };
  async function report() {
    if (busy) return;
    busy = true;
    try {
      if (!chrome.runtime?.id) return stop();
      const p = await ping();
      if (!p.accountId) return;
      let unread = 0, chatCount = 0;
      if (p.store) {
        const chats = await listChats().catch(() => []);
        chatCount = chats.length;
        unread = chats.reduce((n, c) => n + (c.unread > 0 ? c.unread : 0), 0);
      }
      await chrome.runtime.sendMessage({ kind: 'account:report', id: p.accountId, online: navigator.onLine && p.store, unread, chatCount } satisfies RuntimeMsg);
    } catch (e) {
      if (!chrome.runtime?.id || /context invalidated/i.test(String(e))) stop(); // else: adapter not ready yet, retry next tick
    } finally { busy = false; }
  }
  function onVis() { if (document.visibilityState === 'visible') void report(); }
  document.addEventListener('visibilitychange', onVis);
  timer = window.setInterval(() => void report(), EVERY_MS);
  setTimeout(() => void report(), 3000);
}
