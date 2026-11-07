import { describe, expect, it } from 'vitest';
import type { Interaction, MsgEvent } from './analytics-types';
import {
  buildUnanswered, classifyInteraction, dayKeyOf, exportInteractionsCsv, exportReportCsv, exportUnansweredCsv,
  formatDuration, leadDayOf, mergeInteraction, parseCsv, parseReportCsv, priorityOf, reportTemplateCsv, resolveRange,
  summarize, toCsv,
} from './analytics-logic';

const L = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const H = 3600e3;

function mk(p: Partial<Interaction> & { chatId: string }): Interaction {
  return {
    key: `A|${p.chatId}`, accountId: 'A', name: p.chatId, phone: '', isGroup: false,
    firstInTs: null, firstOutTs: null, lastInTs: null, lastOutTs: null, inCount: 0, outCount: 0, partialHistory: false, ...p,
  };
}
const ev = (chatId: string, ts: number, dir: 'in' | 'out', extra: Partial<MsgEvent> = {}): MsgEvent =>
  ({ key: `A|${chatId}${ts}${dir}`, accountId: 'A', chatId, ts, dir, isGroup: false, ...extra });

describe('resolveRange', () => {
  const now = L(2026, 3, 15, 14, 30);
  it('today', () => {
    const r = resolveRange('today', now);
    expect(r.from).toBe(L(2026, 3, 15)); expect(r.to).toBe(L(2026, 3, 16));
  });
  it('week = 7 local days incl. today', () => {
    const r = resolveRange('week', now);
    expect(r.from).toBe(L(2026, 3, 9)); expect(r.to).toBe(L(2026, 3, 16));
  });
  it('month/year to date', () => {
    expect(resolveRange('month', now).from).toBe(L(2026, 3, 1));
    expect(resolveRange('year', now).from).toBe(L(2026, 1, 1));
    expect(resolveRange('year', now).to).toBe(L(2026, 3, 16));
  });
  it('all and custom', () => {
    expect(resolveRange('all', now, undefined, 500)).toEqual({ key: 'all', from: 500, to: now + 1 });
    expect(resolveRange('all', now).from).toBe(0);
    expect(resolveRange('custom', now, { from: 1, to: 2 })).toEqual({ key: 'custom', from: 1, to: 2 });
  });
  it('month boundary crossing', () => {
    expect(resolveRange('week', L(2026, 3, 2)).from).toBe(L(2026, 2, 24));
  });
});

describe('classify / leadDay', () => {
  it('never replied is new', () => {
    expect(classifyInteraction(mk({ chatId: 'a', firstInTs: 1, lastInTs: 1 }))).toBe('new');
  });
  it('replied then wrote again is followup', () => {
    expect(classifyInteraction(mk({ chatId: 'a', firstInTs: 1, firstOutTs: 2, lastInTs: 5, lastOutTs: 2 }))).toBe('followup');
  });
  it('replied and quiet is existing', () => {
    expect(classifyInteraction(mk({ chatId: 'a', firstInTs: 1, firstOutTs: 2, lastInTs: 1, lastOutTs: 3 }))).toBe('existing');
    expect(classifyInteraction(mk({ chatId: 'a', firstOutTs: 2, lastOutTs: 2 }))).toBe('existing');
  });
  it('leadDayOf', () => {
    const t = L(2026, 1, 5, 10);
    expect(leadDayOf(mk({ chatId: 'a', firstInTs: t }))).toBe('2026-01-05');
    expect(leadDayOf(mk({ chatId: 'a', firstInTs: t, firstOutTs: t + H }))).toBe('2026-01-05'); // replied later
    expect(leadDayOf(mk({ chatId: 'a', firstInTs: t, firstOutTs: t - H }))).toBeNull();          // we wrote first
    expect(leadDayOf(mk({ chatId: 'a', firstOutTs: t }))).toBeNull();
  });
});

