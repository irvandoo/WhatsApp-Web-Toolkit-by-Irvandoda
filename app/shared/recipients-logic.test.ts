import { describe, expect, it } from 'vitest';
import { entriesFromRecipients, mergeRecipients, normalizePhone, parseManualInput, recipientsToCsv, toCampaignRecipients } from './recipients-logic';

const ph = (s: string, cc?: string) => { const r = normalizePhone(s, cc); return r.ok ? r.phone : `ERR:${r.reason}`; };

describe('normalizePhone', () => {
  it('formats common Indonesian variants to the same digits', () => {
    for (const s of ['+62 857-4747-6308', '0857-4747-6308', '62 857 4747 6308', '6285747476308', '0062 857.4747.6308', '(0857) 4747 6308', '857-4747-6308', '620857 4747 6308', '+62 (0)857 4747 6308'])
      expect(ph(s)).toBe('6285747476308');
  });
  it('handles JIDs and tel URIs', () => {
    expect(ph('6285747476308@c.us')).toBe('6285747476308');
    expect(ph('6285747476308@s.whatsapp.net')).toBe('6285747476308');
    expect(ph('6285747476308:12@s.whatsapp.net')).toBe('6285747476308');
    expect(ph('tel:+62-857-4747-6308')).toBe('6285747476308');
    expect(ph('tel:0857-4747-6308;ext=1')).toBe('6285747476308');
    expect(ph('120363@g.us')).toMatch(/^ERR:ID grup/);
    expect(ph('123@lid')).toMatch(/^ERR/);
  });
  it('flags scientific notation', () => {
    const r = normalizePhone('6.28574E+11');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('format ilmiah, perbaiki di Excel');
  });
  it('normalizes unicode digits and strips zero-width chars', () => {
    expect(ph('＋６２８５７４７４７６３０８')).toBe('6285747476308');
    expect(ph('٠٨٥٧٤٧٤٧٦٣٠٨')).toBe('6285747476308');
    expect(ph('۰۸۵۷۴۷۴۷۶۳۰۸')).toBe('6285747476308');
    expect(ph('\u200B+62\u200F 857\uFEFF4747 6308')).toBe('6285747476308');
  });
  it('validates Indonesian mobile', () => {
    expect(ph('02112345678')).toMatch(/^ERR:bukan nomor seluler/);
    expect(ph('0857')).toMatch(/^ERR/);
    expect(ph('08574747630812345678')).toMatch(/^ERR/);
    expect(ph('')).toBe('ERR:kosong');
    expect(ph('abc')).toMatch(/^ERR:mengandung huruf/);
  });
  it('accepts other countries only when explicit', () => {
    expect(ph('+1 415 555 0123')).toBe('14155550123');
    expect(ph('001 415 555 0123')).toBe('14155550123');
    expect(ph('+44 7911 123456')).toBe('447911123456');
    expect(ph('14155550123')).toMatch(/^ERR/);
    expect(ph('+1234')).toMatch(/^ERR/);
    expect(ph('+1 415 555 0123 4567 89')).toMatch(/^ERR/);
  });
  it('supports another default country code', () => {
    expect(ph('0412 345 678', '61')).toBe('61412345678');
  });
});

describe('parseManualInput', () => {
  it('splits by newline, comma, semicolon, tab', () => {
    const e = parseManualInput('0812-3456-7890\n0813 1111 2222, 0814 3333 4444;0815 5555 6666\t0816 7777 8888');
    expect(e.map((x) => x.phone)).toEqual(['6281234567890', '6281311112222', '6281433334444', '6281555556666', '6281677778888']);
    expect(e.every((x) => x.source === 'manual')).toBe(true);
  });
  it('supports name/number pair forms', () => {
    const e = parseManualInput('Budi, 081234567890\n081234567891, Ani\nCitra - 081234567892\n081234567893 - Dewi\nEko Prasetyo 081234567894\nBudi, 0813\n');
    expect(e.slice(0, 5).map((x) => [x.phone, x.name])).toEqual([
      ['6281234567890', 'Budi'], ['6281234567891', 'Ani'], ['6281234567892', 'Citra'], ['6281234567893', 'Dewi'], ['6281234567894', 'Eko Prasetyo'],
    ]);
    expect(e[5].reason).toBeTruthy();
  });
  it('skips a header line, keeps invalid with reason, handles auto-format off', () => {
    const e = parseManualInput('Nama, Nomor\nBudi, 6.28574E+11');
    expect(e).toHaveLength(1);
    expect(e[0].reason).toBe('format ilmiah, perbaiki di Excel');
    expect(parseManualInput('0812-3456-7890', { autoFormat: false })[0].reason).toBeTruthy();
    expect(parseManualInput('6281234567890', { autoFormat: false })[0].phone).toBe('6281234567890');
  });
});

describe('mergeRecipients', () => {
  const m = (text: string) => ({ source: 'manual' as const, entries: parseManualInput(text) });
  it('dedupes across notations, keeps first, merges name', () => {
    const r = mergeRecipients([
      m('081234567890\n+62 812-3456-7890\n6281234567891'),
      { source: 'crm', entries: [{ phone: '6281234567890', name: 'Budi', formatted: true, contactKey: 'k1' }] },
      { source: 'label', entries: [{ phone: '', original: 'X', reason: 'nomor tidak diketahui' }] },
    ]);
    expect(r.unique.map((x) => x.phone)).toEqual(['6281234567890', '6281234567891']);
    expect(r.unique[0].name).toBe('Budi');
    expect(r.unique[0].contactKey).toBe('k1');
    expect(r.unique[0].source).toBe('manual');
    expect(r.unique[0].sources).toEqual(['manual', 'crm']);
    expect(r.duplicates).toEqual([{ phone: '6281234567890', kept: 'manual', removed: ['manual', 'crm'], count: 2 }]);
    expect(r.invalid).toEqual([{ original: 'X', reason: 'nomor tidak diketahui', source: 'label', listIndex: 2, entryIndex: 0 }]);
    expect(r.stats).toMatchObject({ total: 5, unique: 2, duplicates: 2, invalid: 1 });
  });
  it('excludes opt-out by default and previous only when enabled', () => {
    const lists = [m('081234567890\n081234567891\n081234567892')];
    const optOut = new Set(['6281234567890']); const previous = new Set(['6281234567891']);
    const a = mergeRecipients(lists, { optOut, previous });
    expect(a.unique.map((x) => x.phone)).toEqual(['6281234567891', '6281234567892']);
    expect(a.stats.optOut).toBe(1);
    const b = mergeRecipients(lists, { optOut, previous, excludePrevious: true, excludeOptOut: false });
    expect(b.unique.map((x) => x.phone)).toEqual(['6281234567890', '6281234567892']);
    expect(b.excluded[0]).toMatchObject({ phone: '6281234567891', reason: 'previous' });
  });
  it('produces wizard shape and csv', () => {
    const r = mergeRecipients([{ source: 'crm', entries: entriesFromRecipients([{ phone: '6281234567890', name: 'Budi, "B"' }], 'crm') }]);
    expect(toCampaignRecipients(r.unique)).toEqual([{ phone: '6281234567890', name: 'Budi, "B"', vars: { nama: 'Budi, "B"' } }]);
    expect(recipientsToCsv(r.unique)).toBe('telepon,nama,sumber\n6281234567890,"Budi, ""B""",CRM');
  });
});
