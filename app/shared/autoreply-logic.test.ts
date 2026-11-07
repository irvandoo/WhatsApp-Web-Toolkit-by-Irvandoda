import { describe, expect, it } from 'vitest';
import { decide, inCooldown, isForbiddenChat, isWithinSchedule, matchRule, nextDelayMs, overRateLimit, pickRule, validateRule } from './autoreply-logic';
import { newRule, type ArLogEntry, type ArRule } from './autoreply-types';

const mk = (p: Partial<ArRule> = {}): ArRule => ({ ...newRule(0), id: 'r1', enabled: true, reply: 'Halo {nama}', ...p });
const NOW = new Date(2026, 0, 7, 10, 0).getTime(); // Wednesday 10:00 local
const inbound = (p = {}) => ({ chatKey: 'a|6281@c.us', text: 'harga berapa?', ts: NOW - 1000, isGroup: false, isNewLead: true, optOut: false, ...p });
const logE = (p: Partial<ArLogEntry>): ArLogEntry => ({ id: 'x', ts: NOW - 1000, accountId: 'a', chatKey: 'a|6281@c.us', chatName: '', ruleId: 'r1', ruleName: '', action: 'sent', reason: '', text: '', ...p });
const ctx = (isNewLead = false, now = NOW) => ({ isNewLead, now });

