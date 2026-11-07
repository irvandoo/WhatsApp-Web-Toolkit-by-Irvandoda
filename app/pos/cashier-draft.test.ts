import { describe, expect, it } from 'vitest';
import { EMPTY_CASH_DRAFT, isCashDraft } from './cashier-draft';

describe('draf kasir', () => {
  it('draf kosong valid', () => { expect(isCashDraft(EMPTY_CASH_DRAFT)).toBe(true); });
  it('menolak nilai rusak / enum usang', () => {
    expect(isCashDraft(null)).toBe(false);
    expect(isCashDraft({ ...EMPTY_CASH_DRAFT, method: 'bitcoin' })).toBe(false);
    expect(isCashDraft({ ...EMPTY_CASH_DRAFT, items: 'x' })).toBe(false);
    expect(isCashDraft({ ...EMPTY_CASH_DRAFT, taxPct: 11 })).toBe(true);
  });
});
