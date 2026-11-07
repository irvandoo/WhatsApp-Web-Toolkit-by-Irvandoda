import { DEFAULT_STAGES, MANUAL_ACCOUNT, type Contact } from './crm-types';

/** Digits of the phone number for user chats; '' for groups/broadcast/unknown. */
/**
 * Real phone number of a chat id. `@lid` ids are WhatsApp's internal identifiers, NOT phone numbers, so they yield ''
 * (using their digits as a number makes sends/deep links go to a stranger or fail with "isn't on WhatsApp").
 */
export function phoneFromChatId(chatId: string): string {
  const m = /^(\d+)(?::\d+)?@(c\.us|s\.whatsapp\.net)$/.exec(String(chatId).trim());
  return m ? m[1] : '';
}

export const isLidChat = (chatId: string): boolean => /@lid$/.test(String(chatId).trim());

/** Drop a stored 'phone' that is really the digits of a LID chat id (written by older versions). */
export function cleanPhone(chatId: string, phone: string | undefined): string {
  const p = String(phone ?? '').replace(/\D/g, '');
  if (!p) return '';
  if (isLidChat(chatId) && chatId.split('@')[0].split(':')[0] === p) return '';
  return p;
}

/** CSV cell with quoting and formula-injection guard. */
export function escapeCsvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Trim + validate stages: 2..12 unique, non-empty. Returns null on invalid. */
export function normalizeStages(stages: unknown): string[] | null {
  if (!Array.isArray(stages)) return null;
  const out = stages.map((s) => (typeof s === 'string' ? s.trim() : ''));
  if (out.length < 2 || out.length > 12) return null;
  if (out.some((s) => !s)) return null;
  if (new Set(out).size !== out.length) return null;
  return out;
}

export function remapStage(stage: string, stages: string[]): string {
  return stages.includes(stage) ? stage : (stages[0] ?? DEFAULT_STAGES[0]);
}

export function csvFromRows(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(escapeCsvCell).join(',')).join('\r\n');
}

// ---------- contact index / merge-by-phone ----------

export class ContactIndex {
  private byKey = new Map<string, Contact>();
  private byPhone = new Map<string, Contact[]>();
  constructor(list: Contact[] = []) { for (const c of list) this.add(c); }
  add(c: Contact): void {
    this.byKey.set(c.key, c);
    if (c.phone) { const a = this.byPhone.get(c.phone); if (a) a.push(c); else this.byPhone.set(c.phone, [c]); }
  }
  remove(key: string): void {
    const c = this.byKey.get(key);
    if (!c) return;
    this.byKey.delete(key);
    const a = this.byPhone.get(c.phone);
    if (a) { const i = a.indexOf(c); if (i >= 0) a.splice(i, 1); }
  }
  get(key: string): Contact | undefined { return this.byKey.get(key); }
  phone(p: string): Contact[] { return p ? this.byPhone.get(p) ?? [] : []; }
}

export interface Target { key: string; accountId: string; chatId: string; prev?: Contact; /** old 'manual' record to remove (its data moves to `key`) */ adopt?: Contact }

/**
 * Where an upsert for (accountId, chatId, phone) must land.
 *  - exact key wins;
 *  - real account + a 'manual' record with the same phone: adopt it (re-keyed to the real chat);
 *  - 'manual' account + a real record with the same phone: merge into the real record.
 */
export function resolveTarget(idx: ContactIndex, accountId: string, chatId: string, phone: string): Target {
  const key = `${accountId}|${chatId}`;
  const direct = idx.get(key);
  if (direct) return { key, accountId, chatId, prev: direct };
  if (phone) {
    if (accountId !== MANUAL_ACCOUNT) {
      const m = idx.phone(phone).find((c) => c.accountId === MANUAL_ACCOUNT);
      if (m) return { key, accountId, chatId, prev: m, adopt: m };
    } else {
      const r = idx.phone(phone).find((c) => c.accountId !== MANUAL_ACCOUNT);
      if (r) return { key: r.key, accountId: r.accountId, chatId: r.chatId, prev: r };
    }
  }
  return { key, accountId, chatId };
}

/** Distinct, trimmed tags (case-insensitive dedupe, first spelling wins), max 20 x 30 chars. */
export function parseTags(input: string | string[]): string[] {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(/[,;|\n]/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const v = String(t).trim().slice(0, 30);
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase()); out.push(v);
    if (out.length >= 20) break;
  }
  return out;
}

// ---------- funnel / filter / bulk edit ----------
export interface FunnelRow { stage: string; count: number; value: number; pct: number }
export function funnelCounts(contacts: Contact[], stages: string[]): FunnelRow[] {
  const rows = stages.map((stage) => ({ stage, count: 0, value: 0, pct: 0 }));
  const at = new Map(rows.map((r) => [r.stage, r]));
  for (const c of contacts) {
    const r = at.get(c.stage) ?? rows[0];
    if (!r) continue;
    r.count++; r.value += c.value || 0;
  }
  const max = Math.max(1, ...rows.map((r) => r.count));
  for (const r of rows) r.pct = r.count / max;
  return rows;
}

export interface ContactFilter { q?: string; stage?: string; tag?: string; assignee?: string; optOut?: 'all' | 'yes' | 'no'; source?: string; accountId?: string }
export function filterContacts(list: Contact[], f: ContactFilter, stages: string[]): Contact[] {
  const s = (f.q ?? '').trim().toLowerCase();
  return list.filter((c) =>
    (!f.accountId || c.accountId === f.accountId) &&
    (!f.stage || remapStage(c.stage, stages) === f.stage) &&
    (!f.tag || c.tags.includes(f.tag)) &&
    (!f.assignee || (f.assignee === '__none' ? !c.assignee : c.assignee === f.assignee)) &&
    (!f.optOut || f.optOut === 'all' || (f.optOut === 'yes') === !!c.optOut) &&
    (!f.source || (c.source ?? 'bar') === f.source) &&
    (!s || c.name.toLowerCase().includes(s) || c.phone.includes(s) || c.chatId.toLowerCase().includes(s) || (c.note ?? '').toLowerCase().includes(s) || c.tags.some((t) => t.toLowerCase().includes(s))));
}

export type BulkOp =
  | { type: 'stage'; stage: string }
  | { type: 'tag-add'; tag: string }
  | { type: 'tag-remove'; tag: string }
  | { type: 'assignee'; assignee: string }
  | { type: 'optout'; value: boolean };

/** Patch for one contact; null when nothing would change. */
export function applyBulkEdit(c: Contact, op: BulkOp): Partial<Contact> | null {
  switch (op.type) {
    case 'stage': return c.stage === op.stage ? null : { stage: op.stage };
    case 'tag-add': {
      const t = parseTags(op.tag);
      const next = parseTags([...c.tags, ...t]);
      return next.length === c.tags.length ? null : { tags: next };
    }
    case 'tag-remove': {
      const t = op.tag.trim().toLowerCase();
      const next = c.tags.filter((x) => x.toLowerCase() !== t);
      return next.length === c.tags.length ? null : { tags: next };
    }
    case 'assignee': { const a = op.assignee.trim(); return c.assignee === a ? null : { assignee: a }; }
    case 'optout': return !!c.optOut === op.value ? null : { optOut: op.value };
  }
}

/** Keys between two anchors (inclusive) in display order, for shift-click selection. */
export function rangeKeys(order: string[], a: string, b: string): string[] {
  const i = order.indexOf(a), j = order.indexOf(b);
  if (i < 0 || j < 0) return j >= 0 ? [b] : [];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}
