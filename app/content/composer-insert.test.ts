// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { insertIntoComposer, readComposerText } from './composer-insert';

interface Behaviour {
  paste: boolean | 'replace-only'; // editor handles synthetic paste (keeps newlines)
  lineBreakCmd: boolean; // execCommand('insertLineBreak') works
  shiftEnter: boolean; // keydown Shift+Enter inserts a new line
  flatten: boolean; // insertText turns "\n" into a space (newline loss)
}
let sent = 0;
let keys: { key: string; shift: boolean }[] = [];
let c: HTMLElement;

const para = (t: string) => { const p = document.createElement('p'); if (t) p.append(t); else p.append(document.createElement('br')); return p; };
const setLines = (ls: string[]) => { c.replaceChildren(...ls.map(para)); };
const allSelected = () => {
  const r = window.getSelection()?.getRangeAt(0);
  return !!r && !r.collapsed && r.startContainer === c && r.startOffset === 0 && r.endOffset === c.childNodes.length;
};
const lastP = () => {
  if (!c.lastElementChild) c.append(para(''));
  const p = c.lastElementChild as HTMLElement;
  p.querySelector('br')?.remove();
  return p;
};

function setup(b: Behaviour, draft: string[] = []) {
  document.body.innerHTML = '<div id="main"><footer><div contenteditable="true" role="textbox"></div></footer></div>';
  c = document.querySelector('[role=textbox]') as HTMLElement;
  setLines(draft);
  sent = 0; keys = [];
  c.addEventListener('paste', (e) => {
    if (!b.paste || (b.paste === 'replace-only' && !allSelected())) return;
    e.preventDefault();
    const txt = (e as ClipboardEvent).clipboardData!.getData('text/plain');
    if (allSelected()) c.replaceChildren();
    const lines = txt.split('\n');
    // append behaviour: first line continues the last paragraph (like a real caret at the end)
    lines.forEach((l, i) => { if (i === 0 && c.lastElementChild) { const p = lastP(); p.append(l); } else c.append(para(l)); });
  });
  c.addEventListener('keydown', (e) => {
    const k = e as KeyboardEvent;
    keys.push({ key: k.key, shift: k.shiftKey });
    if (k.key === 'Enter' && !k.shiftKey) sent++;
    if (k.key === 'Enter' && k.shiftKey && b.shiftEnter) c.append(para(''));
  });
  (document as unknown as { execCommand: unknown }).execCommand = (cmd: string, _ui?: boolean, v?: string) => {
    if (cmd === 'delete') { if (allSelected()) c.replaceChildren(); return true; }
    if (cmd === 'insertLineBreak') { if (!b.lineBreakCmd) return false; c.append(para('')); return true; }
    if (cmd === 'insertText') {
      if (allSelected()) c.replaceChildren();
      const txt = b.flatten ? String(v).replace(/\n/g, ' ') : String(v);
      const p = lastP(); p.append(txt);
      return true;
    }
    return false;
  };
}

const good: Behaviour = { paste: true, lineBreakCmd: true, shiftEnter: true, flatten: false };
const T = 'Toko *Maju*\n\n```\n1. Kopi\n   2 x Rp 10.000   Rp 20.000\n```\nTerima kasih';
const run = (o?: Parameters<typeof insertIntoComposer>[1]) => insertIntoComposer(T, { settleMs: 0, ...o });

describe('readComposerText', () => {
  it('reads paragraphs, blank lines and br', () => {
    setup(good, ['a', '', 'b']);
    expect(readComposerText(c)).toBe('a\n\nb');
    c.innerHTML = 'x<br>y<br>';
    expect(readComposerText(c)).toBe('x\ny');
    c.innerHTML = '';
    expect(readComposerText(c)).toBe('');
  });
});

describe('insertIntoComposer', () => {
  beforeEach(() => setup(good));

  it('uses synthetic paste first and verifies read-back', async () => {
    const r = await run();
    expect(r).toMatchObject({ ok: true, method: 'paste' });
    expect(readComposerText(c)).toBe(T);
  });

  it('falls back to per-line insert when paste is ignored', async () => {
    setup({ ...good, paste: false });
    const r = await run();
    expect(r).toMatchObject({ ok: true, method: 'lines' });
    expect(readComposerText(c)).toBe(T);
  });

  it('uses Shift+Enter keydown when insertLineBreak is unavailable, never plain Enter', async () => {
    setup({ paste: false, lineBreakCmd: false, shiftEnter: true, flatten: false });
    const r = await run();
    expect(r).toMatchObject({ ok: true, method: 'lines' });
    expect(readComposerText(c)).toBe(T);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.key === 'Enter' && k.shift)).toBe(true);
    expect(sent).toBe(0);
  });

  it('reports mismatch and restores the composer when nothing keeps newlines (empty before)', async () => {
    setup({ paste: false, lineBreakCmd: false, shiftEnter: false, flatten: true });
    const r = await run();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('mismatch');
    expect(r.mismatch?.expected).toBe(T);
    expect(r.mismatch?.actual).not.toBe(T);
    expect(readComposerText(c)).toBe('');
    expect(sent).toBe(0);
  });

  it('appends on a new line after an existing draft by default', async () => {
    setup(good, ['Halo kak']);
    const r = await run();
    expect(r.ok).toBe(true);
    expect(readComposerText(c)).toBe('Halo kak\n' + T);
  });

  it('restores the existing draft when an attempt fails', async () => {
    setup({ paste: 'replace-only', lineBreakCmd: false, shiftEnter: false, flatten: true }, ['Draft saya', 'baris 2']);
    const r = await run();
    expect(r.ok).toBe(false);
    expect(readComposerText(c)).toBe('Draft saya\nbaris 2');
  });

  it('replace mode overwrites; empty-only refuses to touch a draft', async () => {
    setup(good, ['lama']);
    expect((await run({ mode: 'empty-only' })).reason).toBe('composer-not-empty');
    expect(readComposerText(c)).toBe('lama');
    const r = await run({ mode: 'replace' });
    expect(r.ok).toBe(true);
    expect(readComposerText(c)).toBe(T);
  });

  it('replace mode works through the fallback path too', async () => {
    setup({ ...good, paste: false }, ['lama', 'sekali']);
    const r = await run({ mode: 'replace' });
    expect(r).toMatchObject({ ok: true, method: 'lines' });
    expect(readComposerText(c)).toBe(T);
  });

  it('normalises input (CRLF, trailing spaces, NBSP) before inserting', async () => {
    const r = await insertIntoComposer('a  \r\n\r\n\r\n\r\nb c  ', { settleMs: 0 });
    expect(r.ok).toBe(true);
    expect(readComposerText(c)).toBe('a\n\nb c');
  });

  it('handles composer missing and empty text', async () => {
    document.body.innerHTML = '';
    expect(await run()).toMatchObject({ ok: false, reason: 'composer-not-found' });
    setup(good);
    expect(await insertIntoComposer('  \n ', { settleMs: 0 })).toMatchObject({ ok: false, reason: 'empty-text' });
  });

  it('accepts a paste event without a native DataTransfer (clipboardData shim)', async () => {
    // jsdom has no DataTransfer; the first test already proves the shim path works. Verify getData is exposed on the event.
    let got = '';
    c.addEventListener('paste', (e) => { got = (e as ClipboardEvent).clipboardData?.getData('text/plain') ?? ''; });
    await run();
    expect(got).toBe(T);
  });
});
