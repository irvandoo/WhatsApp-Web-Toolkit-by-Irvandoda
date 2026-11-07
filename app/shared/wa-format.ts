/**
 * Single source of truth for WhatsApp text: normalising, previewing (mimics WhatsApp's chat rendering), table layout and
 * message splitting. Pure (no DOM / chrome). The preview and the text inserted into the composer MUST both be
 * `normalizeForWa(text)` so what you see is exactly what gets sent.
 */

// ---------- normalising ----------
// zero-width + bidi marks + BOM + soft hyphen
const INVISIBLE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
// other unicode spaces -> plain space (NBSP, figure/narrow NBSP, en/em spaces, ideographic space ...)
const ODD_SPACE = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;
// control chars except \n (tab handled separately)
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** Deterministic, idempotent clean-up applied to every text before preview / insertion / copy. */
export function normalizeForWa(text: string): string {
  const s = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/\t/g, '    ')
    .replace(ODD_SPACE, ' ')
    .replace(INVISIBLE, '')
    .replace(CONTROL, '');
  const lines = s.split('\n').map((l) => l.replace(/ +$/, ''));
  const out: string[] = [];
  for (const l of lines) {
    if (l === '' && (out.length === 0 || out[out.length - 1] === '')) continue; // collapse blank runs, drop leading blanks
    out.push(l);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

// ---------- preview AST ----------
export type WaInline =
  | { t: 'text'; v: string }
  | { t: 'bold' | 'italic' | 'strike'; c: WaInline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; v: string };

export type WaBlock =
  | { t: 'line'; c: WaInline[] }
  | { t: 'blank' }
  | { t: 'quote'; lines: WaInline[][] }
  | { t: 'ul'; items: WaInline[][] }
  | { t: 'ol'; items: { n: number; c: WaInline[] }[] }
  | { t: 'pre'; v: string };

const isAlnum = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);
const isSpace = (ch: string | undefined) => !ch || /\s/.test(ch);
const MARKS: Record<string, 'bold' | 'italic' | 'strike'> = { '*': 'bold', _: 'italic', '~': 'strike' };
const URL_RE = /^(?:https?:\/\/|www\.)[^\s]+/i;

function matchUrl(s: string, i: number): string | null {
  const m = URL_RE.exec(s.slice(i));
  if (!m) return null;
  let u = m[0];
  while (u.length && /[.,;:!?)\]'"*_~]$/.test(u)) u = u.slice(0, -1);
  return u.length > 4 ? u : null;
}

/**
 * Inline parser following WhatsApp's rules: an opening mark must follow start/space/punctuation (not a letter or digit) and be
 * followed by a non-space; the closing mark must follow a non-space and be followed by end/space/punctuation. Marks never span
 * lines (we parse line by line). Unmatched marks stay literal. WhatsApp has no escape character.
 */
