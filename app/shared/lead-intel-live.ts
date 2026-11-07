import { liveQuery } from 'dexie';
import { useEffect, useMemo, useState } from 'react';
import type { Interaction, MsgEvent } from './analytics-types';
import type { Contact } from './crm-types';
import { db } from './db';
import { computeAll, D, type LeadIntel } from './lead-intel-logic';

/** Live events of the last 30 days (Dexie liveQuery) + client-side lead intel for the given data. No snippets (not persisted). */
export function useLeadIntel(interactions: Interaction[], contacts: Contact[], now: number): Map<string, LeadIntel> {
  const [events, setEvents] = useState<MsgEvent[]>([]);
  useEffect(() => {
    const sub = liveQuery(() => db.events.where('ts').aboveOrEqual(Date.now() - 30 * D).toArray()).subscribe({ next: setEvents, error: () => {} });
    return () => sub.unsubscribe();
  }, []);
  return useMemo(() => computeAll(interactions, events, contacts, now), [interactions, events, contacts, now]);
}
