import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __setRunForTest, isEngineOn, onHealth, readAllHealth, reportHealth } from './engine-health';
import { defaultRunState } from '../shared/runmode';

function mkArea(store: Record<string, unknown>) {
  return {
    get: async (k: string[]) => Object.fromEntries(k.filter((x) => x in store).map((x) => [x, store[x]])),
    set: vi.fn(async (o: Record<string, unknown>) => { Object.assign(store, o); }),
  };
}

describe('engine health', () => {
  let session: Record<string, unknown>, local: Record<string, unknown>;
  beforeEach(() => {
    session = {}; local = {};
    (globalThis as { chrome?: unknown }).chrome = { storage: { session: mkArea(session), local: mkArea(local), onChanged: { addListener: vi.fn(), removeListener: vi.fn() } } };
  });

  it('writes to session storage and reads it back', async () => {
    reportHealth('tracker', { state: 'jalan', detail: 'ok', ts: 1000 });
    await new Promise((r) => setTimeout(r, 0));
    expect(session['wwt-health:tracker']).toMatchObject({ state: 'jalan', ts: 1000 });
    expect((await readAllHealth()).tracker?.detail).toBe('ok');
  });

  it('falls back to local when session is unavailable and read picks the newest', async () => {
    (globalThis as unknown as { chrome: { storage: { session: unknown } } }).chrome.storage.session = {
      get: async () => ({ 'wwt-health:outbox': { state: 'siaga', ts: 5 } }),
      set: async () => { throw new Error('no access'); },
    };
    reportHealth('outbox', { state: 'kerja', detail: 'x', ts: 50 });
    await new Promise((r) => setTimeout(r, 0));
    expect(local['wwt-health:outbox']).toMatchObject({ state: 'kerja', ts: 50 });
    expect((await readAllHealth()).outbox?.state).toBe('kerja');
  });

  it('notifies subscribers and throttles identical writes', async () => {
    const cb = vi.fn();
    const off = onHealth(cb);
    reportHealth('memory', { state: 'jalan', ts: 100 });
    reportHealth('memory', { state: 'jalan', ts: 200 });
    await new Promise((r) => setTimeout(r, 0));
    expect(cb).toHaveBeenCalledTimes(2);
    expect((globalThis as unknown as { chrome: { storage: { session: { set: { mock: { calls: unknown[] } } } } } }).chrome.storage.session.set.mock.calls).toHaveLength(1);
    off();
  });

  it('gate follows the run state', () => {
    const r = defaultRunState(true);
    __setRunForTest({ ...r, enabled: false, engines: { ...r.engines, tracker: false } });
    // module flavor is store under vitest: legacy rule applies until the mode is enabled
    expect(isEngineOn('tracker')).toBe(true);
    __setRunForTest({ ...r, enabled: true, engines: { ...r.engines, tracker: false } });
    expect(isEngineOn('tracker')).toBe(false);
    expect(isEngineOn('memory')).toBe(true);
    __setRunForTest({ ...r, enabled: true, pausedUntil: Date.now() + 60_000 });
    expect(isEngineOn('memory')).toBe(false);
  });
});
