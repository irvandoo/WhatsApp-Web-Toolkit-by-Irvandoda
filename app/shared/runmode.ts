import { IS_FULL } from './credit';

/**
 * "Mode Otomatis": one state in chrome.storage.local ('wwt-run') that tells every engine whether it may run in the
 * background, plus pure helpers that turn (run state + engine heartbeats) into a plain-Indonesian indicator.
 * No DOM here; the storage helpers only touch chrome.storage.local.
 */
export const RUN_KEY = 'wwt-run';
export const HEALTH_PREFIX = 'wwt-health:';
export const OB_KILL_KEY = 'ob:kill';
export const QS_PENDING_KEY = 'wwt-qs-pending';

export const ENGINE_IDS = ['tracker', 'autoReply', 'outbox', 'memory', 'sync', 'accountStatus'] as const;
export type EngineId = (typeof ENGINE_IDS)[number];
/** Engines the user can flip with a switch (sync stays manual). */
export const SWITCHABLE: EngineId[] = ['tracker', 'autoReply', 'outbox', 'memory', 'accountStatus'];

export const ENGINE_LABEL: Record<EngineId, string> = {
  tracker: 'Pencatat aktivitas chat',
  autoReply: 'Balas otomatis',
  outbox: 'Kirim terjadwal & blast',
  memory: 'Hemat memori',
  sync: 'Sinkron riwayat',
  accountStatus: 'Status akun WhatsApp',
};
export const ENGINE_HELP: Record<EngineId, string> = {
  tracker: 'Mencatat waktu pesan masuk/keluar (tanpa isi pesan) untuk statistik.',
  autoReply: 'Membalas pesan sesuai aturan yang Anda buat. Tidak pernah aktif sendiri.',
  outbox: 'Mengirim pesan terjadwal/blast yang Anda buat, dengan batas aman.',
  memory: 'Mengurangi beban memori WhatsApp Web saat tab tidak dilihat.',
  sync: 'Memuat riwayat chat lama. Dijalankan manual dari panel Sync.',
  accountStatus: 'Memantau apakah WhatsApp sudah login dan tersambung.',
};

export const HONESTY_BG = 'Otomatisasi hanya berjalan selama tab WhatsApp Web terbuka dan browser menyala. Ekstensi tidak bisa bekerja saat Chrome ditutup.';
export const HONESTY_RISK = 'Mengirim pesan otomatis dapat membuat WhatsApp membatasi akun. Gunakan seperlunya dan hanya ke kontak yang setuju.';

export const STALE_MS = 180_000;
/** pausedUntil value meaning "paused until the user resumes". */
export const PAUSE_MANUAL = 8.64e15;

export interface RunState {
  enabled: boolean;
  engines: Record<EngineId, boolean>;
  firstRunDone: boolean;
  pausedUntil?: number;
}

export function defaultRunState(full: boolean = IS_FULL): RunState {
  return {
    enabled: full,
    engines: { tracker: true, autoReply: false, outbox: true, memory: true, sync: false, accountStatus: true },
    firstRunDone: false,
  };
}

export function normalizeRunState(raw: unknown, full: boolean = IS_FULL): RunState {
  const d = defaultRunState(full);
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const e = r.engines && typeof r.engines === 'object' ? (r.engines as Record<string, unknown>) : {};
  const engines = { ...d.engines };
  for (const id of ENGINE_IDS) if (typeof e[id] === 'boolean') engines[id] = e[id] as boolean;
  const out: RunState = {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    engines,
    firstRunDone: r.firstRunDone === true,
  };
  if (typeof r.pausedUntil === 'number' && r.pausedUntil > 0) out.pausedUntil = r.pausedUntil;
  return out;
}

export const isPaused = (run: RunState, now: number): boolean => (run.pausedUntil ?? 0) > now;

/**
 * May this engine act right now? FULL: strictly follows the switches and the pause.
 * STORE: without "Mode Otomatis" everything keeps its legacy (manual/draft) behaviour; once the user turns the mode
 * on, the switches and the pause apply too. Send engines are draft-only in the store flavor regardless.
 */