export function parseInline(s: string): WaInline[] {
  const out: WaInline[] = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    const prev = i > 0 ? s[i - 1] : undefined;
    if (ch === '`') {
      if (s.startsWith('```', i)) {
        const e = s.indexOf('```', i + 3);
        if (e > i + 3) { flush(); out.push({ t: 'code', v: s.slice(i + 3, e) }); i = e + 3; continue; }
      }
      const e = s.indexOf('`', i + 1);
      if (e > i + 1) { flush(); out.push({ t: 'code', v: s.slice(i + 1, e) }); i = e + 1; continue; }
    } else if ((ch === 'h' || ch === 'H' || ch === 'w' || ch === 'W') && !isAlnum(prev)) {
      const u = matchUrl(s, i);
      if (u) { flush(); out.push({ t: 'link', href: /^www\./i.test(u) ? 'https://' + u : u, v: u }); i += u.length; continue; }
    } else if (ch in MARKS && !isAlnum(prev) && !isSpace(s[i + 1]) && s[i + 1] !== ch) {
      let j = i + 2;
      let found = -1;
      for (; j < s.length; j++) {
        if (s[j] === ch && !isSpace(s[j - 1]) && s[j - 1] !== ch && !isAlnum(s[j + 1])) { found = j; break; }
      }
      if (found > 0) {
        flush();
        out.push({ t: MARKS[ch], c: parseInline(s.slice(i + 1, found)) });
        i = found + 1;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

/** Parse text into block nodes (not HTML) ready for React/DOM rendering. Input is normalised first. */
export function renderWaPreviewNodes(text: string): WaBlock[] {
  const lines = normalizeForWa(text).split('\n');
  const blocks: WaBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln === '') { if (lines.length > 1) blocks.push({ t: 'blank' }); continue; }
    const tl = ln.trimStart();
    if (tl.startsWith('```')) {
      const rest = tl.slice(3);
      if (rest.length >= 3 && rest.endsWith('```') && rest.slice(0, -3).trim() !== '') {
        blocks.push({ t: 'pre', v: rest.slice(0, -3) });
        continue;
      }
      let close = -1;
      for (let k = i + 1; k < lines.length; k++) if (lines[k].trimEnd().endsWith('```')) { close = k; break; }
      if (close > 0) {
        const body = [rest, ...lines.slice(i + 1, close), lines[close].trimEnd().slice(0, -3)];
        if (body[0] === '') body.shift();
        if (body.length && body[body.length - 1] === '') body.pop();
        blocks.push({ t: 'pre', v: body.join('\n') });
        i = close;
        continue;
      }
    }
    let m: RegExpExecArray | null;
    if ((m = /^>\s(.*)$/.exec(ln))) {
      const last = blocks[blocks.length - 1];
      const c = parseInline(m[1]);
      if (last?.t === 'quote') last.lines.push(c); else blocks.push({ t: 'quote', lines: [c] });
    } else if ((m = /^[-*]\s+(\S.*)$/.exec(ln))) {
      const last = blocks[blocks.length - 1];
      const c = parseInline(m[1]);
      if (last?.t === 'ul') last.items.push(c); else blocks.push({ t: 'ul', items: [c] });
    } else if ((m = /^(\d{1,3})\.\s+(\S.*)$/.exec(ln))) {
      const last = blocks[blocks.length - 1];
      const it = { n: parseInt(m[1], 10), c: parseInline(m[2]) };
      if (last?.t === 'ol') last.items.push(it); else blocks.push({ t: 'ol', items: [it] });
    } else blocks.push({ t: 'line', c: parseInline(ln) });
  }
  return blocks;
}

// ---------- width helpers (graphemes) ----------
type Seg = { segment: string };
const SegmenterCtor = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<Seg> } }).Segmenter;
const seg = SegmenterCtor ? new SegmenterCtor(undefined, { granularity: 'grapheme' }) : null;
export const graphemes = (s: string): string[] => (seg ? Array.from(seg.segment(s), (x) => x.segment) : Array.from(s));
const WIDE = /[\p{Extended_Pictographic}\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/u;
const gw = (g: string) => (WIDE.test(g) ? 2 : 1);
/** Display width in monospace cells (emoji / CJK = 2). */
export const textWidth = (s: string) => graphemes(s).reduce((n, g) => n + gw(g), 0);

/** Truncate to `max` cells with an ellipsis. */
export function truncateW(s: string, max: number): string {
  if (textWidth(s) <= max) return s;
  let w = 0, out = '';
  for (const g of graphemes(s)) {
    if (w + gw(g) > max - 1) break;
    out += g; w += gw(g);
  }
  return out.replace(/\s+$/, '') + '…';
}

/** Word-wrap to `width` cells; words longer than the width are hard-split by grapheme. */
export function wrapW(s: string, width: number): string[] {
  const out: string[] = [];
  let cur = '', cw = 0;
  const push = () => { out.push(cur); cur = ''; cw = 0; };
  for (const word of s.trim().split(/\s+/).filter(Boolean)) {
    const ww = textWidth(word);
    if (ww > width) {
      if (cur) push();
      for (const g of graphemes(word)) {
        if (cw + gw(g) > width) push();
        cur += g; cw += gw(g);
      }
      continue;
    }
    if (cur && cw + 1 + ww > width) push();
    cur += (cur ? ' ' : '') + word; cw += (cw ? 1 : 0) + ww;
  }
  if (cur || !out.length) out.push(cur);
  return out;
}

export const padEndW = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - textWidth(s)));
export const padStartW = (s: string, w: number) => ' '.repeat(Math.max(0, w - textWidth(s))) + s;

/** "label            value" filling exactly `width` cells (at least one space between). */
export function leftRight(l: string, v: string, width = WA_LINE_WIDTH): string {
  return l + ' '.repeat(Math.max(1, width - textWidth(l) - textWidth(v))) + v;
}

export const FENCE = '```';
/** Wrap lines in a monospace block (the only place where column alignment survives in WhatsApp). */
export const fenceLines = (lines: string[]) => FENCE + '\n' + lines.join('\n') + '\n' + FENCE;

