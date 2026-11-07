import { formatDuration, parseCsv, toCsv } from './analytics-logic';
import type { Contact } from './crm-types';
import { render, type TplVars } from './template-engine';
import type {
  Campaign, CampaignInput, CampaignSource, OutboxItem, Recipient, Recurrence, SafetySettings, Schedule, SendLogEntry, SendMode,
} from './outbox-types';

export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const MAX_RETRIES = 2;
export const WARMUP_CAPS = [50, 80, 120, 160, 200]; // max sends on day 1..5 of a new account
export const DEFAULT_SAFETY: SafetySettings = {
  delayMinSec: 20, delayMaxSec: 60, maxPerHour: 40, maxPerDay: 200,
  windowEnabled: true, windowFrom: '08:00', windowTo: '20:00',
  warmup: true, checkRegistered: true, pauseAfterErrors: 3,
};
export const SAFETY_LIMITS = { delayMinFloor: 8, delayMaxCeil: 7200, hourCeil: 120, dayCeil: 1000 } as const;

const clampInt = (v: unknown, lo: number, hi: number, d: number): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

// ---------- time helpers (local timezone) ----------
export function parseHm(s: unknown): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(s ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
export const startOfDay = (ts: number): number => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
export const nextDayStart = (ts: number): number => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(); };
const atMinutes = (ts: number, addDays: number, min: number): number => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + addDays, Math.floor(min / 60), min % 60).getTime();
};

/** Clamp and fill safety settings. Hard floors are enforced here (min delay 8s, ceilings). */
export function normalizeSafety(p: Partial<SafetySettings> = {}): SafetySettings {
  const d = DEFAULT_SAFETY;
  const delayMinSec = clampInt(p.delayMinSec, SAFETY_LIMITS.delayMinFloor, SAFETY_LIMITS.delayMaxCeil, d.delayMinSec);
  const delayMaxSec = clampInt(p.delayMaxSec, delayMinSec, SAFETY_LIMITS.delayMaxCeil, Math.max(delayMinSec, d.delayMaxSec));
  return {
    delayMinSec, delayMaxSec,
    maxPerHour: clampInt(p.maxPerHour, 1, SAFETY_LIMITS.hourCeil, d.maxPerHour),
    maxPerDay: clampInt(p.maxPerDay, 1, SAFETY_LIMITS.dayCeil, d.maxPerDay),
    windowEnabled: p.windowEnabled ?? d.windowEnabled,
    windowFrom: parseHm(p.windowFrom) != null ? String(p.windowFrom) : d.windowFrom,
    windowTo: parseHm(p.windowTo) != null ? String(p.windowTo) : d.windowTo,
    warmup: p.warmup ?? d.warmup,
    checkRegistered: p.checkRegistered ?? d.checkRegistered,
    pauseAfterErrors: clampInt(p.pauseAfterErrors, 1, 10, d.pauseAfterErrors),
  };
}

export function inWindow(ts: number, from: string, to: string): boolean {
  const a = parseHm(from), b = parseHm(to);
  if (a == null || b == null || a === b) return true;
  const d = new Date(ts);
  const m = d.getHours() * 60 + d.getMinutes();
  return a < b ? m >= a && m < b : m >= a || m < b;
}

/** ts itself when inside the window, otherwise the next opening time. */
export function nextWindowOpen(ts: number, from: string, to: string): number {
  const a = parseHm(from), b = parseHm(to);
  if (a == null || b == null || a === b || inWindow(ts, from, to)) return ts;
  const d = new Date(ts);
  const m = d.getHours() * 60 + d.getMinutes();
  return m < a ? atMinutes(ts, 0, a) : atMinutes(ts, 1, a);
}

// ---------- phone / recipients ----------
export const isBlockedTarget = (s: string): boolean => /@g\.us|@broadcast|broadcast|status@|@newsletter/i.test(String(s ?? ''));

