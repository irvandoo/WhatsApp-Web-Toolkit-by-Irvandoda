import { describe, expect, it } from 'vitest';
import { buildVcard, crmPhoneSet, filterMembers, membersCsv, memberPhone, mergeMembers, normalizePhone, vcardEscape } from './groups-logic';
import type { GroupMember } from './messages';

const mk = (o: Partial<GroupMember>): GroupMember => ({ id: '', phone: null, name: '', isAdmin: false, isSuperAdmin: false, isMe: false, ...o });

describe('groups-logic', () => {
  it('normalizes phones', () => {
    expect(normalizePhone('+62 812-3456-7890')).toBe('6281234567890');
    expect(normalizePhone('0812345678')).toBe('62812345678');
    expect(normalizePhone('12')).toBe('');
    expect(normalizePhone(null)).toBe('');
  });
  it('does not treat LID as phone', () => {
    expect(memberPhone(mk({ id: '123456789012345@lid' }))).toBe('');
    expect(memberPhone(mk({ id: '6281234567@c.us' }))).toBe('6281234567');
    expect(memberPhone(mk({ id: '999999999999999@lid', phone: '6281234567' }))).toBe('6281234567');
  });
  it('merges across groups and excludes me', () => {
    const a = { id: 'a@g.us', name: 'A' }, b = { id: 'b@g.us', name: 'B' };
    const r = mergeMembers([
      { group: a, members: [mk({ id: '6281111111@c.us', name: 'Budi' }), mk({ id: '6282222222@c.us', isMe: true }), mk({ id: '55555555555555@lid', name: 'L' })] },
      { group: b, members: [mk({ id: 'x@lid', phone: '6281111111', isAdmin: true }), mk({ id: '55555555555555@lid' })] },
    ], { excludeMe: true });
    expect(r).toHaveLength(2);
    const budi = r.find((m) => m.phone === '6281111111')!;
    expect(budi.groups).toEqual(['A', 'B']);
    expect(budi.isAdmin).toBe(true);
    expect(budi.name).toBe('Budi');
    expect(r.find((m) => !m.phone)!.groups).toEqual(['A', 'B']);
  });
  it('filters', () => {
    const list = [
      { key: '1', phone: '6281', name: 'Ani', groups: ['G'], isAdmin: true },
      { key: '2', phone: '6282', name: 'Budi', groups: ['G'], isAdmin: false },
    ];
    expect(filterMembers(list, { nonAdminOnly: true }, new Set())).toHaveLength(1);
    expect(filterMembers(list, { notInCrmOnly: true }, new Set(['6282']))).toHaveLength(1);
    expect(filterMembers(list, { query: 'bud' }, new Set())[0].key).toBe('2');
    expect(crmPhoneSet([{ phone: '0812345678' }, { phone: '' }]).has('62812345678')).toBe(true);
  });
  it('builds csv with injection guard', () => {
    const csv = membersCsv([{ key: '1', phone: '6281', name: '=HYPERLINK("x")', groups: ['A', 'B'], isAdmin: false }]);
    expect(csv.startsWith('﻿nomor,nama,grup,admin')).toBe(true);
    expect(csv).toContain('"\'=HYPERLINK(""x"")"');
    expect(csv).toContain('A; B');
  });
  it('builds vcard with escapes, skipping no-phone', () => {
    expect(vcardEscape('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const v = buildVcard([
      { key: '1', phone: '6281', name: 'Budi; S', groups: ['A'], isAdmin: false },
      { key: '2', phone: '', name: 'X', groups: [], isAdmin: false },
    ]);
    expect(v).toContain('FN:Budi\\; S\r\n');
    expect(v).toContain('TEL;TYPE=CELL:+6281');
    expect(v.match(/BEGIN:VCARD/g)).toHaveLength(1);
    expect(buildVcard([])).toBe('');
  });
});
