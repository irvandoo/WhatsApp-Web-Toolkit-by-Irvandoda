import { beforeEach, describe, expect, it } from 'vitest';
import {
  PAUSE_MANUAL, STALE_MS, computeBadge, computeIndicator, defaultRunState, emergencyStopSend, engineOn, fmtClock, loadRun,
  normalizeRunState, pauseRun, pauseUntil, resumeRun, setEngine, type EngineHealth, type HealthMap,
} from './runmode';

const NOW = new Date(2026, 5, 10, 10, 0, 0).getTime();
const h = (state: EngineHealth['state'], extra: Partial<EngineHealth> = {}): EngineHealth => ({ state, ts: NOW - 5000, ...extra });
const allOk = (): HealthMap => ({
  tracker: h('jalan'), accountStatus: h('jalan', { code: 'online', ready: true }), memory: h('jalan'), outbox: h('jalan'),
});

describe('defaults / normalize', () => {
  it('full: on, safe engines, auto-reply and sync off', () => {
    const d = defaultRunState(true);
    expect(d.enabled).toBe(true);
    expect(d.engines).toEqual({ tracker: true, autoReply: false, outbox: true, memory: true, sync: false, accountStatus: true });
    expect(d.firstRunDone).toBe(false);
  });
  it('store: mode off by default', () => expect(defaultRunState(false).enabled).toBe(false));
  it('normalizes garbage', () => {
    const r = normalizeRunState({ enabled: 'x', engines: { tracker: false, outbox: 'yes' }, pausedUntil: -4, firstRunDone: 1 }, true);
    expect(r.enabled).toBe(true);
    expect(r.engines.tracker).toBe(false);
    expect(r.engines.outbox).toBe(true);
    expect(r.pausedUntil).toBeUndefined();
    expect(r.firstRunDone).toBe(false);
  });
});

describe('engineOn', () => {
  it('full honors switches, master and pause', () => {
    const r = defaultRunState(true);
    expect(engineOn(r, 'tracker', NOW, true)).toBe(true);
    expect(engineOn(r, 'autoReply', NOW, true)).toBe(false);
    expect(engineOn({ ...r, pausedUntil: NOW + 1000 }, 'tracker', NOW, true)).toBe(false);
    expect(engineOn({ ...r, pausedUntil: NOW - 1 }, 'tracker', NOW, true)).toBe(true);
    expect(engineOn({ ...r, enabled: false }, 'memory', NOW, true)).toBe(false);
  });
  it('store keeps legacy behaviour until the mode is turned on', () => {
    const r = defaultRunState(false);
    expect(engineOn(r, 'autoReply', NOW, false)).toBe(true);
    expect(engineOn({ ...r, enabled: true }, 'autoReply', NOW, false)).toBe(false);
  });
});

describe('pause helpers', () => {
  it('computes deadlines', () => {
    expect(pauseUntil(15, NOW)).toBe(NOW + 15 * 60_000);
    expect(pauseUntil('manual', NOW)).toBe(PAUSE_MANUAL);
    const t = new Date(pauseUntil('tomorrow', NOW));
    expect(t.getDate()).toBe(11);
    expect(t.getHours()).toBe(7);
  });
});

