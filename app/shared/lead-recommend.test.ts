import { describe, expect, it } from 'vitest';
import type { Interaction, MsgEvent } from './analytics-types';
import type { Contact } from './crm-types';
import { bestContactHour, computeLeadIntel, exportLeadIntelCsv, firstName, suggestMessage } from './lead-intel-logic';

const H = 3600e3;
const NOW = new Date(2026, 2, 15, 12, 0).getTime();
const ev = (ts: number, dir: 'in' | 'out'): MsgEvent => ({ key: `A|c1${ts}${dir}`, accountId: 'A', chatId: 'c1', ts, dir, isGroup: false });
const inter = (evs: MsgEvent[], name = 'Budi Santoso'): Interaction => {
  const ins = evs.filter((e) => e.dir === 'in'), outs = evs.filter((e) => e.dir === 'out');
  const mx = (a: MsgEvent[]) => (a.length ? Math.max(...a.map((e) => e.ts)) : null);
  const mn = (a: MsgEvent[]) => (a.length ? Math.min(...a.map((e) => e.ts)) : null);
  return { key: 'A|c1', accountId: 'A', chatId: 'c1', name, phone: '62811', isGroup: false, firstInTs: mn(ins), firstOutTs: mn(outs), lastInTs: mx(ins), lastOutTs: mx(outs), inCount: ins.length, outCount: outs.length, partialHistory: false };
};
const contact = (p: Partial<Contact> = {}): Contact => ({ key: 'A|c1', accountId: 'A', chatId: 'c1', name: 'Budi Santoso', phone: '62811', stage: 'Lead baru', tags: [], value: 0, assignee: '', optOut: false, createdAt: 0, updatedAt: 0, lastContactAt: null, ...p });

describe('firstName', () => {
  it('uses the first word, falls back to Kak for numbers/empty', () => {
    expect(firstName('Budi Santoso')).toBe('Budi');
    expect(firstName('')).toBe('Kak');
    expect(firstName(undefined)).toBe('Kak');
    expect(firstName('+62 812')).toBe('Kak');
    expect(firstName('6281234')).toBe('Kak');
  });
});

describe('bestContactHour', () => {
  const at = (day: number, h: number) => new Date(2026, 2, day, h, 5).getTime();
  it('null with fewer than 5 inbound messages', () => {
    expect(bestContactHour([ev(at(1, 20), 'in'), ev(at(2, 20), 'in'), ev(at(3, 9), 'out')])).toBeNull();
  });
  it('picks the busiest inbound hour (outbound ignored)', () => {
    const evs = [20, 20, 20, 9, 9, 15].map((h, i) => ev(at(i + 1, h), 'in')).concat([ev(at(7, 3), 'out'), ev(at(8, 3), 'out'), ev(at(9, 3), 'out')]);
    expect(bestContactHour(evs)).toBe(20);
  });
  it('ties go to the earlier hour', () => {
    expect(bestContactHour([8, 8, 21, 21, 14].map((h, i) => ev(at(i + 1, h), 'in')))).toBe(8);
  });
});

describe('suggestMessage', () => {
  const base = { name: 'Budi Santoso', intent: null, temperature: 'warm' as const, momentum: 'steady' as const, lastSender: 'in' as const, waitingMs: 0, totalMsgs: 5 };
  it('never suggests anything for opt-out or empty chats', () => {
    expect(suggestMessage({ ...base, optOut: true })).toBeNull();
    expect(suggestMessage({ ...base, totalMsgs: 0 })).toBeNull();
  });
  it('matches the intent and greets by first name', () => {
    expect(suggestMessage({ ...base, intent: 'tanya-harga' })).toMatch(/^Halo Budi,.*harga/);
    expect(suggestMessage({ ...base, intent: 'komplain' })).toMatch(/mohon maaf/i);
    expect(suggestMessage({ ...base, intent: 'siap-beli' })).toMatch(/pembayaran/);
  });
  it('apologises only when the lead waited 6h or more', () => {
    expect(suggestMessage({ ...base, intent: 'tanya-info', waitingMs: 7 * H })).toMatch(/baru sempat membalas/);
    expect(suggestMessage({ ...base, intent: 'tanya-info', waitingMs: 1 * H })).not.toMatch(/baru sempat/);
  });
  it('when we spoke last: reactivation, momentum follow-up, gentle reminder', () => {
    const out = { ...base, lastSender: 'out' as const };
    expect(suggestMessage({ ...out, temperature: 'dormant' })).toMatch(/penawaran baru/);
    expect(suggestMessage({ ...out, momentum: 'slipping' })).toMatch(/follow up/);
    expect(suggestMessage(out)).toMatch(/mengingatkan/);
  });
});

describe('recommendation in computeLeadIntel', () => {
  it('adds a suggested message and best hour, deterministic', () => {
    const e = [20, 20, 20, 9, 9].map((h, i) => ev(new Date(2026, 2, 10 + i, h, 5).getTime(), 'in'));
    const a = computeLeadIntel({ interaction: inter(e), events: e, snippet: 'berapa harganya?', now: NOW });
    expect(a.suggestedMessage).toMatch(/Halo Budi,.*harga/);
    expect(a.bestHour).toBe(20);
    expect(computeLeadIntel({ interaction: inter(e), events: e, snippet: 'berapa harganya?', now: NOW })).toEqual(a);
  });
  it('opt-out has no suggested message', () => {
    const e = [ev(NOW - 2 * H, 'in')];
    expect(computeLeadIntel({ interaction: inter(e), events: e, contact: contact({ optOut: true }), now: NOW }).suggestedMessage).toBeUndefined();
  });
  it('a big deal waiting for our reply escalates one level (normal -> high)', () => {
    const e = [ev(NOW - 2 * H, 'in')];
    const small = computeLeadIntel({ interaction: inter(e), events: e, contact: contact({ value: 100_000 }), now: NOW });
    const big = computeLeadIntel({ interaction: inter(e), events: e, contact: contact({ value: 2_000_000 }), now: NOW });
    expect(small.followUpPriority).toBe('normal');
    expect(big.followUpPriority).toBe('high');
    expect(big.reason).toMatch(/nilai besar/);
  });
  it('a big deal does not escalate when we answered last or the wait is short', () => {
    const answered = [ev(NOW - 3 * H, 'in'), ev(NOW - 2 * H, 'out')];
    expect(computeLeadIntel({ interaction: inter(answered), events: answered, contact: contact({ value: 5_000_000 }), now: NOW }).reason).not.toMatch(/nilai besar/);
    const fresh = [ev(NOW - 5 * 60e3, 'in')];
    expect(computeLeadIntel({ interaction: inter(fresh), events: fresh, contact: contact({ value: 5_000_000 }), now: NOW }).reason).not.toMatch(/nilai besar/);
  });
  it('csv includes the new columns', () => {
    const e = [ev(NOW - 2 * H, 'in')];
    const csv = exportLeadIntelCsv([computeLeadIntel({ interaction: inter(e), events: e, now: NOW })]);
    expect(csv.split('\n')[0]).toContain('suggested_message');
    expect(csv.split('\n')[0]).toContain('best_hour');
  });
});
