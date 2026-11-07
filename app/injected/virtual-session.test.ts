// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { installVirtualSession } from './virtual-session';

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  } as unknown as Storage;
}
function fakeWin(sid: string | null, hash = '') {
  const listeners: Array<(e: any) => void> = [];
  const ss = fakeStorage();
  if (sid) ss.setItem('wwt-sid', sid);
  const idb = {
    open: vi.fn((n: string) => n), deleteDatabase: vi.fn((n: string) => n),
    databases: vi.fn(async () => [{ name: 'wwt:abc12345:a', version: 1 }, { name: 'wwt:zzz:b', version: 2 }, { name: 'orig', version: 3 }]),
  };
  class BC { constructor(public name: string) {} }
  const win: any = {
    sessionStorage: ss, localStorage: fakeStorage(), indexedDB: idb, BroadcastChannel: BC,
    location: { hash, pathname: '/', search: '' }, history: { state: null, replaceState: vi.fn() },
    addEventListener: (_t: string, fn: any) => listeners.push(fn),
  };
  return { win, idb, listeners };
}

describe('virtual-session', () => {

  it('does nothing for default / absent sid', () => {
    const { win, idb } = fakeWin(null);
    const ls = win.localStorage, open = idb.open;
    expect(installVirtualSession(win)).toBeNull();
    expect(win.localStorage).toBe(ls);
    expect(idb.open).toBe(open);
    expect(installVirtualSession(fakeWin('default').win)).toBeNull();
  });

  it('prefixes indexedDB and filters databases()', async () => {
    const { win, idb } = fakeWin('abc12345');
    const raw = idb.open, rawDel = idb.deleteDatabase;
    expect(installVirtualSession(win)).toBe('abc12345');
    expect(win.indexedDB.open('model')).toBe('wwt:abc12345:model');
    expect(raw).toHaveBeenCalledWith('wwt:abc12345:model');
    win.indexedDB.deleteDatabase('x');
    expect(rawDel).toHaveBeenCalledWith('wwt:abc12345:x');
    expect(await win.indexedDB.databases()).toEqual([{ name: 'a', version: 1 }]);
  });

  it('scopes localStorage', () => {
    const { win } = fakeWin('abc12345');
    const real = win.localStorage as Storage;
    real.setItem('outside', '1');
    real.setItem('wwt:other:k', '2');
    installVirtualSession(win);
    const ls = win.localStorage as Storage;
    expect(ls.length).toBe(0);
    expect(ls.getItem('outside')).toBeNull();
    ls.setItem('a', '1'); (ls as any).b = 2;
    expect(real.getItem('wwt:abc12345:a')).toBe('1');
    expect(ls.length).toBe(2);
    expect(ls.key(0)).toBe('a');
    expect(Object.keys(ls).sort()).toEqual(['a', 'b']);
    expect('a' in ls).toBe(true);
    expect('outside' in ls).toBe(false);
    expect((ls as any).b).toBe('2');
    const seen: string[] = []; for (const k in ls) seen.push(k);
    expect(seen.sort()).toEqual(['a', 'b']);
    delete (ls as any).b;
    ls.clear();
    expect(ls.length).toBe(0);
    expect(real.getItem('outside')).toBe('1');
    expect(real.getItem('wwt:other:k')).toBe('2');
  });

  it('prefixes BroadcastChannel names', () => {
    const { win } = fakeWin('abc12345');
    installVirtualSession(win);
    expect(new win.BroadcastChannel('wa').name).toBe('wwt:abc12345:wa');
  });

  it('filters storage events', () => {
    const { win, listeners } = fakeWin('abc12345');
    const real = win.localStorage;
    installVirtualSession(win);
    const [fn] = listeners;
    const foreign: any = { storageArea: real, key: 'x', stopImmediatePropagation: vi.fn() };
    fn(foreign); expect(foreign.stopImmediatePropagation).toHaveBeenCalled();
    const mine: any = { storageArea: real, key: 'wwt:abc12345:k', stopImmediatePropagation: vi.fn() };
    fn(mine); expect(mine.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(mine.key).toBe('k');
    expect(mine.storageArea).toBe(win.localStorage);
  });

  it('applies and strips #wwt-sid= hash', () => {
    const { win } = fakeWin(null, '#wwt-sid=newslot1');
    expect(installVirtualSession(win)).toBe('newslot1');
    expect(win.sessionStorage.getItem('wwt-sid')).toBe('newslot1');
    expect(win.history.replaceState).toHaveBeenCalled();
  });

  it('never throws on broken environments', () => {
    expect(installVirtualSession({})).toBeNull();
    const { win } = fakeWin('abc12345');
    win.indexedDB = null; win.BroadcastChannel = undefined;
    expect(() => installVirtualSession(win)).not.toThrow();
  });
});