describe('summarize', () => {
  const now = L(2026, 3, 15, 14);
  const range = resolveRange('week', now);
  const d = (day: number, h = 10) => L(2026, 3, day, h);
  const a = mk({ chatId: 'a', firstInTs: d(15), firstOutTs: d(15, 11), lastInTs: d(15), lastOutTs: d(15, 11), inCount: 1, outCount: 1 }); // new today, replied in 1h
  const b = mk({ chatId: 'b', firstInTs: d(1), firstOutTs: d(1, 11), lastInTs: d(14), lastOutTs: d(1, 11), inCount: 3, outCount: 1 }); // old, follow-up on 14
  const c = mk({ chatId: 'c', firstInTs: d(13), lastInTs: d(13), inCount: 1 }); // new on 13, unanswered
  const g = mk({ chatId: 'g', isGroup: true, firstInTs: d(13), lastInTs: d(13), inCount: 1 });
  const events: MsgEvent[] = [
    ev('a', d(15), 'in'), ev('a', d(15, 11), 'out'),
    ev('b', d(14), 'in'), ev('b', d(14, 2), 'in'),
    ev('c', d(13), 'in'),
    ev('g', d(13), 'in', { isGroup: true }),
    ev('b', d(1), 'in'), // outside range
  ];
  const s = summarize(events, [a, b, c, g], range);
  it('counts', () => {
    expect(s.newLeads).toBe(2);
    expect(s.followUps).toBe(1);
    expect(s.inbound).toBe(4);
    expect(s.outbound).toBe(1);
    expect(s.activeChats).toBe(3);
    expect(s.unanswered).toBe(2); // b (lastIn>lastOut) and c
    expect(s.avgFirstResponseMs).toBe(H);
  });
  it('zero-filled days', () => {
    expect(s.days).toHaveLength(7);
    expect(s.days[0].date).toBe('2026-03-09');
    expect(s.days.find((x) => x.date === '2026-03-13')).toMatchObject({ newLeads: 1, inbound: 1 });
    expect(s.days.find((x) => x.date === '2026-03-14')).toMatchObject({ followUps: 1, inbound: 2 });
    expect(s.days.find((x) => x.date === '2026-03-10')).toMatchObject({ newLeads: 0, inbound: 0 });
  });
  it('same-day inbound after reply on lead day is not a follow-up', () => {
    const e2 = [ev('a', d(15), 'in'), ev('a', d(15, 11), 'out'), ev('a', d(15, 12), 'in')];
    expect(summarize(e2, [a], range).followUps).toBe(0);
  });
  it('groups and account filter', () => {
    const s2 = summarize(events, [a, b, c, g], range, { includeGroups: true });
    expect(s2.newLeads).toBe(3);
    expect(summarize(events, [a, b, c, g], range, { accountId: 'Z' }).newLeads).toBe(0);
  });
  it('long ranges list only non-empty days', () => {
    const r = resolveRange('all', now, undefined, L(2020, 1, 1));
    const s3 = summarize(events, [a, b, c], r);
    expect(s3.days.length).toBeLessThan(10);
    expect(s3.days.every((x) => x.inbound + x.outbound + x.newLeads + x.followUps > 0)).toBe(true);
  });
});

describe('buildUnanswered / priority / duration', () => {
  const now = L(2026, 3, 15, 12);
  it('filters and sorts', () => {
    const rows = buildUnanswered([
      mk({ chatId: 'x', lastInTs: now - 2 * H, firstInTs: now - 2 * H }),
      mk({ chatId: 'y', lastInTs: now - 30 * H, firstInTs: now - 40 * H, firstOutTs: now - 39 * H, lastOutTs: now - 39 * H }),
      mk({ chatId: 'z', lastInTs: now - H, lastOutTs: now }),
      mk({ chatId: 'w', lastOutTs: now }),
      mk({ chatId: 'grp', isGroup: true, lastInTs: now - H, firstInTs: now - H }),
    ], now);
    expect(rows.map((r) => r.chatId)).toEqual(['y', 'x']);
    expect(rows[0]).toMatchObject({ kind: 'followup', priority: 'urgent' });
    expect(rows[1]).toMatchObject({ kind: 'new', priority: 'high' });
    expect(buildUnanswered([mk({ chatId: 'grp', isGroup: true, lastInTs: 1, firstInTs: 1 })], now, { includeGroups: true })).toHaveLength(1);
  });
  it('priorityOf', () => {
    expect(priorityOf(30 * 60e3, 'existing')).toBe('low');
    expect(priorityOf(1 * H, 'existing')).toBe('normal');
    expect(priorityOf(6 * H, 'followup')).toBe('high');
    expect(priorityOf(24 * H, 'existing')).toBe('urgent');
    expect(priorityOf(30 * 60e3, 'new')).toBe('normal');
    expect(priorityOf(100 * H, 'new')).toBe('urgent');
  });
  it('formatDuration', () => {
    expect(formatDuration(10e3)).toBe('<1 mnt');
    expect(formatDuration(45 * 60e3)).toBe('45 mnt');
    expect(formatDuration(2 * H + 15 * 60e3)).toBe('2 j 15 mnt');
    expect(formatDuration(2 * H)).toBe('2 j');
    expect(formatDuration(76 * H)).toBe('3 hr 4 j');
    expect(formatDuration(48 * H)).toBe('2 hr');
  });
});

