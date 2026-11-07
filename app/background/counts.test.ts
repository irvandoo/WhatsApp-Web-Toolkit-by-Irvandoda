import { describe, expect, it } from 'vitest';
import { computeCounts, isCountsMsg } from './counts';
import type { Interaction } from '../shared/analytics-types';

const H = 3600e3;
const now = new Date(2026, 5, 10, 15).getTime();
const mk = (key: string, o: Partial<Interaction>): Interaction => ({
  key, accountId: 'a', chatId: key, name: key, phone: '', isGroup: false,
  firstInTs: null, firstOutTs: null, lastInTs: null, lastOutTs: null, inCount: 1, outCount: 0, partialHistory: false, ...o,
});

describe('computeCounts', () => {
  it('counts unanswered, urgent, new leads; skips groups and opt-out', () => {
    const list = [
      mk('a|1', { firstInTs: now - 2 * H, lastInTs: now - 2 * H }),
      mk('a|2', { firstInTs: now - 50 * H, lastInTs: now - 30 * H, firstOutTs: now - 49 * H, lastOutTs: now - 40 * H }),
      mk('a|3', { firstInTs: now - 5 * H, lastInTs: now - 5 * H, firstOutTs: now - 4 * H, lastOutTs: now - 4 * H }),
      mk('a|4', { lastInTs: now - H, isGroup: true }),
      mk('a|5', { lastInTs: now - H }),
    ];
    expect(computeCounts(list, new Set(['a|5']), now)).toEqual({ unanswered: 2, urgent: 1, newLeadsToday: 2 });
  });
  it('isCountsMsg', () => {
    expect(isCountsMsg({ kind: 'ui:counts' })).toBe(true);
    expect(isCountsMsg({ kind: 'ui:open' })).toBe(false);
    expect(isCountsMsg(null)).toBe(false);
  });
});
