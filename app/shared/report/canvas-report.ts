/**
 * Canvas drawing of the report ("paper" design, white background, theme independent).
 * Pure drawing code: takes a plain ReportModel and a canvas factory. Layout (pagination) is separate from rendering so
 * callers can render page by page and yield to the UI in between.
 */
import { formatDuration } from '../analytics-logic';
import { FOLLOW_LABEL, MOMENTUM_LABEL, TEMP_LABEL } from '../lead-intel-logic';
import { statsRows } from '../stats-logic';
import { BRAND, fmtDateTime, fmtNum, WD, WD_ORDER, type Orientation, type ReportModel } from './model';

type Ctx = CanvasRenderingContext2D;
export interface CanvasLike { width: number; height: number; getContext(id: '2d'): Ctx | null }
export type CanvasFactory = (w: number, h: number) => CanvasLike;

export type RenderMode = 'pages' | 'long';
export interface LayoutOpts {
  orientation: Orientation;
  /** 'pages' = fixed A4 pages (PDF); 'long' = tall parts trimmed to content (PNG) */
  mode: RenderMode;
  /** long mode: max part height in device pixels (default 16000) */
  maxPartPx?: number;
  /** device pixel scale used to convert maxPartPx to CSS px (default 2) */
  scale?: number;
  /** max rows per table (default 300) */
  maxRows?: number;
}

export const PAGE_PORTRAIT = { w: 794, h: 1123 } as const; // A4 @ 96 dpi
export const PAGE_LANDSCAPE = { w: 1123, h: 794 } as const;
const M = 36;           // page margin
const FOOT = 34;        // reserved footer height
const MAX_CANVAS_PX = 120e6;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const C = {
  brand: '#128c7e', ink: '#1b2430', muted: '#657084', line: '#dde1e8', soft: '#f6f8fa', white: '#ffffff',
  fu: '#3b6fd4', inb: '#c2410c', up: '#1b9a4b', down: '#c62828',
  urgent: '#c62828', high: '#c26a00', normal: '#3b6fd4', low: '#657084',
};
const TONE = { up: C.up, down: C.down, flat: C.muted } as const;
const PRIO_COLOR = { urgent: C.urgent, high: C.high, normal: C.normal, low: C.low } as const;
const PRIO = { urgent: 'Mendesak', high: 'Tinggi', normal: 'Normal', low: 'Rendah' } as const;
const KIND = { new: 'WA Baru', followup: 'Follow-up', existing: 'Lama' } as const;

export interface Block {
  h: number;
  draw: (ctx: Ctx, x: number, y: number, w: number) => void;
  keepNext?: boolean;
  /** full-bleed block placed at the very top of the first page */
  bleed?: boolean;
  isHeader?: boolean;
  /** table header re-drawn when the table continues on a new page */
  header?: Block;
}
export interface PlacedBlock { b: Block; y: number }
export interface Page { items: PlacedBlock[]; bottom: number }
export interface Layout { pageW: number; pageH: number; mode: RenderMode; pages: Page[] }

const f = (size: number, weight: 'normal' | 'bold' = 'normal', style = '') => `${style ? style + ' ' : ''}${weight} ${size}px ${FONT}`;

function fit(ctx: Ctx, text: string, maxW: number): string {
  if (maxW <= 0) return '';
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + '…' : '';
}

