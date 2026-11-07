import { describe, expect, it } from 'vitest';
import { A4_PT, buildPdf, pdfHexString } from './pdf';

const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, ...Array.from({ length: n }, (_, i) => i & 127), 0xff, 0xd9]);
const latin = (u: Uint8Array) => Array.from(u, (c) => String.fromCharCode(c)).join('');

describe('pdf', () => {
  const pages = [
    { jpeg: jpeg(100), pxW: 1588, pxH: 2246, ptW: A4_PT.w, ptH: A4_PT.h },
    { jpeg: jpeg(7), pxW: 10, pxH: 20, ptW: A4_PT.h, ptH: A4_PT.w },
  ];
  const bytes = buildPdf(pages, { title: 'Laporan é', created: new Date(Date.UTC(2024, 0, 2, 3, 4, 5)) });
  const s = latin(bytes);
  it('header and trailer', () => {
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(s).toContain('/Count 2');
    expect(s).toContain('/CreationDate (D:20240102030405Z)');
    expect(s).toContain(pdfHexString('WhatsApp Web Toolkit by Irvandoda'));
    expect(s).toContain(pdfHexString('Laporan é'));
  });
  it('xref offsets point at objects', () => {
    const start = Number(/startxref\n(\d+)\n/.exec(s)![1]);
    expect(s.slice(start, start + 4)).toBe('xref');
    const m = /xref\n0 (\d+)\n([\s\S]*?)trailer/.exec(s.slice(start))!;
    const n = Number(m[1]);
    const lines = m[2].split('\n').filter(Boolean);
    expect(lines.length).toBe(n);
    expect(n).toBe(1 + 3 + 3 * 2);
    for (let i = 1; i < n; i++) {
      const off = Number(lines[i].slice(0, 10));
      expect(s.slice(off).startsWith(`${i} 0 obj`)).toBe(true);
    }
    expect(s).toContain(`/Size ${n}`);
  });
  it('image xobjects with correct lengths', () => {
    const imgs = [...s.matchAll(/\/Subtype \/Image \/Width (\d+) \/Height (\d+)[^>]*\/Filter \/DCTDecode \/Length (\d+) >>\nstream\n/g)];
    expect(imgs.length).toBe(2);
    expect(imgs.map((x) => Number(x[3]))).toEqual([104, 11]);
    for (const x of imgs) {
      const at = x.index! + x[0].length;
      expect(bytes[at]).toBe(0xff);
      expect(bytes[at + 1]).toBe(0xd8);
      expect(s.slice(at + Number(x[3]), at + Number(x[3]) + 10)).toBe('\nendstream');
    }
  });
  it('content stream length matches', () => {
    for (const m of s.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
      const at = m.index! + m[0].length;
      expect(s.slice(at + Number(m[1]), at + Number(m[1]) + 9)).toBe('endstream');
    }
  });
  it('validates input', () => {
    expect(() => buildPdf([])).toThrow();
    expect(() => buildPdf([{ ...pages[0], jpeg: new Uint8Array([1, 2, 3, 4]) }])).toThrow();
  });
});
