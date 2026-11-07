import type { ActivityEvent } from '../shared/outbox-activity';
import { sanitizeActivity } from '../shared/outbox-activity';
import type { Campaign, OutboxItem, Schedule, SendLogEntry } from '../shared/outbox-types';
import { sanitizeDraft, type BlastDraft } from './draft';

/** Backup of all Blast data (campaigns, queue, schedules, send log, activity feed, draft) as one JSON file. */
export interface BlastBackup {
  app: 'wwt-blast';
  v: 1;
  exportedAt: number;
  campaigns: Campaign[];
  outbox: OutboxItem[];
  schedules: Schedule[];
  sendLog: SendLogEntry[];
  activity: ActivityEvent[];
  draft: BlastDraft | null;
}

export const MAX_BACKUP_ROWS = 300_000;

export function buildBackup(d: Omit<BlastBackup, 'app' | 'v' | 'exportedAt'>, now = Date.now()): BlastBackup {
  return { app: 'wwt-blast', v: 1, exportedAt: now, ...d };
}

const hasStr = (o: unknown, ...keys: string[]): boolean => !!o && typeof o === 'object' && keys.every((k) => typeof (o as Record<string, unknown>)[k] === 'string' && (o as Record<string, string>)[k] !== '');
const rows = <T>(v: unknown, ok: (x: unknown) => boolean): T[] => (Array.isArray(v) ? (v.filter(ok) as T[]) : []);

export type ParsedBackup = { ok: true; backup: BlastBackup; dropped: number } | { ok: false; error: string };

/** Strict parse: wrong file type/version is rejected, malformed rows are dropped and counted. */
export function parseBackup(text: string): ParsedBackup {
  let o: unknown;
  try { o = JSON.parse(text); } catch { return { ok: false, error: 'Berkas bukan JSON yang valid.' }; }
  if (!o || typeof o !== 'object' || (o as { app?: unknown }).app !== 'wwt-blast') return { ok: false, error: 'Ini bukan berkas cadangan Blast dari ekstensi ini.' };
  if ((o as { v?: unknown }).v !== 1) return { ok: false, error: 'Versi cadangan tidak dikenali.' };
  const r = o as Record<string, unknown>;
  const total = ['campaigns', 'outbox', 'schedules', 'sendLog'].reduce((n, k) => n + (Array.isArray(r[k]) ? (r[k] as unknown[]).length : 0), 0);
  if (total > MAX_BACKUP_ROWS) return { ok: false, error: `Cadangan terlalu besar (${total} baris).` };
  const campaigns = rows<Campaign>(r.campaigns, (x) => hasStr(x, 'id', 'name'));
  const outbox = rows<OutboxItem>(r.outbox, (x) => hasStr(x, 'id', 'campaignId', 'phone'));
  const schedules = rows<Schedule>(r.schedules, (x) => hasStr(x, 'id'));
  const sendLog = rows<SendLogEntry>(r.sendLog, (x) => hasStr(x, 'id'));
  const dropped = total - (campaigns.length + outbox.length + schedules.length + sendLog.length);
  return {
    ok: true, dropped,
    backup: { app: 'wwt-blast', v: 1, exportedAt: typeof r.exportedAt === 'number' ? r.exportedAt : 0, campaigns, outbox, schedules, sendLog, activity: sanitizeActivity(r.activity), draft: sanitizeDraft(r.draft) },
  };
}

/**
 * Make a restored backup safe: a campaign that was running must NOT start sending by itself right after a restore
 * (its pending messages may be long overdue). It comes back paused with an explanation; the user resumes it.
 * Items that were mid-send go back to pending.
 */
export function prepareRestore(b: BlastBackup): BlastBackup {
  return {
    ...b,
    campaigns: b.campaigns.map((c) => (c.status === 'running'
      ? { ...c, status: 'paused' as const, pausedReason: 'Dipulihkan dari cadangan. Periksa lalu klik Lanjutkan.' }
      : c)),
    outbox: b.outbox.map((i) => (i.status === 'sending' ? { ...i, status: 'pending' as const } : i)),
    schedules: b.schedules.map((s) => ({ ...s, enabled: false })),
  };
}

export type CleanKind = 'draft' | 'activity' | 'sendLog' | 'finished' | 'campaigns' | 'schedules';
export const CLEAN_LABEL: Record<CleanKind, string> = {
  draft: 'Draf isian yang belum dikirim (wizard & formulir jadwal)',
  activity: 'Log aktivitas langsung',
  sendLog: 'Log kirim (riwayat pesan terkirim, dipakai untuk batas harian)',
  finished: 'Kampanye selesai/dihentikan beserta daftar pesannya',
  campaigns: 'SEMUA kampanye beserta antriannya (harus tidak ada yang berjalan)',
  schedules: 'Semua pesan terjadwal',
};

/** What a clean-up would remove, so the confirmation can show real numbers. */
export function cleanPlan(kinds: CleanKind[], c: { campaigns: Campaign[]; outbox: OutboxItem[]; schedules: Schedule[]; sendLog: number; activity: number }):
  { blocked?: string; campaignIds: string[]; items: number; schedules: number; sendLog: number; activity: number; draft: boolean } {
  const want = new Set(kinds);
  const running = c.campaigns.filter((x) => x.status === 'running');
  if (want.has('campaigns') && running.length) {
    return { blocked: `Ada ${running.length} kampanye yang masih berjalan. Hentikan dulu di tab Berjalan.`, campaignIds: [], items: 0, schedules: 0, sendLog: 0, activity: 0, draft: false };
  }
  const ids = new Set<string>();
  if (want.has('campaigns')) c.campaigns.forEach((x) => ids.add(x.id));
  else if (want.has('finished')) c.campaigns.filter((x) => x.status === 'done' || x.status === 'stopped').forEach((x) => ids.add(x.id));
  return {
    campaignIds: [...ids],
    items: c.outbox.filter((i) => ids.has(i.campaignId)).length,
    schedules: want.has('schedules') ? c.schedules.length : 0,
    sendLog: want.has('sendLog') ? c.sendLog : 0,
    activity: want.has('activity') ? c.activity : 0,
    draft: want.has('draft'),
  };
}