describe('CSV', () => {
  it('escapes and guards', () => {
    const out = toCsv([{ a: '=SUM(1)', b: 'x,"y"', c: -5, d: '-12.5', e: '-abc', f: '+62812', g: 'l1\nl2' }], ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(out).toBe('a,b,c,d,e,f,g\r\n\'=SUM(1),"x,""y""",-5,-12.5,\'-abc,\'+62812,"l1\nl2"');
  });
  it('parseCsv handles BOM, CRLF, quotes, blanks', () => {
    expect(parseCsv('﻿a,b\r\n"x,1","he said ""hi"""\r\n\r\nz,\r\n')).toEqual([['a', 'b'], ['x,1', 'he said "hi"'], ['z', '']]);
    expect(parseCsv('a,b\n"m\nn",2')).toEqual([['a', 'b'], ['m\nn', '2']]);
    expect(parseCsv('')).toEqual([]);
  });
  it('roundtrips toCsv/parseCsv', () => {
    const rows = [{ a: 'x,y', b: 'q"r' }];
    expect(parseCsv(toCsv(rows, ['a', 'b']))).toEqual([['a', 'b'], ['x,y', 'q"r']]);
  });
});

describe('report import/export', () => {
  it('template parses cleanly', () => {
    const r = parseReportCsv(reportTemplateCsv());
    expect(r.errors).toEqual([]);
    expect(r.interactions).toHaveLength(2);
    expect(r.interactions[0]).toMatchObject({ key: '628111111111@c.us|628122222222@c.us', phone: '628122222222', partialHistory: true, inCount: 5, outCount: 4 });
    expect(r.interactions[1].firstOutTs).toBeNull();
  });
  it('reports row errors', () => {
    const csv = 'account_id,chat_id,name,phone,first_in,first_out,last_in,last_out,in_count,out_count\n'
      + 'A,1@c.us,n,abc,2026-01-01T00:00:00Z,,,,x,0\n'
      + ',2@c.us,n,,2026-01-01T00:00:00Z,,,,1,0\n'
      + 'A,3@c.us,n,,notadate,,,,1,0\n'
      + 'A,4@c.us,n,+62 811-111,2026-01-01T00:00:00Z,,,,1,0\n';
    const r = parseReportCsv(csv);
    expect(r.interactions).toHaveLength(1);
    expect(r.interactions[0].phone).toBe('62811111');
    expect(r.errors).toHaveLength(3);
    expect(r.errors[0]).toMatch(/^Baris 2/);
  });
  it('missing columns', () => {
    expect(parseReportCsv('foo,bar\n1,2').errors[0]).toMatch(/Kolom wajib/);
    expect(parseReportCsv('').errors).toHaveLength(1);
  });
  it('export interactions roundtrips', () => {
    const list = parseReportCsv(reportTemplateCsv()).interactions;
    const again = parseReportCsv(exportInteractionsCsv(list));
    expect(again.errors).toEqual([]);
    expect(again.interactions).toEqual(list);
  });
  it('exportReportCsv / exportUnansweredCsv', () => {
    const s = summarize([], [], resolveRange('today', L(2026, 3, 15, 9)));
    expect(exportReportCsv(s)).toBe('date,new_leads,follow_ups,inbound,outbound\r\n2026-03-15,0,0,0,0\r\nTOTAL,0,0,0,0');
    const rows = buildUnanswered([mk({ chatId: 'x', name: '=bad', lastInTs: 0, firstInTs: 0 })], 2 * H);
    expect(exportUnansweredCsv(rows)).toContain("'=bad");
  });
});

describe('mergeInteraction', () => {
  const base = mk({ chatId: 'a', firstInTs: 10, firstOutTs: 20, lastInTs: 50, lastOutTs: 40, inCount: 5, outCount: 2 });
  it('returns next when no prev', () => expect(mergeInteraction(undefined, base)).toBe(base));
  it('min firsts, max lasts, max counts, partial sticky', () => {
    const m = mergeInteraction(base, mk({ chatId: 'a', name: 'New', firstInTs: 5, firstOutTs: null, lastInTs: 30, lastOutTs: 60, inCount: 3, outCount: 4, partialHistory: true }));
    expect(m).toMatchObject({ firstInTs: 5, firstOutTs: 20, lastInTs: 50, lastOutTs: 60, inCount: 5, outCount: 4, partialHistory: true, name: 'New' });
  });
  it('dayKeyOf is local', () => expect(dayKeyOf(L(2026, 12, 31, 23, 59))).toBe('2026-12-31'));
});
