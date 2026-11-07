import type { GroupMember } from './messages';
import { toCsv } from './analytics-logic';
import { phoneFromChatId } from './crm-logic';

/** Digits-only phone, 7..15 digits. Local Indonesian "08xx" becomes "628xx". '' when invalid. */
export function normalizePhone(raw: unknown): string {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (/^0[1-9]/.test(d)) d = '62' + d.slice(1);
  return d.length >= 7 && d.length <= 15 ? d : '';
}

/** Phone of a member: adapter-resolved phone first, else only a real `@c.us` wid (a LID is NOT a phone). */
export function memberPhone(m: Pick<GroupMember, 'id' | 'phone'>): string {
  const p = normalizePhone(m.phone);
  if (p) return p;
  return /@(c\.us|s\.whatsapp\.net)$/.test(m.id) ? normalizePhone(phoneFromChatId(m.id)) : '';
}

export interface GroupRef { id: string; name: string }
export interface MergedMember {
  key: string;          // phone, or wid when the phone is unknown
  phone: string;        // '' when unknown (LID without number)
  name: string;
  groups: string[];     // group names (unique, in order)
  isAdmin: boolean;     // admin in at least one group
}

/** Merges members across groups (dedupe by phone, fallback wid). Own number is dropped when excludeMe. */
export function mergeMembers(entries: { group: GroupRef; members: GroupMember[] }[], opts: { excludeMe?: boolean } = {}): MergedMember[] {
  const map = new Map<string, MergedMember>();
  for (const { group, members } of entries) {
    for (const m of members) {
      if (opts.excludeMe && m.isMe) continue;
      const phone = memberPhone(m);
      const key = phone || m.id;
      if (!key) continue;
      let r = map.get(key);
      if (!r) { r = { key, phone, name: '', groups: [], isAdmin: false }; map.set(key, r); }
      if (!r.name && m.name) r.name = m.name;
      if (!r.groups.includes(group.name)) r.groups.push(group.name);
      if (m.isAdmin || m.isSuperAdmin) r.isAdmin = true;
    }
  }
  return [...map.values()];
}

export interface MemberFilter { nonAdminOnly?: boolean; notInCrmOnly?: boolean; query?: string; withPhoneOnly?: boolean }

export function filterMembers(list: MergedMember[], f: MemberFilter, crmPhones: Set<string>): MergedMember[] {
  const q = (f.query ?? '').trim().toLowerCase();
  return list.filter((m) =>
    (!f.nonAdminOnly || !m.isAdmin) &&
    (!f.notInCrmOnly || !m.phone || !crmPhones.has(m.phone)) &&
    (!f.withPhoneOnly || !!m.phone) &&
    (!q || m.phone.includes(q) || m.name.toLowerCase().includes(q) || m.groups.some((g) => g.toLowerCase().includes(q))));
}

export const MEMBER_COLUMNS = ['nomor', 'nama', 'grup', 'admin'];

export function memberRows(list: MergedMember[]): Record<string, unknown>[] {
  return list.map((m) => ({ nomor: m.phone, nama: m.name, grup: m.groups.join('; '), admin: m.isAdmin ? 'ya' : 'tidak' }));
}

/** CSV (CRLF, formula-injection guarded) with a leading BOM so Excel reads UTF-8. */
export function membersCsv(list: MergedMember[]): string {
  return '\uFEFF' + toCsv(memberRows(list), MEMBER_COLUMNS);
}

export function membersJson(list: MergedMember[]): string {
  return JSON.stringify(list.map((m) => ({ phone: m.phone, name: m.name, groups: m.groups, isAdmin: m.isAdmin })), null, 2);
}

/** vCard text escape (RFC 6350): backslash, comma, semicolon, newline. */
export function vcardEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\r?\n|\r/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

/** vCard 3.0 file (UTF-8, CRLF). Contacts without phone are skipped. */
export function buildVcard(list: MergedMember[]): string {
  const out: string[] = [];
  for (const m of list) {
    if (!m.phone) continue;
    const fn = vcardEscape(m.name || `+${m.phone}`);
    out.push('BEGIN:VCARD', 'VERSION:3.0', `FN:${fn}`, `N:${fn};;;;`, `TEL;TYPE=CELL:+${m.phone}`);
    if (m.groups.length) out.push(`NOTE:${vcardEscape('Grup: ' + m.groups.join(', '))}`);
    out.push('END:VCARD');
  }
  return out.join('\r\n') + (out.length ? '\r\n' : '');
}

/** Phones present in the CRM, normalized. */
export function crmPhoneSet(contacts: { phone: string }[]): Set<string> {
  return new Set(contacts.map((c) => normalizePhone(c.phone)).filter(Boolean));
}
