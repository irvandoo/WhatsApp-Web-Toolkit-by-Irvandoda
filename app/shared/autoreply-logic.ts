import {
  AR_SCOPES, DEFAULT_GROUP_CFG, GROUP_COOLDOWN_MIN, type ArDecision, type ArGroupCfg, type ArGroupRef, type ArInbound, type ArLogEntry, type ArRule,
  type ArSchedule, type ArScope,
} from './autoreply-types';
import { renderWithRotation, type RotState } from './rotation';
import type { TplVars } from './template-engine';

export const MAX_INBOUND_AGE_MS = 15 * 60_000;
const HOUR = 3600_000;

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface MatchCtx { isNewLead: boolean; now: number; isGroup?: boolean }

const idOf = (chatKey: string): string => (chatKey.includes('|') ? chatKey.slice(chatKey.indexOf('|') + 1) : chatKey);
export const isGroupKey = (chatKey: string): boolean => /@g\.us$/.test(idOf(chatKey));

/** Chat ids we must never auto-reply to (broadcast lists, status, channels). Groups are handled by rule scope + group guards. */
export function isForbiddenChat(chatKey: string): boolean {
  const id = idOf(chatKey);
  return id.includes('broadcast') || id.startsWith('status@') || id.endsWith('@newsletter');
}

// ---------- scope / group config ----------
export const scopeOf = (r: Pick<ArRule, 'scope'>): ArScope => (AR_SCOPES.includes(r.scope) ? r.scope : 'personal');
export const scopeAllows = (r: Pick<ArRule, 'scope'>, isGroup: boolean): boolean => {
  const sc = scopeOf(r);
  return sc === 'all' || (isGroup ? sc === 'group' : sc === 'personal');
};
const refs = (v: unknown): ArGroupRef[] =>
  (Array.isArray(v) ? v : []).filter((x): x is ArGroupRef => !!x && typeof (x as ArGroupRef).name === 'string' && typeof (x as ArGroupRef).id === 'string')
    .map((x) => ({ id: x.id.trim(), name: x.name.trim() })).filter((x) => x.id || x.name);

/** Normalised group guards with the unremovable floors applied. */
export function groupCfg(r: { grp?: Partial<ArGroupCfg> }): ArGroupCfg {
  const g = r.grp ?? {};
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    allow: refs(g.allow), deny: refs(g.deny),
    requireMention: g.requireMention !== false,
    groupCooldownMin: Math.max(GROUP_COOLDOWN_MIN, num(g.groupCooldownMin, DEFAULT_GROUP_CFG.groupCooldownMin)),
    maxPerHour: Math.min(60, Math.max(1, Math.round(num(g.maxPerHour, DEFAULT_GROUP_CFG.maxPerHour)))),
  };
}

/** Migration: rules saved before group scope existed become 'personal' with default group guards. Idempotent. */
export function normalizeRule(r: ArRule): ArRule {
  return { ...r, scope: scopeOf(r), grp: groupCfg(r), groups: false };
}
export const needsMigration = (r: Partial<ArRule>): boolean => !AR_SCOPES.includes(r.scope as ArScope) || !r.grp;

const matchRef = (ref: ArGroupRef, chatId: string, groupName: string): boolean =>
  ref.id ? ref.id === chatId : !!ref.name && norm(ref.name) === norm(groupName);
export const groupListed = (list: ArGroupRef[], chatId: string, groupName: string): boolean => list.some((x) => matchRef(x, chatId, groupName));

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
  if (!scopeAllows(rule, !!ctx.isGroup)) return false;
  if (ctx.isGroup && rule.trigger !== 'keyword') return false; // groups: keyword triggers only, no exceptions
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

/** Sent replies in the last hour. Personal and group counts are separate (group = chat id ends with @g.us). */
export function sentLastHour(log: ArLogEntry[], now: number, group = false): number {
  return log.filter((l) => l.action === 'sent' && now - l.ts < HOUR && now >= l.ts && isGroupKey(l.chatKey) === group).length;
}
export const overRateLimit = (rule: ArRule, log: ArLogEntry[], now: number, group = false): boolean =>
  group ? sentLastHour(log, now, true) >= groupCfg(rule).maxPerHour : sentLastHour(log, now) >= Math.max(0, rule.maxPerHour);

/** Group cooldown per (group + author), any rule. Floor 5 min. */
export function inAuthorCooldown(rule: ArRule, chatKey: string, author: string, log: ArLogEntry[], now: number): boolean {
  const win = Math.max(GROUP_COOLDOWN_MIN, rule.cooldownMin || 0) * 60_000;
  return log.some((l) => l.chatKey === chatKey && l.author === author && (l.action === 'sent' || l.action === 'draft') && now - l.ts < win);
}
/** Group-wide cooldown (any author, any rule). */
export function inGroupCooldown(rule: ArRule, chatKey: string, log: ArLogEntry[], now: number): boolean {
  const win = groupCfg(rule).groupCooldownMin * 60_000;
  return log.some((l) => l.chatKey === chatKey && (l.action === 'sent' || l.action === 'draft') && now - l.ts < win);
}

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

