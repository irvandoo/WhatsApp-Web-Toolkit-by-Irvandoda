import { describe, expect, it } from 'vitest';
import { buildBackup, cleanPlan, parseBackup, prepareRestore } from './backup-logic';
import { hasContent, sanitizeDraft } from './draft';
import type { Campaign, OutboxItem } from '../shared/outbox-types';

const camp = (id: string, status: Campaign['status'] = 'running'): Campaign => ({ id, name: `K ${id}`, status } as Campaign);
const item = (id: string, campaignId: string, status: OutboxItem['status'] = 'pending'): OutboxItem => ({ id, campaignId, phone: '628111111111', status, dueAt: 1 } as OutboxItem);

describe('draf Blast', () => {
  it('menolak data rusak/versi lain', () => {
    expect(sanitizeDraft(null)).toBeNull();
    expect(sanitizeDraft({ v: 2 })).toBeNull();
    expect(sanitizeDraft('x')).toBeNull();
  });
  it('membersihkan penerima dan membatasi nilai', () => {
    const d = sanitizeDraft({
      v: 1, savedAt: 5, tab: 'jadwal',
      wizard: { step: 99, name: 'K', body: 'halo', optIn: true, later: false, startLocal: '2026-11-08T10:00', source: 'aneh', safety: { delayMinSec: 1, delayMaxSec: 99999999 },
        recipients: [{ phone: '628111111111', name: 'Budi' }, { phone: 'abc' }, { phone: '12' }, null, { phone: '628222222222', vars: { a: 'b', c: 5 } }] },
    })!;
    expect(d.wizard!.step).toBe(4);
    expect(d.wizard!.source).toBe('csv');
    expect(d.wizard!.recipients.map((r) => r.phone)).toEqual(['628111111111', '628222222222']);
    expect(d.wizard!.recipients[1].vars).toEqual({ a: 'b' });
    expect(d.wizard!.safety.delayMinSec).toBe(8);
    expect(d.wizard!.safety.delayMaxSec).toBe(86_400);
    expect(d.tab).toBe('jadwal');
  });
  it('hasContent hanya bila ada yang terisi', () => {
    expect(hasContent(null)).toBe(false);
    expect(hasContent(sanitizeDraft({ v: 1, savedAt: 1, wizard: { step: 1, name: '', body: '', recipients: [] } }))).toBe(false);
    expect(hasContent(sanitizeDraft({ v: 1, savedAt: 1, wizard: { step: 1, name: 'x', body: '', recipients: [] } }))).toBe(true);
  });
});

describe('cadangan Blast', () => {
  const base = { campaigns: [camp('a'), camp('b', 'done')], outbox: [item('i1', 'a'), item('i2', 'a', 'sending')], schedules: [{ id: 's1', enabled: true } as never], sendLog: [{ id: 'l1' } as never], activity: [], draft: null };
  it('round-trip dan penolakan berkas asing', () => {
    const text = JSON.stringify(buildBackup(base, 123));
    const r = parseBackup(text);
    expect(r.ok && r.backup.campaigns).toHaveLength(2);
    expect(parseBackup('bukan json').ok).toBe(false);
    expect(parseBackup('{"app":"lain","v":1}').ok).toBe(false);
    expect(parseBackup('{"app":"wwt-blast","v":9}').ok).toBe(false);
  });
  it('baris rusak dilewati dan dihitung', () => {
    const r = parseBackup(JSON.stringify({ app: 'wwt-blast', v: 1, campaigns: [{ id: 'a', name: 'x' }, { id: 5 }, null], outbox: [{ id: 'i', campaignId: 'a' }], schedules: [], sendLog: [] }));
    expect(r.ok && r.backup.campaigns).toHaveLength(1);
    expect(r.ok && r.backup.outbox).toHaveLength(0);
    expect(r.ok && r.dropped).toBe(3);
  });
  it('pemulihan membuat kampanye berjalan dijeda, jadwal nonaktif, item sending jadi pending', () => {
    const p = prepareRestore(buildBackup(base, 1));
    expect(p.campaigns[0].status).toBe('paused');
    expect(p.campaigns[0].pausedReason).toMatch(/Dipulihkan/);
    expect(p.campaigns[1].status).toBe('done');
    expect(p.outbox[1].status).toBe('pending');
    expect(p.schedules[0].enabled).toBe(false);
  });
});

describe('rencana pembersihan', () => {
  const c = { campaigns: [camp('a'), camp('b', 'done'), camp('c', 'stopped')], outbox: [item('1', 'a'), item('2', 'b'), item('3', 'c'), item('4', 'c')], schedules: [{ id: 's' } as never], sendLog: 7, activity: 9 };
  it('hanya kampanye selesai/dihentikan', () => {
    const p = cleanPlan(['finished'], c);
    expect(p.campaignIds.sort()).toEqual(['b', 'c']);
    expect(p.items).toBe(3);
    expect(p.draft).toBe(false);
  });
  it('semua kampanye diblokir bila ada yang berjalan', () => {
    const p = cleanPlan(['campaigns'], c);
    expect(p.blocked).toMatch(/masih berjalan/);
    expect(p.campaignIds).toEqual([]);
  });
  it('log dan draf dihitung sesuai pilihan', () => {
    const p = cleanPlan(['activity', 'sendLog', 'draft', 'schedules'], c);
    expect(p).toMatchObject({ activity: 9, sendLog: 7, draft: true, schedules: 1, campaignIds: [] });
    expect(cleanPlan([], c)).toMatchObject({ activity: 0, sendLog: 0, draft: false, schedules: 0 });
  });
});