/** Indonesian-first normalization. Returns digits (country code, no +) with 10..15 digits, or null. */
export function normalizePhone(raw: string, cc = '62'): string | null {
  const s0 = String(raw ?? '').trim();
  if (!s0 || s0.includes('@') || /[a-z]/i.test(s0) || isBlockedTarget(s0)) return null;
  const s = s0.replace(/\(0\)/g, '');
  const plus = s.startsWith('+');
  const digits = s.replace(/\D/g, '');
  if (!digits) return null;
  let d: string;
  if (plus) d = digits;
  else if (digits.startsWith('00')) d = digits.slice(2);
  else if (digits.startsWith('0')) d = cc + digits.slice(1);
  else if (digits.startsWith(cc)) d = digits;
  else if (digits.startsWith('8')) d = cc + digits;
  else d = digits;
  return /^[1-9]\d{9,14}$/.test(d) ? d : null;
}

export interface InvalidRow { line: number; raw: string; reason: string }
export interface ParsedRecipients { recipients: Recipient[]; invalid: InvalidRow[]; duplicates: number; columns: string[] }

const PHONE_HEADERS = new Set(['phone', 'telepon', 'telp', 'nomor', 'no', 'hp', 'no_hp', 'nohp', 'whatsapp', 'wa', 'number', 'nomor_hp', 'no_wa']);
const NAME_HEADERS = new Set(['nama', 'name']);
const colKey = (h: string): string => h.trim().toLowerCase().replace(/[\s.-]+/g, '_').replace(/[^a-z0-9_]/g, '');

