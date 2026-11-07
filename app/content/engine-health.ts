import { IS_FULL } from '../shared/credit';
import {
  ENGINE_IDS, HEALTH_PREFIX, RUN_KEY, defaultRunState, engineOn, normalizeRunState,
  type EngineHealth, type EngineId, type HealthMap, type RunState,
} from '../shared/runmode';

/**
 * Engine heartbeats + the run-mode gate. Heartbeats go to chrome.storage.session (falls back to local when a
 * content script cannot reach session storage); readers merge both and keep the newest. No DOM.
 */
type Listener = (id: EngineId, h: EngineHealth) => void;
const listeners = new Set<Listener>();
const lastWrite = new Map<string, { sig: string; at: number }>();
const WRITE_EVERY_MS = 15_000;

export const healthKey = (id: EngineId): string => HEALTH_PREFIX + id;
const area = (name: 'session' | 'local'): chrome.storage.StorageArea | undefined => {
  try { return (chrome.storage as unknown as Record<string, chrome.storage.StorageArea | undefined>)?.[name]; } catch { return undefined; }
};

export function reportHealth(id: EngineId, h: Omit<EngineHealth, 'ts'> & { ts?: number }): void {
  const full: EngineHealth = { ...h, ts: h.ts ?? Date.now() };
  listeners.forEach((f) => { try { f(id, full); } catch { /* ignore */ } });
  const sig = JSON.stringify([full.state, full.detail, full.done, full.total, full.failed, full.code, full.ready]);
  const prev = lastWrite.get(id);
  if (prev && prev.sig === sig && full.ts - prev.at < WRITE_EVERY_MS) return;
  lastWrite.set(id, { sig, at: full.ts });
  void (async () => {
    const data = { [healthKey(id)]: full };
    try {
      const s = area('session');
      if (s) { await s.set(data); return; }
    } catch { /* fall through to local */ }
    try { await area('local')?.set(data); } catch { /* ignore */ }
  })();
}

/** Subscribe to heartbeats from this tab and from other contexts (storage changes). Returns unsubscribe. */
export function onHealth(cb: Listener): () => void {
  listeners.add(cb);
  const onChanged = (ch: Record<string, chrome.storage.StorageChange>) => {
    for (const id of ENGINE_IDS) {
      const c = ch[healthKey(id)];
      if (c?.newValue && typeof c.newValue === 'object') { try { cb(id, c.newValue as EngineHealth); } catch { /* ignore */ } }
    }
  };
  try { chrome.storage?.onChanged?.addListener(onChanged); } catch { /* ignore */ }
  return () => { listeners.delete(cb); try { chrome.storage?.onChanged?.removeListener(onChanged); } catch { /* ignore */ } };
}

const validHealth = (v: unknown): v is EngineHealth => !!v && typeof v === 'object' && typeof (v as EngineHealth).ts === 'number' && typeof (v as EngineHealth).state === 'string';

/** Newest heartbeat per engine across session + local storage. */
export async function readAllHealth(): Promise<HealthMap> {
  const keys = ENGINE_IDS.map(healthKey);
  const out: HealthMap = {};
  for (const name of ['session', 'local'] as const) {
    try {
      const got = await area(name)?.get(keys);
      if (!got) continue;
      for (const id of ENGINE_IDS) {
        const v = got[healthKey(id)];
        if (validHealth(v) && (!out[id] || v.ts > out[id]!.ts)) out[id] = v;
      }
    } catch { /* ignore */ }
  }
  return out;
}

// ---------------- run-mode gate (sync reads for the engines) ----------------
let run: RunState = defaultRunState(IS_FULL);
let gateReady: Promise<void> | null = null;
const runSubs = new Set<(r: RunState) => void>();
const setRun = (r: RunState) => { run = r; runSubs.forEach((f) => { try { f(r); } catch { /* ignore */ } }); };

export function initRunGate(): Promise<void> {
  if (gateReady) return gateReady;
  gateReady = (async () => {
    try {
      const r = await chrome.storage.local.get(RUN_KEY);
      setRun(normalizeRunState(r?.[RUN_KEY], IS_FULL));
    } catch { /* keep defaults */ }
    try {
      chrome.storage.onChanged.addListener((ch, a) => {
        if (a === 'local' && ch[RUN_KEY]) setRun(normalizeRunState(ch[RUN_KEY].newValue, IS_FULL));
      });
    } catch { /* ignore */ }
  })();
  return gateReady;
}

export const getRunState = (): RunState => run;
/** May this engine act right now? (switch on, not paused, mode enabled) */
export const isEngineOn = (id: EngineId): boolean => engineOn(run, id, Date.now(), IS_FULL);
export function onRunChange(cb: (r: RunState) => void): () => void { runSubs.add(cb); return () => { runSubs.delete(cb); }; }

/** test helper */
export function __setRunForTest(r: RunState): void { setRun(r); }
