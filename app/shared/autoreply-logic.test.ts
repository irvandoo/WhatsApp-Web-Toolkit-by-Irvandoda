import { describe, expect, it } from 'vitest';
import {
  decide, groupCfg, inCooldown, isForbiddenChat, isWithinSchedule, matchRule, needsMigration, nextDelayMs, normalizeRule, overRateLimit, pickRule, scopeAllows,
  validateRule,
} from './autoreply-logic';
import { buildRules } from './presets-logic';
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

// ---------------- scope & group guards ----------------
const GID = '1203@g.us';
const gKey = `a|${GID}`;
const gRule = (p: Partial<ArRule> = {}): ArRule => mk({
  trigger: 'keyword', keywords: ['harga'], scope: 'group', grp: { allow: [{ id: GID, name: 'Grup A' }], deny: [], requireMention: true, groupCooldownMin: 10, maxPerHour: 6 }, ...p,
});
const gIn = (p = {}) => inbound({ chatKey: gKey, isGroup: true, author: '6285@c.us', groupName: 'Grup A', mentionedMe: true, text: 'harga?', ...p });
const gBase = { now: NOW, log: [] as ArLogEntry[], lastOutboundTs: null as number | null, rng: () => 0 };

describe('scope matrix', () => {
  const trig: Array<ArRule['trigger']> = ['keyword', 'any', 'first-message', 'away-hours'];
  it('personal / group / all x trigger types', () => {
    for (const t of trig) {
      const base = { trigger: t, keywords: ['harga'], schedule: { days: [3], from: '09:00', to: '17:00' } } as Partial<ArRule>;
      const away = new Date(2026, 0, 7, 20, 0).getTime();
      const okP = (r: ArRule) => matchRule(r, 'harga', { isNewLead: true, now: away, isGroup: false });
      const okG = (r: ArRule) => matchRule(r, 'harga', { isNewLead: true, now: away, isGroup: true });
      expect(okP(mk({ ...base, scope: 'personal' }))).toBe(true);
      expect(okP(mk({ ...base, scope: 'group' }))).toBe(false);
      expect(okP(mk({ ...base, scope: 'all' }))).toBe(true);
      expect(okG(mk({ ...base, scope: 'personal' }))).toBe(false);
      expect(okG(mk({ ...base, scope: 'group' }))).toBe(t === 'keyword');
      expect(okG(mk({ ...base, scope: 'all' }))).toBe(t === 'keyword');
    }
  });
  it('scopeAllows + missing scope = personal', () => {
    expect(scopeAllows({ scope: 'all' }, true)).toBe(true);
    expect(scopeAllows({ scope: undefined as never }, false)).toBe(true);
    expect(scopeAllows({ scope: undefined as never }, true)).toBe(false);
  });
});

