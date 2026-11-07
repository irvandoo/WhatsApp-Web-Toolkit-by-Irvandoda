/**
 * MAIN world, document_start, dependency-free. Namespace virtualization ("one tab, many logins"):
 * each tab has an active slot id kept in sessionStorage['wwt-sid'] (tab-scoped, survives reload).
 * 'default'/absent => nothing is touched. Otherwise, BEFORE WhatsApp's scripts run, we prefix
 * `wwt:<sid>:` onto indexedDB names, localStorage keys and BroadcastChannel names, so WA sees an
 * empty profile (shows a QR) and keeps each login's CryptoKeys inside its own IndexedDB.
 * A new tab can be pre-assigned a slot via URL hash `#wwt-sid=<id>` (read and stripped here).
 *
 * LIMITS: only one account is live per tab (others get no notifications while inactive);
 * Web Workers / Service Worker / Cache Storage / cookies are NOT virtualized; duplicating a tab
 * copies sessionStorage so both tabs share a sid and WA will complain ("open in another window");
 * untested against every WA release. Any failure leaves WhatsApp untouched.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export function installVirtualSession(win: Any): string | null {
  try {
    const KEY = 'wwt-sid';
    const ok = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9]{3,16}$/.test(s);
    let sid: string | null = null;
    try {
      const m = /[#&]wwt-sid=([a-z0-9]+)/.exec(win.location.hash || '');
      if (m) {
        if (ok(m[1])) { sid = m[1]; win.sessionStorage.setItem(KEY, sid); }
        win.history.replaceState(win.history.state, '', win.location.pathname + win.location.search);
      }
    } catch { /* ignore */ }
    if (!sid) {
      try { sid = win.sessionStorage.getItem(KEY); } catch { /* storage blocked */ }
    }
    if (!ok(sid) || sid === 'default') return null;
    const P = `wwt:${sid}:`;
    const real: Storage = win.localStorage;

    const guard = (fn: () => void) => { try { fn(); } catch { /* leave that API untouched */ } };

    // --- indexedDB ---
    guard(() => {
      const f = win.indexedDB;
      if (!f) return;
      const open = f.open, del = f.deleteDatabase, dbs = f.databases;
      const def = (k: string, v: unknown) => Object.defineProperty(f, k, { value: v, configurable: true, writable: true });
      def('open', function (name: string, ...r: Any[]) { return open.call(f, P + name, ...r); });
      def('deleteDatabase', function (name: string, ...r: Any[]) { return del.call(f, P + name, ...r); });
      if (typeof dbs === 'function') {
        def('databases', async function () {
          const all: { name?: string; version?: number }[] = await dbs.call(f);
          return all.filter((d) => typeof d.name === 'string' && d.name.startsWith(P)).map((d) => ({ ...d, name: (d.name as string).slice(P.length) }));
        });
      }
    });

    // --- localStorage: Proxy over the real storage, scoped to the prefix ---
    guard(() => {
      const keys = (): string[] => {
        const out: string[] = [];
        for (let i = 0; i < real.length; i++) { const k = real.key(i); if (k !== null && k.startsWith(P)) out.push(k.slice(P.length)); }
        return out;
      };
      const methods: Record<string, unknown> = {
        getItem: (k: string) => real.getItem(P + k),
        setItem: (k: string, v: string) => real.setItem(P + k, v),
        removeItem: (k: string) => real.removeItem(P + k),
        key: (i: number) => keys()[i] ?? null,
        clear: () => { for (const k of keys()) real.removeItem(P + k); },
      };
      const proxy = new Proxy(real, {
        get(_t, p) {
          if (p === 'length') return keys().length;
          if (typeof p === 'string' && Object.prototype.hasOwnProperty.call(methods, p)) return methods[p];
          if (typeof p === 'symbol') return p === Symbol.toStringTag ? 'Storage' : undefined;
          const v = real.getItem(P + p);
          return v === null ? undefined : v;
        },
        set(_t, p, v) { if (typeof p === 'string') real.setItem(P + p, String(v)); return true; },
        has(_t, p) { return typeof p === 'string' && (p in methods || p === 'length' || real.getItem(P + p) !== null); },
        deleteProperty(_t, p) { if (typeof p === 'string') real.removeItem(P + p); return true; },
        ownKeys() { return keys(); },
        getOwnPropertyDescriptor(_t, p) {
          if (typeof p !== 'string') return undefined;
          const v = real.getItem(P + p);
          return v === null ? undefined : { value: v, writable: true, enumerable: true, configurable: true };
        },
        defineProperty(_t, p, d) { if (typeof p === 'string' && 'value' in d) real.setItem(P + p, String(d.value)); return true; },
      });
      Object.defineProperty(win, 'localStorage', { get: () => proxy, configurable: true });

      // storage events: drop foreign-namespace ones, expose the stripped key for ours.
      win.addEventListener('storage', (e: StorageEvent) => {
        if (e.storageArea !== real) return;
        if (e.key === null || !e.key.startsWith(P)) { e.stopImmediatePropagation(); return; }
        Object.defineProperty(e, 'key', { value: e.key.slice(P.length) });
        Object.defineProperty(e, 'storageArea', { value: proxy });
      }, true);
    });

    // --- BroadcastChannel ---
    guard(() => {
      const BC = win.BroadcastChannel;
      if (typeof BC !== 'function') return;
      win.BroadcastChannel = class extends BC { constructor(name: string) { super(P + name); } };
    });

    return sid;
  } catch {
    return null;
  }
}

installVirtualSession(window);
