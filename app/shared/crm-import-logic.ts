/** CRM lead import: entry builders (chat/label/manual/CSV) and the create/update/skip plan. Pure, no I/O. */
import { parseCsv, toCsv } from './analytics-logic';
import { ContactIndex, parseTags, remapStage, resolveTarget } from './crm-logic';
import type { BulkMode, Contact, ContactSource } from './crm-types';
import type { ChatContact, LabelChat } from './messages';
import { normalizePhone, parseManualInput } from './recipients-logic';

export interface ImportEntry {
  name: string;
  phone: string;            // canonical digits, '' when unknown
  chatId?: string;
  accountId?: string;
  source: ContactSource;
  sourceDetail?: string;
  stage?: string;
  tags?: string[];
  value?: number;
  assignee?: string;
  note?: string;
  optOut?: boolean;
  /** set = invalid (not importable) */
  reason?: string;
  original?: string;
  /** importable keyed by chatId but the phone is unknown */
  unknownPhone?: boolean;
}

export function entriesFromChats(chats: ChatContact[], o: { includeGroups?: boolean } = {}): ImportEntry[] {
  return chats.filter((c) => o.includeGroups || !c.isGroup).map((c): ImportEntry => ({
    name: c.name, phone: c.phone ?? '', chatId: c.chatId, source: c.isGroup ? 'grup' : 'chat', unknownPhone: !c.isGroup && !c.phone,
    original: c.name || c.chatId,
  }));
}

export function entriesFromLabelChats(chats: LabelChat[], labelName: string): ImportEntry[] {
  return chats.filter((c) => !c.isGroup).map((c): ImportEntry => ({
    name: c.name, phone: c.phone ?? '', chatId: c.chatId, source: 'label', sourceDetail: labelName, unknownPhone: !c.phone, original: c.name || c.chatId,
  }));
}

export function entriesFromGroupMembers(members: { id: string; phone: string | null; name: string }[], groupName: string): ImportEntry[] {
  return members.map((m): ImportEntry => ({
    name: m.name, phone: m.phone ?? '', chatId: m.phone ? undefined : m.id, source: 'grup', sourceDetail: groupName, unknownPhone: !m.phone, original: m.name || m.id,
  }));
}

export function entriesFromManual(text: string, autoFormat = true): ImportEntry[] {
  return parseManualInput(text, { autoFormat }).map((e): ImportEntry => e.reason
    ? { name: e.name ?? '', phone: '', source: 'manual', original: e.original ?? e.phone, reason: e.reason }
    : { name: e.name ?? '', phone: e.phone, source: 'manual', original: e.original ?? e.phone });
}

// ---------- CSV ----------
export const CRM_CSV_COLUMNS = ['name', 'phone', 'stage', 'tags', 'value', 'assignee', 'note'];
const ALIASES: Record<string, string> = {
  name: 'name', nama: 'name',
  phone: 'phone', telepon: 'phone', telp: 'phone', nomor: 'phone', no: 'phone', hp: 'phone', wa: 'phone', whatsapp: 'phone', no_hp: 'phone', nohp: 'phone',
  stage: 'stage', tahap: 'stage', tag: 'tags', tags: 'tags',
  value: 'value', nilai: 'value', assignee: 'assignee', penanggung_jawab: 'assignee', pic: 'assignee',
  note: 'note', catatan: 'note',
};
const colKey = (s: string) => ALIASES[s.trim().toLowerCase().replace(/[\s.-]+/g, '_')] ?? '';

export function crmTemplateCsv(): string {
  return toCsv([
    { name: 'Budi', phone: '081234567890', stage: 'Lead baru', tags: 'vip;bandung', value: 1500000, assignee: 'Sinta', note: 'Tanya paket A' },
    { name: 'Siti', phone: '+62 812-3456-7891', stage: 'Dihubungi', tags: 'reseller', value: 0, assignee: '', note: '' },
  ], CRM_CSV_COLUMNS);
}

