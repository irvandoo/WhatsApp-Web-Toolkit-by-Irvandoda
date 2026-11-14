import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES, dataUrlBytes, dataUrlToBlob, fitSize, formatBytes, isValidMedia } from './image-logic';
import { assertSendable, normalizeSafety, planCampaign } from './outbox-logic';
import type { MediaInput, OutboxItem } from './outbox-types';
import { hasContent, sanitizeDraft } from '../blast/draft';

// 1x1 transparent PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const img = (o: Partial<MediaInput> = {}): MediaInput => ({ name: 'promo.png', mime: 'image/png', bytes: 70, dataUrl: `data:image/png;base64,${PNG}`, ...o });
const base = (o = {}) => ({
  id: 'c1', name: 'Promo', template: '', source: 'csv' as const, optInConfirmed: true, now: new Date(2026, 2, 2, 9).getTime(),
  recipients: ['6281234567801', '6281234567802'].map((phone) => ({ phone })), genId: (() => { let i = 0; return () => `id${++i}`; })(), rng: () => 0,
  safety: normalizeSafety({ windowEnabled: false, warmup: false }), ...o,
});

describe('image-logic', () => {
  it('fitSize caps the longest side, keeps ratio, never upscales', () => {
    expect(fitSize(3200, 1600)).toEqual({ w: 1600, h: 800 });
    expect(fitSize(800, 600)).toEqual({ w: 800, h: 600 });
    expect(fitSize(0, 10)).toEqual({ w: 0, h: 0 });
  });
  it('dataUrlBytes decodes base64 length', () => {
    expect(dataUrlBytes(`data:image/png;base64,${PNG}`)).toBe(70);
    expect(dataUrlBytes('data:text/html;base64,AAAA')).toBe(0);
    expect(dataUrlBytes('nope')).toBe(0);
  });
  it('isValidMedia accepts real images only', () => {
    expect(isValidMedia(img())).toBe(true);
    expect(isValidMedia(img({ mime: 'image/gif' }))).toBe(false);
    expect(isValidMedia(img({ mime: 'image/jpeg' }))).toBe(false); // mime must match the data URL
    expect(isValidMedia(img({ dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' , mime: 'image/png' }))).toBe(false);
    expect(isValidMedia(img({ dataUrl: 'javascript:alert(1)' }))).toBe(false);
    expect(isValidMedia(undefined)).toBe(false);
  });
  it('rejects images over the size cap', () => {
    const big = `data:image/png;base64,${'A'.repeat(Math.ceil(((MAX_IMAGE_BYTES + 10) * 4) / 3))}`;
    expect(isValidMedia(img({ dataUrl: big }))).toBe(false);
  });
  it('dataUrlToBlob keeps type and size', () => {
    const b = dataUrlToBlob(`data:image/png;base64,${PNG}`);
    expect(b?.type).toBe('image/png');
    expect(b?.size).toBe(70);
    expect(dataUrlToBlob('x')).toBeNull();
  });
  it('formatBytes', () => { expect(formatBytes(2048)).toBe('2 KB'); expect(formatBytes(1572864)).toBe('1.5 MB'); });
});

describe('planCampaign with image', () => {
  it('empty text is an error without an image', () => {
    const r = planCampaign(base());
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/kosong/i);
  });
  it('image without caption is allowed and stores only metadata on the campaign', () => {
    const r = planCampaign(base({ media: img() }));
    expect(r.ok).toBe(true);
    expect(r.items).toHaveLength(2);
    expect(r.items.every((i) => i.text === '')).toBe(true);
    expect(r.campaign?.media).toEqual({ name: 'promo.png', mime: 'image/png', bytes: 70 });
    expect(JSON.stringify(r.campaign)).not.toContain(PNG); // bytes live in campaignMedia, not on the campaign
    expect(r.skipped).toHaveLength(0);
  });
  it('caption is rendered per recipient (variables + spintax)', () => {
    const r = planCampaign(base({ template: 'Hai {nama}', media: img(), recipients: [{ phone: '6281234567801', name: 'Budi' }] }));
    expect(r.items[0].text).toBe('Hai Budi');
  });
  it('an unresolved variable in the caption still skips the recipient', () => {
    const r = planCampaign(base({ template: 'Harga {harga}', media: img(), recipients: [{ phone: '6281234567801' }] }));
    expect(r.skipped[0]?.reason).toMatch(/Variabel/);
  });
  it('invalid image blocks the campaign', () => {
    const r = planCampaign(base({ media: img({ mime: 'image/gif' }) }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Gambar tidak valid/);
  });
  it('assertSendable: empty text only passes for an image campaign', () => {
    const plan = planCampaign(base({ media: img() }));
    const item = plan.items[0] as OutboxItem;
    expect(assertSendable(item, plan.campaign)).toBeNull();
    expect(assertSendable(item, { ...plan.campaign!, media: undefined })).toBe('Pesan kosong');
    expect(assertSendable(item, { ...plan.campaign!, optInConfirmed: false })).toMatch(/opt-in/);
  });
});

describe('draft keeps only the image metadata (bytes live in IndexedDB)', () => {
  const wiz = (mediaMeta: unknown) => ({ v: 1, wizard: { step: 2, name: 'x', body: '', recipients: [], source: 'csv', mediaMeta } });
  it('restores valid metadata and never carries a data URL', () => {
    const d = sanitizeDraft(wiz({ name: 'promo.png', mime: 'image/png', bytes: 70, dataUrl: 'data:image/png;base64,AAAA' }));
    expect(d?.wizard?.mediaMeta).toEqual({ name: 'promo.png', mime: 'image/png', bytes: 70 });
    expect(JSON.stringify(d)).not.toContain('base64');
  });
  it('drops tampered/invalid metadata', () => {
    expect(sanitizeDraft(wiz({ name: 'x', mime: 'text/html', bytes: 70 }))?.wizard?.mediaMeta).toBeUndefined();
    expect(sanitizeDraft(wiz({ name: 'x', mime: 'image/png', bytes: 0 }))?.wizard?.mediaMeta).toBeUndefined();
    expect(sanitizeDraft(wiz({ name: 'x', mime: 'image/png', bytes: MAX_IMAGE_BYTES + 1 }))?.wizard?.mediaMeta).toBeUndefined();
    expect(sanitizeDraft(wiz('junk'))?.wizard?.mediaMeta).toBeUndefined();
  });
  it('a draft with only an image counts as content', () => {
    expect(hasContent(sanitizeDraft(wiz({ name: 'p.png', mime: 'image/png', bytes: 70 })))).toBe(true);
  });
});

describe('isValidMedia cache', () => {
  it('stays correct after a cached success (different mime / url are re-checked)', () => {
    const ok = img();
    expect(isValidMedia(ok)).toBe(true);
    expect(isValidMedia(ok)).toBe(true);
    expect(isValidMedia({ ...ok, mime: 'image/jpeg' })).toBe(false);
    expect(isValidMedia({ ...ok, dataUrl: 'data:image/png;base64,@@@@' })).toBe(false);
  });
});
