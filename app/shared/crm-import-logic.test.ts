import { describe, expect, it } from 'vitest';
import { applyBulkEdit, ContactIndex, filterContacts, funnelCounts, parseTags, rangeKeys, resolveTarget } from './crm-logic';
import { entriesFromChats, entriesFromManual, parseCrmCsv, planImport, crmTemplateCsv, skipReasons, type ImportOpts } from './crm-import-logic';
import type { Contact } from './crm-types';

const STAGES = ['Lead baru', 'Dihubungi', 'Deal'];
const mk = (o: Partial<Contact> & { accountId: string; chatId: string }): Contact => ({
  key: `${o.accountId}|${o.chatId}`, name: '', phone: '', stage: 'Lead baru', tags: [], value: 0, assignee: '', optOut: false,
  createdAt: 1, updatedAt: 1, lastContactAt: null, ...o,
});
const OPTS: ImportOpts = { accountId: 'A', stage: 'Dihubungi', stages: STAGES, tags: ['promo'], assignee: 'Sinta', note: '', mode: 'skip', skipOptOut: true };

describe('planImport', () => {
  it('creates, dedupes by phone and key, skips invalid', () => {
    const entries = entriesFromManual('Budi, 0812 3456 7890\nSiti 081234567890\nAni - +62 813-1111-2222\nxx, 123');
    const p = planImport(entries, [], OPTS);
    expect(p.counts).toEqual({ create: 2, update: 0, skip: 2 });
    expect(p.rows[0].contact).toMatchObject({ accountId: 'A', chatId: '6281234567890@c.us', stage: 'Dihubungi', tags: ['promo'], assignee: 'Sinta', source: 'manual' });
    expect(skipReasons(p).map((x) => x[0]).sort()).toEqual(['duplikat dalam daftar', 'tidak valid']);
  });
  it('skip vs update existing, by key and by phone', () => {
    const ex = [mk({ accountId: 'A', chatId: '6281@c.us', phone: '6281', tags: ['vip'], name: 'Lama' })];
    const entries = [{ name: 'Baru', phone: '6281', chatId: '6281@c.us', source: 'chat' as const }, { name: 'Z', phone: '6282', source: 'csv' as const }];
    const s = planImport(entries, ex, OPTS);
    expect(s.counts).toEqual({ create: 1, update: 0, skip: 1 });
    const u = planImport(entries, ex, { ...OPTS, mode: 'update' });
    expect(u.counts).toEqual({ create: 1, update: 1, skip: 0 });
    expect(u.rows[0].contact).toMatchObject({ name: 'Baru', tags: ['vip', 'promo'], accountId: 'A' });
  });
  it('skips opt-out (also via same phone in other chat)', () => {
    const ex = [mk({ accountId: 'A', chatId: '6281@c.us', phone: '6281', optOut: true })];
    const p = planImport([{ name: '', phone: '6281', chatId: '777@lid', source: 'chat' }], ex, OPTS);
    expect(p.rows[0]).toMatchObject({ action: 'skip', reason: 'opt-out' });
    expect(planImport([{ name: '', phone: '6281', chatId: '777@lid', source: 'chat' }], ex, { ...OPTS, skipOptOut: false }).counts.create).toBe(1);
  });
  it('chats without phone are keyed by chatId; groups excluded by default', () => {
    const chats = [
      { chatId: '99@lid', name: 'X', phone: null, isGroup: false, unread: 0, lastTs: 0 },
      { chatId: '1@g.us', name: 'G', phone: null, isGroup: true, unread: 0, lastTs: 0 },
    ];
    const e = entriesFromChats(chats);
    expect(e).toHaveLength(1);
    expect(e[0].unknownPhone).toBe(true);
    expect(planImport(e, [], OPTS).rows[0].contact).toMatchObject({ chatId: '99@lid', phone: '' });
    expect(entriesFromChats(chats, { includeGroups: true })).toHaveLength(2);
  });
});

