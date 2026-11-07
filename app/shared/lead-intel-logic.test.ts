import { describe, expect, it } from 'vitest';
import type { Interaction, MsgEvent } from './analytics-types';
import type { Contact } from './crm-types';
import {
  computeAll, computeLeadIntel, detectIntent, engagementScore, exportLeadIntelCsv, hotLeads, momentumOf,
  rankFollowUps, responseGaps, slippingLeads, temperatureOf, type LeadIntel,
} from './lead-intel-logic';

const H = 3600e3, D = 24 * H, MIN = 60e3;
const NOW = Date.UTC(2026, 2, 15, 12, 0);
const ev = (ts: number, dir: 'in' | 'out', chatId = 'c1'): MsgEvent => ({ key: `A|${chatId}${ts}${dir}`, accountId: 'A', chatId, ts, dir, isGroup: false });
function mkI(chatId: string, evs: MsgEvent[]): Interaction {
  const ins = evs.filter((e) => e.dir === 'in'), outs = evs.filter((e) => e.dir === 'out');
  const mx = (a: MsgEvent[]) => (a.length ? Math.max(...a.map((e) => e.ts)) : null);
  const mn = (a: MsgEvent[]) => (a.length ? Math.min(...a.map((e) => e.ts)) : null);
  return { key: `A|${chatId}`, accountId: 'A', chatId, name: chatId, phone: '62811', isGroup: false, firstInTs: mn(ins), firstOutTs: mn(outs),
    lastInTs: mx(ins), lastOutTs: mx(outs), inCount: ins.length, outCount: outs.length, partialHistory: false };
}
const contact = (p: Partial<Contact> = {}): Contact => ({ key: 'A|c1', accountId: 'A', chatId: 'c1', name: 'C', phone: '62811', stage: 'Lead baru', tags: [], value: 0,
  assignee: '', optOut: false, createdAt: 0, updatedAt: 0, lastContactAt: null, ...p });

describe('detectIntent', () => {
  it('null without snippet', () => { expect(detectIntent(undefined)).toBeNull(); expect(detectIntent('  ')).toBeNull(); });
  it.each([
    ['Berapa harganya kak?', 'tanya-harga'], ['mau order 2 ya', 'siap-beli'], ['sudah transfer kak', 'siap-beli'],
    ['barang rusak, saya kecewa', 'komplain'], ['minta refund', 'komplain'], ['stok ready?', 'tanya-info'],
    ['ok terima kasih', 'lainnya'], ['Harga berapa? mau beli', 'siap-beli'],
  ])('%s -> %s', (t, i) => { expect(detectIntent(t)).toBe(i); });
  it('komplain beats buying words', () => { expect(detectIntent('pesanan lambat, mau refund')).toBe('komplain'); });
  it('no substring false positives', () => { expect(detectIntent('terdeal')).toBe('lainnya'); });
});

describe('responseGaps', () => {
  it('measures from first msg of previous run', () => {
    const g = responseGaps([ev(0, 'in'), ev(10 * MIN, 'in'), ev(30 * MIN, 'out'), ev(90 * MIN, 'in')]);
    expect(g).toEqual([{ ts: 30 * MIN, ms: 30 * MIN, who: 'our' }, { ts: 90 * MIN, ms: 60 * MIN, who: 'their' }]);
  });
  it('ignores gaps over 7 days and empty', () => {
    expect(responseGaps([])).toEqual([]);
    expect(responseGaps([ev(0, 'in'), ev(8 * D, 'out')])).toEqual([]);
  });
});

describe('engagementScore', () => {
  const base = { ageMs: 0, inCount: 10, outCount: 10, msgs7d: 20, theirAvgMs: 5 * MIN, stage: 'Deal', value: 2e6 };
  it('maxes at 100', () => { expect(engagementScore(base)).toBe(100); });
  it('is 0 with nothing', () => { expect(engagementScore({ ageMs: null, inCount: 0, outCount: 0, msgs7d: 0, theirAvgMs: null })).toBe(0); });
  it('recency halves every 5 days', () => {
    const z = { inCount: 0, outCount: 0, msgs7d: 0, theirAvgMs: null };
    expect(engagementScore({ ...z, ageMs: 0 })).toBe(30);
    expect(engagementScore({ ...z, ageMs: 5 * D })).toBe(15);
  });
  it('one-sided has no reciprocity', () => {
    expect(engagementScore({ ageMs: null, inCount: 5, outCount: 0, msgs7d: 0, theirAvgMs: null })).toBe(0);
    expect(engagementScore({ ageMs: null, inCount: 5, outCount: 5, msgs7d: 0, theirAvgMs: null })).toBe(20);
  });
  it('speed tiers and stage/value cap', () => {
    const z = { ageMs: null, inCount: 0, outCount: 0, msgs7d: 0 };
    expect(engagementScore({ ...z, theirAvgMs: 5 * MIN })).toBe(15);
    expect(engagementScore({ ...z, theirAvgMs: 30 * MIN })).toBe(11);
    expect(engagementScore({ ...z, theirAvgMs: 3 * H })).toBe(7);
    expect(engagementScore({ ...z, theirAvgMs: 12 * H })).toBe(3);
    expect(engagementScore({ ...z, theirAvgMs: 3 * D })).toBe(0);
    expect(engagementScore({ ...z, theirAvgMs: null, stage: 'Deal', value: 5e6 })).toBe(15);
    expect(engagementScore({ ...z, theirAvgMs: null, stage: 'Negosiasi', value: 100 })).toBe(11);
  });
});

