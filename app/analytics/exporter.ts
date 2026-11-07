/** Browser-side glue: renders ReportModel to xlsx / png / pdf blobs. Yields between pages so the UI stays responsive. */
import type { Summary } from '../shared/analytics-types';
import { layoutReport, renderPage, type CanvasFactory, type CanvasLike } from '../shared/report/canvas-report';
import { reportFilename, type Orientation, type ReportModel } from '../shared/report/model';
import { A4_PT, buildPdf, type PdfPage } from '../shared/report/pdf';
import { buildReportXlsx } from '../shared/report/workbook';
import { BRAND } from '../shared/report/model';

export type Format = 'xlsx' | 'wa' | 'pdf' | 'png';
export interface OutFile { name: string; blob: Blob }

export const domCanvas: CanvasFactory = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function toBlob(c: CanvasLike, type: string, q?: number): Promise<Blob> {
  return new Promise((res, rej) => (c as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new Error('Gagal membuat gambar (canvas terlalu besar?)'))), type, q));
}

function measureCtx() {
  const ctx = domCanvas(2, 2).getContext('2d');
  if (!ctx) throw new Error('Canvas 2D tidak tersedia');
  return ctx;
}

/** Draws only the first page at 1x into `target` for the dialog preview. */
export function renderPreview(m: ReportModel, orientation: Orientation, format: 'pdf' | 'png', target: HTMLCanvasElement) {
  const layout = layoutReport(m, measureCtx(), { orientation, mode: format === 'pdf' ? 'pages' : 'long', maxPartPx: 16000, scale: 2 });
  const c = renderPage(layout, 0, domCanvas, 1);
  target.width = c.width; target.height = c.height;
  target.getContext('2d')?.drawImage(c as HTMLCanvasElement, 0, 0);
  return layout.pages.length;
}

export async function makeXlsx(m: ReportModel, summary: Summary, account: string | null): Promise<OutFile[]> {
  const bytes = buildReportXlsx(m, summary);
  return [{ name: reportFilename(account, summary.range, 'xlsx'), blob: new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) }];
}

export async function makePng(m: ReportModel, summary: Summary, account: string | null, orientation: Orientation, progress: (s: string) => void): Promise<OutFile[]> {
  const layout = layoutReport(m, measureCtx(), { orientation, mode: 'long', maxPartPx: 16000, scale: 2 });
  const n = layout.pages.length;
  const out: OutFile[] = [];
  for (let i = 0; i < n; i++) {
    progress(`Membuat PNG ${i + 1}/${n}...`);
    await tick();
    const c = renderPage(layout, i, domCanvas, 2, 'Bagian');
    out.push({ name: reportFilename(account, summary.range, 'png', n > 1 ? i + 1 : undefined), blob: await toBlob(c, 'image/png') });
  }
  return out;
}

export async function makePdf(m: ReportModel, summary: Summary, account: string | null, orientation: Orientation, progress: (s: string) => void): Promise<OutFile[]> {
  const layout = layoutReport(m, measureCtx(), { orientation, mode: 'pages' });
  const n = layout.pages.length;
  const pages: PdfPage[] = [];
  const land = orientation === 'landscape';
  for (let i = 0; i < n; i++) {
    progress(`Membuat halaman PDF ${i + 1}/${n}...`);
    await tick();
    const c = renderPage(layout, i, domCanvas, 2);
    const blob = await toBlob(c, 'image/jpeg', 0.92);
    pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), pxW: c.width, pxH: c.height, ptW: land ? A4_PT.h : A4_PT.w, ptH: land ? A4_PT.w : A4_PT.h });
  }
  const bytes = buildPdf(pages, { title: m.title, subject: m.subtitle, author: BRAND, created: new Date(m.generatedAt) });
  return [{ name: reportFilename(account, summary.range, 'pdf'), blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }) }];
}

export function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