export interface CsvParse { entries: ImportEntry[]; warnings: string[]; headerFound: boolean }
export function parseCrmCsv(text: string, stages: string[], fileName?: string): CsvParse {
  let src = String(text ?? '');
  if (!src.includes(',') && /[;\t]/.test(src)) src = src.replace(/[;\t]/g, ',');
  const rows = parseCsv(src);
  const warnings: string[] = [];
  if (!rows.length) return { entries: [], warnings, headerFound: false };
  let map: string[] = CRM_CSV_COLUMNS;
  let start = 0;
  const hdr = rows[0].map(colKey);
  const headerFound = hdr.includes('phone') || (hdr.filter(Boolean).length >= 2 && !rows[0].some((c) => normalizePhone(c).ok));
  if (headerFound) { map = hdr; start = 1; }
  const entries: ImportEntry[] = [];
  const badStages = new Set<string>();
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    const g = (k: string) => { const j = map.indexOf(k); return j >= 0 ? (r[j] ?? '').trim().replace(/^'(?=[=+\-@])/, '') : ''; };
    let rawPhone = g('phone'), name = g('name');
    if (!headerFound && !normalizePhone(rawPhone).ok && normalizePhone(name).ok) { [rawPhone, name] = [name, rawPhone]; }
    const base = { source: 'csv' as const, sourceDetail: fileName, original: rawPhone || name };
    const p = normalizePhone(rawPhone);
    if (!p.ok) { entries.push({ ...base, name, phone: '', reason: rawPhone ? p.reason ?? 'nomor tidak valid' : 'nomor kosong' }); continue; }
    const e: ImportEntry = { ...base, name, phone: p.phone as string };
    const st = g('stage');
    if (st) { const hit = stages.find((s) => s.toLowerCase() === st.toLowerCase()); if (hit) e.stage = hit; else badStages.add(st); }
    const tags = parseTags(g('tags')); if (tags.length) e.tags = tags;
    const v = g('value');
    if (v) { const n = Number(v.replace(/[^\d]/g, '')); if (Number.isFinite(n) && n > 0) e.value = n; }
    const a = g('assignee'); if (a) e.assignee = a;
    const n = g('note'); if (n) e.note = n.slice(0, 1000);
    entries.push(e);
  }
  if (badStages.size) warnings.push(`Tahap tidak dikenal diabaikan (memakai tahap pilihan): ${[...badStages].slice(0, 5).join(', ')}`);
  return { entries, warnings, headerFound };
}

// ---------- plan ----------
export interface ImportOpts {
  accountId: string;
  stage: string;
  stages: string[];
  tags: string[];
  assignee: string;
  value?: number;
  note: string;
  mode: BulkMode;
  skipOptOut: boolean;
}
export type PlanAction = 'create' | 'update' | 'skip';
type ContactDraft = Partial<Contact> & Pick<Contact, 'accountId' | 'chatId'>;
export interface PlanRow {
  entry: ImportEntry;
  action: PlanAction;
  reason?: string;
  key: string;
  contact?: ContactDraft;
  prev?: Contact;
}
export interface ImportPlan { rows: PlanRow[]; counts: Record<PlanAction, number> }

export function planImport(entries: ImportEntry[], existing: Contact[] | ContactIndex, o: ImportOpts): ImportPlan {
  const idx = existing instanceof ContactIndex ? existing : new ContactIndex(existing);
  const rows: PlanRow[] = [];
  const counts: Record<PlanAction, number> = { create: 0, update: 0, skip: 0 };
  const seenKeys = new Set<string>();
  const seenPhones = new Set<string>();
  const push = (r: PlanRow) => { rows.push(r); counts[r.action]++; };
  const skip = (entry: ImportEntry, reason: string, key = ''): void => push({ entry, action: 'skip', reason, key });

  for (const e of entries) {
    if (e.reason) { skip(e, `tidak valid: ${e.reason}`); continue; }
    const chatId = e.chatId || (e.phone ? `${e.phone}@c.us` : '');
    if (!chatId) { skip(e, 'tanpa nomor/chat'); continue; }
    const acc = e.accountId || o.accountId;
    const t = resolveTarget(idx, acc, chatId, e.phone);
    if (seenKeys.has(t.key) || (e.phone && seenPhones.has(e.phone))) { skip(e, 'duplikat dalam daftar', t.key); continue; }
    seenKeys.add(t.key); if (e.phone) seenPhones.add(e.phone);
    if (o.skipOptOut && (e.optOut || t.prev?.optOut || idx.phone(e.phone).some((c) => c.optOut))) { skip(e, 'opt-out', t.key); continue; }
    const stage = remapStage(e.stage ?? o.stage, o.stages);
    const tags = parseTags([...(t.prev?.tags ?? []), ...(e.tags ?? []), ...o.tags]);
    const assignee = e.assignee || o.assignee;
    const value = e.value ?? o.value;
    const note = e.note || o.note;
    if (t.prev) {
      if (o.mode === 'skip') { skip(e, 'sudah ada di CRM', t.key); continue; }
      const contact: ContactDraft = { accountId: t.prev.accountId, chatId: t.prev.chatId, stage, tags };
      if (e.name) contact.name = e.name;
      if (e.phone && !t.prev.phone) contact.phone = e.phone;
      if (assignee) contact.assignee = assignee;
      if (value !== undefined) contact.value = value;
      if (note) contact.note = note;
      if (!t.prev.source) { contact.source = e.source; if (e.sourceDetail) contact.sourceDetail = e.sourceDetail; }
      push({ entry: e, action: 'update', key: t.prev.key, contact, prev: t.prev });
      continue;
    }
    const contact: ContactDraft = { accountId: acc, chatId, name: e.name, phone: e.phone, stage, tags, assignee, value: value ?? 0, source: e.source };
    if (e.sourceDetail) contact.sourceDetail = e.sourceDetail;
    if (note) contact.note = note;
    push({ entry: e, action: 'create', key: t.key, contact });
  }
  return { rows, counts };
}

/** Skip reasons with counts (invalid reasons collapsed into "tidak valid"). */
export function skipReasons(plan: ImportPlan): [string, number][] {
  const m = new Map<string, number>();
  for (const r of plan.rows) {
    if (r.action !== 'skip' || !r.reason) continue;
    const k = r.reason.startsWith('tidak valid') ? 'tidak valid' : r.reason;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()];
}

export function chunk<T>(a: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}
