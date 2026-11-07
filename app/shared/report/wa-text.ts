/** WhatsApp-markup text report (*bold*, _italic_, ``` monospace blocks). Pure; no DOM. */
import type { Summary, UnansweredRow } from '../analytics-types';
import { formatDuration } from '../analytics-logic';
import { MOMENTUM_LABEL, TEMP_LABEL, type LeadIntel } from '../lead-intel-logic';
import { statsRows, type Stats } from '../stats-logic';
import { ALL_SECTIONS, BRAND, buildBuckets, buildKpis, fmtDateTime, fmtNum, periodLabel, type Bucket, type ReportSections } from './model';

export interface WaTextOpts {
  title?: string;
  business?: string;
  accountLabel?: string;
  /** previous period summary for deltas */
  prev?: Summary | null;
  topN?: number;
  now?: number;
  sections?: ReportSections;
  /** 7x24 inbound grid, Mon..Sun rows (see heatmapGrid) */
  heatmap?: number[][];
  /** max characters per part (WhatsApp allows ~65k, but short messages read better); default 4000 */
  maxPartLength?: number;
  /** computed statistics (see stats-logic); included when sections.stats is on */
  stats?: Stats;
}
export interface WaReport { parts: string[]; text: string }

export const WA_MAX_PART = 4000;
const MONO_W = 32;
const PRIO = { urgent: 'Mendesak', high: 'Tinggi', normal: 'Normal', low: 'Rendah' } as const;
const KIND = { new: 'WA Baru', followup: 'Follow-up', existing: 'Lama' } as const;

