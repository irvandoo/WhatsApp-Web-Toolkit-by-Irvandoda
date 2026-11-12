/** Recipient sources, phone auto-format, manual parsing and merge/dedupe. Pure, no I/O. */
import type { Recipient } from './outbox-types';

export type RecipientSource = 'manual' | 'label' | 'grup' | 'crm' | 'csv';

export interface PhoneResult { ok: boolean; phone?: string; reason?: string; original: string }

const ZERO_WIDTH = /[​-‏‪-‮⁠-⁤﻿­]/g;

/** Full-width and Arabic-Indic / Persian digits to ASCII; full-width plus to '+'. */
function foldDigits(s: string): string {
  return s
    .replace(ZERO_WIDTH, '')
    .replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xff10))
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[＋⁺]/g, '+')
    .replace(/[   ]/g, ' ');
}

const bad = (original: string, reason: string): PhoneResult => ({ ok: false, reason, original });

/**
 * Canonical international digits (no '+', separators). Indonesian mobile numbers must be 628xxxxxxx (10-15 digits);
 * other countries only when explicitly given with '+' or '00' (or a WhatsApp JID).
 */
export function normalizePhone(raw: unknown, defaultCc = '62'): PhoneResult {
  const original = String(raw ?? '');
  let s = foldDigits(original).trim();
  if (!s) return bad(original, 'kosong');

  // tel: URI
  s = s.replace(/^tel:/i, '').split(';')[0].trim();
  // scientific notation (Excel mangled it)
  if (/^[+-]?\d+(?:[.,]\d+)?e[+-]?\d+$/i.test(s)) return bad(original, 'format ilmiah, perbaiki di Excel');

  let explicit = false; // international form given explicitly
  const jid = /^\+?(\d+)(?::\d+)?@(c\.us|s\.whatsapp\.net)$/i.exec(s);
  if (jid) { s = jid[1]; explicit = true; }
  else if (/@g\.us$/i.test(s)) return bad(original, 'ID grup, bukan nomor');
  else if (/@lid$/i.test(s)) return bad(original, 'ID LID, nomor tidak diketahui');
  else if (s.includes('@')) return bad(original, 'format tidak dikenali');

  if (/[a-z\p{L}]/iu.test(s)) return bad(original, 'mengandung huruf');
  s = s.replace(/\(0\)/g, '');
  if (/[^\d\s+().\-/]/.test(s)) return bad(original, 'karakter tidak dikenali');
  if (s.lastIndexOf('+') > 0 || (s.match(/\+/g) ?? []).length > 1) return bad(original, 'tanda + salah posisi');

  const plus = s.startsWith('+');
  let d = s.replace(/\D/g, '');
  if (!d) return bad(original, 'tidak ada digit');
  const cc = String(defaultCc || '62').replace(/\D/g, '') || '62';

  if (jid) explicit = true;
  else if (plus) explicit = true;
  else if (d.startsWith('00')) { d = d.slice(2); explicit = true; }
  else if (d.startsWith('0')) d = cc + d.slice(1);
  else if (d.startsWith(cc)) { /* already international */ }
  else if (d.startsWith('8') && d.length >= 9 && d.length <= 12 && cc === '62') d = cc + d;
  else return bad(original, 'kode negara tidak jelas (awali +kode negara, 0, atau 62)');

  // 620857... -> 62857...
  if (d.startsWith(cc + '0')) d = cc + d.slice(cc.length + 1);
  if (!d || d[0] === '0') return bad(original, 'format tidak valid');

  if (d.startsWith('62')) {
    if (!/^628\d+$/.test(d)) return bad(original, 'bukan nomor seluler Indonesia (harus 628...)');
    if (d.length < 10 || d.length > 15) return bad(original, `panjang ${d.length} digit tidak wajar (10-15)`);
    return { ok: true, phone: d, original };
  }
  if (explicit || (cc !== '62' && d.startsWith(cc))) {
    if (d.length < 8 || d.length > 15) return bad(original, `panjang ${d.length} digit tidak wajar (8-15)`);
    return { ok: true, phone: d, original };
  }
  return bad(original, 'kode negara tidak jelas (awali dengan +)');
}

