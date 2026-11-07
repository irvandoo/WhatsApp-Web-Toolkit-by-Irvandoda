// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildXlsx, cleanXmlText, colName, excelSerial, sanitizeSheetName } from './xlsx';
import { readZip } from './zip.test';

const txt = (m: Map<string, Uint8Array>, k: string) => new TextDecoder().decode(m.get(k)!);
function wellFormed(xml: string): Document {
  const d = new DOMParser().parseFromString(xml, 'application/xml');
  expect(d.getElementsByTagName('parsererror').length).toBe(0);
  return d;
}

describe('xlsx helpers', () => {
  it('colName', () => { expect([0, 25, 26, 27, 701, 702].map(colName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']); });
  it('sheet names', () => {
    expect(sanitizeSheetName('a/b:c?d*e[f]g\\h')).toBe('a-b-c-d-e-f-g-h');
    expect(sanitizeSheetName('x'.repeat(40)).length).toBe(31);
    expect(sanitizeSheetName('')).toBe('Sheet');
    expect(sanitizeSheetName("'quoted'")).toBe('quoted');
    const u = new Set<string>();
    expect(sanitizeSheetName('Data', u)).toBe('Data');
    expect(sanitizeSheetName('data', u)).toBe('data (2)');
    expect(sanitizeSheetName('History')).toBe('History_');
  });
  it('strips control chars and lone surrogates', () => {
    expect(cleanXmlText('a\u0000b\u0008c\td')).toBe('abc\td');
    expect(cleanXmlText('x\ud800y')).toBe('xy');
    expect(cleanXmlText('😀')).toBe('😀');
  });
  it('excelSerial of local midnight 2020-01-01 is 43831', () => {
    expect(excelSerial(new Date(2020, 0, 1))).toBeCloseTo(43831, 6);
  });
});

describe('buildXlsx', () => {
  const bytes = buildXlsx({
    title: 'T & <x>',
    created: new Date(Date.UTC(2024, 0, 2, 3, 4, 5)),
    sheets: [
      { name: 'Ringkasan', headerRow: 0, widths: [10, 20], rows: [['Nama', 'Nilai'], ['=HYPERLINK("x")', 5], ['+1 \u0001<&>"', true], ['', new Date(2020, 0, 1, 12)], [{ v: 0.25, s: 'pct' }, NaN]] },
      { name: 'a/b', rows: [['x']] },
    ],
  });
  const z = readZip(bytes);
  it('has required parts', () => {
    for (const k of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'docProps/core.xml']) expect(z.has(k), k).toBe(true);
    expect(z.has('xl/worksheets/sheet3.xml')).toBe(false);
  });
  it('all xml parts are well formed', () => {
    for (const [k, v] of z) if (/\.(xml|rels)$/.test(k)) wellFormed(new TextDecoder().decode(v));
  });
  it('content types and rels reference sheets', () => {
    const ct = txt(z, '[Content_Types].xml');
    expect(ct).toContain('/xl/worksheets/sheet2.xml');
    expect(ct).toContain('spreadsheetml.sheet.main+xml');
    const rels = wellFormed(txt(z, 'xl/_rels/workbook.xml.rels'));
    const targets = [...rels.getElementsByTagName('Relationship')].map((r) => r.getAttribute('Target'));
    expect(targets).toEqual(expect.arrayContaining(['worksheets/sheet1.xml', 'worksheets/sheet2.xml', 'styles.xml', 'sharedStrings.xml']));
    const wb = wellFormed(txt(z, 'xl/workbook.xml'));
    expect([...wb.getElementsByTagName('sheet')].map((s) => s.getAttribute('name'))).toEqual(['Ringkasan', 'a-b']);
  });
  it('sheet has freeze, filter, widths, typed cells', () => {
    const s = wellFormed(txt(z, 'xl/worksheets/sheet1.xml'));
    expect(s.getElementsByTagName('pane')[0].getAttribute('state')).toBe('frozen');
    expect(s.getElementsByTagName('autoFilter')[0].getAttribute('ref')).toBe('A1:B5');
    expect(s.getElementsByTagName('col').length).toBe(2);
    const cell = (r: string) => [...s.getElementsByTagName('c')].find((c) => c.getAttribute('r') === r)!;
    expect(cell('A1').getAttribute('s')).toBe('1');
    expect(cell('B2').getElementsByTagName('v')[0].textContent).toBe('5');
    expect(cell('B3').getAttribute('t')).toBe('b');
    expect(cell('B4').getElementsByTagName('v')[0].textContent).toBe(String(excelSerial(new Date(2020, 0, 1, 12))));
    expect(cell('A2').getAttribute('t')).toBe('s');
    expect(cell('A2').getElementsByTagName('f').length).toBe(0);
    expect(cell('B5')).toBeUndefined();
  });
  it('shared strings escaped and cleaned', () => {
    const sst = wellFormed(txt(z, 'xl/sharedStrings.xml'));
    const all = [...sst.getElementsByTagName('t')].map((t) => t.textContent);
    expect(all).toContain('+1 <&>"');
    expect(all).toContain('=HYPERLINK("x")');
  });
  it('rejects empty workbook', () => { expect(() => buildXlsx({ sheets: [] })).toThrow(); });
  it('50k rows is fast and valid', () => {
    const rows: (string | number)[][] = [['a', 'b', 'c']];
    for (let i = 0; i < 50000; i++) rows.push([`n${i % 500}`, i, i / 3]);
    const t = Date.now();
    const out = buildXlsx({ sheets: [{ name: 'Big', rows, headerRow: 0 }] });
    expect(Date.now() - t).toBeLessThan(5000);
    const m = readZip(out);
    const xml = txt(m, 'xl/worksheets/sheet1.xml');
    expect(xml).toContain('<autoFilter ref="A1:C50001"/>');
    expect(xml.endsWith('</worksheet>')).toBe(true);
    expect(txt(m, 'xl/sharedStrings.xml')).toContain('uniqueCount="503"');
  });
});