describe('schedule', () => {
  const s = { days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00' };
  it('inside/outside', () => {
    expect(isWithinSchedule(s, NOW)).toBe(true);
    expect(isWithinSchedule(s, new Date(2026, 0, 7, 18, 0))).toBe(false);
    expect(isWithinSchedule(s, new Date(2026, 0, 10, 10, 0))).toBe(false); // Saturday
  });
  it('overnight', () => {
    const n = { days: [3], from: '22:00', to: '06:00' }; // Wed night
    expect(isWithinSchedule(n, new Date(2026, 0, 7, 23, 0))).toBe(true);
    expect(isWithinSchedule(n, new Date(2026, 0, 8, 5, 0))).toBe(true); // Thu morning, started Wed
    expect(isWithinSchedule(n, new Date(2026, 0, 7, 5, 0))).toBe(false); // Wed morning, started Tue
    expect(isWithinSchedule(n, new Date(2026, 0, 7, 12, 0))).toBe(false);
  });
});

describe('matching', () => {
  it('modes', () => {
    expect(matchRule(mk({ keywords: ['harga'] }), 'Berapa HARGA nya', ctx())).toBe(true);
    expect(matchRule(mk({ keywords: ['harga'], matchMode: 'exact' }), 'harga?', ctx())).toBe(true);
    expect(matchRule(mk({ keywords: ['harga'], matchMode: 'exact' }), 'harga barang', ctx())).toBe(false);
    expect(matchRule(mk({ keywords: ['cat'], matchMode: 'regex-safe' }), 'category', ctx())).toBe(false);
    expect(matchRule(mk({ keywords: ['cat'], matchMode: 'regex-safe' }), 'ada cat?', ctx())).toBe(true);
    expect(matchRule(mk({ keywords: ['a.b'], matchMode: 'regex-safe' }), 'axb', ctx())).toBe(false);
  });
  it('disabled never matches; first by order wins', () => {
    expect(matchRule(mk({ enabled: false, trigger: 'any' }), 'x', ctx())).toBe(false);
    const a = mk({ id: 'a', order: 2, trigger: 'any' }), b = mk({ id: 'b', order: 1, trigger: 'any' });
    expect(pickRule([a, b], 'x', ctx())?.id).toBe('b');
  });
  it('away-hours and first-message', () => {
    const away = mk({ trigger: 'away-hours', schedule: { days: [3], from: '09:00', to: '17:00' } });
    expect(matchRule(away, 'x', ctx())).toBe(false);
    expect(matchRule(away, 'x', ctx(false, new Date(2026, 0, 7, 20, 0).getTime()))).toBe(true);
    expect(matchRule(mk({ trigger: 'first-message' }), 'x', ctx(true))).toBe(true);
  });
});

describe('limits', () => {
  it('cooldown and rate', () => {
    expect(inCooldown(mk(), 'a|6281@c.us', [logE({})], NOW)).toBe(true);
    expect(inCooldown(mk({ cooldownMin: 1 }), 'a|6281@c.us', [logE({ ts: NOW - 120_000 })], NOW)).toBe(false);
    expect(inCooldown(mk(), 'a|other@c.us', [logE({})], NOW)).toBe(false);
    expect(overRateLimit(mk({ maxPerHour: 2 }), [logE({}), logE({ chatKey: 'z' })], NOW)).toBe(true);
    expect(overRateLimit(mk({ maxPerHour: 2 }), [logE({}), logE({ action: 'draft' })], NOW)).toBe(false);
  });
  it('delay in range', () => {
    expect(nextDelayMs({ delaySec: [4, 12] }, () => 0)).toBe(4000);
    expect(nextDelayMs({ delaySec: [4, 12] }, () => 1)).toBe(12000);
  });
});

describe('decide safety', () => {
  const base = { rules: [mk({ trigger: 'any' })], now: NOW, log: [] as ArLogEntry[], lastOutboundTs: null as number | null, rng: () => 0 };
  it('replies by draft or send', () => {
    expect(decide({ ...base, inbound: inbound() }).action).toBe('draft');
    const auto = [mk({ trigger: 'any', mode: 'auto' })];
    expect(decide({ ...base, rules: auto, inbound: inbound(), vars: { nama: 'Budi' } })).toMatchObject({ action: 'send', text: 'Halo Budi', delayMs: 4000 });
    expect(decide({ ...base, rules: auto, inbound: inbound(), canAutoSend: false }).action).toBe('draft');
  });
  it('never groups / optout / broadcast / status', () => {
    expect(decide({ ...base, inbound: inbound({ isGroup: true }) }).action).toBe('skip');
    expect(decide({ ...base, inbound: inbound({ chatKey: 'a|123@g.us' }) }).action).toBe('skip');
    expect(decide({ ...base, inbound: inbound({ optOut: true }) }).action).toBe('skip');
    expect(isForbiddenChat('a|status@broadcast')).toBe(true);
    expect(decide({ ...base, inbound: inbound({ chatKey: 'a|status@broadcast' }) }).action).toBe('skip');
  });
  it('skips if answered, stale, cooldown, rate, onlyNewLeads', () => {
    expect(decide({ ...base, lastOutboundTs: NOW - 500, inbound: inbound() }).reason).toBe('sudah dibalas');
    expect(decide({ ...base, inbound: inbound({ ts: NOW - 3600_000 }) }).reason).toBe('pesan terlalu lama');
    expect(decide({ ...base, log: [logE({})], inbound: inbound() }).reason).toMatch(/cooldown/);
    const auto = mk({ trigger: 'any', mode: 'auto', maxPerHour: 1, cooldownMin: 0 });
    expect(decide({ ...base, rules: [auto], log: [logE({ chatKey: 'other' })], inbound: inbound() }).reason).toMatch(/per jam/);
    expect(decide({ ...base, rules: [mk({ trigger: 'any', onlyNewLeads: true })], inbound: inbound({ isNewLead: false }) }).action).toBe('skip');
  });
});

describe('validateRule', () => {
  it('flags problems', () => {
    expect(validateRule(mk({ trigger: 'keyword', keywords: [] })).length).toBeGreaterThan(0);
    expect(validateRule(mk({ trigger: 'any' }))).toEqual([]);
    expect(validateRule(mk({ trigger: 'away-hours' })).length).toBeGreaterThan(0);
  });
});

describe('decide rotation', () => {
  const base = { rules: [mk({ trigger: 'any', reply: 'A', replyVariants: ['B', 'C'], rotation: 'round-robin' })], now: NOW, log: [] as ArLogEntry[], lastOutboundTs: null };
  it('rotates via state and returns next state', () => {
    const d1 = decide({ ...base, inbound: inbound(), rng: () => 0 });
    expect(d1.text).toBe('A');
    const d2 = decide({ ...base, inbound: inbound(), rng: () => 0, rotation: { r1: d1.rotState } });
    expect(d2.text).toBe('B');
    const d3 = decide({ ...base, inbound: inbound(), rng: () => 0, rotation: { r1: d2.rotState } });
    expect(d3.text).toBe('C');
  });
  it('no variants keeps old behavior and no rotState', () => {
    const d = decide({ ...base, rules: [mk({ trigger: 'any' })], inbound: inbound(), vars: { nama: 'Budi' } });
    expect(d.text).toBe('Halo Budi');
    expect(d.rotState).toBeUndefined();
  });
  it('validates variant limits', () => {
    expect(validateRule(mk({ trigger: 'any', replyVariants: Array(11).fill('x') })).length).toBe(1);
    expect(validateRule(mk({ trigger: 'any', replyVariants: ['x'.repeat(1001)] })).length).toBe(1);
  });
});
