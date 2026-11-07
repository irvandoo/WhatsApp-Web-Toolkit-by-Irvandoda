/** Pure report model + helpers shared by the Excel, WhatsApp text, PNG and PDF exporters. No DOM. */
import type { DateRange, DayStat, Interaction, MsgEvent, Summary, UnansweredRow } from '../analytics-types';
import { formatDuration } from '../analytics-logic';
import type { LeadIntel } from '../lead-intel-logic';
import type { Stats } from '../stats-logic';

const DAY = 86400e3;
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export const WD = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
/** Mon-first display order of Date.getDay() values */
export const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const BRAND = 'WhatsApp Web Toolkit by Irvandoda';
export const HONEST_NOTE = 'Data hanya sejauh riwayat yang terlihat oleh WhatsApp Web; riwayat yang belum dimuat tidak ikut terhitung.';

// ---------- buckets (daily / weekly / monthly) ----------

export interface Bucket { label: string; full: string; newLeads: number; followUps: number; inbound: number; outbound: number }

function parseDate(s: string) { const [y, m, d] = s.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); }
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function buildBuckets(days: DayStat[], range: DateRange): { unit: string; buckets: Bucket[] } {
  const spanDays = Math.max(1, Math.round((range.to - range.from) / DAY));
  const unit = spanDays <= 31 ? 'hari' : spanDays <= 180 ? 'minggu' : 'bulan';
  const map = new Map<string, Bucket>();
  const keyOf = (d: Date): [string, string, string] => {
    if (unit === 'hari') return [ymd(d), `${d.getDate()}`, `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`];
    if (unit === 'minggu') {
      const m = new Date(d); m.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return [ymd(m), `${m.getDate()} ${MON[m.getMonth()]}`, `Minggu ${m.getDate()} ${MON[m.getMonth()]} ${m.getFullYear()}`];
    }
    return [`${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`, `${MON[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, `${MON[d.getMonth()]} ${d.getFullYear()}`];
  };
  const add = (d: Date, s?: DayStat) => {
    const [k, label, full] = keyOf(d);
    let b = map.get(k);
    if (!b) { b = { label, full, newLeads: 0, followUps: 0, inbound: 0, outbound: 0 }; map.set(k, b); }
    if (s) { b.newLeads += s.newLeads; b.followUps += s.followUps; b.inbound += s.inbound; b.outbound += s.outbound; }
  };
  if (unit === 'hari') for (let t = range.from, n = 0; t < range.to && n < 40; t += DAY, n++) add(new Date(t));
  for (const s of days) add(parseDate(s.date), s);
  const sorted = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return { unit, buckets: sorted.map(([, b]) => b) };
}

/** 7x24 grid of inbound counts, rows in Mon..Sun order (WD_ORDER), columns = hour. */
export function heatmapGrid(events: MsgEvent[], includeGroups: boolean): { grid: number[][]; max: number } {
  const g = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  let max = 0;
  for (const e of events) {
    if (e.dir !== 'in' || (!includeGroups && e.isGroup)) continue;
    const d = new Date(e.ts);
    const r = WD_ORDER.indexOf(d.getDay());
    const v = ++g[r][d.getHours()];
    if (v > max) max = v;
  }
  return { grid: g, max };
}

// ---------- formatting ----------

export const fmtNum = (n: number) => n.toLocaleString('id-ID');
export function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
}
export function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  return `${fmtDate(ts)} ${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
}
export function periodLabel(range: DateRange): string {
  const last = range.to - 1;
  if (range.from <= 0) return `Awal data - ${fmtDate(last)}`;
  const a = fmtDate(range.from), b = fmtDate(last);
  return a === b ? a : `${a} - ${b}`;
}
const ymd8 = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
export const slug = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

/** laporan-wa-<akun|semua>-<YYYYMMDD>-<YYYYMMDD>[-b<part>].<ext> */
export function reportFilename(account: string | null, range: DateRange, ext: string, part?: number): string {
  const acc = (account && slug(account)) || 'semua';
  const from = range.from > 0 ? range.from : range.to - 1;
  return `laporan-wa-${acc}-${ymd8(from)}-${ymd8(range.to - 1)}${part ? `-b${part}` : ''}.${ext}`;
}

// ---------- KPIs ----------

export interface Kpi { label: string; value: string; delta: string | null; tone: 'up' | 'down' | 'flat' | null; raw: number | null }

export function deltaOf(cur: number, prev: number | null, invert = false): { text: string; tone: 'up' | 'down' | 'flat' } | null {
  if (prev == null) return null;
  if (prev === 0) return { text: cur === 0 ? '0%' : 'baru', tone: 'flat' };
  const pct = Math.round(((cur - prev) / prev) * 100);
  const good = invert ? pct < 0 : pct > 0;
  return { text: `${pct > 0 ? '▲' : pct < 0 ? '▼' : '='}${Math.abs(pct)}%`, tone: pct === 0 ? 'flat' : good ? 'up' : 'down' };
}

export function buildKpis(s: Summary, prev: Summary | null, unansweredCount: number): Kpi[] {
  const k = (label: string, cur: number, p: number | null, invert = false, fmt: (n: number) => string = fmtNum): Kpi => {
    const d = deltaOf(cur, p, invert);
    return { label, value: fmt(cur), delta: d?.text ?? null, tone: d?.tone ?? null, raw: cur };
  };
  const resp = s.avgFirstResponseMs;
  const respKpi: Kpi = { label: 'Rata-rata respon pertama', value: resp == null ? '-' : formatDuration(resp), delta: null, tone: null, raw: resp };
  if (resp != null && prev?.avgFirstResponseMs != null) {
    const d = deltaOf(resp, prev.avgFirstResponseMs, true);
    if (d) { respKpi.delta = d.text; respKpi.tone = d.tone; }
  }
  return [
    k('WA Baru', s.newLeads, prev?.newLeads ?? null),
    k('Follow-up', s.followUps, prev?.followUps ?? null),
    k('Pesan masuk', s.inbound, prev?.inbound ?? null),
    k('Pesan keluar', s.outbound, prev?.outbound ?? null),
    k('Chat aktif', s.activeChats, prev?.activeChats ?? null),
    k('Belum dibalas', unansweredCount, null),
    respKpi,
  ];
}

// ---------- the model ----------

export interface ReportSections { kpi: boolean; charts: boolean; heatmap: boolean; unanswered: boolean; hot: boolean; interactions: boolean; stats?: boolean }
export const ALL_SECTIONS: ReportSections = { kpi: true, charts: true, heatmap: true, unanswered: true, hot: true, interactions: false, stats: true };
export type Orientation = 'portrait' | 'landscape';

export interface ReportModel {
  title: string; subtitle: string; business: string;
  period: string; accountLabel: string; generatedAt: number;
  sections: ReportSections;
  kpis: Kpi[];
  bucketUnit: string; buckets: Bucket[];
  heatmap: number[][]; heatMax: number;
  unanswered: UnansweredRow[]; hot: LeadIntel[]; interactions: Interaction[];
  accountNames: Map<string, string>;
  stats?: Stats;
  note: string;
}

export interface ModelInput {
  summary: Summary; prev: Summary | null; unanswered: UnansweredRow[]; hot: LeadIntel[]; interactions: Interaction[];
  events: MsgEvent[]; includeGroups: boolean; accountNames: Map<string, string>; accountId: string;
  title: string; subtitle: string; business: string; sections: ReportSections; now: number;
  stats?: Stats;
}

export function accountLabelOf(accountId: string, names: Map<string, string>): string {
  return accountId ? names.get(accountId) ?? accountId : 'Semua akun';
}

export function buildReportModel(i: ModelInput): ReportModel {
  const { buckets, unit } = buildBuckets(i.summary.days, i.summary.range);
  const { grid, max } = heatmapGrid(i.events, i.includeGroups);
  return {
    title: i.title, subtitle: i.subtitle, business: i.business.trim(),
    period: periodLabel(i.summary.range), accountLabel: accountLabelOf(i.accountId, i.accountNames), generatedAt: i.now,
    sections: i.sections, kpis: buildKpis(i.summary, i.prev, i.unanswered.length),
    bucketUnit: unit, buckets, heatmap: grid, heatMax: max,
    unanswered: i.unanswered, hot: i.hot, interactions: i.interactions, accountNames: i.accountNames, stats: i.stats, note: HONEST_NOTE,
  };
}

export const defaultSubtitle = (range: DateRange, accountLabel: string) => `Periode ${periodLabel(range)} - ${accountLabel}`;
