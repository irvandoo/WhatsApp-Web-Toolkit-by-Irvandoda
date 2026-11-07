import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * UI settings that must survive a refresh (filters, selected tab, view mode, sort, form drafts...).
 * Stored in chrome.storage.local under 'wwt-ui:<key>' = on this PC, in the browser profile. localStorage is the
 * fallback where chrome.storage does not exist (tests, plain tab). Cleared only by the "Bersihkan" actions.
 */
export const UI_PREFIX = 'wwt-ui:';

type Area = { get: (k: string) => Promise<Record<string, unknown>>; set: (o: Record<string, unknown>) => Promise<void>; remove: (k: string | string[]) => Promise<void>; keys?: () => Promise<string[]> };

function area(): Area {
  try {
    const s = chrome?.storage?.local;
    if (s) {
      return {
        get: (k) => s.get(k) as Promise<Record<string, unknown>>,
        set: (o) => s.set(o),
        remove: (k) => s.remove(k),
        keys: async () => Object.keys(await s.get(null)),
      };
    }
  } catch { /* not an extension context */ }
  return {
    get: async (k) => { try { const v = localStorage.getItem(k); return v == null ? {} : { [k]: JSON.parse(v) }; } catch { return {}; } },
    set: async (o) => { try { for (const [k, v] of Object.entries(o)) localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota/blocked */ } },
    remove: async (k) => { try { for (const x of Array.isArray(k) ? k : [k]) localStorage.removeItem(x); } catch { /* ignore */ } },
    keys: async () => { try { return Object.keys(localStorage); } catch { return []; } },
  };
}

/** Same JS type as the default (and, for arrays/objects, a plain array/object). Guards against stale or corrupt stored values. */
export function sameShape<T>(value: unknown, initial: T): value is T {
  if (value === null || value === undefined) return false;
  if (Array.isArray(initial)) return Array.isArray(value);
  if (initial !== null && typeof initial === 'object') return typeof value === 'object' && !Array.isArray(value);
  return typeof value === typeof initial;
}

export async function readPersisted<T>(key: string, initial: T, validate: (v: unknown) => v is T = (v): v is T => sameShape(v, initial)): Promise<T> {
  try {
    const got = await area().get(UI_PREFIX + key);
    const v = got[UI_PREFIX + key];
    return validate(v) ? v : initial;
  } catch { return initial; }
}

export async function writePersisted(key: string, value: unknown): Promise<void> {
  try { await area().set({ [UI_PREFIX + key]: value }); } catch { /* best effort */ }
}

/** Remove saved UI settings (all, or only keys starting with `prefix`). Used by "Bersihkan" actions. */
export async function clearPersisted(prefix = ''): Promise<number> {
  try {
    const a = area();
    const keys = ((await a.keys?.()) ?? []).filter((k) => k.startsWith(UI_PREFIX + prefix));
    if (keys.length) await a.remove(keys);
    return keys.length;
  } catch { return 0; }
}

/**
 * useState that is restored from, and saved to, local storage.
 * Returns [value, setValue, ready]. Nothing is written before the stored value has been read (so the default never
 * overwrites a saved setting). Pass `ready` to delay rendering things that must start from the restored value.
 */
export function usePersistentState<T>(key: string, initial: T, validate?: (v: unknown) => v is T): [T, (v: T | ((p: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  const loaded = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    let live = true;
    void readPersisted(key, initial, validate).then((v) => {
      if (!live) return;
      loaded.current = true;
      if (v !== initial) setValue(v);
      setReady(true);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!loaded.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void writePersisted(key, latest.current); }, 300);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [key, value]);

  // flush a pending write when the page goes away (refresh / close)
  useEffect(() => {
    const flush = () => { if (loaded.current) void writePersisted(key, latest.current); };
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, [key]);

  const set = useCallback((v: T | ((p: T) => T)) => setValue(v), []);
  return [value, set, ready];
}
