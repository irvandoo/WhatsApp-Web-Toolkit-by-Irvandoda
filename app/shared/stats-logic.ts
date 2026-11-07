/** Pure statistics for the Analitik "Statistik" view and exports. No DOM / chrome / Dexie. Every function is safe on empty input (never NaN/Infinity). */
import type { Interaction, MsgEvent, Summary } from './analytics-types';
import { formatDuration, leadDayOf } from './analytics-logic';

const MIN = 60e3, HOUR = 3600e3, DAY = 86400e3;

export const RESPONSE_BUCKETS: { label: string; max: number }[] = [
  { label: '<5m', max: 5 * MIN }, { label: '5-15m', max: 15 * MIN }, { label: '15-60m', max: HOUR },
  { label: '1-4j', max: 4 * HOUR }, { label: '4-24j', max: DAY }, { label: '>24j', max: Infinity },
];
export const WEEKDAYS_FULL = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']; // Date.getDay() order

const fin = (n: number) => (Number.isFinite(n) ? n : 0);
/** percentage 0..100 rounded to 1 decimal; null when the denominator is 0 */
export const pct = (part: number, whole: number): number | null => (whole > 0 ? Math.round((fin(part) / whole) * 1000) / 10 : null);
const fmtPct = (p: number | null) => (p == null ? '-' : `${Number.isInteger(p) ? p : p.toFixed(1)}%`);
const nf = (n: number) => fin(n).toLocaleString('id-ID');
const pad2 = (n: number) => String(n).padStart(2, '0');

// ---------- response time ----------

export interface ResponseDist { n: number; buckets: { label: string; count: number }[]; median: number | null; mean: number | null; p90: number | null }

export function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1];
}

export function responseDistribution(times: number[]): ResponseDist {
  const v = times.filter((t) => Number.isFinite(t) && t >= 0).sort((a, b) => a - b);
  const buckets = RESPONSE_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  for (const t of v) buckets[RESPONSE_BUCKETS.findIndex((b) => t < b.max)].count++;
  if (!v.length) return { n: 0, buckets, median: null, mean: null, p90: null };
  const mid = v.length >> 1;
  const median = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  return { n: v.length, buckets, median, mean: v.reduce((a, b) => a + b, 0) / v.length, p90: percentile(v, 90) };
}

export interface StatsOpts { accountId?: string; includeGroups?: boolean }
const pass = (i: { accountId: string; isGroup: boolean }, o?: StatsOpts) => (!o?.accountId || i.accountId === o.accountId) && (!!o?.includeGroups || !i.isGroup);

/** New leads whose first inbound falls in [from,to) (same definition as summarize). */
export function newLeadsIn(interactions: Interaction[], from: number, to: number, opts?: StatsOpts): Interaction[] {
  return interactions.filter((i) => pass(i, opts) && i.firstInTs != null && i.firstInTs >= from && i.firstInTs < to && leadDayOf(i) != null);
}
const firstResponseMs = (i: Interaction): number | null => (i.firstInTs != null && i.firstOutTs != null && i.firstOutTs > i.firstInTs ? i.firstOutTs - i.firstInTs : null);

export function firstResponseTimes(leads: Interaction[]): number[] {
  const out: number[] = [];
  for (const i of leads) { const r = firstResponseMs(i); if (r != null) out.push(r); }
  return out;
}

export interface ResponseRate { leads: number; replied: number; within1h: number; repliedPct: number | null; within1hPct: number | null }
export function responseRate(leads: Interaction[]): ResponseRate {
  let replied = 0, within1h = 0;
  for (const i of leads) { const r = firstResponseMs(i); if (r == null) continue; replied++; if (r <= HOUR) within1h++; }
  return { leads: leads.length, replied, within1h, repliedPct: pct(replied, leads.length), within1hPct: pct(within1h, leads.length) };
}

// ---------- funnel ----------

export interface FunnelStep { label: string; count: number; pctOfFirst: number | null; pctOfPrev: number | null }
export function funnel(leads: Interaction[]): FunnelStep[] {
  const replied = leads.filter((i) => firstResponseMs(i) != null);
  const answered = replied.filter((i) => i.lastInTs != null && i.firstOutTs != null && i.lastInTs > i.firstOutTs);
  const active = answered.filter((i) => i.outCount >= 2);
  const counts: [string, number][] = [['Lead baru', leads.length], ['Dibalas', replied.length], ['Mereka balas lagi', answered.length], ['Follow-up aktif', active.length]];
  return counts.map(([label, count], k) => ({ label, count, pctOfFirst: pct(count, counts[0][1]), pctOfPrev: k === 0 ? null : pct(count, counts[k - 1][1]) }));
}

