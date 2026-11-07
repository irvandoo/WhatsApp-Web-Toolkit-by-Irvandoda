import { describe, expect, it } from 'vitest';
import type { Contact } from './crm-types';
import {
  DEFAULT_SAFETY, assertSendable, bumpAfterSend, computeNextRun, inWindow, nextSendable, nextWindowOpen, normalizePhone, normalizeSafety,
  parseRecipients, placeSend, planCampaign, recipientsFromContacts, renderMessage, retryPlan, shouldAutoPause, checkCaps, validateSchedule,
  logToCsv,
} from './outbox-logic';
import type { Campaign, OutboxItem, SendLogEntry } from './outbox-types';

const at = (d: string, h: number, m = 0) => { const x = new Date(d); return new Date(x.getFullYear(), x.getMonth(), x.getDate(), h, m).getTime(); };
const seq = () => { let i = 0; return () => `id${++i}`; };
const rng0 = () => 0;
const safe = (o = {}) => normalizeSafety({ windowEnabled: false, warmup: false, ...o });

describe('normalizePhone', () => {
  it('handles Indonesian formats', () => {
    expect(normalizePhone('0812-3456-7890')).toBe('6281234567890');
    expect(normalizePhone('+62 812 3456 7890')).toBe('6281234567890');
    expect(normalizePhone('6281234567890')).toBe('6281234567890');
    expect(normalizePhone('81234567890')).toBe('6281234567890');
    expect(normalizePhone('0062 812 3456 7890')).toBe('6281234567890');
    expect(normalizePhone('+1 415 555 2671')).toBe('14155552671');
  });
  it('rejects bad/groups', () => {
    expect(normalizePhone('0812')).toBeNull();
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone('120363025@g.us')).toBeNull();
    expect(normalizePhone('status@broadcast')).toBeNull();
    expect(normalizePhone('62812345678901234567')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
});

describe('parseRecipients', () => {
  it('parses header csv with extra vars, dedupes, reports invalid', () => {
    const r = parseRecipients('telepon,nama,Kota Asal\r\n0812345678901,Budi,Bandung\r\n+62 812 3456 78901,Dup,X\r\n123,Bad,Y');
    expect(r.recipients).toHaveLength(1);
    expect(r.recipients[0]).toMatchObject({ phone: '62812345678901', name: 'Budi', vars: { nama: 'Budi', kota_asal: 'Bandung' } });
    expect(r.duplicates).toBe(1);
    expect(r.invalid).toHaveLength(1);
    expect(r.columns).toEqual(['nama', 'kota_asal']);
  });
  it('parses headerless paste with optional names and semicolons', () => {
    const r = parseRecipients('081234567890;Ani\n081234567891\n');
    expect(r.recipients.map((x) => [x.phone, x.name])).toEqual([['6281234567890', 'Ani'], ['6281234567891', undefined]]);
  });
});

describe('recipientsFromContacts', () => {
  const c = (o: Partial<Contact>): Contact => ({ key: 'a|' + (o.chatId ?? ''), accountId: 'a', chatId: '', name: 'N', phone: '', stage: 'Lead baru', tags: [], value: 0, assignee: '', optOut: false, createdAt: 0, updatedAt: 0, lastContactAt: null, ...o });
  it('filters stage/tag and skips optOut + groups', () => {
    const list = [
      c({ chatId: '6281234567890@c.us', phone: '6281234567890', tags: ['vip'] }),
      c({ chatId: '6281234567891@c.us', phone: '6281234567891', optOut: true }),
      c({ chatId: '1203@g.us', phone: '' }),
      c({ chatId: '6281234567892@c.us', phone: '6281234567892', stage: 'Deal' }),
    ];
    const r = recipientsFromContacts(list, { stage: 'Lead baru' });
    expect(r.recipients.map((x) => x.phone)).toEqual(['6281234567890']);
    expect(r.skipped).toMatchObject({ optOut: 1, group: 1 });
    expect(recipientsFromContacts(list, { tag: 'vip' }).recipients).toHaveLength(1);
  });
});

describe('renderMessage', () => {
  it('uses csv vars, spintax and flags unresolved', () => {
    const r = renderMessage('{Halo|Hai} {nama} dari {kota}, {promo}', { phone: '6281', name: 'Budi', vars: { kota: 'Bandung' } }, {}, rng0);
    expect(r.text).toBe('Halo Budi dari Bandung, {promo}');
    expect(r.unresolved).toEqual(['promo']);
    expect(renderMessage('Hi {nama}', { phone: '6281' }).text).toBe('Hi Kak');
  });
});

describe('safety + window', () => {
  it('enforces floors', () => {
    const s = normalizeSafety({ delayMinSec: 1, delayMaxSec: 2, maxPerHour: 9999, maxPerDay: 99999, pauseAfterErrors: 0 });
    expect(s.delayMinSec).toBe(8);
    expect(s.delayMaxSec).toBeGreaterThanOrEqual(8);
    expect(s.maxPerHour).toBe(120);
    expect(s.maxPerDay).toBe(1000);
    expect(normalizeSafety()).toEqual(DEFAULT_SAFETY);
  });
  it('window open/close and overnight', () => {
    expect(inWindow(at('2026-03-02', 9), '08:00', '20:00')).toBe(true);
    expect(inWindow(at('2026-03-02', 21), '08:00', '20:00')).toBe(false);
    expect(nextWindowOpen(at('2026-03-02', 21), '08:00', '20:00')).toBe(at('2026-03-03', 8));
    expect(nextWindowOpen(at('2026-03-02', 6), '08:00', '20:00')).toBe(at('2026-03-02', 8));
    expect(inWindow(at('2026-03-02', 23), '22:00', '06:00')).toBe(true);
    expect(inWindow(at('2026-03-02', 12), '22:00', '06:00')).toBe(false);
  });
});

describe('planCampaign', () => {
  const base = (o = {}) => ({
    id: 'c1', name: 'Tes', template: 'Hai {nama}', source: 'csv' as const, optInConfirmed: true, now: at('2026-03-02', 9),
    recipients: ['6281234567801', '6281234567802', '6281234567803'].map((phone) => ({ phone })), genId: seq(), rng: rng0, safety: safe(), ...o,
  });
  it('requires opt-in', () => {
    const r = planCampaign(base({ optInConfirmed: false }));
    expect(r.ok).toBe(false);
    expect(r.items).toHaveLength(0);
  });
  it('spaces items by at least min delay (deterministic rng)', () => {
    const r = planCampaign(base());
    expect(r.ok).toBe(true);
    const d = r.items.map((i) => i.dueAt);
    expect(d[1] - d[0]).toBe(20_000);
    expect(d[2] - d[1]).toBe(20_000);
    expect(r.durationMs).toBe(40_000);
  });
  it('respects hourly cap', () => {
    const r = planCampaign(base({ safety: safe({ maxPerHour: 2, delayMinSec: 8, delayMaxSec: 8 }) }));
    const d = r.items.map((i) => i.dueAt);
    expect(d[2] - d[0]).toBeGreaterThanOrEqual(3_600_000);
  });
  it('pushes outside window to next opening', () => {
    const r = planCampaign(base({ now: at('2026-03-02', 21), safety: safe({ windowEnabled: true }) }));
    expect(r.items[0].dueAt).toBe(at('2026-03-03', 8));
  });
  it('warm-up caps day 1 at 50', () => {
    const recipients = Array.from({ length: 60 }, (_, i) => ({ phone: String(6281234560000 + i) }));
    const r = planCampaign(base({ recipients, safety: safe({ warmup: true, maxPerHour: 120, delayMinSec: 8, delayMaxSec: 8 }) }));
    const day1 = r.items.filter((i) => i.dueAt < at('2026-03-03', 0)).length;
    expect(day1).toBe(50);
  });
  it('skips opt-out, dedupes, flags unresolved variables', () => {
    const r = planCampaign(base({
      template: 'Hi {nama} {kode}', optOutPhones: new Set(['6281234567801']),
      recipients: [{ phone: '6281234567801' }, { phone: '6281234567802', vars: { kode: 'A1' } }, { phone: '6281234567802' }, { phone: '6281234567803' }],
    }));
    expect(r.items.map((i) => i.phone)).toEqual(['6281234567802']);
    expect(r.skipped.some((s) => s.reason.includes('{kode}'))).toBe(true);
  });
  it('draft mode ignores window/caps', () => {
    const r = planCampaign(base({ now: at('2026-03-02', 23), mode: 'draft', safety: safe({ windowEnabled: true }) }));
    expect(r.items[0].dueAt).toBe(at('2026-03-02', 23));
  });
});

describe('nextSendable', () => {
  const now = at('2026-03-02', 10);
  const camp = (id: string, o: Partial<Campaign> = {}): Campaign => ({
    id, name: id, template: 'x', status: 'running', source: 'csv', createdAt: 1, startAt: 1, safety: safe(), optInConfirmed: true, total: 1, ...o,
  });
  const item = (id: string, campaignId: string, o: Partial<OutboxItem> = {}): OutboxItem => ({
    id, campaignId, phone: '6281234567801', text: 'hi', status: 'pending', dueAt: now - 1, attempts: 0, createdAt: 0, ...o,
  });
  const sentLog = (ts: number, n = 1): SendLogEntry[] => Array.from({ length: n }, (_, i) => ({ id: 'l' + i + ts, ts: ts - i, campaignId: 'a', itemId: 'i', phone: '1', status: 'sent', mode: 'auto' }));

  it('picks due item; stagger: only oldest blast campaign', () => {
    const r = nextSendable([item('2', 'b'), item('1', 'a', { dueAt: now - 5 })], now, { campaigns: [camp('a', { createdAt: 1 }), camp('b', { createdAt: 2 })], log: [], auto: true });
    expect(r.item?.id).toBe('1');
    const r2 = nextSendable([item('2', 'b')], now, { campaigns: [camp('a'), camp('b', { createdAt: 2 })], log: [], auto: true });
    expect(r2.item?.id).toBe('2');
  });
  it('single schedule items interleave', () => {
    const r = nextSendable([item('1', 'a', { dueAt: now - 10 }), item('s', 's', { dueAt: now - 20 })], now, { campaigns: [camp('a'), camp('s', { source: 'schedule' })], log: [], auto: true });
    expect(r.item?.id).toBe('s');
  });
  it('blocks without consent, paused, killed, optOut, group', () => {
    const ctx = { campaigns: [camp('a', { optInConfirmed: false })], log: [], auto: true };
    expect(nextSendable([item('1', 'a')], now, ctx).item).toBeNull();
    expect(nextSendable([item('1', 'a')], now, { ...ctx, campaigns: [camp('a', { status: 'paused' })] }).item).toBeNull();
    expect(nextSendable([item('1', 'a')], now, { campaigns: [camp('a')], log: [], auto: true, killed: true }).item).toBeNull();
    expect(nextSendable([item('1', 'a')], now, { campaigns: [camp('a')], log: [], auto: true, optOutPhones: new Set(['6281234567801']) }).item).toBeNull();
    expect(assertSendable(item('1', 'a', { phone: '123@g.us' }), camp('a'))).toBeTruthy();
    expect(assertSendable(item('1', 'a', { chatId: '123@g.us' }), camp('a'))).toBeTruthy();
  });
  it('enforces gap and hourly cap, but not in draft mode', () => {
    const ctx = { campaigns: [camp('a', { safety: safe({ maxPerHour: 3 }) })], auto: true };
    const recent = nextSendable([item('1', 'a')], now, { ...ctx, log: sentLog(now - 5_000) });
    expect(recent.item).toBeNull();
    expect((recent as { retryAt?: number }).retryAt).toBe(now - 5_000 + 20_000);
    const full = nextSendable([item('1', 'a')], now, { ...ctx, log: sentLog(now - 600_000, 3) });
    expect(full.item).toBeNull();
    expect((full as { reason: string }).reason).toMatch(/jam/);
    expect(nextSendable([item('1', 'a')], now, { ...ctx, auto: false, log: sentLog(now - 5_000) }).item?.id).toBe('1');
  });
  it('enforces send window at send time', () => {
    const c = camp('a', { safety: safe({ windowEnabled: true }) });
    expect(nextSendable([item('1', 'a')], at('2026-03-02', 22), { campaigns: [c], log: [], auto: true }).item).toBeNull();
    expect(checkCaps(c.safety, now, []).ok).toBe(true);
  });
  it('placeSend honours daily cap', () => {
    const s = safe({ maxPerDay: 2 });
    const sent = [now - 2000, now - 1000];
    expect(placeSend(now, s, sent, sent[0])).toBe(at('2026-03-03', 0));
  });
});

describe('errors / retry / bump', () => {
  const e = (ts: number, status: 'sent' | 'failed', countable?: boolean): SendLogEntry => ({ id: String(ts), ts, campaignId: 'c', itemId: 'i', phone: '1', status, mode: 'auto', countable });
  it('auto-pauses after 3 consecutive transient errors', () => {
    expect(shouldAutoPause([e(1, 'failed'), e(2, 'failed'), e(3, 'failed')])).toBe(true);
    expect(shouldAutoPause([e(1, 'failed'), e(2, 'sent'), e(3, 'failed')])).toBe(false);
    expect(shouldAutoPause([e(1, 'failed'), e(2, 'failed'), e(3, 'failed', false)])).toBe(false);
    expect(shouldAutoPause([e(1, 'failed'), e(2, 'failed')])).toBe(false);
  });
  it('retry rules', () => {
    expect(retryPlan({ attempts: 0 }, false, 1000, rng0)).toEqual({ status: 'pending', attempts: 1, dueAt: 1000 + 300_000 });
    expect(retryPlan({ attempts: 2 }, false, 1000, rng0).status).toBe('failed');
    expect(retryPlan({ attempts: 0 }, true, 1000, rng0).status).toBe('failed');
  });
  it('bumpAfterSend keeps spacing', () => {
    const s = safe({ delayMinSec: 10, delayMaxSec: 10 });
    const mk = (id: string, dueAt: number): OutboxItem => ({ id, campaignId: 'c', phone: '1', text: 't', status: 'pending', dueAt, attempts: 0, createdAt: 0 });
    const out = bumpAfterSend([mk('a', 1000), mk('b', 2000)], s, 1000, rng0);
    expect(out).toEqual([{ id: 'a', dueAt: 11_000 }, { id: 'b', dueAt: 21_000 }]);
  });
});

describe('schedules', () => {
  it('none', () => {
    expect(computeNextRun({ type: 'none', at: 500 }, 100)).toBe(500);
    expect(computeNextRun({ type: 'none', at: 50 }, 100)).toBeNull();
  });
  it('daily', () => {
    expect(computeNextRun({ type: 'daily', time: '09:00' }, at('2026-03-02', 8))).toBe(at('2026-03-02', 9));
    expect(computeNextRun({ type: 'daily', time: '09:00' }, at('2026-03-02', 9))).toBe(at('2026-03-03', 9));
  });
  it('weekly', () => {
    // 2026-03-02 is Monday (1)
    expect(computeNextRun({ type: 'weekly', time: '09:00', weekdays: [3] }, at('2026-03-02', 10))).toBe(at('2026-03-04', 9));
    expect(computeNextRun({ type: 'weekly', time: '09:00', weekdays: [1] }, at('2026-03-02', 10))).toBe(at('2026-03-09', 9));
    expect(computeNextRun({ type: 'weekly', time: '09:00', weekdays: [] }, 0)).toBeNull();
    expect(computeNextRun({ type: 'daily', time: '25:00' }, 0)).toBeNull();
  });
  it('validates', () => {
    const s = { id: 's', name: 'n', enabled: true, target: { phone: '6281234567890' }, text: 'x', recurrence: { type: 'daily' as const, time: '09:00' }, nextRunAt: null, optInConfirmed: false, createdAt: 0 };
    expect(validateSchedule(s)).toHaveLength(1);
    expect(validateSchedule({ ...s, optInConfirmed: true })).toHaveLength(0);
  });
});

describe('log csv', () => {
  it('guards formulas', () => {
    const csv = logToCsv([{ id: '1', ts: 0, campaignId: 'c', itemId: 'i', phone: '62', status: 'failed', mode: 'auto', error: '=cmd' }], { c: 'K' });
    expect(csv).toContain("'=cmd");
  });
});
