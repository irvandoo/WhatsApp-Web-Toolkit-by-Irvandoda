/** Receives 'pos:insert' from the background relay and inserts text into the open chat composer. Never presses Enter. */
const SEL = ['footer [contenteditable="true"][role="textbox"]', '#main footer div[contenteditable="true"]', 'footer div[contenteditable="true"]'];

function findComposer(): HTMLElement | null {
  for (const s of SEL) {
    const el = document.querySelector<HTMLElement>(s);
    if (el) return el;
  }
  return null;
}

export function insertIntoComposer(text: string): boolean {
  const c = findComposer();
  if (!c) return false;
  c.focus();
  const range = document.createRange();
  range.selectNodeContents(c);
  const s = window.getSelection();
  s?.removeAllRanges();
  s?.addRange(range);
  document.execCommand('delete');
  const lines = text.split('\n');
  lines.forEach((ln, i) => {
    if (i > 0 && !document.execCommand('insertLineBreak')) document.execCommand('insertText', false, '\n');
    if (ln) document.execCommand('insertText', false, ln);
  });
  return true;
}

let mounted = false;
export function mountPosBridge(): void {
  if (mounted) return;
  mounted = true;
  chrome.runtime.onMessage.addListener((m: { kind?: string; text?: unknown }, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || m?.kind !== 'pos:insert') return false;
    if (typeof m.text !== 'string' || m.text.length > 20_000) { sendResponse({ ok: false, error: 'Teks tidak valid' }); return false; }
    try { sendResponse({ ok: insertIntoComposer(m.text) }); } catch (e) { sendResponse({ ok: false, error: String(e) }); }
    return false;
  });
}
