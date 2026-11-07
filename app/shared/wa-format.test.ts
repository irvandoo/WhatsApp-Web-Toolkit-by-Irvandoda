import { describe, expect, it } from 'vitest';
import {
  WA_LINE_WIDTH, formatInvoiceTable, graphemes, invoiceTableLines, normalizeForWa, parseInline, renderWaPreviewNodes, splitForWa,
  textWidth, truncateW, wrapW, type WaInline,
} from './wa-format';

describe('normalizeForWa', () => {
  it('normalises newlines, spaces, invisible and control chars', () => {
    expect(normalizeForWa('a\r\nb\rc')).toBe('a\nb\nc');
    expect(normalizeForWa('a b​c\u0007d')).toBe('a bcd');
    expect(normalizeForWa('x   \ny \t\nz')).toBe('x\ny\nz');
    expect(normalizeForWa('﻿hi‮')).toBe('hi');
  });
  it('collapses blank runs and trims leading/trailing blanks', () => {
    expect(normalizeForWa('\n\n a\n\n\n\n\nb \n\n')).toBe(' a\n\nb');
    expect(normalizeForWa('   \n\n')).toBe('');
    expect(normalizeForWa(null as unknown as string)).toBe('');
  });
  it('is idempotent', () => {
    const t = normalizeForWa('a \r\n\r\n\r\n b\t\n');
    expect(normalizeForWa(t)).toBe(t);
  });
});

const T = (v: string): WaInline => ({ t: 'text', v });
describe('parseInline', () => {
  it('bold / italic / strike / code', () => {
    expect(parseInline('*a*')).toEqual([{ t: 'bold', c: [T('a')] }]);
    expect(parseInline('x _i_ ~s~ `c`')).toEqual([T('x '), { t: 'italic', c: [T('i')] }, T(' '), { t: 'strike', c: [T('s')] }, T(' '), { t: 'code', v: 'c' }]);
  });
  it('nests marks', () => {
    expect(parseInline('*a _b_ c*')).toEqual([{ t: 'bold', c: [T('a '), { t: 'italic', c: [T('b')] }, T(' c')] }]);
  });
  it('respects word boundaries', () => {
    expect(parseInline('snake_case_name')).toEqual([T('snake_case_name')]);
    expect(parseInline('2*3*4')).toEqual([T('2*3*4')]);
    expect(parseInline('(*b*)')).toEqual([T('('), { t: 'bold', c: [T('b')] }, T(')')]);
    expect(parseInline('*b*,')).toEqual([{ t: 'bold', c: [T('b')] }, T(',')]);
  });
  it('rejects spaces just inside marks and empty marks', () => {
    expect(parseInline('* a*')).toEqual([T('* a*')]);
    expect(parseInline('*a *')).toEqual([T('*a *')]);
    expect(parseInline('**')).toEqual([T('**')]);
    expect(parseInline('*unclosed')).toEqual([T('*unclosed')]);
  });
  it('monospace content is literal', () => {
    expect(parseInline('`*x*`')).toEqual([{ t: 'code', v: '*x*' }]);
    expect(parseInline('```*x*```')).toEqual([{ t: 'code', v: '*x*' }]);
  });
  it('links are atomic and strip trailing punctuation', () => {
    expect(parseInline('lihat https://a.id/x_y_z.')).toEqual([T('lihat '), { t: 'link', href: 'https://a.id/x_y_z', v: 'https://a.id/x_y_z' }, T('.')]);
    expect(parseInline('www.toko.id')[0]).toMatchObject({ t: 'link', href: 'https://www.toko.id' });
  });
});

describe('renderWaPreviewNodes', () => {
  it('keeps lines and blank lines', () => {
    const b = renderWaPreviewNodes('a\n\nb');
    expect(b.map((x) => x.t)).toEqual(['line', 'blank', 'line']);
  });
  it('groups quotes, bullets and numbered lists', () => {
    const b = renderWaPreviewNodes('> q1\n> q2\n- a\n* b\n1. x\n2. y');
    expect(b).toEqual([
      { t: 'quote', lines: [[T('q1')], [T('q2')]] },
      { t: 'ul', items: [[T('a')], [T('b')]] },
      { t: 'ol', items: [{ n: 1, c: [T('x')] }, { n: 2, c: [T('y')] }] },
    ]);
  });
  it('does not treat separators, "*bold*" or "-5" as lists', () => {
    const b = renderWaPreviewNodes('--------\n*bold*\n-5\n>no space');
    expect(b.every((x) => x.t === 'line')).toBe(true);
  });
  it('monospace blocks keep content verbatim incl. marks and spaces', () => {
    const b = renderWaPreviewNodes('hi\n```\n*a*   1\n  b\n```\nend');
    expect(b[1]).toEqual({ t: 'pre', v: '*a*   1\n  b' });
    expect(b[2].t).toBe('line');
  });
  it('single-line fenced block and unclosed fence', () => {
    expect(renderWaPreviewNodes('```x y```')[0]).toEqual({ t: 'pre', v: 'x y' });
    expect(renderWaPreviewNodes('```open\nfoo')[0].t).toBe('line');
  });
  it('is normalised first (CRLF, extra blanks)', () => {
    expect(renderWaPreviewNodes('a\r\n\r\n\r\n\r\nb').map((x) => x.t)).toEqual(['line', 'blank', 'line']);
  });
});