export function wrapText(ctx: Ctx, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const t = cur ? cur + ' ' + word : word;
    if (cur && ctx.measureText(t).width > maxW) { lines.push(cur); cur = word; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function niceTop(max: number): number {
  const m = Math.max(1, max);
  const step = Math.pow(10, Math.floor(Math.log10(m)));
  const t = Math.ceil(m / step) * step;
  return t;
}

// ---------- blocks ----------

function headerBlock(m: ReportModel, pageW: number): Block {
  const h = 104;
  return {
    h, bleed: true,
    draw(ctx, _x, y) {
      ctx.fillStyle = C.brand; ctx.fillRect(0, y, pageW, h);
      ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(0, y + h - 5, pageW, 5);
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = f(12, 'bold'); ctx.textAlign = 'left';
      const biz = m.business || BRAND;
      ctx.fillText(fit(ctx, biz, pageW - 2 * M - 170), M, y + 28);
      ctx.font = f(10); ctx.textAlign = 'right';
      ctx.fillText(`Dibuat ${fmtDateTime(m.generatedAt)}`, pageW - M, y + 28);
      ctx.textAlign = 'left'; ctx.fillStyle = C.white; ctx.font = f(26, 'bold');
      ctx.fillText(fit(ctx, m.title || 'Laporan', pageW - 2 * M), M, y + 62);
      ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.font = f(13);
      ctx.fillText(fit(ctx, m.subtitle, pageW - 2 * M), M, y + 86);
    },
  };
}

function headingBlock(text: string): Block {
  return {
    h: 34, keepNext: true,
    draw(ctx, x, y) {
      ctx.fillStyle = C.brand; ctx.fillRect(x, y + 8, 4, 18);
      ctx.fillStyle = C.ink; ctx.font = f(15, 'bold'); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(text, x + 12, y + 22);
    },
  };
}

function kpiBlocks(m: ReportModel, w: number): Block[] {
  const cols = 4, gap = 10, ch = 72;
  const cw = (w - gap * (cols - 1)) / cols;
  const out: Block[] = [];
  for (let r = 0; r * cols < m.kpis.length; r++) {
    const row = m.kpis.slice(r * cols, r * cols + cols);
    out.push({
      h: ch + gap,
      draw(ctx, x, y) {
        row.forEach((k, i) => {
          const cx = x + i * (cw + gap);
          ctx.fillStyle = C.soft; rr(ctx, cx, y, cw, ch, 8); ctx.fill();
          ctx.strokeStyle = C.line; ctx.lineWidth = 1; rr(ctx, cx + 0.5, y + 0.5, cw - 1, ch - 1, 8); ctx.stroke();
          ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
          ctx.fillStyle = C.muted; ctx.font = f(11);
          ctx.fillText(fit(ctx, k.label, cw - 20), cx + 10, y + 20);
          ctx.fillStyle = C.ink; ctx.font = f(22, 'bold');
          ctx.fillText(fit(ctx, k.value, cw - 20), cx + 10, y + 46);
          if (k.delta) {
            ctx.fillStyle = k.tone ? TONE[k.tone] : C.muted; ctx.font = f(11, 'bold');
            ctx.fillText(fit(ctx, `${k.delta} vs periode lalu`, cw - 20), cx + 10, y + 63);
          }
        });
      },
    });
  }
  return out;
}

function chartBlock(m: ReportModel): Block {
  const H = 250;
  return {
    h: H + 10,
    draw(ctx, x, y, w) {
      const bs = m.buckets, n = bs.length;
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      // legend
      ctx.font = f(11);
      let lx = x;
      const leg: [string, string][] = [[C.brand, 'WA Baru'], [C.fu, 'Follow-up'], [C.inb, `Pesan masuk (garis), per ${m.bucketUnit}`]];
      for (const [col, label] of leg) {
        ctx.fillStyle = col; ctx.fillRect(lx, y + 4, 10, 10);
        ctx.fillStyle = C.muted; ctx.fillText(label, lx + 15, y + 13);
        lx += 15 + ctx.measureText(label).width + 18;
      }
      if (!n) { ctx.fillStyle = C.muted; ctx.font = f(12); ctx.fillText('Tidak ada data pada rentang ini.', x, y + 60); return; }
      const L = 44, R = 8, T = 28, B = 26;
      const pw = w - L - R, ph = H - T - B;
      const max = Math.max(1, ...bs.map((b) => Math.max(b.newLeads + b.followUps, b.inbound)));
      const top = niceTop(max);
      const yy = (v: number) => y + T + ph * (1 - v / top);
      ctx.font = f(10); ctx.textAlign = 'right'; ctx.strokeStyle = C.line; ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const v = (top * i) / 4, gy = Math.round(yy(v)) + 0.5;
        ctx.beginPath(); ctx.moveTo(x + L, gy); ctx.lineTo(x + w - R, gy); ctx.stroke();
        ctx.fillStyle = C.muted; ctx.fillText(fmtNum(Math.round(v)), x + L - 6, gy + 3);
      }
      const bw = pw / n, barW = Math.max(2, Math.min(bw * 0.7, 44));
      const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(pw / 48))));
      ctx.textAlign = 'center';
      bs.forEach((b, i) => {
        const bx = x + L + bw * i + (bw - barW) / 2;
        const y0 = yy(0), yN = yy(b.newLeads), yF = yy(b.newLeads + b.followUps);
        ctx.fillStyle = C.brand; ctx.fillRect(bx, yN, barW, y0 - yN);
        ctx.fillStyle = C.fu; ctx.fillRect(bx, yF, barW, yN - yF);
        if (i % every === 0) { ctx.fillStyle = C.muted; ctx.fillText(fit(ctx, b.label, bw * every), x + L + bw * (i + 0.5), y + H - 8); }
      });
      ctx.strokeStyle = C.inb; ctx.lineWidth = 2; ctx.beginPath();
      bs.forEach((b, i) => { const px = x + L + bw * (i + 0.5), py = yy(b.inbound); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
      ctx.stroke();
      if (n <= 40) { ctx.fillStyle = C.inb; bs.forEach((b, i) => { ctx.beginPath(); ctx.arc(x + L + bw * (i + 0.5), yy(b.inbound), 2.5, 0, Math.PI * 2); ctx.fill(); }); }
    },
  };
}

