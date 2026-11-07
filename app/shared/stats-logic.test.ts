import { describe, expect, it } from 'vitest';
import type { Interaction, MsgEvent, Summary } from './analytics-types';
import { summarize } from './analytics-logic';
import {
  backlogStreak, busiest, compareSummaries, computeStats, dailyStats, firstResponseTimes, funnel, newLeadsIn, percentile, perAccount, pct,
  responseDistribution, responseRate, statsRows, trendOf,
} from './stats-logic';

const MIN = 60e3, HOUR = 3600e3, DAY = 86400e3;
const T0 = new Date(2026, 10, 2, 9, 0).getTime(); // Mon 2 Nov 2026 09:00
const range = { key: 'month' as const, from: new Date(2026, 10, 1).getTime(), to: new Date(2026, 10, 8).getTime() };
const mkI = (o: Partial<Interaction> & { key: string }): Interaction => ({
  accountId: 'a', chatId: o.key, name: o.key, phone: o.key, isGroup: false, firstInTs: null, firstOutTs: null, lastInTs: null, lastOutTs: null, inCount: 0, outCount: 0, partialHistory: false, ...o,
});
let seq = 0;
const ev = (ts: number, dir: 'in' | 'out' = 'in', extra: Partial<MsgEvent> = {}): MsgEvent => ({ key: `k${seq++}`, accountId: 'a', chatId: 'c', ts, dir, isGroup: false, ...extra });

describe('responseDistribution', () => {
  it('buckets, median, mean, p90', () => {
    const d = responseDistribution([1 * MIN, 10 * MIN, 30 * MIN, 2 * HOUR, 10 * HOUR, 30 * HOUR]);
    expect(d.buckets.map((b) => b.count)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(d.n).toBe(6);
    expect(d.median).toBe((30 * MIN + 2 * HOUR) / 2);
    expect(d.p90).toBe(30 * HOUR);
    expect(d.mean).toBeCloseTo((1 * MIN + 10 * MIN + 30 * MIN + 2 * HOUR + 10 * HOUR + 30 * HOUR) / 6);
  });
  it('bucket edges are lower-inclusive', () => {
    const d = responseDistribution([5 * MIN, 15 * MIN, HOUR, 4 * HOUR, DAY]);
    expect(d.buckets.map((b) => b.count)).toEqual([0, 1, 1, 1, 1, 1]);
  });
  it('empty / junk input', () => {
    const d = responseDistribution([]);
    expect(d).toMatchObject({ n: 0, median: null, mean: null, p90: null });
    expect(d.buckets.length).toBe(6);
    expect(responseDistribution([NaN, -5, Infinity]).n).toBe(0);
  });
  it('single value', () => { const d = responseDistribution([7 * MIN]); expect(d.median).toBe(7 * MIN); expect(d.p90).toBe(7 * MIN); });
  it('percentile edges', () => { expect(percentile([], 90)).toBeNull(); expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9); expect(percentile([5], 0)).toBe(5); });
});

describe('leads, rate and funnel', () => {
  const list = [
    mkI({ key: '1', firstInTs: T0, firstOutTs: T0 + 10 * MIN, lastInTs: T0 + HOUR, lastOutTs: T0 + 2 * HOUR, inCount: 3, outCount: 3 }),
    mkI({ key: '2', firstInTs: T0, firstOutTs: T0 + 3 * HOUR, lastInTs: T0, lastOutTs: T0 + 3 * HOUR, inCount: 1, outCount: 1 }),
    mkI({ key: '3', firstInTs: T0, lastInTs: T0, inCount: 1 }),
    mkI({ key: '4', firstInTs: T0 - 40 * DAY, firstOutTs: T0 - 39 * DAY, inCount: 2, outCount: 1 }),
    mkI({ key: '5', firstOutTs: T0 - DAY, firstInTs: T0, lastInTs: T0, inCount: 1, outCount: 1 }),
    mkI({ key: 'g', isGroup: true, firstInTs: T0, lastInTs: T0, inCount: 1 }),
  ];
  const leads = newLeadsIn(list, range.from, range.to);
  it('new lead selection excludes groups, old and outbound-first', () => {
    expect(leads.map((l) => l.key)).toEqual(['1', '2', '3']);
    expect(newLeadsIn(list, range.from, range.to, { includeGroups: true }).length).toBe(4);
  });
  it('first response times', () => expect(firstResponseTimes(leads)).toEqual([10 * MIN, 3 * HOUR]));
  it('rate', () => expect(responseRate(leads)).toEqual({ leads: 3, replied: 2, within1h: 1, repliedPct: 66.7, within1hPct: 33.3 }));
  it('funnel', () => {
    const f = funnel(leads);
    expect(f.map((s) => s.count)).toEqual([3, 2, 1, 1]);
    expect(f[1].pctOfFirst).toBe(66.7); expect(f[2].pctOfPrev).toBe(50); expect(f[0].pctOfPrev).toBeNull();
  });
  it('empty', () => {
    expect(responseRate([])).toEqual({ leads: 0, replied: 0, within1h: 0, repliedPct: null, within1hPct: null });
    expect(funnel([]).every((s) => s.count === 0 && s.pctOfFirst == null)).toBe(true);
  });
  it('pct guards zero denominator', () => { expect(pct(1, 0)).toBeNull(); expect(pct(1, 3)).toBe(33.3); });
});