// ---------- busiest hour / weekday ----------

export interface Busiest {
  total: number; hours: number[]; weekdays: number[]; // weekdays in Date.getDay() order
  topHour: number | null; topWeekday: number | null; sentence: string;
}
export function busiest(events: MsgEvent[], opts?: StatsOpts): Busiest {
  const hours = new Array<number>(24).fill(0), weekdays = new Array<number>(7).fill(0);
  let total = 0;
  for (const e of events) {
    if (e.dir !== 'in' || !pass(e, opts) || !Number.isFinite(e.ts)) continue;
    const d = new Date(e.ts); hours[d.getHours()]++; weekdays[d.getDay()]++; total++;
  }
  if (!total) return { total, hours, weekdays, topHour: null, topWeekday: null, sentence: 'Belum ada pesan masuk untuk menentukan jam sibuk.' };
  const argmax = (a: number[]) => a.reduce((b, v, i) => (v > a[b] ? i : b), 0);
  const topHour = argmax(hours), topWeekday = argmax(weekdays);
  const sentence = `Jam sibuk: sekitar pukul ${pad2(topHour)}.00-${pad2((topHour + 1) % 24)}.00 (${pct(hours[topHour], total)}% pesan masuk), paling ramai hari ${WEEKDAYS_FULL[topWeekday]}.`;
  return { total, hours, weekdays, topHour, topWeekday, sentence };
}

// ---------- trend ----------

export type TrendDir = 'naik' | 'turun' | 'stabil';
export interface Trend { slope: number; direction: TrendDir; relative: number }
/** Least-squares slope (units per step) and a direction word; |relative change over the span| < 10% counts as stable. */
export function trendOf(values: number[]): Trend {
  const n = values.length;
  if (n < 3) return { slope: 0, direction: 'stabil', relative: 0 };
  const mx = (n - 1) / 2, my = values.reduce((a, b) => a + fin(b), 0) / n;
  let num = 0, den = 0;
  values.forEach((y, x) => { num += (x - mx) * (fin(y) - my); den += (x - mx) ** 2; });
  const slope = den ? num / den : 0;
  const relative = my > 0 ? (slope * (n - 1)) / my : 0;
  return { slope, relative, direction: relative > 0.1 ? 'naik' : relative < -0.1 ? 'turun' : 'stabil' };
}

export interface DailyStats {
  dayCount: number; total: number; avgPerDay: number; trend: Trend;
  best: { date: string; total: number } | null; worst: { date: string; total: number } | null; series: number[];
}
export function dailyStats(days: Summary['days']): DailyStats {
  const series = days.map((d) => d.inbound + d.outbound);
  const total = series.reduce((a, b) => a + b, 0);
  if (!days.length) return { dayCount: 0, total: 0, avgPerDay: 0, trend: trendOf([]), best: null, worst: null, series };
  let bi = 0, wi = 0;
  series.forEach((v, i) => { if (v > series[bi]) bi = i; if (v < series[wi]) wi = i; });
  return { dayCount: days.length, total, avgPerDay: total / days.length, trend: trendOf(series), best: { date: days[bi].date, total: series[bi] }, worst: { date: days[wi].date, total: series[wi] }, series };
}

/** Consecutive days (ending at the last day before `to`) on which at least one chat was still never replied at end of day. */
export function backlogStreak(interactions: Interaction[], from: number, to: number, opts?: StatsOpts): { streak: number; peak: number } {
  const list = interactions.filter((i) => pass(i, opts) && i.firstInTs != null);
  if (!list.length || !(to > from)) return { streak: 0, peak: 0 };
  const ends: number[] = [];
  const s = new Date(from);
  for (let k = 0; k < 400; k++) {
    const next = new Date(s.getFullYear(), s.getMonth(), s.getDate() + k + 1).getTime();
    ends.push(Math.min(next, to));
    if (next >= to) break;
  }
  const backlog = ends.map((end) => list.reduce((c, i) => c + ((i.firstInTs as number) < end && (i.firstOutTs == null || i.firstOutTs >= end) ? 1 : 0), 0));
  let streak = 0;
  for (let k = backlog.length - 1; k >= 0 && backlog[k] > 0; k--) streak++;
  return { streak, peak: Math.max(0, ...backlog) };
}