describe('group guards in decide', () => {
  it('replies in an allowed group when mentioned', () => {
    expect(decide({ ...gBase, rules: [gRule()], inbound: gIn() }).action).toBe('draft');
  });
  it('personal-scope rule never answers groups', () => {
    expect(decide({ ...gBase, rules: [mk({ trigger: 'any' })], inbound: gIn() }).action).toBe('skip');
  });
  it('requires mention or quote when enabled (default ON)', () => {
    expect(decide({ ...gBase, rules: [gRule()], inbound: gIn({ mentionedMe: false }) }).reason).toMatch(/mention/);
    expect(decide({ ...gBase, rules: [gRule()], inbound: gIn({ mentionedMe: false, quotedMe: true }) }).action).toBe('draft');
    const off = gRule({ grp: { ...gRule().grp, requireMention: false } });
    expect(decide({ ...gBase, rules: [off], inbound: gIn({ mentionedMe: false }) }).action).toBe('draft');
  });
  it('allow list required, deny wins, manual name entry works', () => {
    const none = gRule({ grp: { ...gRule().grp, allow: [] } });
    expect(decide({ ...gBase, rules: [none], inbound: gIn() }).reason).toMatch(/belum ada grup/);
    expect(decide({ ...gBase, rules: [gRule()], inbound: gIn({ chatKey: 'a|999@g.us' }) }).reason).toMatch(/izin/);
    const deny = gRule({ grp: { ...gRule().grp, deny: [{ id: GID, name: 'Grup A' }] } });
    expect(decide({ ...gBase, rules: [deny], inbound: gIn() }).reason).toMatch(/tolak/);
    const byName = gRule({ grp: { ...gRule().grp, allow: [{ id: '', name: 'grup a' }] } });
    expect(decide({ ...gBase, rules: [byName], inbound: gIn() }).action).toBe('draft');
  });
  it('skips own messages, bots and unknown authors', () => {
    expect(decide({ ...gBase, rules: [gRule()], inbound: gIn({ fromMe: true }) }).reason).toMatch(/akun sendiri/);
    expect(decide({ ...gBase, rules: [gRule()], inbound: gIn({ isBot: true }) }).reason).toMatch(/bot/);
    expect(decide({ ...gBase, rules: [gRule()], inbound: gIn({ author: undefined }) }).action).toBe('skip');
  });
  it('author cooldown and group-wide cooldown', () => {
    const sentBy = (author: string, ago: number) => logE({ chatKey: gKey, author, ts: NOW - ago, ruleId: 'other' });
    expect(decide({ ...gBase, log: [sentBy('6285@c.us', 60_000)], rules: [gRule()], inbound: gIn() }).reason).toMatch(/pengirim/);
    expect(decide({ ...gBase, log: [sentBy('6286@c.us', 60_000)], rules: [gRule()], inbound: gIn() }).reason).toMatch(/jeda grup/);
    expect(decide({ ...gBase, log: [sentBy('6286@c.us', 11 * 60_000)], rules: [gRule({ cooldownMin: 5 })], inbound: gIn() }).action).toBe('draft');
  });
  it('group cooldown floor 5 min cannot be lowered', () => {
    expect(groupCfg({ grp: { groupCooldownMin: 0 } as never }).groupCooldownMin).toBe(5);
    const log = [logE({ chatKey: gKey, author: 'x', ts: NOW - 4 * 60_000 })];
    const r = gRule({ grp: { ...gRule().grp, groupCooldownMin: 1 } });
    expect(decide({ ...gBase, log, rules: [r], inbound: gIn() }).reason).toMatch(/jeda grup/);
  });
  it('group hourly cap is separate from personal cap', () => {
    const auto = gRule({ mode: 'auto', cooldownMin: 5, grp: { ...gRule().grp, maxPerHour: 2, groupCooldownMin: 5 } });
    const old = (i: number) => logE({ chatKey: `a|g${i}@g.us`, author: 'z', ts: NOW - 20 * 60_000 });
    expect(decide({ ...gBase, log: [old(1), old(2)], rules: [auto], inbound: gIn() }).reason).toMatch(/per jam/);
    expect(decide({ ...gBase, log: [old(1)], rules: [auto], inbound: gIn() }).action).toBe('send');
    const personal = [1, 2, 3].map((i) => logE({ chatKey: `a|${i}@c.us`, ts: NOW - 20 * 60_000 }));
    expect(decide({ ...gBase, log: personal, rules: [auto], inbound: gIn() }).action).toBe('send');
  });
  it('group sends still respect canAutoSend and lastOutbound', () => {
    expect(decide({ ...gBase, rules: [gRule({ mode: 'auto' })], inbound: gIn(), canAutoSend: false }).action).toBe('draft');
    expect(decide({ ...gBase, lastOutboundTs: NOW, rules: [gRule()], inbound: gIn() }).reason).toBe('sudah dibalas');
  });
  it('scope all answers both chat types; broadcast/status stay forbidden', () => {
    const all = gRule({ scope: 'all' });
    expect(decide({ ...gBase, rules: [all], inbound: gIn() }).action).toBe('draft');
    expect(decide({ ...gBase, rules: [all], inbound: inbound({ text: 'harga' }) }).action).toBe('draft');
    expect(decide({ ...gBase, rules: [all], inbound: gIn({ chatKey: 'a|status@broadcast' }) }).action).toBe('skip');
  });
  it('template variables {pengirim} {grup}', () => {
    const r = gRule({ reply: 'Halo {pengirim} di {grup}' });
    const d = decide({ ...gBase, rules: [r], inbound: gIn(), vars: { pengirim: 'Budi', grup: 'Grup A' } });
    expect(d.text).toBe('Halo Budi di Grup A');
  });
  it('opt-out still respected', () => {
    expect(decide({ ...gBase, rules: [gRule()], inbound: gIn({ optOut: true }) }).reason).toMatch(/opt-out/);
  });
});

describe('validateRule group scope', () => {
  it('rejects non-keyword triggers for group/all', () => {
    for (const scope of ['group', 'all'] as const) for (const t of ['any', 'first-message', 'away-hours'] as const) {
      expect(validateRule(gRule({ scope, trigger: t, schedule: { days: [1], from: '09:00', to: '17:00' } })).join(' ')).toMatch(/Kata kunci/);
    }
    expect(validateRule(gRule())).toEqual([]);
    expect(validateRule(mk({ trigger: 'any', scope: 'personal' }))).toEqual([]);
  });
  it('requires a group, min cooldown, short keywords, {grup} only for group', () => {
    expect(validateRule(gRule({ grp: { ...gRule().grp, allow: [] } })).join(' ')).toMatch(/minimal satu grup/);
    expect(validateRule(gRule({ grp: { ...gRule().grp, groupCooldownMin: 2 } })).join(' ')).toMatch(/minimal 5/);
    expect(validateRule(gRule({ keywords: ['ab'] })).join(' ')).toMatch(/3 karakter/);
    expect(validateRule(mk({ trigger: 'any', reply: 'di {grup}' })).join(' ')).toMatch(/grup/);
    expect(validateRule(mk({ scope: 'bogus' as never, trigger: 'any' })).length).toBe(1);
  });
});

describe('migration', () => {
  it('old rules without scope/grp become personal with default guards', () => {
    const old = { ...mk({ trigger: 'any' }) } as Partial<ArRule>;
    delete old.scope; delete old.grp;
    expect(needsMigration(old)).toBe(true);
    const n = normalizeRule(old as ArRule);
    expect(n.scope).toBe('personal');
    expect(n.grp).toMatchObject({ requireMention: true, groupCooldownMin: 10, maxPerHour: 6, allow: [] });
    expect(needsMigration(n)).toBe(false);
    expect(normalizeRule(n)).toEqual(n);
    expect(decide({ rules: [n], inbound: inbound(), now: NOW, log: [], lastOutboundTs: null, rng: () => 0 }).action).toBe('draft');
  });
  it('seeded/new/preset rules are personal', () => {
    expect(newRule(0).scope).toBe('personal');
    const rules = buildRules({
      templates: [], stages: null, skipped: [], conflicts: [],
      rules: [{ originalName: 'x', renamed: false, rule: { name: 'x', trigger: 'keyword', keywords: ['a'], matchMode: 'contains', reply: 'r', delaySec: [4, 12], cooldownMin: 360, maxPerHour: 20, onlyNewLeads: false } }],
    }, 0);
    expect(rules[0].scope).toBe('personal');
    expect(rules[0].enabled).toBe(false);
  });
});
