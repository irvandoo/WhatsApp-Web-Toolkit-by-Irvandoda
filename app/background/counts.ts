import { db } from '../shared/db';
import { buildUnanswered, dayKeyOf, leadDayOf, resolveRange } from '../shared/analytics-logic';
import { PRIORITY_THRESHOLDS_MS, type Interaction } from '../shared/analytics-types';

export interface CountsMsg { kind: 'ui:counts' }
export interface Counts { unanswered: number; urgent: number; newLeadsToday: number }

/** Upper bound on rows scanned per request (keeps the 30s poll cheap on huge archives). */
const MAX_ROWS = 50_000;

export const isCountsMsg = (m: unknown): m is CountsMsg => (m as { kind?: unknown } | null)?.kind === 'ui:counts';

/** Pure: counts over non-group interactions, opted-out contacts excluded. */
export function computeCounts(interactions: Interaction[], optOut: Set<string>, now: number): Counts {
  const list = interactions.filter((i) => !i.isGroup && !optOut.has(i.key));
  const rows = buildUnanswered(list, now);
  const today = dayKeyOf(now);
  let newLeadsToday = 0;
  for (const i of list) if (leadDayOf(i) === today) newLeadsToday++;
  return {
    unanswered: rows.length,
    urgent: rows.filter((r) => r.waitingMs >= PRIORITY_THRESHOLDS_MS.urgent).length,
    newLeadsToday,
  };
}

export async function handleCounts(_m: CountsMsg): Promise<Counts> {
  const now = Date.now();
  const from = resolveRange('today', now).from;
  const [optList, waiting, fresh] = await Promise.all([
    db.contacts.filter((c) => c.optOut).primaryKeys(),
    db.interactions.where('lastInTs').above(0).filter((i) => !i.isGroup).limit(MAX_ROWS).toArray(),
    db.interactions.where('firstInTs').aboveOrEqual(from).filter((i) => !i.isGroup).limit(MAX_ROWS).toArray(),
  ]);
  const byKey = new Map<string, Interaction>();
  for (const i of waiting) byKey.set(i.key, i);
  for (const i of fresh) byKey.set(i.key, i);
  return computeCounts([...byKey.values()], new Set(optList as string[]), now);
}
