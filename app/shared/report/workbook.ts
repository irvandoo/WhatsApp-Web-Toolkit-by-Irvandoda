/** Builds the .xlsx workbook (Ringkasan, Harian, Heatmap, Belum Dibalas, Lead Panas, Interaksi) from a ReportModel. */
import type { Summary } from '../analytics-types';
import { formatDuration } from '../analytics-logic';
import { FOLLOW_LABEL, INTENT_LABEL, MOMENTUM_LABEL, TEMP_LABEL } from '../lead-intel-logic';
import { WD, WD_ORDER, type ReportModel } from './model';
import { buildXlsx, type CellInput, type SheetInput } from './xlsx';

const KIND = { new: 'WA Baru', followup: 'Follow-up', existing: 'Lama' } as const;
const PRIO = { urgent: 'Mendesak', high: 'Tinggi', normal: 'Normal', low: 'Rendah' } as const;
const ts = (t: number | null): CellInput => (t == null ? null : new Date(t));

function localDay(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function buildReportSheets(m: ReportModel, summary: Summary): SheetInput[] {
  const acc = (id: string) => m.accountNames.get(id) ?? id;
  const sheets: SheetInput[] = [];
  const S = m.sections;

  const info: CellInput[][] = [
    [{ v: m.title, s: 'title' }],
    [{ v: m.subtitle, s: 'muted' }],
    [],
    [{ v: 'Periode', s: 'bold' }, m.period],
    [{ v: 'Akun', s: 'bold' }, m.accountLabel],
  ];
  if (m.business) info.push([{ v: 'Nama usaha', s: 'bold' }, m.business]);
  info.push([{ v: 'Dibuat', s: 'bold' }, { v: new Date(m.generatedAt), s: 'datetime' }], []);
  let headerRow: number | undefined;
  if (S.kpi) {
    headerRow = info.length;
    info.push(['Metrik', 'Nilai', 'Perubahan vs periode lalu']);
    for (const k of m.kpis) info.push([k.label, k.raw != null && /^[\d.,]+$/.test(k.value) ? { v: k.raw, s: 'int' } : k.value, k.delta ?? '']);
  }
  info.push([], [{ v: m.note, s: 'muted' }]);
  sheets.push({ name: 'Ringkasan', rows: info, widths: [30, 22, 28], headerRow, autoFilter: false });

  if (S.charts) {
    const rows: CellInput[][] = [['Tanggal', 'WA Baru', 'Follow-up', 'Pesan masuk', 'Pesan keluar']];
    for (const d of summary.days) rows.push([{ v: localDay(d.date), s: 'date' }, { v: d.newLeads, s: 'int' }, { v: d.followUps, s: 'int' }, { v: d.inbound, s: 'int' }, { v: d.outbound, s: 'int' }]);
    rows.push([{ v: 'TOTAL', s: 'bold' }, { v: summary.newLeads, s: 'int' }, { v: summary.followUps, s: 'int' }, { v: summary.inbound, s: 'int' }, { v: summary.outbound, s: 'int' }]);
    sheets.push({ name: 'Harian', rows, widths: [14, 12, 12, 14, 14], headerRow: 0, autoFilter: false });
  }

  if (S.heatmap) {
    const rows: CellInput[][] = [['Hari \\ Jam', ...Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'))]];
    m.heatmap.forEach((r, i) => rows.push([{ v: WD[WD_ORDER[i]], s: 'bold' }, ...r.map((v) => ({ v, s: 'int' as const }))]));
    sheets.push({ name: 'Heatmap', rows, widths: [12, ...new Array<number>(24).fill(5)], headerRow: 0, autoFilter: false });
  }

  if (S.unanswered) {
    const rows: CellInput[][] = [['Nama', 'Nomor', 'Akun', 'Jenis', 'Prioritas', 'Menunggu', 'Menunggu (jam)', 'Sejak', 'Pesan masuk', 'Tahap', 'Tag', 'Opt-out']];
    for (const r of m.unanswered) rows.push([
      r.name, r.phone, acc(r.accountId), KIND[r.kind], PRIO[r.priority], formatDuration(r.waitingMs),
      { v: Math.round((r.waitingMs / 3600e3) * 10) / 10, s: 'dec' }, ts(r.waitingSinceTs), { v: r.inCount, s: 'int' }, r.stage ?? '', (r.tags ?? []).join(', '), r.optOut ? 'ya' : '']);
    sheets.push({ name: 'Belum Dibalas', rows, widths: [26, 18, 16, 12, 12, 14, 14, 20, 12, 14, 20, 9], headerRow: 0 });
  }

  if (S.hot) {
    const rows: CellInput[][] = [['Nama', 'Nomor', 'Akun', 'Temperature', 'Engagement', 'Momentum', 'Prioritas follow-up', 'Alasan', 'Saran', 'Intent', 'Aktivitas terakhir', 'Terakhir oleh', 'Menunggu', 'Total pesan']];
    for (const l of m.hot) rows.push([
      l.name, l.phone, acc(l.accountId), TEMP_LABEL[l.temperature], { v: l.engagement, s: 'int' }, MOMENTUM_LABEL[l.momentum], FOLLOW_LABEL[l.followUpPriority],
      { v: l.reason, s: 'wrap' }, { v: l.nextAction, s: 'wrap' }, l.intent ? INTENT_LABEL[l.intent] : '', ts(l.lastActivityTs),
      l.lastSender === 'in' ? 'Mereka' : l.lastSender === 'out' ? 'Kita' : '', l.waitingMs ? formatDuration(l.waitingMs) : '', { v: l.totalMsgs, s: 'int' }]);
    sheets.push({ name: 'Lead Panas', rows, widths: [26, 18, 16, 13, 12, 12, 16, 40, 40, 14, 20, 13, 14, 12], headerRow: 0 });
  }

  if (S.interactions) {
    const rows: CellInput[][] = [['Nama', 'Nomor', 'Akun', 'Grup', 'Masuk pertama', 'Keluar pertama', 'Masuk terakhir', 'Keluar terakhir', 'Jumlah masuk', 'Jumlah keluar', 'Riwayat parsial']];
    for (const i of m.interactions) rows.push([
      i.name, i.phone, acc(i.accountId), i.isGroup, ts(i.firstInTs), ts(i.firstOutTs), ts(i.lastInTs), ts(i.lastOutTs), { v: i.inCount, s: 'int' }, { v: i.outCount, s: 'int' }, i.partialHistory]);
    sheets.push({ name: 'Interaksi', rows, widths: [26, 18, 16, 8, 20, 20, 20, 20, 13, 13, 14], headerRow: 0 });
  }
  return sheets;
}

export function buildReportXlsx(m: ReportModel, summary: Summary): Uint8Array {
  return buildXlsx({ sheets: buildReportSheets(m, summary), title: m.title, created: new Date(m.generatedAt) });
}