// ---------- per account / period compare ----------

export interface AccountRow { accountId: string; name: string; messages: number; newLeads: number; medianMs: number | null; unanswered: number }
export function perAccount(events: MsgEvent[], interactions: Interaction[], from: number, to: number, names: Map<string, string>, opts?: StatsOpts): AccountRow[] {
  const ids = new Set<string>();
  const msgs = new Map<string, number>();
  for (const e of events) {
    if (e.ts < from || e.ts >= to || !pass(e, opts)) continue;
    ids.add(e.accountId); msgs.set(e.accountId, (msgs.get(e.accountId) ?? 0) + 1);
  }
  for (const i of interactions) if (pass(i, opts)) ids.add(i.accountId);
  return [...ids].sort().map((accountId) => {
    const mine = interactions.filter((i) => i.accountId === accountId);
    const leads = newLeadsIn(mine, from, to, { includeGroups: opts?.includeGroups });
    const unanswered = mine.filter((i) => pass(i, opts) && i.lastInTs != null && (i.lastOutTs == null || i.lastOutTs < i.lastInTs)).length;
    return { accountId, name: names.get(accountId) || accountId, messages: msgs.get(accountId) ?? 0, newLeads: leads.length, medianMs: responseDistribution(firstResponseTimes(leads)).median, unanswered };
  });
}

export interface Compare { label: string; cur: number; prev: number; pct: number | null; text: string; invert?: boolean }
export function compareSummaries(cur: Summary, prev: Summary | null): Compare[] {
  if (!prev) return [];
  const row = (label: string, c: number, p: number, text: (n: number) => string = nf, invert = false): Compare => ({ label, cur: c, prev: p, pct: p > 0 ? Math.round(((c - p) / p) * 100) : null, text: `${text(c)} vs ${text(p)}`, invert });
  const out = [
    row('Pesan total', cur.inbound + cur.outbound, prev.inbound + prev.outbound),
    row('WA Baru', cur.newLeads, prev.newLeads), row('Follow-up', cur.followUps, prev.followUps),
    row('Pesan masuk', cur.inbound, prev.inbound), row('Pesan keluar', cur.outbound, prev.outbound), row('Chat aktif', cur.activeChats, prev.activeChats),
  ];
  if (cur.avgFirstResponseMs != null && prev.avgFirstResponseMs != null) out.push(row('Rata-rata respon', cur.avgFirstResponseMs, prev.avgFirstResponseMs, formatDuration, true));
  return out;
}

// ---------- everything ----------

export interface StatsInput {
  events: MsgEvent[]; interactions: Interaction[]; summary: Summary; prev?: Summary | null;
  accountId?: string; includeGroups?: boolean; accountNames?: Map<string, string>;
}
export interface Stats {
  empty: boolean;
  response: ResponseDist; rate: ResponseRate; funnel: FunnelStep[]; busiest: Busiest;
  inbound: number; outbound: number; inboundShare: number | null; ratio: number | null;
  avgMsgsPerChat: number | null;
  newShare: { newLeads: number; returning: number; newPct: number | null };
  daily: DailyStats; backlog: { streak: number; peak: number };
  accounts: AccountRow[]; compare: Compare[]; insights: string[];
}

export function computeStats(i: StatsInput): Stats {
  const { summary: s } = i;
  const opts: StatsOpts = { accountId: i.accountId, includeGroups: i.includeGroups };
  const leads = newLeadsIn(i.interactions, s.range.from, s.range.to, opts);
  const response = responseDistribution(firstResponseTimes(leads));
  const rate = responseRate(leads);
  const total = s.inbound + s.outbound;
  const returning = Math.max(0, s.activeChats - s.newLeads);
  const stats: Stats = {
    empty: total === 0 && leads.length === 0 && s.activeChats === 0,
    response, rate, funnel: funnel(leads), busiest: busiest(i.events.filter((e) => e.ts >= s.range.from && e.ts < s.range.to), opts),
    inbound: s.inbound, outbound: s.outbound, inboundShare: pct(s.inbound, total),
    ratio: s.outbound > 0 ? Math.round((s.inbound / s.outbound) * 100) / 100 : null,
    avgMsgsPerChat: s.activeChats > 0 ? Math.round((total / s.activeChats) * 10) / 10 : null,
    newShare: { newLeads: s.newLeads, returning, newPct: pct(s.newLeads, s.newLeads + returning) },
    daily: dailyStats(s.days), backlog: backlogStreak(i.interactions, s.range.from, s.range.to, opts),
    accounts: [], compare: compareSummaries(s, i.prev ?? null), insights: [],
  };
  const accs = perAccount(i.events, i.interactions, s.range.from, s.range.to, i.accountNames ?? new Map(), opts);
  stats.accounts = accs.length > 1 ? accs : [];
  stats.insights = buildInsights(stats);
  return stats;
}