describe('temperatureOf', () => {
  const p = { ageMs: H, lastSender: 'in' as const, intent: null, engagement: 10, inCount: 1 };
  it('hot with buying intent and recent inbound', () => { expect(temperatureOf({ ...p, intent: 'siap-beli' })).toBe('hot'); });
  it('hot with high engagement', () => { expect(temperatureOf({ ...p, engagement: 60 })).toBe('hot'); });
  it('not hot if inbound too old', () => { expect(temperatureOf({ ...p, ageMs: 3 * D, intent: 'siap-beli', engagement: 10 })).toBe('cold'); });
  it('hot on very high engagement even if we spoke last', () => { expect(temperatureOf({ ...p, lastSender: 'out', ageMs: 2 * D, engagement: 75 })).toBe('hot'); });
  it('opt-out never hot', () => { expect(temperatureOf({ ...p, intent: 'siap-beli', engagement: 90, optOut: true })).toBe('warm'); });
  it('warm / cold / dormant', () => {
    expect(temperatureOf({ ...p, lastSender: 'out', ageMs: 5 * D, engagement: 40 })).toBe('warm');
    expect(temperatureOf({ ...p, lastSender: 'out', ageMs: 5 * D, engagement: 10 })).toBe('cold');
    expect(temperatureOf({ ...p, ageMs: 14 * D })).toBe('dormant');
    expect(temperatureOf({ ...p, ageMs: null })).toBe('dormant');
  });
});

describe('momentumOf', () => {
  it('rising', () => {
    const e = [ev(NOW - 5 * D, 'in'), ev(NOW - 1 * D, 'in'), ev(NOW - 1 * D + MIN, 'out'), ev(NOW - 2 * H, 'in')];
    expect(momentumOf(e, NOW, 2 * H)).toBe('rising');
  });
  it('slipping when volume halves', () => {
    const e = [ev(NOW - 5 * D, 'in'), ev(NOW - 4.9 * D, 'out'), ev(NOW - 4.5 * D, 'in'), ev(NOW - 4.4 * D, 'out'), ev(NOW - 1 * D, 'in')];
    expect(momentumOf(e, NOW, D)).toBe('slipping');
  });
  it('slipping when latency doubles', () => {
    const e = [ev(NOW - 4.5 * D, 'in'), ev(NOW - 4.5 * D + 5 * MIN, 'out'), ev(NOW - 2 * D, 'in'), ev(NOW - 2 * D + 3 * H, 'out')];
    expect(momentumOf(e, NOW, 2 * D)).toBe('slipping');
  });
  it('stalled after 7 days or no data; steady otherwise', () => {
    expect(momentumOf([ev(NOW - 8 * D, 'in')], NOW, 8 * D)).toBe('stalled');
    expect(momentumOf([], NOW, null)).toBe('stalled');
    expect(momentumOf([ev(NOW - 2 * D, 'in')], NOW, 2 * D)).toBe('steady');
  });
});

