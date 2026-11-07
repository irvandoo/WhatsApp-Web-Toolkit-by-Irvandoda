/** Pure analytics logic (no DOM / chrome / Dexie). Contracts: analytics-types.ts (frozen). */
import {
  PRIORITY_THRESHOLDS_MS,
  type DateRange, type DayStat, type Interaction, type LeadKind, type MsgEvent, type RangeKey,
  type Summary, type UnansweredRow,
} from './analytics-types';

const DAY_MS = 24 * 3600e3;
/** Ranges up to this many days get a zero-filled per-day series; longer ones list only non-empty days. */
const ZERO_FILL_MAX_DAYS = 400;

const pad = (n: number) => String(n).padStart(2, '0');

/** Local YYYY-MM-DD for an epoch ms. */
export function dayKeyOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Range resolution, all in the LOCAL timezone. Boundaries are built from y/m/d (never "+24h")
 * so DST days of 23/25 hours are handled. Ranges are [from, to).
 *  - today: local midnight .. next local midnight
 *  - week:  last 7 local days including today (from = midnight 6 days ago)
 *  - month: calendar month to date (1st of current month .. next midnight, today included)
 *  - year:  calendar year to date (Jan 1 .. next midnight)
 *  - all:   earliestTs ?? 0 .. now + 1
 *  - custom: exactly the given from/to
 */
export function resolveRange(key: RangeKey, now: number = Date.now(), custom?: { from: number; to: number }, earliestTs?: number): DateRange {
  const d = new Date(now);
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
  const tomorrow = new Date(y, m, day + 1).getTime();
  switch (key) {
    case 'today': return { key, from: new Date(y, m, day).getTime(), to: tomorrow };
    case 'week': return { key, from: new Date(y, m, day - 6).getTime(), to: tomorrow };
    case 'month': return { key, from: new Date(y, m, 1).getTime(), to: tomorrow };
    case 'year': return { key, from: new Date(y, 0, 1).getTime(), to: tomorrow };
    case 'all': return { key, from: earliestTs ?? 0, to: now + 1 };
    case 'custom': return { key, from: custom?.from ?? new Date(y, m, day).getTime(), to: custom?.to ?? tomorrow };
  }
}

/**
 * Per-chat kind:
 *  - 'new':      we have inbound but never replied (no outbound known)
 *  - 'followup': we replied before (firstOutTs) and they wrote again after that (lastInTs > firstOutTs)
 *  - 'existing': everything else
 * (Whether a chat counts as a new lead in a PERIOD is decided by leadDayOf, which is more lenient.)
 */
export function classifyInteraction(i: Interaction): LeadKind {
  if (i.firstInTs != null && i.firstOutTs == null) return 'new';
  if (i.firstOutTs != null && i.lastInTs != null && i.lastInTs > i.firstOutTs) return 'followup';
  return 'existing';
}

/**
 * Local day of the lead when the chat is a NEW lead: firstInTs != null and (never replied OR first reply came
 * after the first inbound). It is counted on the day of firstInTs even if we replied later; once replied,
 * later inbound messages are follow-ups. Otherwise null.
 */
export function leadDayOf(i: Interaction): string | null {
  if (i.firstInTs == null) return null;
  if (i.firstOutTs != null && i.firstOutTs <= i.firstInTs) return null;
  return dayKeyOf(i.firstInTs);
}

export interface SummaryOpts { accountId?: string; includeGroups?: boolean }

function iPass(i: { accountId: string; isGroup: boolean }, o?: SummaryOpts): boolean {
  if (o?.accountId && i.accountId !== o.accountId) return false;
  if (i.isGroup && !o?.includeGroups) return false;
  return true;
}

function isUnanswered(i: Interaction): boolean {
  return i.lastInTs != null && (i.lastOutTs == null || i.lastOutTs < i.lastInTs);
}