/** CSV/paste parser. Header row optional (telepon,nama,...); extra columns become template variables. */
export function parseRecipients(text: string): ParsedRecipients {
  let src = String(text ?? '');
  if (!src.includes(',') && /[;\t]/.test(src)) src = src.replace(/[;\t]/g, ',');
  const rows = parseCsv(src);
  const out: Recipient[] = [];
  const invalid: InvalidRow[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let header: string[] | null = null;
  let start = 0;
  if (rows.length) {
    const keys = rows[0].map(colKey);
    if (keys.some((k) => PHONE_HEADERS.has(k)) && !rows[0].some((c) => normalizePhone(c))) { header = keys; start = 1; }
  }
  const phoneCol = header ? header.findIndex((k) => PHONE_HEADERS.has(k)) : 0;
  const nameCol = header ? header.findIndex((k) => NAME_HEADERS.has(k)) : -1;
  for (let i = start; i < rows.length; i++) {
    const row = rows[i];
    const raw = row.join(',');
    let pi = phoneCol;
    if (!header) { const j = row.findIndex((c) => normalizePhone(c)); if (j >= 0) pi = j; }
    const phone = normalizePhone(row[pi] ?? '');
    if (!phone) { invalid.push({ line: i + 1, raw, reason: 'Nomor tidak valid (harus 10-15 digit)' }); continue; }
    if (seen.has(phone)) { duplicates++; continue; }
    seen.add(phone);
    const r: Recipient = { phone };
    const vars: Record<string, string> = {};
    if (header) {
      header.forEach((k, ci) => {
        if (ci === pi || !k || !/^[a-z_]/.test(k)) return;
        const v = (row[ci] ?? '').trim();
        if (v) vars[k] = v;
      });
      if (nameCol >= 0 && row[nameCol]?.trim()) r.name = row[nameCol].trim();
    } else {
      const nm = row.find((c, ci) => ci !== pi && c.trim() && !normalizePhone(c));
      if (nm) r.name = nm.trim();
    }
    if (r.name) vars.nama = r.name;
    if (Object.keys(vars).length) r.vars = vars;
    out.push(r);
  }
  const columns = header ? header.filter((k, ci) => ci !== phoneCol && k) : [];
  return { recipients: out, invalid, duplicates, columns };
}

export function recipientsTemplateCsv(): string {
  return toCsv(
    [{ telepon: '081234567890', nama: 'Budi', kota: 'Bandung' }, { telepon: '+62 812-3456-7891', nama: 'Siti', kota: 'Jakarta' }],
    ['telepon', 'nama', 'kota'],
  );
}

export interface CrmFilter { stage?: string; tag?: string; accountId?: string }
export interface CrmPick { recipients: Recipient[]; skipped: { optOut: number; group: number; invalid: number } }

/** Contacts -> recipients. Skips optOut, groups/broadcast and invalid numbers. */
export function recipientsFromContacts(contacts: Contact[], f: CrmFilter = {}): CrmPick {
  const skipped = { optOut: 0, group: 0, invalid: 0 };
  const seen = new Set<string>();
  const recipients: Recipient[] = [];
  for (const c of contacts) {
    if (f.stage && c.stage !== f.stage) continue;
    if (f.tag && !c.tags.includes(f.tag)) continue;
    if (f.accountId && c.accountId !== f.accountId) continue;
    if (isBlockedTarget(c.chatId) || !c.phone) { skipped.group++; continue; }
    if (c.optOut) { skipped.optOut++; continue; }
    const phone = normalizePhone(c.phone);
    if (!phone) { skipped.invalid++; continue; }
    if (seen.has(phone)) continue;
    seen.add(phone);
    recipients.push({ phone, name: c.name || undefined, contactKey: c.key, stage: c.stage, vars: c.name ? { nama: c.name } : undefined });
  }
  return { recipients, skipped };
}

/** Merge lists (first wins), dedupe by phone, drop opted-out numbers. */
export function mergeRecipients(lists: Recipient[][], optOutPhones: Set<string> = new Set()): { recipients: Recipient[]; duplicates: number; optedOut: number } {
  const seen = new Set<string>();
  const recipients: Recipient[] = [];
  let duplicates = 0, optedOut = 0;
  for (const r of lists.flat()) {
    if (optOutPhones.has(r.phone)) { optedOut++; continue; }
    if (seen.has(r.phone)) { duplicates++; continue; }
    seen.add(r.phone);
    recipients.push(r);
  }
  return { recipients, duplicates, optedOut };
}

export function optOutPhoneSet(contacts: Contact[]): Set<string> {
  const s = new Set<string>();
  for (const c of contacts) if (c.optOut) { const p = normalizePhone(c.phone); if (p) s.add(p); }
  return s;
}

// ---------- rendering ----------
export function buildVars(r: Recipient, ctx: { akun?: string; now?: number } = {}): TplVars {
  const tanggal = new Date(ctx.now ?? Date.now()).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const v: Record<string, string> = { ...(r.vars ?? {}) };
  v.nama = (r.name || v.nama || 'Kak').trim() || 'Kak';
  v.telepon = r.phone;
  v.tahap = r.stage ?? v.tahap ?? '';
  v.tanggal = tanggal;
  v.akun = ctx.akun ?? v.akun ?? '';
  return v as TplVars;
}

export function renderMessage(template: string, r: Recipient, ctx: { akun?: string; now?: number } = {}, rng: () => number = Math.random): { text: string; unresolved: string[] } {
  const text = render(template, buildVars(r, ctx), rng).replace(/\r\n/g, '\n').trim();
  const unresolved = [...new Set([...text.matchAll(/\{([a-z_][a-z0-9_]*)\}/gi)].map((m) => m[1].toLowerCase()))];
  return { text, unresolved };
}

// ---------- caps / placement ----------
export const autoSentTimes = (log: SendLogEntry[]): number[] => log.filter((e) => e.status === 'sent' && e.mode === 'auto').map((e) => e.ts).sort((a, b) => a - b);

export function effectiveDailyCap(s: SafetySettings, ts: number, firstTs: number): number {
  if (!s.warmup) return s.maxPerDay;
  const idx = Math.max(0, Math.round((startOfDay(ts) - startOfDay(firstTs)) / DAY));
  return Math.min(s.maxPerDay, idx < WARMUP_CAPS.length ? WARMUP_CAPS[idx] : Infinity);
}

export function randDelayMs(s: SafetySettings, rng: () => number = Math.random): number {
  return Math.round((s.delayMinSec + rng() * (s.delayMaxSec - s.delayMinSec)) * 1000);
}

const countSince = (sorted: number[], from: number, to = Infinity): number => {
  let n = 0;
  for (let i = sorted.length - 1; i >= 0; i--) { if (sorted[i] < from) break; if (sorted[i] < to) n++; }
  return n;
};

/** Earliest time >= t that satisfies window + hourly + daily caps, given past/planned send times (ascending). */
export function placeSend(t: number, s: SafetySettings, sent: number[], firstTs: number): number {
  for (let i = 0; i < 5000; i++) {
    if (s.windowEnabled) {
      const w = nextWindowOpen(t, s.windowFrom, s.windowTo);
      if (w !== t) { t = w; continue; }
    }
    const inHour: number[] = [];
    for (let k = sent.length - 1; k >= 0 && sent[k] > t - HOUR; k--) if (sent[k] <= t) inHour.unshift(sent[k]);
    if (inHour.length >= s.maxPerHour) { t = inHour[inHour.length - s.maxPerHour] + HOUR; continue; }
    if (countSince(sent, startOfDay(t), nextDayStart(t)) >= effectiveDailyCap(s, t, firstTs)) { t = nextDayStart(t); continue; }
    return t;
  }
  return t;
}

export interface CapCheck { ok: boolean; reason?: string; retryAt?: number }
/** Send-time check against safety settings and the log of previous automatic sends. */
export function checkCaps(s: SafetySettings, now: number, log: SendLogEntry[]): CapCheck {
  const sent = autoSentTimes(log);
  const first = sent.length ? sent[0] : now;
  const last = sent.length ? sent[sent.length - 1] : 0;
  if (s.windowEnabled && !inWindow(now, s.windowFrom, s.windowTo)) {
    return { ok: false, reason: `Di luar jam kirim (${s.windowFrom}-${s.windowTo})`, retryAt: nextWindowOpen(now, s.windowFrom, s.windowTo) };
  }
  if (now - last < s.delayMinSec * 1000) return { ok: false, reason: 'Menunggu jeda antar pesan', retryAt: last + s.delayMinSec * 1000 };
  const at = placeSend(now, s, sent, first);
  if (at <= now) return { ok: true };
  const hourFull = countSince(sent, now - HOUR) >= s.maxPerHour;
  return { ok: false, reason: hourFull ? 'Batas per jam tercapai' : 'Batas harian tercapai', retryAt: at };
}

// ---------- planning ----------
export interface PlanInput extends CampaignInput {
  id: string;
  now: number;
  history?: number[];                  // ascending times of previous automatic sends
  optOutPhones?: Set<string>;
  akun?: string;
  mode?: SendMode;                     // 'draft' = no caps/window (nothing is sent automatically)
  rng?: () => number;
  genId?: () => string;
  scheduleId?: string;
}
export interface PlanResult {
  ok: boolean;
  errors: string[];
  campaign?: Campaign;
  items: OutboxItem[];
  skipped: { phone: string; reason: string }[];
  startAt: number;
  endAt: number;
  durationMs: number;
}

export function planCampaign(p: PlanInput): PlanResult {
  const rng = p.rng ?? Math.random;
  const genId = p.genId ?? (() => crypto.randomUUID());
  const errors: string[] = [];
  const safety = normalizeSafety(p.safety);
  const startAt = Math.max(p.startAt ?? p.now, p.now);
  if (!p.optInConfirmed) errors.push('Centang "Penerima sudah opt-in" untuk melanjutkan.');
  if (!String(p.template ?? '').trim()) errors.push('Isi pesan masih kosong.');
  if (!String(p.name ?? '').trim()) errors.push('Nama kampanye wajib diisi.');
  const merged = mergeRecipients([p.recipients], p.optOutPhones ?? new Set<string>());
  const items: OutboxItem[] = [];
  const skipped: { phone: string; reason: string }[] = [];
  const sent = [...(p.history ?? [])];
  const first = sent.length ? sent[0] : startAt;
  let prev = 0;
  for (const r of merged.recipients) {
    const phone = normalizePhone(r.phone);
    if (!phone) { skipped.push({ phone: r.phone, reason: 'Nomor tidak valid' }); continue; }
    const { text, unresolved } = renderMessage(p.template, { ...r, phone }, { akun: p.akun, now: p.now }, rng);
    if (!text) { skipped.push({ phone, reason: 'Pesan kosong' }); continue; }
    if (unresolved.length) { skipped.push({ phone, reason: `Variabel belum terisi: ${unresolved.map((u) => `{${u}}`).join(' ')}` }); continue; }
    const cand = items.length === 0 ? startAt : prev + randDelayMs(safety, rng);
    const due = p.mode === 'draft' ? cand : placeSend(cand, safety, sent, first);
    prev = due;
    sent.push(due);
    items.push({ id: genId(), campaignId: p.id, phone, name: r.name, text, status: 'pending', dueAt: due, attempts: 0, createdAt: p.now, contactKey: r.contactKey });
  }
  if (merged.optedOut) skipped.push({ phone: '-', reason: `${merged.optedOut} nomor dilewati (opt-out di CRM)` });
  if (!items.length && !errors.length) errors.push('Tidak ada penerima valid.');
  const endAt = items.length ? items[items.length - 1].dueAt : startAt;
  if (errors.length) return { ok: false, errors, items: [], skipped, startAt, endAt: startAt, durationMs: 0 };
  const campaign: Campaign = {
    id: p.id, name: p.name.trim(), template: p.template, status: 'running', source: p.source as CampaignSource, createdAt: p.now, startAt,
    safety, optInConfirmed: !!p.optInConfirmed, total: items.length, accountId: p.accountId, scheduleId: p.scheduleId,
  };
  return { ok: true, errors, campaign, items, skipped, startAt, endAt, durationMs: endAt - startAt };
}

export const describeDuration = (ms: number): string => (ms < 1000 ? 'langsung' : formatDuration(ms));

// ---------- send-time selection ----------
export interface SendCtx {
  campaigns: Campaign[];
  log: SendLogEntry[];
  auto: boolean;                  // false = draft-on-due (store flavor): no caps/window, nothing is sent
  optOutPhones?: Set<string>;
  killed?: boolean;
  accountId?: string | null;
}
export type NextResult = { item: OutboxItem; campaign: Campaign } | { item: null; reason: string; retryAt?: number };

/** Guard that must hold for every send; returns an Indonesian error or null. */
export function assertSendable(item: OutboxItem, campaign: Campaign | undefined, optOut: Set<string> = new Set()): string | null {
  if (!campaign) return 'Kampanye tidak ditemukan';
  if (!campaign.optInConfirmed) return 'Penerima belum dikonfirmasi opt-in';
  if (isBlockedTarget(item.phone) || isBlockedTarget(item.chatId ?? '')) return 'Grup/broadcast/status tidak diizinkan';
  if (normalizePhone(item.phone) !== item.phone) return 'Nomor tidak valid';
  if (optOut.has(item.phone)) return 'Kontak opt-out di CRM';
  if (!item.text.trim()) return 'Pesan kosong';
  return null;
}

const SINGLE_SOURCES: CampaignSource[] = ['schedule', 'reminder'];

/**
 * Picks the next item allowed to go out right now. Staggering: only the oldest running blast campaign is
 * active; single-message schedule/reminder campaigns may interleave (they still obey every cap).
 */
export function nextSendable(items: OutboxItem[], now: number, ctx: SendCtx): NextResult {
  if (ctx.killed) return { item: null, reason: 'Dihentikan (tombol Stop global)' };
  const running = ctx.campaigns.filter((c) => c.status === 'running' && (!c.accountId || !ctx.accountId || c.accountId === ctx.accountId));
  const byId = new Map(running.map((c) => [c.id, c]));
  const pending = items.filter((i) => i.status === 'pending' && byId.has(i.campaignId));
  const blasts = running.filter((c) => !SINGLE_SOURCES.includes(c.source) && pending.some((i) => i.campaignId === c.id)).sort((a, b) => a.createdAt - b.createdAt);
  const active = blasts[0]?.id;
  const eligible = pending
    .filter((i) => i.campaignId === active || SINGLE_SOURCES.includes(byId.get(i.campaignId)!.source))
    .sort((a, b) => a.dueAt - b.dueAt);
  if (!eligible.length) return { item: null, reason: 'Tidak ada pesan menunggu' };
  let retryAt: number | undefined;
  let reason = 'Belum jatuh tempo';
  for (const item of eligible) {
    if (item.dueAt > now) { retryAt = Math.min(retryAt ?? Infinity, item.dueAt); continue; }
    const campaign = byId.get(item.campaignId)!;
    const bad = assertSendable(item, campaign, ctx.optOutPhones);
    if (bad) { reason = bad; continue; }
    if (ctx.auto) {
      const c = checkCaps(campaign.safety, now, ctx.log);
      if (!c.ok) { reason = c.reason ?? reason; if (c.retryAt) retryAt = Math.min(retryAt ?? Infinity, c.retryAt); continue; }
    }
    return { item, campaign };
  }
  return { item: null, reason, retryAt };
}

/** After a send: push later pending items of the campaign so the random delay holds even if sending drifted. */
export function bumpAfterSend(pending: OutboxItem[], s: SafetySettings, now: number, rng: () => number = Math.random): { id: string; dueAt: number }[] {
  const sorted = [...pending].sort((a, b) => a.dueAt - b.dueAt);
  const out: { id: string; dueAt: number }[] = [];
  let floor = now + randDelayMs(s, rng);
  for (const it of sorted) {
    if (it.dueAt < floor) { out.push({ id: it.id, dueAt: floor }); floor += randDelayMs(s, rng); }
    else floor = it.dueAt + s.delayMinSec * 1000;
  }
  return out;
}

/** True when the last N automatic attempts (transient errors only) all failed. */
export function shouldAutoPause(log: SendLogEntry[], n = 3): boolean {
  const recent = log
    .filter((e) => e.mode === 'auto' && (e.status === 'sent' || (e.status === 'failed' && e.countable !== false)))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, n);
  return recent.length >= n && recent.every((e) => e.status === 'failed');
}

