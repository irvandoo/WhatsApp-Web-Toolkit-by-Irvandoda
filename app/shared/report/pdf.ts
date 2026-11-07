/** Tiny PDF writer: one full-page JPEG (DCTDecode) per page, Info dictionary, classic xref table. */

export interface PdfPage {
  /** complete JPEG file bytes */
  jpeg: Uint8Array;
  /** JPEG pixel size */
  pxW: number; pxH: number;
  /** page size in PDF points (1/72 in) */
  ptW: number; ptH: number;
}
export interface PdfInfo { title?: string; author?: string; subject?: string; creator?: string; created?: Date }

export const A4_PT = { w: 595.28, h: 841.89 } as const;

/** PDF text string as UTF-16BE hex (safe for any Unicode). */
export function pdfHexString(s: string): string {
  let h = 'FEFF';
  for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${h}>`;
}

function pdfDate(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `D:${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}
const num = (n: number) => (Math.round(n * 100) / 100).toString();

export function buildPdf(pages: PdfPage[], info: PdfInfo = {}): Uint8Array {
  if (!pages.length) throw new Error('PDF membutuhkan minimal satu halaman');
  for (const p of pages) {
    if (p.jpeg.length < 4 || p.jpeg[0] !== 0xff || p.jpeg[1] !== 0xd8) throw new Error('Data halaman bukan JPEG');
    if (!(p.pxW > 0 && p.pxH > 0 && p.ptW > 0 && p.ptH > 0)) throw new Error('Ukuran halaman tidak valid');
  }
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let pos = 0;
  const push = (b: Uint8Array | string) => { const u = typeof b === 'string' ? enc.encode(b) : b; chunks.push(u); pos += u.length; };
  const offsets: number[] = []; // by object number - 1

  const begin = (n: number) => { offsets[n - 1] = pos; push(`${n} 0 obj\n`); };
  const nPages = pages.length;
  // 1 Catalog, 2 Pages, 3 Info, then per page i: 4+3i Page, 5+3i Contents, 6+3i Image
  const pageObj = (i: number) => 4 + 3 * i;

  push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // %PDF-1.4\n%âãÏÓ\n
  begin(1); push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  begin(2); push(`<< /Type /Pages /Count ${nPages} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>\nendobj\n`);
  const created = info.created ?? new Date();
  begin(3);
  push(`<< /Title ${pdfHexString(info.title ?? 'Laporan')} /Author ${pdfHexString(info.author ?? 'WhatsApp Web Toolkit by Irvandoda')}`
    + (info.subject ? ` /Subject ${pdfHexString(info.subject)}` : '')
    + ` /Creator ${pdfHexString(info.creator ?? 'WhatsApp Web Toolkit by Irvandoda')} /Producer ${pdfHexString('WhatsApp Web Toolkit by Irvandoda')}`
    + ` /CreationDate (${pdfDate(created)}) >>\nendobj\n`);

  pages.forEach((p, i) => {
    const po = pageObj(i), co = po + 1, io = po + 2;
    begin(po);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.ptW)} ${num(p.ptH)}] /Resources << /XObject << /Im0 ${io} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${co} 0 R >>\nendobj\n`);
    const content = enc.encode(`q\n${num(p.ptW)} 0 0 ${num(p.ptH)} 0 0 cm\n/Im0 Do\nQ\n`);
    begin(co);
    push(`<< /Length ${content.length} >>\nstream\n`); push(content); push('endstream\nendobj\n');
    begin(io);
    push(`<< /Type /XObject /Subtype /Image /Width ${p.pxW} /Height ${p.pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
    push(p.jpeg); push('\nendstream\nendobj\n');
  });

  const total = offsets.length + 1;
  const xrefPos = pos;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  const out = new Uint8Array(pos);
  let q = 0;
  for (const c of chunks) { out.set(c, q); q += c.length; }
  return out;
}