export function summarize(events: MsgEvent[], interactions: Interaction[], range: DateRange, opts?: SummaryOpts): Summary {
  const { from, to } = range;
  const byKey = new Map<string, Interaction>();
  for (const i of interactions) if (iPass(i, opts)) byKey.set(i.key, i);

  const days = new Map<string, DayStat>();
  const zeroFill = (to - from) / DAY_MS <= ZERO_FILL_MAX_DAYS + 1;
  const blank = (date: string): DayStat => ({ date, newLeads: 0, followUps: 0, inbound: 0, outbound: 0 });
  if (zeroFill && to > from) {
    const s = new Date(from);
    for (let k = 0; ; k++) {
      const dt = new Date(s.getFullYear(), s.getMonth(), s.getDate() + k);
      if (dt.getTime() >= to) break;
      days.set(dayKeyOf(dt.getTime()), blank(dayKeyOf(dt.getTime())));
      if (k > 5000) break;
    }
  }
  const dayOf = (ts: number): DayStat => {
    const k = dayKeyOf(ts);
    let d = days.get(k);
    if (!d) { d = blank(k); days.set(k, d); }
    return d;
  };

  // New leads
  let newLeads = 0;
  let respSum = 0, respN = 0;
  for (const i of byKey.values()) {
    if (i.firstInTs == null || i.firstInTs < from || i.firstInTs >= to) continue;
    if (leadDayOf(i) == null) continue;
    newLeads++;
    dayOf(i.firstInTs).newLeads++;
    if (i.firstOutTs != null && i.firstOutTs > i.firstInTs) { respSum += i.firstOutTs - i.firstInTs; respN++; }
  }

  // Events
  let inbound = 0, outbound = 0;
  const active = new Set<string>();
  const fuTotal = new Set<string>();
  const fuDay = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.ts < from || e.ts >= to) continue;
    if (!iPass(e, opts)) continue;
    const ck = `${e.accountId}|${e.chatId}`;
    active.add(ck);
    const ds = dayOf(e.ts);
    if (e.dir === 'out') { outbound++; ds.outbound++; continue; }
    inbound++; ds.inbound++;
    const it = byKey.get(ck);
    if (!it || it.firstOutTs == null || e.ts <= it.firstOutTs) continue;
    if (leadDayOf(it) === ds.date) continue; // counted as new that day
    fuTotal.add(ck);
    let s = fuDay.get(ds.date);
    if (!s) { s = new Set(); fuDay.set(ds.date, s); }
    s.add(ck);
  }
  for (const [k, s] of fuDay) days.get(k)!.followUps = s.size;

  let unanswered = 0;
  for (const i of byKey.values()) if (isUnanswered(i)) unanswered++;

  return {
    range, newLeads, followUps: fuTotal.size, inbound, outbound, activeChats: active.size, unanswered,
    avgFirstResponseMs: respN ? respSum / respN : null,
    days: [...days.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
  };
}

/**
 * Chats waiting for our reply: lastInTs set and (never replied or lastOutTs < lastInTs).
 * waitingSinceTs: the exact first inbound after our last outbound is not stored, so we conservatively use
 * lastInTs (waiting time may be under-estimated). Groups excluded unless includeGroups. Sorted waitingMs desc.
 */
export function buildUnanswered(interactions: Interaction[], now: number, opts?: SummaryOpts): UnansweredRow[] {
  const rows: UnansweredRow[] = [];
  for (const i of interactions) {
    if (!iPass(i, opts) || !isUnanswered(i)) continue;
    const since = i.lastInTs as number;
    const waitingMs = Math.max(0, now - since);
    const kind = classifyInteraction(i);
    rows.push({
      key: i.key, accountId: i.accountId, chatId: i.chatId, name: i.name, phone: i.phone,
      waitingSinceTs: since, waitingMs, kind, inCount: i.inCount, priority: priorityOf(waitingMs, kind),
    });
  }
  return rows.sort((a, b) => b.waitingMs - a.waitingMs);
}

const LEVELS = ['low', 'normal', 'high', 'urgent'] as const;
/** urgent >= 24h, high >= 6h, normal >= 1h, else low; new leads bump one level (max urgent). */
export function priorityOf(waitingMs: number, kind: LeadKind): UnansweredRow['priority'] {
  const t = PRIORITY_THRESHOLDS_MS;
  let lv = waitingMs >= t.urgent ? 3 : waitingMs >= t.high ? 2 : waitingMs >= t.normal ? 1 : 0;
  if (kind === 'new') lv = Math.min(3, lv + 1);
  return LEVELS[lv];
}

/** Indonesian compact: '<1 mnt', '45 mnt', '2 j 15 mnt', '3 hr 4 j'. Shows the two largest units. */
export function formatDuration(ms: number): string {
  const totalMin = Math.floor(Math.max(0, ms) / 60e3);
  if (totalMin < 1) return '<1 mnt';
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return hours > 0 ? `${days} hr ${hours} j` : `${days} hr`;
  if (hours > 0) return mins > 0 ? `${hours} j ${mins} mnt` : `${hours} j`;
  return `${mins} mnt`;
}