describe('width helpers', () => {
  it('counts graphemes, not UTF-16 units', () => {
    expect(graphemes('a👨‍👩‍👧b').length).toBe(3);
    expect(textWidth('é')).toBe(1);
    expect(textWidth('😀')).toBe(2);
  });
  it('truncates with ellipsis within width', () => {
    const t = truncateW('Kopi Susu Gula Aren Dingin', 10);
    expect(textWidth(t)).toBeLessThanOrEqual(10);
    expect(t.endsWith('…')).toBe(true);
    expect(truncateW('abc', 5)).toBe('abc');
  });
  it('wraps words and hard-splits long words', () => {
    expect(wrapW('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc']);
    expect(wrapW('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapW('', 5)).toEqual(['']);
  });
});

describe('formatInvoiceTable', () => {
  const rows = [
    { name: 'Kopi', qty: '2', price: 'Rp 10.000', total: 'Rp 20.000' },
    { name: 'Nasi Goreng Spesial Ayam Kampung Pedas Level Dewa Tanpa Kerupuk', qty: '12', price: 'Rp 25.000', total: 'Rp 300.000', extra: [{ label: 'Diskon', value: '-Rp 1.000' }] },
    { name: 'Es Teh Manis Rasa Jeruk Nipis Segar Sekali', qty: '1', price: 'Rp 1.234.567', total: 'Rp 1.234.567' },
  ];
  it('fits width, right-aligns money, wraps names, wraps in a fence', () => {
    const t = formatInvoiceTable(rows);
    const lines = t.split('\n');
    expect(lines[0]).toBe('```'); expect(lines[lines.length - 1]).toBe('```');
    for (const l of lines.slice(1, -1)) expect(textWidth(l)).toBeLessThanOrEqual(WA_LINE_WIDTH);
    const l = invoiceTableLines(rows);
    expect(l[0]).toBe('1. Kopi');
    expect(l[1]).toMatch(/^   2 x Rp 10.000 +Rp 20.000$/);
    expect(textWidth(l[1])).toBe(WA_LINE_WIDTH);
    const amount = l.find((x) => x.includes('Rp 300.000'))!;
    expect(textWidth(amount)).toBe(WA_LINE_WIDTH);
    expect(l.some((x) => x.startsWith('   ') && x.trimEnd().endsWith('-Rp 1.000') && textWidth(x) === WA_LINE_WIDTH)).toBe(true);
    expect(l.filter((x) => /^\d+\. /.test(x)).length).toBe(3);
  });
  it('handles empty rows and emoji / Indonesian text', () => {
    expect(formatInvoiceTable([])).toBe('');
    const l = invoiceTableLines([{ name: 'Kue 😀 Lapis Legit Pandan Wangi Berkelas Premium', qty: '1', price: 'Rp 5.000', total: 'Rp 5.000' }]);
    for (const x of l) expect(textWidth(x)).toBeLessThanOrEqual(WA_LINE_WIDTH);
  });
  it('very long price columns fall back to separate total line within width', () => {
    const l = invoiceTableLines([{ name: 'X', qty: '1000000', price: 'Rp 99.999.999.999', total: 'Rp 99.999.999.999.999' }]);
    for (const x of l.join('\n').split('\n')) expect(textWidth(x)).toBeLessThanOrEqual(WA_LINE_WIDTH + 2);
  });
});

describe('splitForWa', () => {
  it('returns one part when short, none when empty', () => {
    expect(splitForWa('a\nb')).toEqual(['a\nb']);
    expect(splitForWa('  ')).toEqual([]);
  });
  it('splits at line boundaries within the limit and loses no lines', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `baris nomor ${i} ` + 'x'.repeat(20));
    const parts = splitForWa(lines.join('\n'), 500);
    expect(parts.length).toBeGreaterThan(5);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(500);
    expect(parts.join('\n').split('\n')).toEqual(lines);
  });
  it('prefers blank lines and keeps fences balanced', () => {
    const block = '```\n' + Array.from({ length: 60 }, (_, i) => `row ${i}`).join('\n') + '\n```';
    const parts = splitForWa('Judul\n\n' + block + '\n\nPenutup', 150);
    expect(parts.length).toBeGreaterThan(2);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(150);
      expect((p.match(/```/g) ?? []).length % 2).toBe(0);
    }
    expect(parts.join('\n')).toContain('row 59');
  });
  it('hard-splits a single overlong line', () => {
    const parts = splitForWa('y'.repeat(1000), 300);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(300);
    expect(parts.join('').length).toBe(1000);
  });
});
