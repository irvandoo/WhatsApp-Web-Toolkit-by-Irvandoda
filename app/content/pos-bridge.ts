/** Receives 'pos:insert' from the background relay and inserts text into the open chat composer. Never presses Enter. */
import { insertErrorText, insertIntoComposer } from './composer-insert';

let mounted = false;
export function mountPosBridge(): void {
  if (mounted) return;
  mounted = true;
  chrome.runtime.onMessage.addListener((m: { kind?: string; text?: unknown }, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || m?.kind !== 'pos:insert') return false;
    if (typeof m.text !== 'string' || m.text.length > 20_000) { sendResponse({ ok: false, error: 'Teks tidak valid' }); return false; }
    // async: the composer is read back after insertion; mismatch / failure is returned to the POS page (never silent)
    insertIntoComposer(m.text, { mode: 'append' })
      .then((r) => sendResponse(r.ok ? { ok: true, method: r.method } : { ok: false, error: insertErrorText(r) }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  });
}
