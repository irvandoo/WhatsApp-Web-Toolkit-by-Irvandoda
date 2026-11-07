import { db } from '../shared/db';
import { mergeInteraction } from '../shared/analytics-logic';
import type { Interaction, MsgEvent, TrackMsg } from '../shared/analytics-types';

export function isTrackMsg(m: unknown): m is TrackMsg {
  const k = (m as { kind?: unknown } | null)?.kind;
  return k === 'track:put' || k === 'track:clear';
}

/** Counts/first/last for one chat recomputed from the stored (deduplicated by key) events. */
async function fromEvents(accountId: string, chatId: string) {
  const evs = await db.events.where('chatId').equals(chatId).and((e) => e.accountId === accountId).toArray();
  let inCount = 0, outCount = 0;
  let firstIn: number | null = null, firstOut: number | null = null, lastIn: number | null = null, lastOut: number | null = null;
  for (const e of evs) {
    if (e.dir === 'in') {
      inCount++;
      firstIn = firstIn == null ? e.ts : Math.min(firstIn, e.ts);
      lastIn = lastIn == null ? e.ts : Math.max(lastIn, e.ts);
    } else {
      outCount++;
      firstOut = firstOut == null ? e.ts : Math.min(firstOut, e.ts);
      lastOut = lastOut == null ? e.ts : Math.max(lastOut, e.ts);
    }
  }
  return { inCount, outCount, firstIn, firstOut, lastIn, lastOut };
}

export async function handleTrack(m: TrackMsg): Promise<unknown> {
  if (m.kind === 'track:clear') {
    if (m.accountId) {
      await db.events.where('accountId').equals(m.accountId).delete();
      await db.interactions.where('accountId').equals(m.accountId).delete();
    } else {
      await db.events.clear();
      await db.interactions.clear();
    }
    return { cleared: true };
  }
  const events: MsgEvent[] = Array.isArray(m.events) ? m.events : [];
  const interactions: Interaction[] = Array.isArray(m.interactions) ? m.interactions : [];
  await db.transaction('rw', db.events, db.interactions, async () => {
    if (events.length) await db.events.bulkPut(events);
    for (const next of interactions) {
      const prev = await db.interactions.get(next.key);
      const r = await fromEvents(next.accountId, next.chatId);
      const merged = mergeInteraction(prev, {
        ...next, inCount: r.inCount, outCount: r.outCount,
        firstInTs: r.firstIn ?? next.firstInTs, firstOutTs: r.firstOut ?? next.firstOutTs,
        lastInTs: r.lastIn ?? next.lastInTs, lastOutTs: r.lastOut ?? next.lastOutTs,
      });
      await db.interactions.put(merged);
    }
  });
  return { events: events.length, interactions: interactions.length };
}