describe('busiest', () => {
  it('finds hour and weekday and writes the sentence', () => {
    const b = busiest([ev(T0), ev(T0 + 5 * MIN), ev(T0 + 10 * MIN), ev(T0 + DAY + 5 * HOUR), ev(T0, 'out')]);
    expect(b.total).toBe(4); expect(b.topHour).toBe(9); expect(b.topWeekday).toBe(1);
    expect(b.sentence).toContain('09.00-10.00'); expect(b.sentence).toContain('Senin'); expect(b.sentence).toContain('75%');
  });
  it('ignores groups unless included and handles empty', () => {
    expect(busiest([ev(T0, 'in', { isGroup: true })]).topHour).toBeNull();
    expect(busiest([ev(T0, 'in', { isGroup: true })], { includeGroups: true }).topHour).toBe(9);
    const e = busiest([]);
    expect(e.topHour).toBeNull(); expect(e.sentence).toMatch(/Belum ada/);
  });
  it('wraps 23 to 00', () => expect(busiest([ev(new Date(2026, 10, 2, 23, 30).getTime())]).sentence).toContain('23.00-00.00'));
});

describe('trend and daily', () => {
  it('direction words', () => {
    expect(trendOf([1, 2, 3, 4, 5, 6]).direction).toBe('naik');
    expect(trendOf([6, 5, 4, 3, 2, 1]).direction).toBe('turun');
    expect(trendOf([5, 5, 5, 5]).direction).toBe('stabil');
    expect(trendOf([5, 6, 5, 6, 5, 6, 5]).direction).toBe('stabil');
    expect(trendOf([1, 2]).direction).toBe('stabil');
    expect(trendOf([0, 0, 0, 0])).toEqual({ slope: 0, relative: 0, direction: 'stabil' });
    expect(trendOf([1, 2, 3, 4, 5, 6]).slope).toBeCloseTo(1);
  });
  it('dailyStats best/worst/avg', () => {
    const days = [{ date: '2026-11-01', newLeads: 0, followUps: 0, inbound: 5, outbound: 5 }, { date: '2026-11-02', newLeads: 0, followUps: 0, inbound: 1, outbound: 0 }, { date: '2026-11-03', newLeads: 0, followUps: 0, inbound: 20, outbound: 10 }];
    const d = dailyStats(days);
    expect(d.best).toEqual({ date: '2026-11-03', total: 30 }); expect(d.worst).toEqual({ date: '2026-11-02', total: 1 });
    expect(d.avgPerDay).toBeCloseTo(41 / 3); expect(d.trend.direction).toBe('naik');
  });
  it('dailyStats empty', () => { expect(dailyStats([])).toMatchObject({ dayCount: 0, avgPerDay: 0, best: null, worst: null }); });
});

describe('backlogStreak', () => {
  it('counts consecutive days ending at range end', () => {
    expect(backlogStreak([mkI({ key: 'x', firstInTs: new Date(2026, 10, 5, 10).getTime() })], range.from, range.to)).toEqual({ streak: 3, peak: 1 });
  });
  it('resets when replied', () => {
    const list = [mkI({ key: 'x', firstInTs: new Date(2026, 10, 2, 10).getTime(), firstOutTs: new Date(2026, 10, 3, 10).getTime() })];
    expect(backlogStreak(list, range.from, range.to).streak).toBe(0);
  });
  it('empty and degenerate range', () => {
    expect(backlogStreak([], range.from, range.to)).toEqual({ streak: 0, peak: 0 });
    expect(backlogStreak([mkI({ key: 'x', firstInTs: 1 })], 10, 10)).toEqual({ streak: 0, peak: 0 });
  });
});