describe('computeIndicator', () => {
  const run = defaultRunState(true);
  it('ok', () => {
    const i = computeIndicator(run, allOk(), NOW, true);
    expect(i.level).toBe('ok');
    expect(i.title).toBe('Berjalan normal');
    expect(i.items).toHaveLength(6);
    expect(i.items.find((x) => x.id === 'autoReply')!.status).toBe('mati');
    expect(i.items.find((x) => x.id === 'sync')!.status).toBe('mati');
    expect(i.items.find((x) => x.id === 'tracker')!.status).toBe('jalan');
  });
  it('working shows live counts', () => {
    const i = computeIndicator(run, { ...allOk(), outbox: h('kerja', { done: 2, total: 40 }) }, NOW, true);
    expect(i.level).toBe('working');
    expect(i.title).toBe('Sedang mengirim 3 dari 40');
  });
  it('attention when WhatsApp is not logged in', () => {
    const i = computeIndicator(run, { ...allOk(), accountStatus: h('error', { detail: 'WhatsApp belum login', code: 'qr' }) }, NOW, true);
    expect(i.level).toBe('attention');
    expect(i.title).toBe('Perlu perhatian: WhatsApp belum login');
  });
  it('attention when no heartbeat at all (tab closed) and stale heartbeats are ignored', () => {
    expect(computeIndicator(run, {}, NOW, true).title).toContain('tab WhatsApp Web belum dibuka');
    const stale: HealthMap = { tracker: { state: 'jalan', ts: NOW - STALE_MS - 1 }, accountStatus: { state: 'jalan', ts: NOW - STALE_MS - 1 } };
    expect(computeIndicator(run, stale, NOW, true).level).toBe('attention');
  });
  it('paused until a clock time / manual', () => {
    const until = NOW + 30 * 60_000;
    expect(computeIndicator({ ...run, pausedUntil: until }, allOk(), NOW, true).title).toBe(`Dijeda sampai ${fmtClock(until)}`);
    expect(fmtClock(new Date(2026, 5, 10, 14, 30).getTime())).toBe('14:30');
    expect(computeIndicator({ ...run, pausedUntil: PAUSE_MANUAL }, allOk(), NOW, true).title).toBe('Dijeda sampai dilanjutkan');
  });
  it('off states', () => {
    expect(computeIndicator({ ...run, enabled: false }, allOk(), NOW, true).level).toBe('off');
    const none = { ...run, engines: { ...run.engines, tracker: false, outbox: false, memory: false, accountStatus: false } };
    expect(computeIndicator(none, allOk(), NOW, true).level).toBe('off');
  });
  it('store flavor shows Mode draf', () => {
    const i = computeIndicator(defaultRunState(false), allOk(), NOW, false);
    expect(i.title).toBe('Mode draf');
    expect(i.level).toBe('off');
  });
});

describe('computeBadge', () => {
  it('only attention and pause show a badge', () => {
    const run = defaultRunState(true);
    expect(computeBadge(computeIndicator(run, {}, NOW, true), true).text).toBe('!');
    expect(computeBadge(computeIndicator(run, allOk(), NOW, true), true).text).toBe('');
    expect(computeBadge(computeIndicator({ ...run, pausedUntil: NOW + 5000 }, allOk(), NOW, true), true).text).toBe('||');
    expect(computeBadge(computeIndicator(run, {}, NOW, true), false).text).toBe('');
  });
});

describe('storage actions', () => {
  let store: Record<string, unknown>;
  beforeEach(() => {
    store = {};
    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        local: {
          get: async (k: string | string[]) => { const ks = Array.isArray(k) ? k : [k]; return Object.fromEntries(ks.filter((x) => x in store).map((x) => [x, store[x]])); },
          set: async (o: Record<string, unknown>) => { Object.assign(store, o); },
          remove: async (k: string) => { delete store[k]; },
        },
      },
    };
  });
  it('pause / resume / engine switch persist', async () => {
    // module IS_FULL is false under vitest, so use the explicit flavor-neutral checks on the raw state
    await pauseRun(15, NOW);
    expect((store['wwt-run'] as { pausedUntil: number }).pausedUntil).toBe(NOW + 900_000);
    await resumeRun();
    expect((store['wwt-run'] as { pausedUntil?: number }).pausedUntil).toBeUndefined();
    await setEngine('tracker', false);
    expect((await loadRun(true)).engines.tracker).toBe(false);
  });
  it('emergency stop kills outbox + auto-reply and sets the global kill flag; re-enabling outbox clears it', async () => {
    await setEngine('autoReply', true);
    await emergencyStopSend();
    const r = await loadRun(true);
    expect(r.engines.outbox).toBe(false);
    expect(r.engines.autoReply).toBe(false);
    expect(store['ob:kill']).toBe(true);
    await setEngine('outbox', true);
    expect(store['ob:kill']).toBeUndefined();
  });
});