/** Light normalisation: LF newlines, no trailing spaces, at most one blank line in a row, trimmed. */
export function normalizeWaText(s: string): string {
  return s.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Remove characters that would break WhatsApp formatting when user data is embedded in a line. */
export function safeWa(s: string): string {
  return s.replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim();
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s);
const mono = (lines: string[]) => '```\n' + lines.map((l) => l.replace(/`/g, "'")).join('\n') + '\n```';

function shortLabel(unit: string, b: Bucket): string {
  if (unit === 'hari') return b.full.replace(/ \d{4}$/, '');
  if (unit === 'minggu') return b.full.replace(/^Minggu /, '').replace(/ \d{4}$/, '');
  return b.label;
}

function kpiSection(s: Summary, prev: Summary | null, unansweredCount: number): string {
  const kpis = buildKpis(s, prev, unansweredCount);
  const short: Record<string, string> = { 'Rata-rata respon pertama': 'Resp. pertama' };
  const vw = Math.max(...kpis.map((k) => k.value.length));
  const lines = kpis.map((k) => {
    let l = (short[k.label] ?? k.label).padEnd(14) + k.value.padStart(vw);
    if (k.delta && l.length + 1 + k.delta.length <= MONO_W) l += ' ' + k.delta;
    return l;
  });
  return '*Ringkasan*\n' + mono(lines) + (prev ? '\n_Perubahan dibanding periode sebelumnya yang sama panjang._' : '');
}

function trendSection(s: Summary, maxRows: number): string | null {
  const { unit, buckets } = buildBuckets(s.days, s.range);
  if (!buckets.length) return null;
  const shown = buckets.slice(-maxRows);
  const lines = [`${unit === 'hari' ? 'Tanggal' : unit === 'minggu' ? 'Minggu' : 'Bulan'}`.padEnd(9) + 'Baru'.padStart(5) + 'FU'.padStart(5) + 'Masuk'.padStart(7)];
  for (const b of shown) lines.push(clip(shortLabel(unit, b), 9).padEnd(9) + String(b.newLeads).padStart(5) + String(b.followUps).padStart(5) + String(b.inbound).padStart(7));
  let out = `*Tren per ${unit}*\n` + mono(lines);
  if (shown.length < buckets.length) out += `\n_${shown.length} terakhir dari ${buckets.length} ${unit}._`;
  const best = buckets.reduce((a, b) => (b.inbound > a.inbound ? b : a), buckets[0]);
  if (best.inbound > 0) out += `\n• Puncak pesan masuk: ${best.full} (${fmtNum(best.inbound)})`;
  return out;
}

function heatSection(grid: number[][]): string | null {
  const hours = new Array<number>(24).fill(0);
  const days = new Array<number>(7).fill(0);
  grid.forEach((r, di) => r.forEach((v, h) => { hours[h] += v; days[di] += v; }));
  const total = hours.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const DN = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
  const topH = hours.map((v, h) => [h, v] as const).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 3);
  const topD = days.map((v, d) => [d, v] as const).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 3);
  return '*Jam & hari tersibuk*\n'
    + `• Jam: ${topH.map(([h, v]) => `${String(h).padStart(2, '0')}.00 (${fmtNum(v)})`).join(', ')}\n`
    + `• Hari: ${topD.map(([d, v]) => `${DN[d]} (${fmtNum(v)})`).join(', ')}`;
}

function statsSection(st: Stats): string | null {
  if (st.empty) return null;
  const pick = ['Median balasan pertama', 'Lead baru dibalas', 'Lead dibalas < 1 jam', 'Jam tersibuk', 'Hari tersibuk', 'Rasio masuk:keluar'];
  const rows = statsRows(st).filter(([k]) => pick.includes(k));
  let out = '*Statistik*\n' + mono(rows.map(([k, v]) => k.padEnd(22) + v.padStart(MONO_W - 22)));
  if (st.insights.length) out += '\n' + st.insights.slice(0, 4).map((x) => `• ${safeWa(x)}`).join('\n');
  return out;
}

function unansweredSection(rows: UnansweredRow[], topN: number): string {
  const c = { urgent: 0, high: 0, normal: 0, low: 0 };
  for (const r of rows) c[r.priority]++;
  let out = `*Belum dibalas* (${fmtNum(rows.length)})\n`;
  if (!rows.length) return out + '_Semua chat sudah dibalas._';
  out += `Mendesak ${c.urgent} · Tinggi ${c.high} · Normal ${c.normal} · Rendah ${c.low}\n`;
  out += rows.slice(0, topN).map((r, i) => `${i + 1}. ${clip(safeWa(r.name) || safeWa(r.phone) || '-', 40)}${r.phone && r.name ? ` (${safeWa(r.phone)})` : ''} - ${formatDuration(r.waitingMs)}, ${PRIO[r.priority]}, ${KIND[r.kind]}`).join('\n');
  if (rows.length > topN) out += `\n_+ ${fmtNum(rows.length - topN)} lainnya (lihat Excel/PDF)._`;
  return out;
}

function hotSection(list: LeadIntel[], topN: number): string {
  let out = `*Lead panas* (${fmtNum(list.length)})\n`;
  if (!list.length) return out + '_Belum ada lead panas._';
  out += list.slice(0, topN).map((l, i) => {
    const head = `${i + 1}. ${clip(safeWa(l.name) || safeWa(l.phone) || '-', 40)}${l.phone && l.name ? ` (${safeWa(l.phone)})` : ''} - ${TEMP_LABEL[l.temperature]}, skor ${l.engagement}, ${MOMENTUM_LABEL[l.momentum]}`;
    return l.reason ? `${head}\n   _${clip(safeWa(l.reason), 90)}_` : head;
  }).join('\n');
  if (list.length > topN) out += `\n_+ ${fmtNum(list.length - topN)} lainnya (lihat Excel/PDF)._`;
  return out;
}

/** Split an over-long section on line boundaries, closing/reopening ``` fences so each piece renders correctly. */
export function splitLong(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let cur: string[] = [];
  let len = 0;
  let open = false;
  const flush = () => {
    if (!cur.length) return;
    out.push(cur.join('\n') + (open ? '\n```' : ''));
    cur = open ? ['```'] : [];
    len = open ? 4 : 0;
  };
  for (const raw of text.split('\n')) {
    const line = raw.length > max - 10 ? raw.slice(0, max - 10) : raw;
    if (len + line.length + 5 + 1 > max && cur.length > (open ? 1 : 0)) flush();
    cur.push(line);
    len += line.length + 1;
    if (line.startsWith('```')) open = !open;
  }
  if (cur.length > (open ? 1 : 0) || !out.length) out.push(cur.join('\n'));
  return out;
}

export function buildWaReportText(summary: Summary, unanswered: UnansweredRow[], hot: LeadIntel[], opts: WaTextOpts = {}): WaReport {
  const S = opts.sections ?? ALL_SECTIONS;
  const topN = Math.max(1, opts.topN ?? 10);
  const max = Math.max(500, opts.maxPartLength ?? WA_MAX_PART);
  const title = safeWa(opts.title ?? 'Laporan WhatsApp') || 'Laporan WhatsApp';
  const head: string[] = [`*${title.toUpperCase()}*`];
  if (opts.business?.trim()) head.push(`_${safeWa(opts.business)}_`);
  head.push(`Periode: ${periodLabel(summary.range)}`);
  head.push(`Akun: ${safeWa(opts.accountLabel ?? 'Semua akun')}`);
  head.push(`Dibuat: ${fmtDateTime(opts.now ?? Date.now())}`);

  const secs: string[] = [head.join('\n')];
  if (S.kpi) secs.push(kpiSection(summary, opts.prev ?? null, unanswered.length));
  if (S.charts) { const t = trendSection(summary, 14); if (t) secs.push(t); }
  if (S.heatmap && opts.heatmap) { const h = heatSection(opts.heatmap); if (h) secs.push(h); }
  if (S.stats && opts.stats) { const x = statsSection(opts.stats); if (x) secs.push(x); }
  if (S.unanswered) secs.push(unansweredSection(unanswered, topN));
  if (S.hot) secs.push(hotSection(hot, topN));
  secs.push(`_Data sebatas riwayat yang terlihat di WhatsApp Web._\n_${BRAND}_`);

  const budget = max - 60; // room for the "Bagian i/n" label and continuation header
  const pieces = secs.flatMap((s) => splitLong(s, budget));
  const groups: string[][] = [];
  let cur: string[] = [], len = 0;
  for (const p of pieces) {
    if (cur.length && len + p.length + 2 > budget) { groups.push(cur); cur = []; len = 0; }
    cur.push(p); len += p.length + 2;
  }
  if (cur.length) groups.push(cur);

  const n = groups.length;
  const parts = groups.map((g, i) => {
    const body = g.join('\n\n');
    if (n === 1) return normalizeWaText(body);
    const label = `_Bagian ${i + 1}/${n}_`;
    return normalizeWaText(i === 0 ? `${label}\n${body}` : `${label} - *${title}* (lanjutan)\n\n${body}`);
  });
  return { parts, text: parts.join('\n\n') };
}
