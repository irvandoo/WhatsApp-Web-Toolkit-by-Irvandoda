import type { ArDecision, ArInbound, ArLogEntry, ArRule, ArSchedule } from './autoreply-types';
import { renderWithRotation, type RotState } from './rotation';
import type { TplVars } from './template-engine';

export const MAX_INBOUND_AGE_MS = 15 * 60_000;
const HOUR = 3600_000;

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface MatchCtx { isNewLead: boolean; now: number }

/** Chat ids we must never auto-reply to (groups, broadcast lists, status, channels). */
export function isForbiddenChat(chatKey: string): boolean {
  const id = chatKey.includes('|') ? chatKey.slice(chatKey.indexOf('|') + 1) : chatKey;
  return /@g\.us$/.test(id) || id.includes('broadcast') || id.startsWith('status@') || id.endsWith('@newsletter');
}

function hhmm(s: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
export const validHHMM = (s: string): boolean => hhmm(s) !== null;

/** True if `now` is inside the schedule (business hours). Supports overnight ranges (e.g. 22:00-06:00). */
export function isWithinSchedule(schedule: ArSchedule | undefined, now: number | Date): boolean {
  if (!schedule) return true;
  const from = hhmm(schedule.from), to = hhmm(schedule.to);
  if (from === null || to === null) return false;
  const d = new Date(now);
  const mins = d.getHours() * 60 + d.getMinutes();
  const day = d.getDay();
  const days = schedule.days;
  if (from === to) return days.includes(day); // whole day
  if (from < to) return days.includes(day) && mins >= from && mins < to;
  // overnight: evening part belongs to the start day, morning part to the day after the start day
  if (mins >= from) return days.includes(day);
  if (mins < to) return days.includes((day + 6) % 7);
  return false;
}

export function matchKeywords(rule: Pick<ArRule, 'keywords' | 'matchMode'>, text: string): boolean {
  const t = norm(text);
  if (!t) return false;
  for (const raw of rule.keywords) {
    const k = norm(raw);
    if (!k) continue;
    if (rule.matchMode === 'exact') {
      if (t.replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim() === k) return true;
    } else if (rule.matchMode === 'regex-safe') {
      if (new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(k)}($|[^\\p{L}\\p{N}])`, 'u').test(t)) return true;
    } else if (t.includes(k)) return true;
  }
  return false;
}

export function matchRule(rule: ArRule, text: string, ctx: MatchCtx): boolean {
  if (!rule.enabled) return false;
  switch (rule.trigger) {
    case 'any': return true;
    case 'keyword': return matchKeywords(rule, text);
    case 'first-message': return ctx.isNewLead;
    case 'away-hours': return !isWithinSchedule(rule.schedule, ctx.now);
  }
}

/** First enabled matching rule by `order` wins. */
export function pickRule(rules: ArRule[], text: string, ctx: MatchCtx): ArRule | undefined {
  return [...rules].sort((a, b) => a.order - b.order).find((r) => matchRule(r, text, ctx));
}

export function inCooldown(rule: ArRule, chatKey: string, log: ArLogEntry[], now: number): boolean {
  const win = Math.max(0, rule.cooldownMin) * 60_000;
  return log.some((l) => l.ruleId === rule.id && l.chatKey === chatKey && (l.action === 'sent' || l.action === 'draft') && now - l.ts < win);
}

export function sentLastHour(log: ArLogEntry[], now: number): number {
  return log.filter((l) => l.action === 'sent' && now - l.ts < HOUR && now >= l.ts).length;
}
export const overRateLimit = (rule: ArRule, log: ArLogEntry[], now: number): boolean =>
  sentLastHour(log, now) >= Math.max(0, rule.maxPerHour);

export function nextDelayMs(rule: Pick<ArRule, 'delaySec'>, rng: () => number = Math.random): number {
  const [a, b] = rule.delaySec;
  const lo = Math.max(0, Math.min(a, b)), hi = Math.max(0, Math.max(a, b));
  return Math.round((lo + rng() * (hi - lo)) * 1000);
}

export interface DecideInput {
  rules: ArRule[];
  inbound: ArInbound;
  now: number;
  log: ArLogEntry[];
  lastOutboundTs: number | null;
  rng?: () => number;
  /** rotation state per rule id (persisted by the caller) */
  rotation?: Record<string, RotState | undefined>;
  vars?: TplVars;
  /** false when sending is not possible (store flavor, send:text unavailable, or global Auto-kirim off) */
  canAutoSend?: boolean;
}

const skip = (reason: string, rule?: ArRule): ArDecision => ({ action: 'skip', reason, rule });

/** Strict safety gate + rule selection. Pure. */
export function decide(i: DecideInput): ArDecision {
  const { inbound: m, now, log } = i;
  const rng = i.rng ?? Math.random;
  if (m.isGroup || isForbiddenChat(m.chatKey)) return skip('grup/broadcast/status tidak pernah dibalas');
  if (m.optOut) return skip('kontak opt-out');
  if (!m.text.trim()) return skip('pesan bukan teks');
  if (i.lastOutboundTs != null && i.lastOutboundTs >= m.ts) return skip('sudah dibalas');
  if (now - m.ts > MAX_INBOUND_AGE_MS) return skip('pesan terlalu lama');
  const rule = pickRule(i.rules, m.text, { isNewLead: m.isNewLead, now });
  if (!rule) return skip('tidak ada aturan cocok');
  if (rule.onlyNewLeads && !m.isNewLead) return skip('hanya untuk lead baru', rule);
  if (inCooldown(rule, m.chatKey, log, now)) return skip('masih masa jeda (cooldown)', rule);
  const rot = renderWithRotation({ body: rule.reply, variants: rule.replyVariants, rotation: rule.rotation }, i.vars ?? {}, i.rotation?.[rule.id], rng);
  const text = rot.text.trim();
  const rotState = rule.replyVariants?.some((v) => v.trim()) ? rot.state : undefined;
  if (!text) return skip('isi balasan kosong', rule);
  if (rule.mode === 'auto' && i.canAutoSend !== false) {
    if (overRateLimit(rule, log, now)) return skip('batas per jam tercapai', rule);
    return { action: 'send', rule, text, delayMs: nextDelayMs(rule, rng), reason: 'cocok aturan', rotState };
  }
  return { action: 'draft', rule, text, reason: rule.mode === 'auto' ? 'auto tidak tersedia, jadi draft' : 'cocok aturan', rotState };
}

/** Editor validation: returns a list of error strings (empty = ok). */
export function validateRule(r: ArRule): string[] {
  const e: string[] = [];
  if (!r.name.trim()) e.push('Nama aturan wajib diisi.');
  if (!r.reply.trim()) e.push('Isi balasan wajib diisi.');
  if (r.reply.length > 1000) e.push('Balasan maksimal 1000 karakter.');
  if ((r.replyVariants?.length ?? 0) > 10) e.push('Varian balasan maksimal 10.');
  if (r.replyVariants?.some((v) => v.length > 1000)) e.push('Setiap varian balasan maksimal 1000 karakter.');
  if (r.trigger === 'keyword' && !r.keywords.some((k) => k.trim())) e.push('Tambahkan minimal satu kata kunci.');
  if (r.trigger === 'away-hours') {
    if (!r.schedule || !validHHMM(r.schedule.from) || !validHHMM(r.schedule.to)) e.push('Jam kerja tidak valid (format HH:MM).');
    else if (!r.schedule.days.length) e.push('Pilih minimal satu hari kerja.');
  }
  if (r.delaySec[0] < 0 || r.delaySec[1] < r.delaySec[0]) e.push('Rentang jeda tidak valid (min <= maks).');
  if (r.mode === 'auto' && r.delaySec[0] < 2) e.push('Mode auto: jeda minimal 2 detik.');
  if (!(r.cooldownMin >= 0)) e.push('Cooldown tidak valid.');
  if (!(r.maxPerHour >= 1 && r.maxPerHour <= 60)) e.push('Batas per jam harus 1-60.');
  return e;
}