export function engineOn(run: RunState, id: EngineId, now: number, full: boolean = IS_FULL): boolean {
  if (!full && !run.enabled) return true;
  return run.enabled && !isPaused(run, now) && run.engines[id];
}

export type PauseKind = 15 | 60 | 'tomorrow' | 'manual';
export function pauseUntil(kind: PauseKind, now: number): number {
  if (kind === 'manual') return PAUSE_MANUAL;
  if (kind === 'tomorrow') { const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(7, 0, 0, 0); return d.getTime(); }
  return now + kind * 60_000;
}

// ---------------- engine health ----------------
export type HealthState = 'jalan' | 'kerja' | 'siaga' | 'mati' | 'error';
export interface EngineHealth {
  state: HealthState;
  detail?: string;
  ts: number;
  done?: number;
  total?: number;
  failed?: number;
  /** machine-readable extra (slot state for accountStatus) */
  code?: string;
  ready?: boolean;
}
export type HealthMap = Partial<Record<EngineId, EngineHealth>>;

export const isFresh = (h: EngineHealth | undefined, now: number): h is EngineHealth => !!h && now - h.ts <= STALE_MS && now - h.ts > -60_000;

export type IndicatorLevel = 'ok' | 'working' | 'attention' | 'paused' | 'off';
export type ItemStatus = 'jalan' | 'siaga' | 'mati' | 'error';
export interface IndicatorItem { id: EngineId; label: string; status: ItemStatus; detail: string }
export interface Indicator { level: IndicatorLevel; title: string; detail: string; items: IndicatorItem[] }

export const fmtClock = (ts: number): string => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function buildItems(run: RunState, health: HealthMap, now: number, full: boolean): IndicatorItem[] {
  const paused = isPaused(run, now);
  return ENGINE_IDS.map((id): IndicatorItem => {
    const label = ENGINE_LABEL[id];
    const h = health[id];
    const fresh = isFresh(h, now);
    if (id === 'sync') {
      return fresh && h.state === 'kerja'
        ? { id, label, status: 'jalan', detail: h.detail ?? 'Sedang memuat riwayat' }
        : { id, label, status: 'mati', detail: 'Manual: mulai dari panel Sync' };
    }
    if (!run.engines[id]) {
      return { id, label, status: 'mati', detail: id === 'autoReply' ? 'Belum diaktifkan (aktifkan dulu satu aturan balasan)' : 'Dimatikan' };
    }
    if (paused) return { id, label, status: 'siaga', detail: 'Dijeda' };
    if (!fresh) return { id, label, status: 'siaga', detail: 'Menunggu tab WhatsApp Web' };
    const draft = !full && (id === 'outbox' || id === 'autoReply') ? 'Mode draf. ' : '';
    switch (h.state) {
      case 'error': return { id, label, status: 'error', detail: h.detail ?? 'Ada masalah' };
      case 'mati': return { id, label, status: 'mati', detail: h.detail ?? 'Tidak aktif' };
      case 'siaga': return { id, label, status: 'siaga', detail: draft + (h.detail ?? 'Siaga') };
      default: return { id, label, status: 'jalan', detail: draft + (h.detail ?? 'Berjalan') };
    }
  });
}

