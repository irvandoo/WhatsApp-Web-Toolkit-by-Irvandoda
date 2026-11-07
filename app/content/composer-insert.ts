/**
 * Robust, verified insertion of (multi-line) text into WhatsApp Web's composer. Never presses plain Enter (that would send).
 * Strategy: synthetic paste (keeps newlines in Lexical) -> per-line insertText + line breaks -> plain insertText.
 * After each attempt the composer is read back and compared with the expected normalised text.
 */
import { normalizeForWa } from '../shared/wa-format';

export const COMPOSER_SELECTORS = [
  'footer [contenteditable="true"][role="textbox"]',
  '#main footer div[contenteditable="true"]',
  'footer div[contenteditable="true"]',
];

export type InsertMethod = 'paste' | 'lines' | 'plain';
export type InsertMode = 'append' | 'replace' | 'empty-only';
export interface InsertOpts {
  /** append (default): add on a new line after the existing draft; replace: overwrite; empty-only: fail when a draft exists. */
  mode?: InsertMode;
  /** use this composer instead of searching. */
  composer?: HTMLElement | null;
  /** wait (ms) after each attempt before reading back; WhatsApp commits editor state asynchronously. Default 60. */
  settleMs?: number;
  /** restrict / reorder methods (tests). */
  methods?: InsertMethod[];
}
export type InsertFailReason = 'composer-not-found' | 'empty-text' | 'composer-not-empty' | 'mismatch' | 'error';
export interface InsertResult {
  ok: boolean;
  method?: InsertMethod;
  reason?: InsertFailReason;
  /** present when the final attempt did not read back identically */
  mismatch?: { expected: string; actual: string };
  /** true when only blank-line spacing differed (content and line order identical) */
  soft?: boolean;
  message?: string;
}

export function findComposerEl(): HTMLElement | null {
  for (const s of COMPOSER_SELECTORS) {
    const el = document.querySelector<HTMLElement>(s);
    if (el) return el;
  }
  return null;
}

const BLOCK = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3']);

/** Text of the composer with one "\n" per line (works without layout, e.g. jsdom). */
export function readComposerText(c: HTMLElement): string {
  const lines: string[] = [];
  let cur = '';
  const hasContentAfter = (n: Node): boolean => {
    for (let s = n.nextSibling; s; s = s.nextSibling) if ((s.textContent ?? '') !== '' || (s as Element).tagName === 'BR' || BLOCK.has((s as Element).tagName)) return true;
    const p = n.parentNode;
    if (p && p !== c && !BLOCK.has((p as Element).tagName)) return hasContentAfter(p);
    return false;
  };
  const walk = (n: Node, isBlockRoot: boolean) => {
    if (n.nodeType === 3) { cur += n.nodeValue ?? ''; return; }
    if (n.nodeType !== 1) return;
    const el = n as Element;
    if (el.tagName === 'BR') {
      // a trailing <br> is only the editor's placeholder for an empty line
      if (hasContentAfter(el)) { lines.push(cur); cur = ''; }
      return;
    }
    const block = isBlockRoot || BLOCK.has(el.tagName);
    if (block && cur !== '') { lines.push(cur); cur = ''; }
    const start = lines.length;
    el.childNodes.forEach((k) => walk(k, false));
    if (block) {
      if (cur !== '') { lines.push(cur); cur = ''; } else if (lines.length === start && !isBlockRoot) lines.push('');
    }
  };
  walk(c, true);
  if (cur !== '') lines.push(cur);
  return lines.join('\n');
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function selectAll(c: HTMLElement) {
  const sel = window.getSelection();
  const r = document.createRange();
  r.selectNodeContents(c);
  sel?.removeAllRanges();
  sel?.addRange(r);
}
function caretToEnd(c: HTMLElement) {
  const sel = window.getSelection();
  const r = document.createRange();
  r.selectNodeContents(c);
  r.collapse(false);
  sel?.removeAllRanges();
  sel?.addRange(r);
}
const exec = (cmd: string, v?: string): boolean => {
  try { return typeof document.execCommand === 'function' && document.execCommand(cmd, false, v); } catch { return false; }
};

function clipboardEvent(text: string): Event {
  let dt: unknown = null;
  try { if (typeof DataTransfer === 'function') { const d = new DataTransfer(); d.setData('text/plain', text); dt = d; } } catch { dt = null; }
  if (!dt || (dt as DataTransfer).getData?.('text/plain') !== text) {
    dt = { types: ['text/plain'], items: [], files: [], getData: (t: string) => (t === 'text/plain' || t === 'text' ? text : ''), setData: () => undefined };
  }
  let ev: Event;
  try { ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt as DataTransfer }); } catch { ev = new Event('paste', { bubbles: true, cancelable: true }); }
  if (!(ev as ClipboardEvent).clipboardData) Object.defineProperty(ev, 'clipboardData', { value: dt });
  return ev;
}

