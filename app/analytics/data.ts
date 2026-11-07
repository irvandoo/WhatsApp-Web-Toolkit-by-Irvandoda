import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import type { DateRange, Interaction, MsgEvent } from '../shared/analytics-types';
import type { Contact } from '../shared/crm-types';
import { db } from '../shared/db';

export function useLive<T>(fn: () => Promise<T>, init: T, deps: unknown[] = []): T {
  const [v, setV] = useState<T>(init);
  useEffect(() => {
    const sub = liveQuery(fn).subscribe({ next: setV, error: () => {} });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return v;
}

export async function eventsIn(range: DateRange, accountId: string): Promise<MsgEvent[]> {
  if (range.key === 'all') return accountId ? db.events.where('accountId').equals(accountId).toArray() : db.events.toArray();
  if (accountId) return db.events.where('[accountId+ts]').between([accountId, range.from], [accountId, range.to], true, false).toArray();
  return db.events.where('ts').between(range.from, range.to, true, false).toArray();
}

export const useInteractions = () => useLive<Interaction[]>(() => db.interactions.toArray(), []);
export const useContacts = () => useLive<Contact[]>(() => db.contacts.toArray(), []);

/** earliest known timestamp (for the "all" range) */
export const useEarliest = () => useLive<number | undefined>(async () => {
  const e = await db.events.orderBy('ts').first();
  const i = await db.interactions.orderBy('firstInTs').filter((x) => x.firstInTs != null).first();
  const c = [e?.ts, i?.firstInTs ?? undefined].filter((x): x is number => typeof x === 'number');
  return c.length ? Math.min(...c) : undefined;
}, undefined);