export type RetryPlan = { status: 'pending'; dueAt: number; attempts: number } | { status: 'failed'; attempts: number };
export function retryPlan(item: Pick<OutboxItem, 'attempts'>, permanent: boolean, now: number, rng: () => number = Math.random): RetryPlan {
  const attempts = item.attempts + 1;
  if (permanent || attempts > MAX_RETRIES) return { status: 'failed', attempts };
  return { status: 'pending', attempts, dueAt: now + attempts * 5 * 60_000 + Math.round(rng() * 30_000) };
}

// ---------- schedules ----------
export function computeNextRun(rec: Recurrence, after: number): number | null {
  if (rec.type === 'none') return Number.isFinite(rec.at) && rec.at > after ? rec.at : null;
  const hm = parseHm(rec.time);
  if (hm == null) return null;
  if (rec.type === 'weekly' && !rec.weekdays?.length) return null;
  for (let i = 0; i <= 8; i++) {
    const c = atMinutes(after, i, hm);
    if (c <= after) continue;
    if (rec.type === 'weekly' && !rec.weekdays.includes(new Date(c).getDay())) continue;
    return c;
  }
  return null;
}

export function validateSchedule(s: Schedule): string[] {
  const e: string[] = [];
  if (!s.name?.trim()) e.push('Nama jadwal wajib diisi.');
  if (!normalizePhone(s.target?.phone ?? '')) e.push('Nomor tujuan tidak valid.');
  if (!s.text?.trim()) e.push('Isi pesan kosong.');
  if (!s.optInConfirmed) e.push('Centang "Penerima sudah opt-in".');
  const r = s.recurrence;
  if (r.type === 'none' ? !Number.isFinite(r.at) : parseHm(r.time) == null) e.push('Waktu tidak valid.');
  if (r.type === 'weekly' && !r.weekdays?.length) e.push('Pilih minimal satu hari.');
  return e;
}

/** Schedule runs missed by more than this are skipped instead of sent late (stale messages). */
export const MAX_LATE_MS = 12 * HOUR;

// ---------- misc ----------
export function countByStatus(items: { status: string }[]): Record<string, number> {
  const o: Record<string, number> = {};
  for (const i of items) o[i.status] = (o[i.status] ?? 0) + 1;
  return o;
}

export const LOG_COLUMNS = ['waktu', 'kampanye', 'nomor', 'status', 'mode', 'keterangan'];
export function logToCsv(entries: SendLogEntry[], campaignNames: Record<string, string> = {}): string {
  const rows = entries.map((e) => ({
    waktu: new Date(e.ts).toISOString(), kampanye: campaignNames[e.campaignId] ?? e.campaignId, nomor: e.phone,
    status: e.status, mode: e.mode, keterangan: e.error ?? '',
  }));
  return toCsv(rows, LOG_COLUMNS);
}