/** Soft line break that can never send: insertLineBreak, else Shift+Enter (shiftKey is always set). */
function softBreak(c: HTMLElement) {
  if (exec('insertLineBreak')) return;
  const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, shiftKey: true, bubbles: true, cancelable: true } as KeyboardEventInit;
  c.dispatchEvent(new KeyboardEvent('keydown', init));
  c.dispatchEvent(new KeyboardEvent('keyup', init));
}

function typeLines(c: HTMLElement, payload: string) {
  payload.split('\n').forEach((ln, i) => {
    if (i > 0) softBreak(c);
    if (ln) exec('insertText', ln);
  });
}

/** Put `text` back as the composer contents (replace), verifying; used to undo a failed attempt. Best effort. */
function restore(c: HTMLElement, text: string) {
  c.focus();
  if (!text) { selectAll(c); exec('delete'); return; }
  for (const m of ['paste', 'lines'] as InsertMethod[]) {
    attempt(c, m, text, true);
    if (normalizeForWa(readComposerText(c)) === text) return;
  }
}

function attempt(c: HTMLElement, method: InsertMethod, payload: string, replace: boolean): void {
  c.focus();
  if (replace) selectAll(c); else caretToEnd(c);
  if (method === 'paste') c.dispatchEvent(clipboardEvent(payload));
  else if (method === 'lines') { if (replace) exec('delete'); typeLines(c, payload); }
  else exec('insertText', payload);
}

const stripBlank = (s: string) => s.split('\n').filter((l) => l !== '').join('\n');

export async function insertIntoComposer(text: string, opts: InsertOpts = {}): Promise<InsertResult> {
  try {
    const norm = normalizeForWa(text);
    if (!norm) return { ok: false, reason: 'empty-text', message: 'Teks kosong' };
    const c = opts.composer ?? findComposerEl();
    if (!c || !c.isConnected) return { ok: false, reason: 'composer-not-found', message: 'Kotak pesan chat tidak ditemukan. Buka chat tujuan dulu.' };
    const mode = opts.mode ?? 'append';
    const before = normalizeForWa(readComposerText(c));
    if (mode === 'empty-only' && before) return { ok: false, reason: 'composer-not-empty', message: 'Kotak pesan sudah berisi draft' };
    const replace = mode === 'replace' || !before;
    const payload = replace ? norm : '\n' + norm;
    const expected = replace ? norm : normalizeForWa(before + '\n' + norm);
    const methods = opts.methods ?? ['paste', 'lines', 'plain'];
    const settle = opts.settleMs ?? 60;
    let last: InsertResult = { ok: false, reason: 'mismatch' };
    for (const method of methods) {
      attempt(c, method, payload, replace);
      await sleep(settle);
      const actual = normalizeForWa(readComposerText(c));
      if (actual === expected) return { ok: true, method };
      if (stripBlank(actual) === stripBlank(expected)) return { ok: true, method, soft: true };
      last = { ok: false, method, reason: 'mismatch', mismatch: { expected, actual }, message: 'Teks di kotak pesan berbeda dari pratinjau' };
      // undo only what we did: put the previous draft back (empty when it was empty)
      restore(c, before);
      await sleep(0);
    }
    return last;
  } catch (e) {
    return { ok: false, reason: 'error', message: String((e as Error)?.message ?? e) };
  }
}

/** Human-readable (Indonesian) message for a failed result. */
export function insertErrorText(r: InsertResult): string {
  if (r.ok) return '';
  switch (r.reason) {
    case 'composer-not-found': return 'Kotak pesan chat tidak ditemukan. Buka chat tujuan dulu.';
    case 'composer-not-empty': return 'Kotak pesan sudah berisi draft; tidak ditimpa.';
    case 'empty-text': return 'Teks kosong.';
    case 'mismatch': return 'Teks gagal disisipkan dengan rapi (baris/format berbeda dari pratinjau). Gunakan Salin lalu tempel manual.';
    default: return r.message || 'Gagal menyisipkan teks.';
  }
}

let toastHost: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** Small self-contained toast (Shadow DOM) so failures are visible to the user inside WhatsApp Web. */
export function showToast(msg: string, kind: 'ok' | 'err' = 'err'): void {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.style.cssText = 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:2147483647;pointer-events:none';
    const root = toastHost.attachShadow({ mode: 'open' });
    const st = document.createElement('style');
    st.textContent = '.t{font:13px system-ui,sans-serif;color:#fff;padding:8px 14px;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.3);max-width:360px}.err{background:#b3261e}.ok{background:#128c7e}';
    const d = document.createElement('div');
    d.className = 't';
    root.append(st, d);
    document.documentElement.appendChild(toastHost);
  }
  const d = toastHost.shadowRoot!.querySelector<HTMLElement>('.t')!;
  d.textContent = msg;
  d.className = 't ' + kind;
  toastHost.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (toastHost) toastHost.style.display = 'none'; }, 5000);
}