/** Group-only gates for one rule. Returns a skip reason or null (= allowed). These cannot be turned off. */
function groupGate(rule: ArRule, m: ArInbound, chatId: string): string | null {
  const g = groupCfg(rule);
  const name = m.groupName ?? '';
  if (groupListed(g.deny, chatId, name)) return 'grup ada di daftar tolak';
  if (!g.allow.length) return 'belum ada grup yang dipilih';
  if (!groupListed(g.allow, chatId, name)) return 'grup tidak ada di daftar izin';
  if (g.requireMention && !m.mentionedMe && !m.quotedMe) return 'tidak me-mention / membalas saya';
  return null;
}

/** Strict safety gate + rule selection. Pure. */
export function decide(i: DecideInput): ArDecision {
  const { inbound: m, now, log } = i;
  const rng = i.rng ?? Math.random;
  if (isForbiddenChat(m.chatKey)) return skip('broadcast/status/channel tidak pernah dibalas');
  const isGroup = m.isGroup || isGroupKey(m.chatKey);
  const chatId = idOf(m.chatKey);
  if (isGroup) {
    if (m.fromMe) return skip('pesan dari akun sendiri');
    if (m.isBot) return skip('pesan bot/sistem');
    if (!m.author) return skip('pengirim grup tidak diketahui');
  }
  if (m.optOut) return skip('kontak opt-out');
  if (!m.text.trim()) return skip('pesan bukan teks');
  if (i.lastOutboundTs != null && i.lastOutboundTs >= m.ts) return skip('sudah dibalas');
  if (now - m.ts > MAX_INBOUND_AGE_MS) return skip('pesan terlalu lama');
  const mctx: MatchCtx = { isNewLead: m.isNewLead, now, isGroup };
  let rule: ArRule | undefined;
  let gateReason = '';
  for (const r of [...i.rules].sort((a, b) => a.order - b.order)) {
    if (!matchRule(r, m.text, mctx)) continue;
    if (isGroup) { const why = groupGate(r, m, chatId); if (why) { gateReason ||= why; continue; } }
    rule = r; break;
  }
  if (!rule) return skip(gateReason || 'tidak ada aturan cocok');
  if (isGroup) {
    if (inAuthorCooldown(rule, m.chatKey, m.author!, log, now)) return skip('masih masa jeda pengirim di grup', rule);
    if (inGroupCooldown(rule, m.chatKey, log, now)) return skip('masih masa jeda grup', rule);
  } else {
    if (rule.onlyNewLeads && !m.isNewLead) return skip('hanya untuk lead baru', rule);
    if (inCooldown(rule, m.chatKey, log, now)) return skip('masih masa jeda (cooldown)', rule);
  }
  const rot = renderWithRotation({ body: rule.reply, variants: rule.replyVariants, rotation: rule.rotation }, i.vars ?? {}, i.rotation?.[rule.id], rng);
  const text = rot.text.trim();
  const rotState = rule.replyVariants?.some((v) => v.trim()) ? rot.state : undefined;
  if (!text) return skip('isi balasan kosong', rule);
  if (rule.mode === 'auto' && i.canAutoSend !== false) {
    if (overRateLimit(rule, log, now, isGroup)) return skip('batas per jam tercapai', rule);
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
  const sc = r.scope as string | undefined;
  if (sc !== undefined && !AR_SCOPES.includes(sc as ArScope)) e.push('Cakupan aturan tidak valid.');
  const scope = scopeOf(r);
  const uses = (v: string) => [r.reply, ...(r.replyVariants ?? [])].some((t) => new RegExp(`\\{${v}\\}`, 'i').test(t));
  if (scope !== 'group' && uses('grup')) e.push('Variabel {grup} hanya untuk aturan khusus Grup.');
  if (scope !== 'personal') {
    const g = groupCfg(r);
    if (r.trigger !== 'keyword') e.push('Aturan untuk Grup/Semua wajib memakai pemicu "Kata kunci" (Semua pesan, Pesan pertama, dan Di luar jam kerja tidak boleh untuk grup).');
    else if (r.keywords.filter((k) => k.trim()).some((k) => norm(k).length < 3)) e.push('Aturan grup: setiap kata kunci minimal 3 karakter agar tidak membalas terlalu sering.');
    if (!g.allow.length) e.push('Pilih minimal satu grup (daftar izin) untuk aturan Grup/Semua.');
    const rg = (r.grp ?? {}) as Partial<ArGroupCfg>;
    if (typeof rg.groupCooldownMin === 'number' && rg.groupCooldownMin < GROUP_COOLDOWN_MIN) e.push(`Cooldown grup minimal ${GROUP_COOLDOWN_MIN} menit.`);
    if (typeof rg.maxPerHour === 'number' && !(rg.maxPerHour >= 1 && rg.maxPerHour <= 60)) e.push('Batas grup per jam harus 1-60.');
  }
  return e;
}