export function computeIndicator(run: RunState, health: HealthMap, now: number, full: boolean = IS_FULL): Indicator {
  const items = buildItems(run, health, now, full);
  if (!full) {
    return { level: 'off', title: 'Mode draf', detail: 'Pesan hanya disiapkan sebagai draf. Anda sendiri yang menekan Kirim; tidak ada kirim otomatis.', items };
  }
  if (!run.enabled) return { level: 'off', title: 'Mode Otomatis mati', detail: 'Tidak ada yang berjalan di latar belakang. Nyalakan kembali kapan saja.', items };
  if (isPaused(run, now)) {
    const until = (run.pausedUntil ?? 0) >= PAUSE_MANUAL ? 'dilanjutkan' : fmtClock(run.pausedUntil!);
    return { level: 'paused', title: `Dijeda sampai ${until}`, detail: 'Semua otomatisasi berhenti sementara. Tekan Lanjutkan untuk menjalankan lagi.', items };
  }
  const on = SWITCHABLE.filter((id) => run.engines[id]);
  if (!on.length) return { level: 'off', title: 'Semua mesin dimatikan', detail: 'Nyalakan minimal satu mesin agar ada yang berjalan.', items };

  const err = items.find((i) => i.status === 'error');
  if (err) {
    const login = items.find((i) => i.id === 'accountStatus' && i.status === 'error') ?? err;
    return { level: 'attention', title: `Perlu perhatian: ${login.detail}`, detail: `${login.label}: ${login.detail}`, items };
  }
  if (!on.some((id) => isFresh(health[id], now))) {
    return { level: 'attention', title: 'Perlu perhatian: tab WhatsApp Web belum dibuka', detail: 'Buka web.whatsapp.com dan biarkan tab tetap terbuka agar otomatisasi berjalan.', items };
  }
  const ob = health.outbox, ar = health.autoReply;
  if (run.engines.outbox && isFresh(ob, now) && ob.state === 'kerja') {
    const t = ob.total && ob.total > 0 ? ` dari ${ob.total}` : '';
    const n = Math.min(ob.total && ob.total > 0 ? ob.total : Infinity, (ob.done ?? 0) + 1);
    return { level: 'working', title: `Sedang mengirim ${n}${t}`, detail: ob.detail ?? 'Mengirim pesan sesuai batas aman.', items };
  }
  if (run.engines.autoReply && isFresh(ar, now) && ar.state === 'kerja') {
    return { level: 'working', title: 'Sedang membalas pesan', detail: ar.detail ?? 'Memproses pesan masuk sesuai aturan.', items };
  }
  const running = on.filter((id) => items.find((i) => i.id === id)?.status === 'jalan').map((id) => ENGINE_LABEL[id].toLowerCase());
  return { level: 'ok', title: 'Berjalan normal', detail: running.length ? `Aktif: ${running.join(', ')}.` : 'Siaga menunggu WhatsApp Web.', items };
}

/** Toolbar badge: only attention (and a pause) show something; everything else stays clean. */
export function computeBadge(i: Indicator, full: boolean = IS_FULL): { text: string; color: string } {
  if (!full) return { text: '', color: '#9aa5a0' };
  if (i.level === 'attention') return { text: '!', color: '#f2b84b' };
  if (i.level === 'paused') return { text: '||', color: '#9aa5a0' };
  return { text: '', color: '#58c487' };
}

// ---------------- storage helpers (chrome.storage.local) ----------------
export async function loadRun(full: boolean = IS_FULL): Promise<RunState> {
  try { const r = await chrome.storage.local.get(RUN_KEY); return normalizeRunState(r?.[RUN_KEY], full); } catch { return defaultRunState(full); }
}
export async function updateRun(fn: (r: RunState) => RunState | void, full: boolean = IS_FULL): Promise<RunState> {
  const cur = await loadRun(full);
  const next = normalizeRunState(fn(cur) ?? cur, full);
  try { await chrome.storage.local.set({ [RUN_KEY]: next }); } catch { /* ignore */ }
  return next;
}
export const setEnabled = (on: boolean) => updateRun((r) => { r.enabled = on; if (on) delete r.pausedUntil; });
export const pauseRun = (kind: PauseKind, now = Date.now()) => updateRun((r) => { r.pausedUntil = pauseUntil(kind, now); });
export const resumeRun = () => updateRun((r) => { delete r.pausedUntil; });
export async function setEngine(id: EngineId, on: boolean): Promise<RunState> {
  if (id === 'outbox' && on) { try { await chrome.storage.local.remove(OB_KILL_KEY); } catch { /* ignore */ } }
  return updateRun((r) => { r.engines[id] = on; });
}
/** Kill switch: stops automatic sending (campaign outbox + auto-reply) at once. */
export async function emergencyStopSend(): Promise<RunState> {
  try { await chrome.storage.local.set({ [OB_KILL_KEY]: true }); } catch { /* ignore */ }
  return updateRun((r) => { r.engines.outbox = false; r.engines.autoReply = false; });
}
export const markFirstRunDone = () => updateRun((r) => { r.firstRunDone = true; });