describe('computeLeadIntel', () => {
  const evs = [ev(NOW - 6 * H, 'out'), ev(NOW - 5 * H, 'in'), ev(NOW - 5 * H + 10 * MIN, 'out'), ev(NOW - 5 * H + 20 * MIN, 'in')];
  it('fills basic signals', () => {
    const r = computeLeadIntel({ interaction: mkI('c1', evs), events: evs, now: NOW });
    expect(r.lastSender).toBe('in');
    expect(r.lastActivityTs).toBe(NOW - 5 * H + 20 * MIN);
    expect(r.ourAvgResponseMs).toBe(10 * MIN);
    expect(r.theirAvgResponseMs).toBe(35 * MIN);
    expect(r.totalMsgs).toBe(4); expect(r.inCount).toBe(2); expect(r.outCount).toBe(2); expect(r.msgs7d).toBe(4);
    expect(r.intent).toBeNull();
    expect(r.engagement).toBeGreaterThanOrEqual(0); expect(r.engagement).toBeLessThanOrEqual(100);
  });
  it('hot lead waiting 5 h with buying snippet is urgent', () => {
    const e = [ev(NOW - 5 * H, 'in')];
    const r = computeLeadIntel({ interaction: mkI('c1', e), events: e, snippet: 'mau order kak', now: NOW });
    expect(r.temperature).toBe('hot'); expect(r.intent).toBe('siap-beli');
    expect(r.followUpPriority).toBe('urgent'); expect(r.reason).toBe('Hot lead belum dibalas 5 j');
    expect(r.waitingMs).toBe(5 * H);
  });
  it('complaint unanswered is urgent', () => {
    const e = [ev(NOW - 1 * H, 'in')];
    const r = computeLeadIntel({ interaction: mkI('c1', e), events: e, snippet: 'saya kecewa', now: NOW });
    expect(r.followUpPriority).toBe('urgent'); expect(r.reason).toContain('Komplain');
  });
  it('we spoke last with slipping momentum escalates', () => {
    const e = [ev(NOW - 6.5 * D, 'in'), ev(NOW - 6.4 * D, 'out'), ev(NOW - 6 * D, 'in'), ev(NOW - 5.9 * D, 'out'), ev(NOW - 5.5 * D, 'in'), ev(NOW - 5.4 * D, 'out'), ev(NOW - 4 * D, 'out')];
    const r = computeLeadIntel({ interaction: mkI('c1', e), events: e, contact: contact({ stage: 'Negosiasi', value: 2e6 }), now: NOW });
    expect(r.lastSender).toBe('out'); expect(['slipping', 'stalled']).toContain(r.momentum);
    expect(r.followUpPriority).toBe('high'); expect(r.reason).toContain('kehilangan momentum');
  });
  it('opt-out is low and never hot', () => {
    const e = [ev(NOW - 5 * H, 'in')];
    const r = computeLeadIntel({ interaction: mkI('c1', e), events: e, snippet: 'mau order', contact: contact({ optOut: true }), now: NOW });
    expect(r.temperature).not.toBe('hot'); expect(r.followUpPriority).toBe('low');
  });
  it('no events falls back to interaction summary', () => {
    const i = { ...mkI('c1', []), lastInTs: NOW - H, inCount: 3, outCount: 1, firstInTs: NOW - D };
    const r = computeLeadIntel({ interaction: i, events: [], now: NOW });
    expect(r.lastSender).toBe('in'); expect(r.totalMsgs).toBe(4); expect(r.waitingMs).toBe(H);
  });
  it('empty everything is dormant and low', () => {
    const r = computeLeadIntel({ interaction: null, events: [], contact: contact(), now: NOW });
    expect(r.temperature).toBe('dormant'); expect(r.followUpPriority).toBe('low'); expect(r.engagement).toBeLessThan(15);
    expect(r.lastActivityTs).toBeNull();
  });
  it('is deterministic and does not mutate input', () => {
    const copy = [...evs].reverse(); const snap = JSON.stringify(copy);
    const a = computeLeadIntel({ interaction: mkI('c1', evs), events: copy, now: NOW });
    const b = computeLeadIntel({ interaction: mkI('c1', evs), events: evs, now: NOW });
    expect(a).toEqual(b); expect(JSON.stringify(copy)).toBe(snap);
  });
});

describe('computeAll / ranking / csv', () => {
  const e1 = [ev(NOW - 5 * H, 'in', 'c1')];
  const e2 = [ev(NOW - 10 * MIN, 'in', 'c2')];
  const e3 = [ev(NOW - 20 * D, 'in', 'c3')];
  const all = [...e1, ...e2, ...e3];
  const ints = [mkI('c1', e1), mkI('c2', e2), mkI('c3', e3)];
  const snippets = new Map([['A|c1', 'harga berapa']]);
  const m = computeAll(ints, all, [contact({ key: 'A|c9', chatId: 'c9' })], NOW, snippets);
  it('groups per chat and includes contacts without interactions', () => {
    expect(m.size).toBe(4);
    expect(m.get('A|c1')!.totalMsgs).toBe(1); expect(m.get('A|c1')!.intent).toBe('tanya-harga');
    expect(m.get('A|c3')!.temperature).toBe('dormant');
    expect(m.get('A|c9')!.totalMsgs).toBe(0);
  });
  it('rankFollowUps by priority then engagement, immutably', () => {
    const list = [...m.values()]; const copy = [...list];
    const r = rankFollowUps(list);
    expect(list).toEqual(copy);
    expect(r[0].key).toBe('A|c1');
    const pr = { urgent: 0, high: 1, normal: 2, low: 3 };
    for (let i = 1; i < r.length; i++) expect(pr[r[i - 1].followUpPriority] <= pr[r[i].followUpPriority]).toBe(true);
  });
  it('hotLeads / slippingLeads filter', () => {
    expect(hotLeads([...m.values()]).map((l) => l.key)).toContain('A|c1');
    const fake = { ...m.get('A|c1')!, momentum: 'slipping' as const, engagement: 50, temperature: 'warm' as const };
    expect(slippingLeads([fake, { ...fake, optOut: true }, { ...fake, engagement: 10 }])).toHaveLength(1);
  });
  it('csv has header and guards formulas', () => {
    const l: LeadIntel = { ...m.get('A|c1')!, name: '=cmd' };
    const csv = exportLeadIntelCsv([l]);
    expect(csv.split('\r\n')[0]).toContain('temperature,engagement,momentum,follow_up_priority');
    expect(csv).toContain("'=cmd");
  });
});