function heatmapBlock(m: ReportModel): Block {
  return {
    h: 270,
    draw(ctx, x, y, w) {
      const lab = 36;
      const cs = Math.min(30, (w - lab) / 24);
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center'; ctx.font = f(9); ctx.fillStyle = C.muted;
      const every = cs >= 20 ? 1 : 3;
      for (let h = 0; h < 24; h += every) ctx.fillText(String(h), x + lab + cs * h + cs / 2, y + 10);
      m.heatmap.forEach((row, ri) => {
        const ry = y + 18 + ri * cs;
        ctx.textAlign = 'left'; ctx.fillStyle = C.muted; ctx.font = f(10);
        ctx.fillText(WD[WD_ORDER[ri]], x, ry + cs / 2 + 3);
        row.forEach((v, h) => {
          const a = v && m.heatMax ? 0.14 + 0.86 * (v / m.heatMax) : 0.05;
          ctx.fillStyle = `rgba(18,140,126,${a.toFixed(3)})`;
          ctx.fillRect(x + lab + cs * h + 1, ry + 1, cs - 2, cs - 2);
          if (v && cs >= 24) {
            ctx.fillStyle = a > 0.55 ? C.white : C.ink; ctx.font = f(9); ctx.textAlign = 'center';
            ctx.fillText(String(v), x + lab + cs * h + cs / 2, ry + cs / 2 + 3);
          }
        });
      });
      const ly = y + 18 + 7 * cs + 18;
      ctx.textAlign = 'left'; ctx.font = f(10); ctx.fillStyle = C.muted;
      ctx.fillText('Sedikit', x + lab, ly + 9);
      for (let i = 0; i < 5; i++) { ctx.fillStyle = `rgba(18,140,126,${(0.1 + 0.9 * (i / 4)).toFixed(2)})`; ctx.fillRect(x + lab + 44 + i * 18, ly, 16, 12); }
      ctx.fillStyle = C.muted; ctx.fillText(`Banyak (maks ${fmtNum(m.heatMax)} pesan masuk per jam)`, x + lab + 44 + 5 * 18 + 6, ly + 9);
    },
  };
}

export interface TableCell { t: string; color?: string; bold?: boolean }
interface Col { title: string; frac: number; right?: boolean }

function tableBlocks(cols: Col[], rows: (string | TableCell)[][], empty: string, total: number, cap: number): Block[] {
  const RH = 22;
  const fr = cols.reduce((a, c) => a + c.frac, 0);
  const geom = (w: number) => { let cx = 0; return cols.map((c) => { const cw = (c.frac / fr) * w; const g = { x: cx, w: cw }; cx += cw; return g; }); };
  const header: Block = {
    h: RH + 2, keepNext: true, isHeader: true,
    draw(ctx, x, y, w) {
      ctx.fillStyle = C.brand; ctx.fillRect(x, y, w, RH);
      ctx.fillStyle = C.white; ctx.font = f(11, 'bold'); ctx.textBaseline = 'alphabetic';
      const g = geom(w);
      cols.forEach((c, i) => {
        ctx.textAlign = c.right ? 'right' : 'left';
        ctx.fillText(fit(ctx, c.title, g[i].w - 12), c.right ? x + g[i].x + g[i].w - 6 : x + g[i].x + 6, y + 15);
      });
    },
  };
  const out: Block[] = [header];
  if (!rows.length) {
    out.push({ h: 30, header, draw(ctx, x, y) { ctx.fillStyle = C.muted; ctx.font = f(12, 'normal', 'italic'); ctx.textAlign = 'left'; ctx.fillText(empty, x + 6, y + 20); } });
    return out;
  }
  rows.forEach((r, ri) => out.push({
    h: RH, header,
    draw(ctx, x, y, w) {
      if (ri % 2) { ctx.fillStyle = C.soft; ctx.fillRect(x, y, w, RH); }
      ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y + RH - 0.5); ctx.lineTo(x + w, y + RH - 0.5); ctx.stroke();
      const g = geom(w);
      ctx.textBaseline = 'alphabetic';
      cols.forEach((c, i) => {
        const cell = typeof r[i] === 'string' ? { t: r[i] as string } : (r[i] as TableCell);
        ctx.font = f(11, cell.bold ? 'bold' : 'normal'); ctx.fillStyle = cell.color ?? C.ink;
        ctx.textAlign = c.right ? 'right' : 'left';
        ctx.fillText(fit(ctx, cell.t, g[i].w - 12), c.right ? x + g[i].x + g[i].w - 6 : x + g[i].x + 6, y + 15);
      });
    },
  }));
  if (total > cap) out.push({
    h: 26,
    draw(ctx, x, y) { ctx.fillStyle = C.muted; ctx.font = f(11, 'normal', 'italic'); ctx.textAlign = 'left'; ctx.fillText(`Menampilkan ${fmtNum(cap)} dari ${fmtNum(total)} baris. Data lengkap ada di ekspor Excel.`, x + 6, y + 18); },
  });
  out.push({ h: 12, draw() { /* spacer */ } });
  return out;
}