describe('merge by phone', () => {
  it('real chat adopts manual record', () => {
    const man = mk({ accountId: 'manual', chatId: '6281@c.us', phone: '6281' });
    const t = resolveTarget(new ContactIndex([man]), 'A', '6281@c.us', '6281');
    expect(t.adopt).toBe(man);
    expect(t.key).toBe('A|6281@c.us');
  });
  it('manual entry merges into existing real record', () => {
    const real = mk({ accountId: 'A', chatId: '6281@c.us', phone: '6281' });
    const t = resolveTarget(new ContactIndex([real]), 'manual', '6281@c.us', '6281');
    expect(t.key).toBe(real.key);
    expect(t.adopt).toBeUndefined();
    expect(planImport([{ name: 'n', phone: '6281', source: 'manual' }], [real], { ...OPTS, accountId: 'manual' }).rows[0].reason).toBe('sudah ada di CRM');
  });
});

describe('csv', () => {
  it('parses template with header, validates', () => {
    const r = parseCrmCsv(crmTemplateCsv(), STAGES, 'f.csv');
    expect(r.headerFound).toBe(true);
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0]).toMatchObject({ name: 'Budi', phone: '6281234567890', stage: 'Lead baru', tags: ['vip', 'bandung'], value: 1500000, assignee: 'Sinta' });
    expect(r.entries[1].phone).toBe('6281234567891');
  });
  it('flags invalid rows, unknown stage, headerless swap', () => {
    const r = parseCrmCsv('nama,telepon,tahap\nA,abc,Deal\nB,0812999,Xyz\nC,081211112222,Xyz', STAGES);
    expect(r.entries[0].reason).toBeTruthy();
    expect(r.entries[2].stage).toBeUndefined();
    expect(r.warnings.length).toBe(1);
    const h = parseCrmCsv('081211112222,Budi', STAGES);
    expect(h.entries[0]).toMatchObject({ name: 'Budi', phone: '6281211112222' });
  });
  it('injection-safe template', () => {
    expect(crmTemplateCsv()).not.toMatch(/(^|,)=/);
  });
});

describe('funnel / bulk / filter', () => {
  const list = [
    mk({ accountId: 'A', chatId: '1', stage: 'Lead baru', value: 100, tags: ['a'] }),
    mk({ accountId: 'A', chatId: '2', stage: 'Deal', value: 50, assignee: 'X' }),
    mk({ accountId: 'A', chatId: '3', stage: 'Hilang', value: 10, optOut: true, source: 'csv' }),
  ];
  it('funnelCounts maps unknown stage to first', () => {
    const f = funnelCounts(list, STAGES);
    expect(f.map((r) => r.count)).toEqual([2, 0, 1]);
    expect(f[0].value).toBe(110);
    expect(f[0].pct).toBe(1);
  });
  it('bulk ops', () => {
    expect(applyBulkEdit(list[0], { type: 'stage', stage: 'Deal' })).toEqual({ stage: 'Deal' });
    expect(applyBulkEdit(list[0], { type: 'stage', stage: 'Lead baru' })).toBeNull();
    expect(applyBulkEdit(list[0], { type: 'tag-add', tag: 'B' })).toEqual({ tags: ['a', 'B'] });
    expect(applyBulkEdit(list[0], { type: 'tag-add', tag: 'A' })).toBeNull();
    expect(applyBulkEdit(list[0], { type: 'tag-remove', tag: 'a' })).toEqual({ tags: [] });
    expect(applyBulkEdit(list[1], { type: 'assignee', assignee: ' Y ' })).toEqual({ assignee: 'Y' });
    expect(applyBulkEdit(list[2], { type: 'optout', value: false })).toEqual({ optOut: false });
  });
  it('filter and range', () => {
    expect(filterContacts(list, { stage: 'Lead baru' }, STAGES)).toHaveLength(2);
    expect(filterContacts(list, { optOut: 'yes' }, STAGES)).toHaveLength(1);
    expect(filterContacts(list, { source: 'bar' }, STAGES)).toHaveLength(2);
    expect(filterContacts(list, { assignee: '__none' }, STAGES)).toHaveLength(2);
    expect(rangeKeys(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(parseTags('x, X ;y|')).toEqual(['x', 'y']);
  });
});
