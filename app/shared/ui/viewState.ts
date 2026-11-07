import { useCallback, useState } from 'react';
import { flushSync } from 'react-dom';
import { clearPersisted } from './persist';

/** Validator for a string enum: a stale stored value falls back to the default. */
export const oneOf = <T extends string>(list: readonly T[]) => (v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/** Validator for an array of strings (ids). */
export const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * "Atur ulang tampilan": unmount the page body (its pending writes flush first), clear the saved keys, then mount it again so
 * every persisted hook inside starts from its default. `after` resets state that lives in the caller itself.
 */
export function useViewReset(prefixes: string[], after?: () => void): [boolean, () => Promise<void>] {
  const [off, setOff] = useState(false);
  const key = prefixes.join('|');
  const reset = useCallback(async () => {
    flushSync(() => setOff(true));
    for (const p of key.split('|')) await clearPersisted(p);
    after?.();
    setOff(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [off, reset];
}
