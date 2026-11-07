/**
 * Live activity feed of the sender ("Mengambil antrean…", "Memeriksa nomor…", "Mengirim pesan…", "Terkirim").
 * Written by the WhatsApp tab (content/outbox.ts) into chrome.storage.local and read by the Blast page.
 * Pure helpers only; no chrome / DOM here.
 */
export const ACTIVITY_KEY = 'wwt-ob-activity';
export const ACTIVITY_MAX = 300;

export type ActivityLevel = 'info' | 'work' | 'ok' | 'warn' | 'err';
export type ActivityStep = 'antre' | 'cek' | 'pesan' | 'chat' | 'kirim' | 'ok' | 'gagal' | 'draf' | 'tunggu' | 'stop';

export interface ActivityEvent {
  id: string;
  ts: number;
  level: ActivityLevel;
  step: ActivityStep;
  text: string;
  campaignId?: string;
  itemId?: string;
  phone?: string;
}

const LEVELS: ActivityLevel[] = ['info', 'work', 'ok', 'warn', 'err'];
const STEPS: ActivityStep[] = ['antre', 'cek', 'pesan', 'chat', 'kirim', 'ok', 'gagal', 'draf', 'tunggu', 'stop'];

/** Append, keeping only the newest `max` events (oldest dropped). Never mutates the input. */
export function pushActivity(list: ActivityEvent[], ev: ActivityEvent | ActivityEvent[], max = ACTIVITY_MAX): ActivityEvent[] {
  const add = Array.isArray(ev) ? ev : [ev];
  const out = list.concat(add);
  return out.length > max ? out.slice(out.length - max) : out;
}

/** Defensive parse of what is stored (may be missing, corrupt or from an older version). */
export function sanitizeActivity(raw: unknown): ActivityEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: ActivityEvent[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.ts !== 'number' || !Number.isFinite(o.ts) || typeof o.text !== 'string') continue;
    if (!LEVELS.includes(o.level as ActivityLevel) || !STEPS.includes(o.step as ActivityStep)) continue;
    out.push({
      id: o.id, ts: o.ts, level: o.level as ActivityLevel, step: o.step as ActivityStep, text: o.text.slice(0, 400),
      campaignId: typeof o.campaignId === 'string' ? o.campaignId : undefined,
      itemId: typeof o.itemId === 'string' ? o.itemId : undefined,
      phone: typeof o.phone === 'string' ? o.phone : undefined,
    });
  }
  return out.slice(-ACTIVITY_MAX);
}

/** Events to show for one campaign: its own events plus campaign-less ones (waiting / global stop). Newest first. */
export function eventsForCampaign(list: ActivityEvent[], campaignId: string, limit = 120): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  for (let i = list.length - 1; i >= 0 && out.length < limit; i--) {
    const e = list[i];
    if (!e.campaignId || e.campaignId === campaignId) out.push(e);
  }
  return out;
}

/** The most recent event that says what is happening right now (null when nothing happened in `staleMs`). */
export function currentActivity(list: ActivityEvent[], campaignId: string, now: number, staleMs = 5 * 60_000): ActivityEvent | null {
  const e = eventsForCampaign(list, campaignId, 1)[0];
  return e && now - e.ts <= staleMs ? e : null;
}

/** Same reason repeated every tick must not flood the feed: only log when the waiting reason changed. */
export function shouldLogWait(prev: string, next: string): boolean {
  return !!next && prev.trim() !== next.trim();
}

const p2 = (n: number) => String(n).padStart(2, '0');
export const fmtClock = (ts: number): string => { const d = new Date(ts); return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };

/** Shorten message text for the feed (single line, no control chars). */
export const snippet = (t: string, n = 70): string => {
  const one = String(t).replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

export const whoLabel = (name: string | undefined, phone: string): string => (name && name.trim() ? `${name.trim()} (+${phone})` : `+${phone}`);

/** Plain-text copy of the feed (oldest first) for support / pasting. */
export function activityToText(list: ActivityEvent[]): string {
  return list.map((e) => `[${fmtClock(e.ts)}] ${e.text}`).join('\n');
}