// ---------- invoice table ----------
/** Max characters per monospace line that does not wrap on a typical phone. */
export const WA_LINE_WIDTH = 32;

export interface InvoiceRow {
  name: string;
  /** preformatted, e.g. "2" */
  qty: string;
  /** preformatted unit price, e.g. "Rp 10.000" */
  price: string;
  /** preformatted line total, e.g. "Rp 20.000" */
  total: string;
  /** extra right-aligned lines, e.g. {label:'Diskon', value:'-Rp 1.000'} */
  extra?: { label: string; value: string }[];
}
export interface TableWidths { line?: number; indent?: number }

/**
 * Item table as lines (no fence): numbered name wrapped by width, then "qty x price" left and the line total right-aligned.
 *   1. Kopi Susu Gula Aren
 *      2 x Rp 10.000      Rp 20.000
 */
export function invoiceTableLines(rows: InvoiceRow[], widths: TableWidths = {}): string[] {
  const W = Math.max(16, widths.line ?? WA_LINE_WIDTH);
  const out: string[] = [];
  rows.forEach((r, i) => {
    const num = `${i + 1}. `;
    const ind = ' '.repeat(widths.indent ?? num.length);
    const nameLines = wrapW(r.name || '-', W - ind.length);
    nameLines.forEach((l, k) => out.push((k === 0 ? num.padEnd(ind.length) : ind) + l));
    const l = `${ind}${r.qty} x ${r.price}`;
    out.push(textWidth(l) + textWidth(r.total) + 1 <= W ? leftRight(l, r.total, W) : [l, leftRight(ind, r.total, W)].join('\n'));
    for (const e of r.extra ?? []) out.push(leftRight(ind + truncateW(e.label, Math.max(4, W - ind.length - textWidth(e.value) - 1)), e.value, W));
  });
  return out;
}

/** Item table inside a monospace block. Empty rows -> ''. */
export function formatInvoiceTable(rows: InvoiceRow[], widths: TableWidths = {}): string {
  return rows.length ? fenceLines(invoiceTableLines(rows, widths)) : '';
}

// ---------- splitting ----------
export const WA_MAX_CHARS = 4096;

/**
 * Split into parts of at most `limit` chars at line boundaries (preferring blank lines). Monospace blocks cut by a split are
 * closed and re-opened so every part renders correctly. Each part is normalised.
 */
export function splitForWa(text: string, limit = WA_MAX_CHARS): string[] {
  const norm = normalizeForWa(text);
  if (norm.length <= limit) return norm ? [norm] : [];
  const reserve = FENCE.length + 1;
  const lim = Math.max(reserve + 20, limit);
  // hard-split overly long lines
  const lines: string[] = [];
  for (const l of norm.split('\n')) {
    if (l.length <= lim - reserve - FENCE.length - 1) { lines.push(l); continue; }
    const gs = graphemes(l);
    let cur = '';
    for (const g of gs) {
      if (cur.length + g.length > lim - reserve - FENCE.length - 1) { lines.push(cur); cur = ''; }
      cur += g;
    }
    if (cur) lines.push(cur);
  }
  const parts: string[] = [];
  let cur: string[] = [];
  let len = 0;
  let inFence = false;
  let fenceAtBlank = false;
  let blankAt = -1; // index in cur of the last blank line (safe split point), fence state is closed there
  const toggles = (l: string) => (l.match(/```/g) ?? []).length % 2 === 1;
  const emit = (n: number, closeFence: boolean) => {
    const chunk = cur.slice(0, n);
    if (closeFence) chunk.push(FENCE);
    const t = normalizeForWa(chunk.join('\n'));
    if (t) parts.push(t);
  };
  for (const l of lines) {
    while (cur.length && len + l.length + 1 + reserve > lim) {
      if (blankAt > 0 && blankAt >= cur.length / 3 && !fenceAtBlank) {
        emit(blankAt, false);
        cur = cur.slice(blankAt + 1);
        // recompute state for the remainder (it began outside a fence)
        inFence = cur.reduce((f, x) => (toggles(x) ? !f : f), false);
      } else {
        emit(cur.length, inFence);
        cur = inFence ? [FENCE] : [];
        // fence is still logically open in the next part
      }
      len = cur.join('\n').length;
      blankAt = -1;
    }
    cur.push(l);
    len += l.length + (cur.length > 1 ? 1 : 0);
    if (toggles(l)) inFence = !inFence;
    if (l === '' ) { blankAt = cur.length - 1; fenceAtBlank = inFence; }
  }
  emit(cur.length, false);
  return parts;
}
