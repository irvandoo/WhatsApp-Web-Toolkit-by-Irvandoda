import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db } from '../db';
import type { Account, AccountGroup, SessionMeta } from '../messages';

export const ONLINE_WINDOW_MS = 45_000;
export const isOnline = (a: Account, now = Date.now()) => a.online && now - a.lastSeen < ONLINE_WINDOW_MS;

function useLive<T>(q: () => Promise<T>, init: T): T {
  const [v, setV] = useState<T>(init);
  useEffect(() => {
    const sub = liveQuery(q).subscribe({ next: setV, error: () => {} });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return v;
}
export const useAccounts = () => useLive<Account[]>(() => db.accounts.toArray(), []);
export const useGroups = () => useLive<AccountGroup[]>(() => db.groups.toArray(), []);
export const useSessions = () => useLive<SessionMeta[]>(() => db.sessions.toArray(), []);

/** re-render every `ms` so online/relative-time stay fresh */
export function useNow(ms = 5000) {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setN(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return n;
}
