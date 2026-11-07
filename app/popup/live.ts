import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';

export function useLiveCount(q: () => Promise<number>): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const sub = liveQuery(q).subscribe({ next: setN, error: () => {} });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return n;
}