/** One candidate recipient from any source. `reason` set = invalid (phone holds the raw text). */
export interface RecipientEntry {
  phone: string;
  name?: string;
  source?: RecipientSource;
  original?: string;
  reason?: string;
  /** phone already canonical (from CRM/CSV/normalizer): skip re-normalizing. */
  formatted?: boolean;
  vars?: Record<string, string>;
  contactKey?: string;
  stage?: string;
}

// ---------- manual parsing ----------
const HEADER_WORDS = new Set(['nama', 'name', 'nomor', 'no', 'telepon', 'telp', 'phone', 'hp', 'wa', 'whatsapp', 'number', 'no_hp', 'nohp']);
const hasLetter = (s: string) => /\p{L}/u.test(s);
const sciLike = (s: string) => /^[+-]?\d+(?:[.,]\d+)?e[+-]?\d+$/i.test(s.trim());
const isNameTok = (t: string) => hasLetter(t) && !sciLike(t) && !/@/.test(t) && !/^tel:/i.test(t);
const cleanName = (n: string) => n.replace(ZERO_WIDTH, '').replace(/^[\s\-–—:|"'`]+|[\s\-–—:|"'`]+$/g, '').replace(/\s+/g, ' ').trim();

const NAME_THEN = /^(\p{L}[^\d+()]*?)\s+[-–—:|]\s+([+(]?[\d０-９٠-٩۰-۹].*)$/u;
const PHONE_THEN = /^([+(]?[\d０-９٠-٩۰-۹][\d０-９\s().+\-]*?)\s+[-–—:|]\s+(\p{L}.*)$/u;
const NAME_SP = /^(\p{L}[\p{L}.'’ ]*?)\s+([+(]?\d[\d\s().+\-]{6,})$/u;
const SP_NAME = /^([+(]?\d[\d\s().+\-]{6,}?)\s+(\p{L}[\p{L}.'’ ]*)$/u;

/** Split "Budi - 0812..." style single tokens into [name, phone] or null. */
function splitPair(t: string): { name: string; phone: string } | null {
  let m = NAME_THEN.exec(t);
  if (m) return { name: m[1], phone: m[2] };
  m = PHONE_THEN.exec(t);
  if (m) return { name: m[2], phone: m[1] };
  m = NAME_SP.exec(t);
  if (m) return { name: m[1], phone: m[2] };
  m = SP_NAME.exec(t);
  if (m) return { name: m[2], phone: m[1] };
  return null;
}

export interface ParseOpts { autoFormat?: boolean; defaultCc?: string }

function toEntry(raw: string, name: string | undefined, o: Required<ParseOpts>): RecipientEntry {
  const nm = name ? cleanName(name) || undefined : undefined;
  if (!o.autoFormat) {
    const d = foldDigits(raw).trim();
    if (/^[1-9]\d{7,14}$/.test(d)) return { phone: d, name: nm, source: 'manual', original: raw, formatted: true };
    return { phone: raw.trim(), name: nm, source: 'manual', original: raw, reason: 'format otomatis mati: harus 8-15 digit tanpa simbol' };
  }
  const r = normalizePhone(raw, o.defaultCc);
  return r.ok
    ? { phone: r.phone as string, name: nm, source: 'manual', original: raw, formatted: true }
    : { phone: raw.trim(), name: nm, source: 'manual', original: raw, reason: r.reason };
}

/**
 * Free text -> entries. Lines split by newline; within a line by comma / semicolon / tab.
 * Supports "Nama, nomor", "nomor, nama", "Nama - nomor" and "nomor - nama" (also space separated).
 */
export function parseManualInput(text: string, opts: ParseOpts = {}): RecipientEntry[] {
  const o: Required<ParseOpts> = { autoFormat: opts.autoFormat ?? true, defaultCc: opts.defaultCc ?? '62' };
  const out: RecipientEntry[] = [];
  const lines = foldDigits(String(text ?? '')).split(/\r\n|\r|\n/);
  let first = true;
  for (const line of lines) {
    const toks = line.split(/[,;\t]/).map((t) => t.trim()).filter(Boolean);
    if (!toks.length) continue;
    if (first && toks.every((t) => HEADER_WORDS.has(t.toLowerCase().replace(/[\s.]+/g, '_')))) { first = false; continue; }
    first = false;

    const phoneFirst = !isNameTok(toks[0]);
    let pending: string | undefined;
    let last: RecipientEntry | undefined;
    for (const t of toks) {
      const pair = splitPair(t);
      if (pair) {
        const e = toEntry(pair.phone, pair.name, o);
        out.push(e); last = e; pending = undefined;
      } else if (isNameTok(t)) {
        if (phoneFirst && last && !last.name) last.name = cleanName(t) || undefined;
        else if (phoneFirst) out.push({ phone: t, source: 'manual', original: t, reason: 'tidak ada nomor' });
        else pending = pending ? `${pending} ${t}` : t;
      } else {
        const e = toEntry(t, pending, o);
        out.push(e); last = e; pending = undefined;
      }
    }
    if (pending) out.push({ phone: pending, source: 'manual', original: pending, reason: 'tidak ada nomor' });
  }
  return out;
}

// ---------- merge ----------
/** `key` is unique per row: the phone when deduping, `phone#n` for repeated numbers when duplicates are allowed. */
export interface MergedRecipient extends Recipient { key: string; source: RecipientSource; sources: RecipientSource[] }
export interface DuplicateInfo { phone: string; kept: RecipientSource; removed: RecipientSource[]; count: number }
export interface InvalidInfo { original: string; reason: string; source: RecipientSource; listIndex: number; entryIndex: number }
export interface ExcludedInfo { phone: string; reason: 'optout' | 'previous'; source: RecipientSource; name?: string }
export interface MergeOpts {
  optOut?: Set<string>;
  previous?: Set<string>;
  /** default true */
  excludeOptOut?: boolean;
  /** default false */
  excludePrevious?: boolean;
  /** default true: remove repeated numbers. false = keep every occurrence (the same number gets one message per row). */
  dedupe?: boolean;
  defaultCc?: string;
}
export interface MergeStats {
  total: number; unique: number; duplicates: number; invalid: number; optOut: number; previous: number;
  /** extra occurrences kept because dedupe is off */
  repeats: number;
  bySource: Record<RecipientSource, number>;
}
export interface MergeResult { unique: MergedRecipient[]; duplicates: DuplicateInfo[]; invalid: InvalidInfo[]; excluded: ExcludedInfo[]; stats: MergeStats }

/** Dedup key: canonical digits. Returns null when the entry is invalid. */
export function entryPhone(e: RecipientEntry, cc = '62'): { phone: string } | { reason: string } {
  if (e.reason) return { reason: e.reason };
  if (e.formatted) return /^[1-9]\d{7,14}$/.test(e.phone) ? { phone: e.phone } : { reason: 'format tidak valid' };
  const r = normalizePhone(e.phone, cc);
  return r.ok ? { phone: r.phone as string } : { reason: r.reason ?? 'tidak valid' };
}

/** Merge lists in order (first occurrence wins). Duplicates are removed (names/vars back-filled) unless `dedupe: false`. */
export function mergeRecipients(lists: { source: RecipientSource; entries: RecipientEntry[] }[], opts: MergeOpts = {}): MergeResult {
  const cc = opts.defaultCc ?? '62';
  const exOpt = opts.excludeOptOut ?? true;
  const exPrev = opts.excludePrevious ?? false;
  const dedupe = opts.dedupe ?? true;
  const occ = new Map<string, number>();
  const unique: MergedRecipient[] = [];
  const index = new Map<string, MergedRecipient>();
  const dups = new Map<string, DuplicateInfo>();
  const invalid: InvalidInfo[] = [];
  const excluded: ExcludedInfo[] = [];
  const seenEx = new Set<string>();
  const bySource: Record<RecipientSource, number> = { manual: 0, label: 0, grup: 0, crm: 0, csv: 0 };
  let total = 0, dupCount = 0, optN = 0, prevN = 0, repeats = 0;

  lists.forEach((list, li) => {
    list.entries.forEach((e, ei) => {
      total++;
      const k = entryPhone(e, cc);
      if ('reason' in k) { invalid.push({ original: e.original ?? e.phone, reason: k.reason, source: list.source, listIndex: li, entryIndex: ei }); return; }
      const phone = k.phone;
      const kept = dedupe ? index.get(phone) : undefined;
      if (kept) {
        dupCount++;
        let d = dups.get(phone);
        if (!d) { d = { phone, kept: kept.source, removed: [], count: 0 }; dups.set(phone, d); }
        d.removed.push(list.source); d.count++;
        if (!kept.name && e.name) kept.name = e.name;
        if (e.vars) kept.vars = { ...e.vars, ...(kept.vars ?? {}) };
        if (!kept.contactKey && e.contactKey) kept.contactKey = e.contactKey;
        if (!kept.stage && e.stage) kept.stage = e.stage;
        if (!kept.sources.includes(list.source)) kept.sources.push(list.source);
        return;
      }
      if (exOpt && opts.optOut?.has(phone)) { optN++; if (!seenEx.has(phone)) { seenEx.add(phone); excluded.push({ phone, reason: 'optout', source: list.source, name: e.name }); } return; }
      if (exPrev && opts.previous?.has(phone)) { prevN++; if (!seenEx.has(phone)) { seenEx.add(phone); excluded.push({ phone, reason: 'previous', source: list.source, name: e.name }); } return; }
      const n = occ.get(phone) ?? 0;
      occ.set(phone, n + 1);
      if (n > 0) repeats++;
      const r: MergedRecipient = { key: n ? `${phone}#${n}` : phone, phone, source: list.source, sources: [list.source] };
      if (e.name) r.name = e.name;
      if (e.vars) r.vars = { ...e.vars };
      if (e.contactKey) r.contactKey = e.contactKey;
      if (e.stage) r.stage = e.stage;
      index.set(phone, r);
      unique.push(r);
      bySource[list.source]++;
    });
  });
  return {
    unique, duplicates: [...dups.values()], invalid, excluded,
    stats: { total, unique: unique.length, duplicates: dupCount, invalid: invalid.length, optOut: optN, previous: prevN, repeats, bySource },
  };
}

/** Strip UI-only fields: the exact shape the campaign wizard / planCampaign expects. */
export function toCampaignRecipients(list: MergedRecipient[]): Recipient[] {
  return list.map((r) => {
    const o: Recipient = { phone: r.phone };
    if (r.name) o.name = r.name;
    if (r.vars) o.vars = r.vars;
    else if (r.name) o.vars = { nama: r.name };
    if (r.contactKey) o.contactKey = r.contactKey;
    if (r.stage) o.stage = r.stage;
    return o;
  });
}

export const SOURCE_LABEL: Record<RecipientSource, string> = { manual: 'Manual', label: 'Label', grup: 'Grup', crm: 'CRM', csv: 'CSV' };

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
/** Final list as CSV (telepon,nama,sumber). */
export function recipientsToCsv(list: MergedRecipient[]): string {
  return ['telepon,nama,sumber', ...list.map((r) => [r.phone, r.name ?? '', r.sources.map((s) => SOURCE_LABEL[s]).join('+')].map(csvCell).join(','))].join('\n');
}

/** Entries from an already-normalized Recipient list (CRM / CSV code paths). */
export function entriesFromRecipients(list: Recipient[], source: RecipientSource): RecipientEntry[] {
  return list.map((r) => ({ phone: r.phone, name: r.name, source, formatted: true, vars: r.vars, contactKey: r.contactKey, stage: r.stage }));
}