function noteBlock(text: string, mctx: Ctx, w: number): Block {
  mctx.font = f(11);
  const lines = wrapText(mctx, text, w);
  return {
    h: lines.length * 15 + 12,
    draw(ctx, x, y, bw) {
      ctx.fillStyle = C.muted; ctx.font = f(11, 'normal', 'italic'); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      wrapText(ctx, text, bw).forEach((l, i) => ctx.fillText(l, x, y + 14 + i * 15));
    },
  };
}

// ---------- layout ----------

export function buildBlocks(m: ReportModel, mctx: Ctx, pageW: number, maxRows = 300): Block[] {
  const w = pageW - 2 * M;
  const S = m.sections;
  const blocks: Block[] = [headerBlock(m, pageW)];
  const gap: Block = { h: 6, draw() { /* spacer */ } };
  if (S.kpi) blocks.push(headingBlock('Ringkasan'), ...kpiBlocks(m, w));
  if (S.charts) blocks.push(headingBlock(`Grafik per ${m.bucketUnit}`), chartBlock(m));
  if (S.heatmap) blocks.push(headingBlock('Aktivitas masuk (jam x hari)'), heatmapBlock(m));
  if (S.stats && m.stats && !m.stats.empty) {
    blocks.push(headingBlock('Statistik'), ...statsRows(m.stats).map(([k, v]) => noteBlock(`${k}: ${v}`, mctx, w)), ...m.stats.insights.map((x) => noteBlock(`- ${x}`, mctx, w)));
  }
  if (S.unanswered) {
    const rows = m.unanswered.slice(0, maxRows).map((r) => [
      r.name || '-', r.phone || '-', KIND[r.kind], { t: PRIO[r.priority], color: PRIO_COLOR[r.priority], bold: true }, formatDuration(r.waitingMs), fmtDateTime(r.waitingSinceTs),
    ] as (string | TableCell)[]);
    blocks.push(headingBlock(`Belum dibalas (${fmtNum(m.unanswered.length)})`), ...tableBlocks(
      [{ title: 'Nama', frac: 0.26 }, { title: 'Nomor', frac: 0.17 }, { title: 'Jenis', frac: 0.11 }, { title: 'Prioritas', frac: 0.11 }, { title: 'Menunggu', frac: 0.13 }, { title: 'Sejak', frac: 0.22 }],
      rows, 'Semua chat sudah dibalas.', m.unanswered.length, maxRows));
  }
  if (S.hot) {
    const rows = m.hot.slice(0, maxRows).map((l) => [
      l.name || '-', l.phone || '-', { t: TEMP_LABEL[l.temperature], bold: true }, String(l.engagement), MOMENTUM_LABEL[l.momentum],
      { t: FOLLOW_LABEL[l.followUpPriority], color: PRIO_COLOR[l.followUpPriority], bold: true }, l.reason,
    ] as (string | TableCell)[]);
    blocks.push(headingBlock(`Lead panas (${fmtNum(m.hot.length)})`), ...tableBlocks(
      [{ title: 'Nama', frac: 0.2 }, { title: 'Nomor', frac: 0.14 }, { title: 'Suhu', frac: 0.08 }, { title: 'Skor', frac: 0.06, right: true }, { title: 'Momentum', frac: 0.1 }, { title: 'Prioritas', frac: 0.1 }, { title: 'Alasan', frac: 0.32 }],
      rows, 'Belum ada lead panas.', m.hot.length, maxRows));
  }
  if (S.interactions) {
    const acc = (id: string) => m.accountNames.get(id) ?? id;
    const rows = m.interactions.slice(0, maxRows).map((i) => [
      i.name || '-', i.phone || '-', acc(i.accountId), i.firstInTs ? fmtDateTime(i.firstInTs) : '-', i.lastInTs ? fmtDateTime(i.lastInTs) : '-', String(i.inCount), String(i.outCount),
    ] as (string | TableCell)[]);
    blocks.push(headingBlock(`Daftar interaksi (${fmtNum(m.interactions.length)})`), ...tableBlocks(
      [{ title: 'Nama', frac: 0.2 }, { title: 'Nomor', frac: 0.14 }, { title: 'Akun', frac: 0.13 }, { title: 'Masuk pertama', frac: 0.17 }, { title: 'Masuk terakhir', frac: 0.17 }, { title: 'Masuk', frac: 0.09, right: true }, { title: 'Keluar', frac: 0.09, right: true }],
      rows, 'Tidak ada interaksi.', m.interactions.length, maxRows));
  }
  blocks.push(gap, noteBlock(m.note, mctx, w));
  return blocks;
}