describe('perAccount and compare', () => {
  it('groups by account', () => {
    const list = [
      mkI({ key: '1', accountId: 'a', firstInTs: T0, firstOutTs: T0 + 10 * MIN, lastInTs: T0, lastOutTs: T0 + 10 * MIN, inCount: 1, outCount: 1 }),
      mkI({ key: '2', accountId: 'b', firstInTs: T0, lastInTs: T0, inCount: 1 }),
    ];
    const rows = perAccount([ev(T0, 'in', { accountId: 'a' }), ev(T0, 'in', { accountId: 'b' }), ev(T0, 'out', { accountId: 'b' })], list, range.from, range.to, new Map([['a', 'Toko A']]));
    expect(rows).toEqual([
      { accountId: 'a', name: 'Toko A', messages: 1, newLeads: 1, medianMs: 10 * MIN, unanswered: 0 },
      { accountId: 'b', name: 'b', messages: 2, newLeads: 1, medianMs: null, unanswered: 1 },
    ]);
  });
  it('empty', () => expect(perAccount([], [], 0, 1, new Map())).toEqual([]));
  const mk = (n: number, resp: number | null): Summary => ({ range, newLeads: n, followUps: n, inbound: n * 2, outbound: n, activeChats: n, unanswered: 0, avgFirstResponseMs: resp, days: [] });
  it('compareSummaries', () => {
    expect(compareSummaries(mk(1, 1), null)).toEqual([]);
    const c = compareSummaries(mk(10, 600e3), mk(5, 1200e3));
    expect(c[0]).toMatchObject({ label: 'Pesan total', cur: 30, prev: 15, pct: 100 });
    expect(c[c.length - 1]).toMatchObject({ label: 'Rata-rata respon', pct: -50, invert: true });
    expect(compareSummaries(mk(3, null), mk(0, null))[0].pct).toBeNull();
  });
});

describe('computeStats', () => {
  const interactions = [
    mkI({ key: '1', firstInTs: T0, firstOutTs: T0 + 12 * MIN, lastInTs: T0 + HOUR, lastOutTs: T0 + 2 * HOUR, inCount: 3, outCount: 3 }),
    mkI({ key: '2', firstInTs: T0 + DAY, firstOutTs: T0 + DAY + 30 * MIN, lastInTs: T0 + DAY, lastOutTs: T0 + DAY + 30 * MIN, inCount: 1, outCount: 1 }),
    mkI({ key: '3', firstInTs: T0 + 2 * DAY, lastInTs: T0 + 2 * DAY, inCount: 1 }),
  ];
  const events = [ev(T0), ev(T0 + 12 * MIN, 'out'), ev(T0 + DAY), ev(T0 + 2 * DAY), ev(T0 + 2 * DAY + MIN)];
  it('produces consistent stats with Indonesian insights', () => {
    const summary = summarize(events, interactions, range);
    const st = computeStats({ events, interactions, summary, prev: summarize([], [], { ...range, from: range.from - 7 * DAY, to: range.from }) });
    expect(st.empty).toBe(false);
    expect(st.rate).toMatchObject({ leads: 3, replied: 2 });
    expect(st.response.median).toBe(21 * MIN);
    expect(st.insights.join(' ')).toContain('Median balasan pertama 21 mnt');
    expect(st.insights.join(' ')).toContain('Jam sibuk');
    expect(st.backlog.streak).toBeGreaterThanOrEqual(1);
    expect(st.accounts).toEqual([]);
    expect(statsRows(st).length).toBeGreaterThan(10);
    expect(JSON.stringify(st)).not.toMatch(/NaN|Infinity/);
  });
  it('empty data is safe and friendly', () => {
    const st = computeStats({ events: [], interactions: [], summary: summarize([], [], range) });
    expect(st.empty).toBe(true);
    expect(st.insights).toEqual([]);
    expect(st.ratio).toBeNull(); expect(st.avgMsgsPerChat).toBeNull(); expect(st.newShare.newPct).toBeNull();
    expect(st.daily.avgPerDay).toBe(0);
    expect(JSON.stringify(st, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? 'BAD' : v))).not.toMatch(/BAD|NaN/);
    expect(statsRows(st).every(([, v]) => !/NaN|Infinity/.test(v))).toBe(true);
  });
  it('outbound only never divides by zero', () => {
    const e = [ev(T0, 'out')];
    const st = computeStats({ events: e, interactions: [], summary: summarize(e, [], range) });
    expect(st.ratio).toBe(0); expect(st.inboundShare).toBe(0);
    expect(Number.isFinite(st.daily.avgPerDay) && Number.isFinite(st.daily.trend.slope)).toBe(true);
  });
  it('multiple accounts yield a comparison table', () => {
    const ints = [mkI({ key: '1', accountId: 'a', firstInTs: T0, lastInTs: T0, inCount: 1 }), mkI({ key: '2', accountId: 'b', firstInTs: T0, lastInTs: T0, inCount: 1 })];
    const e = [ev(T0, 'in', { accountId: 'a' }), ev(T0, 'in', { accountId: 'b' })];
    const st = computeStats({ events: e, interactions: ints, summary: summarize(e, ints, range), accountNames: new Map([['a', 'A'], ['b', 'B']]) });
    expect(st.accounts.map((r) => r.name)).toEqual(['A', 'B']);
    expect(st.insights.join(' ')).toContain('Akun paling aktif');
  });
});
