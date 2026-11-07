import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_MAX, activityToText, currentActivity, eventsForCampaign, pushActivity, sanitizeActivity, shouldLogWait, snippet, whoLabel,
  type ActivityEvent,
} from './outbox-activity';

const ev = (i: number, over: Partial<ActivityEvent> = {}): ActivityEvent => ({ id: `e${i}`, ts: 1000 + i, level: 'info', step: 'antre', text: `t${i}`, ...over });

describe('aktivitas kampanye', () => {
  it('pushActivity membatasi jumlah dan tidak mengubah masukan', () => {
    const base = Array.from({ length: ACTIVITY_MAX }, (_, i) => ev(i));
    const out = pushActivity(base, ev(999));
    expect(out).toHaveLength(ACTIVITY_MAX);
    expect(out[out.length - 1].id).toBe('e999');
    expect(out[0].id).toBe('e1');
    expect(base[0].id).toBe('e0');
    expect(pushActivity([], [ev(1), ev(2)])).toHaveLength(2);
  });

  it('sanitizeActivity membuang data rusak', () => {
    const ok = ev(1, { campaignId: 'c1', phone: '628111' });
    const out = sanitizeActivity([ok, null, 5, { id: 'x' }, { ...ok, level: 'zzz' }, { ...ok, step: 'aneh' }, { ...ok, ts: NaN }, { ...ok, text: 'x'.repeat(900), id: 'long' }]);
    expect(out.map((e) => e.id)).toEqual(['e1', 'long']);
    expect(out[1].text).toHaveLength(400);
    expect(sanitizeActivity('bukan array')).toEqual([]);
  });

  it('eventsForCampaign: milik kampanye + tanpa kampanye, terbaru dulu', () => {
    const list = [ev(1, { campaignId: 'a' }), ev(2, { campaignId: 'b' }), ev(3), ev(4, { campaignId: 'a' })];
    expect(eventsForCampaign(list, 'a').map((e) => e.id)).toEqual(['e4', 'e3', 'e1']);
    expect(eventsForCampaign(list, 'a', 2)).toHaveLength(2);
  });

  it('currentActivity kosong bila sudah basi', () => {
    const list = [ev(1, { campaignId: 'a', ts: 10_000 })];
    expect(currentActivity(list, 'a', 20_000)?.id).toBe('e1');
    expect(currentActivity(list, 'a', 10_000 + 6 * 60_000)).toBeNull();
    expect(currentActivity([], 'a', 1)).toBeNull();
  });

  it('shouldLogWait hanya saat alasan berubah dan tidak kosong', () => {
    expect(shouldLogWait('', 'Di luar jam kirim')).toBe(true);
    expect(shouldLogWait('Di luar jam kirim', 'Di luar jam kirim ')).toBe(false);
    expect(shouldLogWait('A', 'B')).toBe(true);
    expect(shouldLogWait('A', '')).toBe(false);
  });

  it('format teks', () => {
    expect(snippet('halo\n\n  dunia   ini', 10)).toBe('halo duni…');
    expect(snippet('pendek')).toBe('pendek');
    expect(whoLabel('Budi', '628111')).toBe('Budi (+628111)');
    expect(whoLabel(' ', '628111')).toBe('+628111');
    expect(activityToText([ev(1, { text: 'a', ts: new Date(2026, 0, 1, 9, 5, 7).getTime() })])).toBe('[09:05:07] a');
  });
});