export function buildInsights(st: Stats): string[] {
  const out: string[] = [];
  if (st.response.median != null) {
    const w = st.rate.within1hPct;
    out.push(`Median balasan pertama ${formatDuration(st.response.median)}${w != null ? `, ${fmtPct(w)} lead dibalas dalam 1 jam` : ''}.`);
    if (st.response.p90 != null && st.response.n >= 5) out.push(`9 dari 10 lead dibalas dalam ${formatDuration(st.response.p90)} atau kurang.`);
  }
  if (st.rate.leads > 0) {
    const unreplied = st.rate.leads - st.rate.replied;
    out.push(unreplied > 0 ? `${nf(unreplied)} dari ${nf(st.rate.leads)} lead baru belum pernah dibalas (${fmtPct(pct(unreplied, st.rate.leads))}).` : `Semua ${nf(st.rate.leads)} lead baru sudah dibalas.`);
  }
  if (st.busiest.topHour != null) out.push(st.busiest.sentence);
  if (st.avgMsgsPerChat != null) out.push(`Rata-rata ${st.avgMsgsPerChat.toLocaleString('id-ID')} pesan per chat aktif${st.ratio != null ? `; rasio masuk:keluar ${st.ratio.toLocaleString('id-ID')} : 1` : ''}.`);
  if (st.daily.dayCount >= 3 && st.daily.total > 0) {
    const t = st.daily.trend;
    out.push(`Aktivitas ${t.direction === 'stabil' ? 'cenderung stabil' : t.direction} (rata-rata ${nf(Math.round(st.daily.avgPerDay))} pesan/hari${t.direction === 'stabil' ? '' : `, ${t.relative > 0 ? '+' : '-'}${Math.round(Math.abs(t.relative) * 100)}% sepanjang periode`}).`);
  }
  if (st.backlog.streak >= 2) out.push(`Ada chat yang belum pernah dibalas selama ${st.backlog.streak} hari berturut-turut (puncak ${nf(st.backlog.peak)} chat).`);
  const m = st.compare[0];
  if (m && m.pct != null && Math.abs(m.pct) >= 5) out.push(`Total pesan ${m.pct > 0 ? 'naik' : 'turun'} ${Math.abs(m.pct)}% dibanding periode sebelumnya.`);
  if (st.accounts.length > 1) { const top = [...st.accounts].sort((a, b) => b.messages - a.messages)[0]; if (top.messages > 0) out.push(`Akun paling aktif: ${top.name} (${nf(top.messages)} pesan).`); }
  return out;
}

/** Label/value rows for exports (Excel sheet, WA text, PDF/PNG). */
export function statsRows(st: Stats): [string, string][] {
  const d = (ms: number | null) => (ms == null ? '-' : formatDuration(ms));
  const rows: [string, string][] = [
    ['Median balasan pertama', d(st.response.median)], ['Rata-rata balasan pertama', d(st.response.mean)], ['P90 balasan pertama', d(st.response.p90)],
    ['Lead baru dibalas', fmtPct(st.rate.repliedPct)], ['Lead dibalas < 1 jam', fmtPct(st.rate.within1hPct)],
    ...st.funnel.map((f): [string, string] => [`Funnel: ${f.label}`, `${nf(f.count)} (${fmtPct(f.pctOfFirst)})`]),
    ['Jam tersibuk', st.busiest.topHour == null ? '-' : `${pad2(st.busiest.topHour)}.00`], ['Hari tersibuk', st.busiest.topWeekday == null ? '-' : WEEKDAYS_FULL[st.busiest.topWeekday]],
    ['Rasio masuk:keluar', st.ratio == null ? '-' : String(st.ratio)], ['Pesan per chat aktif', st.avgMsgsPerChat == null ? '-' : String(st.avgMsgsPerChat)],
    ['Lead baru vs lama', `${fmtPct(st.newShare.newPct)} baru`], ['Rata-rata pesan per hari', nf(Math.round(st.daily.avgPerDay))], ['Tren', st.daily.trend.direction],
  ];
  return rows;
}