// ---------- CSV ----------

const PLAIN_NEG_NUMBER = /^-\d+(\.\d+)?$/;

function cell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s) && !PLAIN_NEG_NUMBER.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** RFC4180 (CRLF) with formula-injection guard (leading = + - @ tab CR get a ' prefix, except plain negative numbers). */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  return [columns.map(cell).join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\r\n');
}

/** Parses CSV into rows of strings: handles BOM, quotes ("" escapes), CRLF/LF/CR, embedded newlines. Blank lines skipped. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const out: string[][] = [];
  let row: string[] = [];
  let f = '';
  let q = false;
  let touched = false;
  const endField = () => { row.push(f); f = ''; };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0] === '' && !touched)) out.push(row);
    row = []; touched = false;
  };
  for (let k = 0; k < src.length; k++) {
    const c = src[k];
    if (q) {
      if (c === '"') { if (src[k + 1] === '"') { f += '"'; k++; } else q = false; }
      else f += c;
      continue;
    }
    if (c === '"') { q = true; touched = true; }
    else if (c === ',') { endField(); touched = true; }
    else if (c === '\r') { if (src[k + 1] === '\n') k++; endRow(); }
    else if (c === '\n') endRow();
    else { f += c; touched = true; }
  }
  if (touched || f !== '' || row.length) endRow();
  return out;
}

export const REPORT_COLUMNS = ['account_id', 'chat_id', 'name', 'phone', 'first_in', 'first_out', 'last_in', 'last_out', 'in_count', 'out_count'];

export function reportTemplateCsv(): string {
  return toCsv([
    { account_id: '628111111111@c.us', chat_id: '628122222222@c.us', name: 'Contoh Pelanggan A', phone: '628122222222', first_in: '2026-01-05T09:15:00.000Z', first_out: '2026-01-05T09:40:00.000Z', last_in: '2026-01-07T10:00:00.000Z', last_out: '2026-01-07T10:20:00.000Z', in_count: 5, out_count: 4 },
    { account_id: '628111111111@c.us', chat_id: '628133333333@c.us', name: 'Contoh Pelanggan B', phone: '628133333333', first_in: '2026-01-06T13:00:00.000Z', first_out: '', last_in: '2026-01-06T13:05:00.000Z', last_out: '', in_count: 2, out_count: 0 },
  ], REPORT_COLUMNS);
}

const unguard = (s: string) => (s.startsWith("'") ? s.slice(1) : s).trim();

/** Parses an import CSV (see reportTemplateCsv). Invalid rows are skipped and reported in errors (Indonesian). */
export function parseReportCsv(text: string): { interactions: Interaction[]; errors: string[] } {
  const rows = parseCsv(text);
  const errors: string[] = [];
  const interactions: Interaction[] = [];
  if (!rows.length) return { interactions, errors: ['File kosong'] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx: Record<string, number> = {};
  REPORT_COLUMNS.forEach((c) => { idx[c] = header.indexOf(c); });
  const missing = ['account_id', 'chat_id'].filter((c) => idx[c] < 0);
  if (missing.length) return { interactions, errors: [`Kolom wajib tidak ada: ${missing.join(', ')}`] };
  const get = (r: string[], c: string) => (idx[c] >= 0 ? unguard(r[idx[c]] ?? '') : '');
  const seen = new Set<string>();

  for (let n = 1; n < rows.length; n++) {
    const r = rows[n];
    const ln = n + 1;
    const errs: string[] = [];
    const accountId = get(r, 'account_id');
    const chatId = get(r, 'chat_id');
    if (!accountId) errs.push('account_id kosong');
    if (!chatId) errs.push('chat_id kosong');

    const dates: Record<string, number | null> = {};
    for (const c of ['first_in', 'first_out', 'last_in', 'last_out']) {
      const v = get(r, c);
      if (!v) { dates[c] = null; continue; }
      const t = Date.parse(v);
      if (Number.isNaN(t)) { errs.push(`${c} bukan tanggal ISO 8601 valid`); dates[c] = null; } else dates[c] = t;
    }
    const ints: Record<string, number> = {};
    for (const c of ['in_count', 'out_count']) {
      const v = get(r, c);
      if (v === '') { ints[c] = 0; continue; }
      if (!/^\d+$/.test(v) || !Number.isSafeInteger(Number(v))) { errs.push(`${c} harus bilangan bulat >= 0`); ints[c] = 0; } else ints[c] = Number(v);
    }
    let phone = get(r, 'phone').replace(/[\s-]/g, '').replace(/^\+/, '');
    if (phone && !/^\d{5,16}$/.test(phone)) { errs.push('phone harus berisi 5-16 digit'); phone = ''; }
    if (!phone) { const m = /^(\d+)(?::\d+)?@(c\.us|s\.whatsapp\.net|lid)$/.exec(chatId); phone = m ? m[1] : ''; }
    if (dates.first_in == null && dates.first_out == null && dates.last_in == null && dates.last_out == null) errs.push('minimal satu tanggal harus diisi');

    if (errs.length) { errors.push(`Baris ${ln}: ${errs.join('; ')}`); continue; }
    const key = `${accountId}|${chatId}`;
    if (seen.has(key)) { errors.push(`Baris ${ln}: duplikat ${key} (digabung)`); }
    seen.add(key);
    const it: Interaction = {
      key, accountId, chatId, name: get(r, 'name') || phone || chatId, phone, isGroup: chatId.endsWith('@g.us'),
      firstInTs: dates.first_in, firstOutTs: dates.first_out, lastInTs: dates.last_in, lastOutTs: dates.last_out,
      inCount: ints.in_count, outCount: ints.out_count, partialHistory: true,
    };
    const prevIdx = interactions.findIndex((x) => x.key === key);
    if (prevIdx >= 0) interactions[prevIdx] = mergeInteraction(interactions[prevIdx], it);
    else interactions.push(it);
  }
  return { interactions, errors };
}

const iso = (t: number | null) => (t == null ? '' : new Date(t).toISOString());

export function exportInteractionsCsv(list: Interaction[]): string {
  return toCsv(list.map((i) => ({
    account_id: i.accountId, chat_id: i.chatId, name: i.name, phone: i.phone,
    first_in: iso(i.firstInTs), first_out: iso(i.firstOutTs), last_in: iso(i.lastInTs), last_out: iso(i.lastOutTs),
    in_count: i.inCount, out_count: i.outCount,
  })), REPORT_COLUMNS);
}

/** Per-day rows followed by a TOTAL row. */
export function exportReportCsv(s: Summary): string {
  const cols = ['date', 'new_leads', 'follow_ups', 'inbound', 'outbound'];
  const rows: Record<string, unknown>[] = s.days.map((d) => ({ date: d.date, new_leads: d.newLeads, follow_ups: d.followUps, inbound: d.inbound, outbound: d.outbound }));
  rows.push({ date: 'TOTAL', new_leads: s.newLeads, follow_ups: s.followUps, inbound: s.inbound, outbound: s.outbound });
  return toCsv(rows, cols);
}

export function exportUnansweredCsv(rows: UnansweredRow[]): string {
  const cols = ['name', 'phone', 'chat_id', 'kind', 'priority', 'waiting', 'waiting_since', 'in_count', 'stage', 'tags', 'opt_out'];
  return toCsv(rows.map((r) => ({
    name: r.name, phone: r.phone, chat_id: r.chatId, kind: r.kind, priority: r.priority,
    waiting: formatDuration(r.waitingMs), waiting_since: iso(r.waitingSinceTs), in_count: r.inCount,
    stage: r.stage ?? '', tags: (r.tags ?? []).join(';'), opt_out: r.optOut ? 'ya' : '',
  })), cols);
}

/** Union of two records for the same chat: min of firsts, max of lasts, max of counts, partial if either. */
export function mergeInteraction(prev: Interaction | undefined, next: Interaction): Interaction {
  if (!prev) return next;
  const mn = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.min(a, b));
  const mx = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b));
  return {
    ...next,
    name: next.name || prev.name,
    phone: next.phone || prev.phone,
    firstInTs: mn(prev.firstInTs, next.firstInTs), firstOutTs: mn(prev.firstOutTs, next.firstOutTs),
    lastInTs: mx(prev.lastInTs, next.lastInTs), lastOutTs: mx(prev.lastOutTs, next.lastOutTs),
    inCount: Math.max(prev.inCount, next.inCount), outCount: Math.max(prev.outCount, next.outCount),
    partialHistory: prev.partialHistory || next.partialHistory,
  };
}
