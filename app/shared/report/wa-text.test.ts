import { describe, expect, it } from 'vitest';
import type { Summary, UnansweredRow } from '../analytics-types';
import type { LeadIntel } from '../lead-intel-logic';
import { buildWaReportText, normalizeWaText, safeWa, splitLong } from './wa-text';

const from = new Date(2026, 10, 1).getTime();
const summary = (): Summary => ({
  range: { key: 'month', from, to: from + 7 * 86400e3 }, newLeads: 12, followUps: 5, inbound: 1234, outbound: 800, activeChats: 40, unanswered: 3, avgFirstResponseMs: 600e3,
  days: Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-0${i + 1}`, newLeads: i, followUps: 1, inbound: 10 * i, outbound: 5 })),
});
const un = (n: number): UnansweredRow[] => Array.from({ length: n }, (_, i) => ({
  key: `a|${i}`, accountId: 'a', chatId: `${i}`, name: i % 2 ? `Budi *${i}*` : '', phone: `62812${i}`, waitingSinceTs: 0, waitingMs: (i + 1) * 3600e3, kind: 'new', inCount: 2, priority: 'high',
}));
const hot = (n: number): LeadIntel[] => Array.from({ length: n }, (_, i) => ({
  key: `a|${i}`, accountId: 'a', chatId: `${i}`, name: `Lead ${i}`, phone: `6281${i}`, lastSender: 'in', lastActivityTs: 1, ourAvgResponseMs: null, theirAvgResponseMs: null, totalMsgs: 9, inCount: 5, outCount: 4, msgs7d: 5,
  engagement: 80, intent: null, temperature: 'hot', momentum: 'rising', followUpPriority: 'urgent', reason: 'Tanya harga _berulang_', nextAction: 'Balas', waitingMs: 1,
}));

describe('wa-text', () => {
  it('builds a compact single part', () => {
    const r = buildWaReportText(summary(), un(3), hot(2), { title: 'Laporan', now: from, accountLabel: 'Toko A' });
    expect(r.parts.length).toBe(1);
    const t = r.text;
    expect(t).toContain('*LAPORAN*');
    expect(t).toContain('Periode: 1 Nov 2026 - 7 Nov 2026');
    expect(t).toContain('Akun: Toko A');
    expect(t).toContain('*Belum dibalas* (3)');
    expect(t).toContain('*Lead panas* (2)');
    expect(t).toMatch(/```\n[\s\S]*?\n```/);
    expect(t).not.toMatch(/\n{3,}/);
    expect(t).not.toMatch(/[ \t]+\n/);
    expect(t).toContain('1.234');
  });
  it('mono lines stay within 32 chars', () => {
    const t = buildWaReportText(summary(), [], [], { now: from, prev: { ...summary(), newLeads: 6 } }).text;
    for (const blk of t.match(/```\n[\s\S]*?\n```/g)!) for (const l of blk.split('\n').slice(1, -1)) expect(l.length).toBeLessThanOrEqual(32);
    expect(t).toContain('▲100%');
  });
  it('top-N limit and strips markup from user data', () => {
    const t = buildWaReportText(summary(), un(25), [], { topN: 5, now: from }).text;
    expect(t).toContain('5. ');
    expect(t).not.toContain('6. ');
    expect(t).toContain('+ 20 lainnya');
    expect(t).not.toContain('Budi *');
  });
  it('splits into labelled parts under limit', () => {
    const r = buildWaReportText(summary(), un(200), hot(200), { topN: 200, now: from, maxPartLength: 1500 });
    expect(r.parts.length).toBeGreaterThan(1);
    r.parts.forEach((p, i) => { expect(p.length).toBeLessThan(1500); expect(p).toContain(`Bagian ${i + 1}/${r.parts.length}`); });
    for (const p of r.parts) expect((p.match(/```/g) ?? []).length % 2).toBe(0);
  });
  it('default parts < 4000', () => {
    const r = buildWaReportText(summary(), un(300), hot(300), { topN: 300, now: from });
    for (const p of r.parts) expect(p.length).toBeLessThan(4000);
  });
  it('respects sections', () => {
    const t = buildWaReportText(summary(), un(3), hot(2), { now: from, sections: { kpi: false, charts: false, heatmap: false, unanswered: true, hot: false, interactions: false } }).text;
    expect(t).not.toContain('*Ringkasan*');
    expect(t).not.toContain('Lead panas');
    expect(t).toContain('Belum dibalas');
  });
  it('helpers', () => {
    expect(normalizeWaText('a  \r\n\r\n\r\n\r\nb \n')).toBe('a\n\nb');
    expect(safeWa(' a*b_c`d~  e ')).toBe('abcd e');
    const parts = splitLong('```\n' + Array.from({ length: 100 }, (_, i) => `row ${i}`).join('\n') + '\n```', 200);
    expect(parts.length).toBeGreaterThan(1);
    parts.forEach((p) => { expect(p.length).toBeLessThanOrEqual(200); expect((p.match(/```/g) ?? []).length % 2).toBe(0); });
  });
});