export function paginate(blocks: Block[], pageW: number, pageH: number, mode: RenderMode): Layout {
  const avail = pageH - FOOT;
  const pages: Page[] = [];
  let cur: Page = { items: [], bottom: M };
  let y = M;
  const startPage = () => { pages.push(cur); cur = { items: [], bottom: M }; y = M; };
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.bleed && !cur.items.length && !pages.length) {
      cur.items.push({ b, y: 0 }); y = b.h + 16; cur.bottom = y; continue;
    }
    let need = b.h;
    for (let j = i; blocks[j]?.keepNext && blocks[j + 1]; j++) need += blocks[j + 1].h;
    if (y + need > avail && cur.items.length) startPage();
    if (cur.items.length === 0 && b.header && !b.isHeader) {
      cur.items.push({ b: b.header, y }); y += b.header.h;
    }
    cur.items.push({ b, y });
    y += b.h;
    cur.bottom = y;
  }
  if (cur.items.length || !pages.length) pages.push(cur);
  return { pageW, pageH, mode, pages };
}

export function layoutReport(m: ReportModel, mctx: Ctx, opts: LayoutOpts): Layout {
  const dim = opts.orientation === 'landscape' ? PAGE_LANDSCAPE : PAGE_PORTRAIT;
  const blocks = buildBlocks(m, mctx, dim.w, opts.maxRows ?? 300);
  const pageH = opts.mode === 'pages' ? dim.h : Math.max(400, Math.floor((opts.maxPartPx ?? 16000) / (opts.scale ?? 2)));
  return paginate(blocks, dim.w, pageH, opts.mode);
}

/** CSS-pixel height of page `index` (fixed for 'pages', trimmed to content for 'long'). */
export function pageHeight(layout: Layout, index: number): number {
  if (layout.mode === 'pages') return layout.pageH;
  return Math.min(layout.pageH, Math.ceil(layout.pages[index].bottom + FOOT));
}

/** Draws page `index` onto a new canvas. Scale is reduced automatically if the pixel area would be unsafe. */
export function renderPage(layout: Layout, index: number, create: CanvasFactory, scale: number, footerLabel = 'Halaman'): CanvasLike {
  const page = layout.pages[index];
  const h = pageHeight(layout, index);
  const s = Math.max(0.25, Math.min(scale, Math.sqrt(MAX_CANVAS_PX / (layout.pageW * h))));
  const canvas = create(Math.round(layout.pageW * s), Math.round(h * s));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D tidak tersedia');
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.fillStyle = C.white; ctx.fillRect(0, 0, layout.pageW, h);
  const w = layout.pageW - 2 * M;
  for (const it of page.items) it.b.draw(ctx, M, it.y, w);
  // footer
  ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(M, h - FOOT + 6.5); ctx.lineTo(layout.pageW - M, h - FOOT + 6.5); ctx.stroke();
  ctx.font = f(10); ctx.fillStyle = C.muted; ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left'; ctx.fillText(`Dibuat dengan ${BRAND}`, M, h - 12);
  ctx.textAlign = 'right'; ctx.fillText(`${footerLabel} ${index + 1}/${layout.pages.length}`, layout.pageW - M, h - 12);
  return canvas;
}
