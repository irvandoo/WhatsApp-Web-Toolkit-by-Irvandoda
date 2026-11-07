/**
 * Lead intelligence (pure, deterministic; no DOM / chrome / Dexie).
 *
 * Inputs are ONLY timestamps + direction (MsgEvent, no bodies are ever stored), the per-chat Interaction summary,
 * an optional CRM Contact, and an optional transient text snippet of the latest incoming message that the caller
 * reads from the DOM. The snippet is used for keyword intent only and is never stored or returned.
 *
 * Limits (shown in UI): signals only reflect what WhatsApp Web exposed to the tracker; intent is keyword based, not AI.
 */
import type { Interaction, MsgEvent } from './analytics-types';
import type { Contact } from './crm-types';
import { formatDuration, toCsv } from './analytics-logic';

export const H = 3600e3;
export const D = 24 * H;

export type Intent = 'tanya-harga' | 'siap-beli' | 'komplain' | 'tanya-info' | 'lainnya';
export type Temperature = 'hot' | 'warm' | 'cold' | 'dormant';
export type Momentum = 'rising' | 'steady' | 'slipping' | 'stalled';
export type FollowPriority = 'urgent' | 'high' | 'normal' | 'low';

export interface LeadIntel {
  key: string; accountId: string; chatId: string; name: string; phone: string;
  lastSender: 'in' | 'out' | null;
  lastActivityTs: number | null;
  ourAvgResponseMs: number | null;   // how fast WE answer them (their msg -> our reply)
  theirAvgResponseMs: number | null; // how fast THEY answer us (our msg -> their reply)
  totalMsgs: number; inCount: number; outCount: number; msgs7d: number;
  engagement: number;                // 0..100, see engagementScore()
  intent: Intent | null;             // null = no snippet supplied
  temperature: Temperature;
  momentum: Momentum;
  followUpPriority: FollowPriority;
  reason: string;                    // Indonesian
  nextAction: string;                // Indonesian
  /** ms since the last inbound message while it is still unanswered (0 when we spoke last). */
  waitingMs: number;
  stage?: string; tags?: string[]; value?: number; optOut?: boolean;
}

export interface IntelInput {
  interaction?: Interaction | null;
  events: MsgEvent[];
  contact?: Contact | null;
  /** Transient text of the latest incoming message. Never persisted. */
  snippet?: string | null;
  now: number;
}

// ---------- intent (Indonesian keyword rules, first match wins in this order) ----------

const RULES: [Intent, RegExp][] = [
  ['komplain', /\b(komplain|complain|kecewa|mengecewakan|refund|retur|lambat|lama banget|rusak|cacat|tidak sesuai|ga sesuai|gak sesuai|salah kirim|penipu|tipu|batal(kan)?|belum sampai|belum datang)\b/],
  ['siap-beli', /\b(order|mau (beli|pesan|order|ambil)|saya (beli|pesan|ambil)|beli|checkout|transfer|sudah (tf|transfer|bayar)|tf|bayar|pembayaran|rekening|no rek|norek|dp|cod|deal|jadi (ambil|beli|pesan|order))\b/],
  ['tanya-harga', /\b(harga|berapa|brp|price|pricelist|price list|diskon|potongan|nego|tawar|ongkir|biaya|tarif|murah)\b/],
  ['tanya-info', /\b(stok|stock|ready|kirim|pengiriman|bisa|apakah|apa|gimana|bagaimana|info|informasi|ukuran|warna|katalog|spesifikasi|detail|promo|alamat|lokasi|jam buka)\b|\?/],
];

/** Keyword intent from a transient snippet. null when no snippet; 'lainnya' when nothing matches. */
export function detectIntent(snippet: string | null | undefined): Intent | null {
  if (snippet == null) return null;
  const t = snippet.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return null;
  for (const [intent, re] of RULES) if (re.test(t)) return intent;
  return 'lainnya';
}

// ---------- response times ----------

interface Gap { ts: number; ms: number; who: 'our' | 'their' }
/** Replies slower than this are treated as a conversation restart, not a response time. */
export const MAX_GAP_MS = 7 * D;

/**
 * A "response" is the first message of a run after a run in the opposite direction; latency = reply ts - FIRST
 * message of the previous run (the moment the other side started waiting). out-after-in = our response,
 * in-after-out = their response. events must be sorted by ts asc.
 */
export function responseGaps(sorted: MsgEvent[]): Gap[] {
  const out: Gap[] = [];
  let runStart = 0, runDir: 'in' | 'out' | null = null;
  for (const e of sorted) {
    if (runDir === null) { runDir = e.dir; runStart = e.ts; continue; }
    if (e.dir !== runDir) {
      const ms = e.ts - runStart;
      if (ms >= 0 && ms <= MAX_GAP_MS) out.push({ ts: e.ts, ms, who: e.dir === 'out' ? 'our' : 'their' });
      runDir = e.dir; runStart = e.ts;
    }
  }
  return out;
}
const avg = (a: number[]): number | null => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);

// ---------- engagement ----------

/**
 * Engagement score 0..100 = sum of five capped components:
 *  - recency    (0..30): 30 * 0.5^(daysSinceLastActivity / 5)       (half-life 5 days)
 *  - reciprocity(0..20): 20 * min(in,out)/max(in,out)               (both sides talking; 0 if one-sided)
 *  - frequency  (0..20): 20 * min(msgs7d, 20)/20                    (messages in the last 7 days)
 *  - speed      (0..15): their avg response <=10m 15, <=1h 11, <=6h 7, <=24h 3, slower/unknown 0
 *  - stage/value(0..15): stage keyword (deal 10, negosiasi/penawaran 8, dihubungi/follow 4, selesai 3, other 2)
 *                        + value bonus (>0: 3, >=1.000.000: 5); capped at 15
 * Opt-out contacts keep the score but are never "hot".
 */
export function engagementScore(p: {
  ageMs: number | null; inCount: number; outCount: number; msgs7d: number; theirAvgMs: number | null; stage?: string; value?: number;
}): number {
  const recency = p.ageMs == null ? 0 : 30 * Math.pow(0.5, Math.max(0, p.ageMs) / (5 * D));
  const hi = Math.max(p.inCount, p.outCount), lo = Math.min(p.inCount, p.outCount);
  const reciprocity = hi > 0 ? 20 * (lo / hi) : 0;
  const frequency = 20 * Math.min(p.msgs7d, 20) / 20;
  const t = p.theirAvgMs;
  const speed = t == null ? 0 : t <= 10 * 60e3 ? 15 : t <= H ? 11 : t <= 6 * H ? 7 : t <= D ? 3 : 0;
  const st = (p.stage ?? '').toLowerCase();
  let sv = /deal|menang|won/.test(st) ? 10 : /negosiasi|penawaran|quotation|nego/.test(st) ? 8 : /dihubungi|follow/.test(st) ? 4 : /selesai|closed/.test(st) ? 3 : st ? 2 : 0;
  const v = p.value ?? 0;
  sv += v >= 1_000_000 ? 5 : v > 0 ? 3 : 0;
  sv = Math.min(15, sv);
  return Math.max(0, Math.min(100, Math.round(recency + reciprocity + frequency + speed + sv)));
}

// ---------- temperature / momentum ----------

/**
 * Temperature thresholds:
 *  - dormant: no activity, or last activity >= 14 days ago
 *  - hot:  not opt-out AND ( lastSender=in AND age <= 48h AND (intent siap-beli|tanya-harga OR engagement >= 60)
 *                           OR age <= 3d AND engagement >= 70 )
 *  - warm: age <= 7d AND engagement >= 35, or age <= 48h with any inbound
 *  - cold: otherwise
 */
export function temperatureOf(p: {
  ageMs: number | null; lastSender: 'in' | 'out' | null; intent: Intent | null; engagement: number; inCount: number; optOut?: boolean;
}): Temperature {
  if (p.ageMs == null || p.ageMs >= 14 * D) return 'dormant';
  const buying = p.intent === 'siap-beli' || p.intent === 'tanya-harga';
  if (!p.optOut) {
    if (p.lastSender === 'in' && p.ageMs <= 2 * D && (buying || p.engagement >= 60)) return 'hot';
    if (p.ageMs <= 3 * D && p.engagement >= 70) return 'hot';
  }
  if ((p.ageMs <= 7 * D && p.engagement >= 35) || (p.ageMs <= 2 * D && p.inCount > 0)) return 'warm';
  return 'cold';
}

/**
 * Momentum compares msgs in the last 3 days (cur) vs the 3 days before (prev):
 *  - stalled: last activity >= 7 days ago
 *  - rising:  cur > prev and (prev>0 ? cur >= 1.3*prev : cur >= 2)
 *  - slipping: prev >= 2 and cur <= prev/2, or reply latency got >= 2x slower (recent 3d vs 3..10d, recent >= 1h)
 *  - steady: otherwise
 */
export function momentumOf(sorted: MsgEvent[], now: number, ageMs: number | null): Momentum {
  if (ageMs == null || ageMs >= 7 * D) return 'stalled';
  let cur = 0, prev = 0;
  for (const e of sorted) {
    if (e.ts > now - 3 * D && e.ts <= now) cur++;
    else if (e.ts > now - 6 * D && e.ts <= now - 3 * D) prev++;
  }
  if (cur > prev && (prev > 0 ? cur >= 1.3 * prev : cur >= 2)) return 'rising';
  if (prev >= 2 && cur <= prev / 2) return 'slipping';
  const gaps = responseGaps(sorted);
  const recent = avg(gaps.filter((g) => g.ts > now - 3 * D).map((g) => g.ms));
  const earlier = avg(gaps.filter((g) => g.ts <= now - 3 * D && g.ts > now - 10 * D).map((g) => g.ms));
  if (recent != null && earlier != null && recent >= H && recent >= 2 * earlier) return 'slipping';
  return 'steady';
}

// ---------- follow-up priority ----------

const dur = formatDuration;

function nextByIntent(i: Intent | null): string {
  switch (i) {
    case 'siap-beli': return 'Kirim detail pembayaran dan konfirmasi order';
    case 'tanya-harga': return 'Kirim daftar harga dan penawaran';
    case 'komplain': return 'Tanggapi keluhan dan tawarkan solusi';
    case 'tanya-info': return 'Jawab pertanyaan dan arahkan ke order';
    default: return 'Balas pesan';
  }
}

export function followUp(p: {
  temperature: Temperature; momentum: Momentum; intent: Intent | null; lastSender: 'in' | 'out' | null;
  waitingMs: number; ageMs: number | null; engagement: number; optOut?: boolean; totalMsgs: number;
}): { priority: FollowPriority; reason: string; nextAction: string } {
  const w = p.waitingMs;
  if (p.optOut) return { priority: 'low', reason: 'Jangan dihubungi (opt-out)', nextAction: 'Jangan kirim pesan' };
  if (p.totalMsgs === 0 || p.ageMs == null) return { priority: 'low', reason: 'Belum ada percakapan terlacak', nextAction: 'Mulai percakapan' };
  if (p.lastSender === 'in') {
    if (p.intent === 'komplain' && w >= 30 * 60e3) return { priority: 'urgent', reason: `Komplain belum dibalas ${dur(w)}`, nextAction: 'Minta maaf dan tawarkan solusi' };
    if (p.temperature === 'hot') {
      if (w >= 4 * H) return { priority: 'urgent', reason: `Hot lead belum dibalas ${dur(w)}`, nextAction: nextByIntent(p.intent) };
      if (w >= 30 * 60e3) return { priority: 'high', reason: `Hot lead menunggu ${dur(w)}`, nextAction: nextByIntent(p.intent) };
      return { priority: 'normal', reason: 'Hot lead baru masuk', nextAction: nextByIntent(p.intent) };
    }
    if (w >= D) return { priority: 'urgent', reason: `Belum dibalas ${dur(w)}`, nextAction: 'Balas sekarang dan minta maaf atas keterlambatan' };
    if (w >= 6 * H) return { priority: 'high', reason: `Belum dibalas ${dur(w)}`, nextAction: nextByIntent(p.intent) };
    if (w >= H) return { priority: 'normal', reason: `Menunggu balasan ${dur(w)}`, nextAction: nextByIntent(p.intent) };
    return { priority: 'low', reason: 'Pesan baru masuk', nextAction: nextByIntent(p.intent) };
  }
  // we spoke last (or direction unknown)
  if ((p.momentum === 'slipping' || p.momentum === 'stalled') && p.engagement >= 40 && p.ageMs < 14 * D)
    return { priority: 'high', reason: `Mulai kehilangan momentum (sepi ${dur(p.ageMs)})`, nextAction: 'Kirim follow-up singkat atau penawaran baru' };
  if (p.temperature !== 'dormant' && p.ageMs >= 2 * D && p.engagement >= 20)
    return { priority: 'normal', reason: `Belum ada balasan ${dur(p.ageMs)}`, nextAction: 'Kirim pengingat ramah' };
  if (p.temperature === 'dormant' && p.engagement >= 40)
    return { priority: 'low', reason: `Tidak aktif ${dur(p.ageMs)}`, nextAction: 'Pertimbangkan reaktivasi (promo)' };
  return { priority: 'low', reason: 'Tidak ada tindakan mendesak', nextAction: 'Pantau' };
}

// ---------- main ----------

export function computeLeadIntel(inp: IntelInput): LeadIntel {
  const { interaction: it, contact, now } = inp;
  const evs = [...inp.events].sort((x, y) => x.ts - y.ts);
  const last = evs[evs.length - 1];

  let lastSender: 'in' | 'out' | null = null;
  let lastTs: number | null = null;
  if (last) { lastSender = last.dir; lastTs = last.ts; }
  // The interaction summary may know of a newer message than the (limited) event window.
  if (it) {
    if (it.lastInTs != null && (lastTs == null || it.lastInTs > lastTs)) { lastTs = it.lastInTs; lastSender = 'in'; }
    if (it.lastOutTs != null && (lastTs == null || it.lastOutTs > lastTs)) { lastTs = it.lastOutTs; lastSender = 'out'; }
  }

  const evIn = evs.reduce((n, e) => n + (e.dir === 'in' ? 1 : 0), 0);
  const inCount = Math.max(it?.inCount ?? 0, evIn);
  const outCount = Math.max(it?.outCount ?? 0, evs.length - evIn);
  const totalMsgs = inCount + outCount;
  const msgs7d = evs.reduce((n, e) => n + (e.ts > now - 7 * D && e.ts <= now ? 1 : 0), 0);

  const gaps = responseGaps(evs);
  const ourAvg = avg(gaps.filter((g) => g.who === 'our').map((g) => g.ms));
  const theirAvg = avg(gaps.filter((g) => g.who === 'their').map((g) => g.ms));

  const ageMs = lastTs == null ? null : Math.max(0, now - lastTs);
  const engagement = engagementScore({ ageMs, inCount, outCount, msgs7d, theirAvgMs: theirAvg, stage: contact?.stage, value: contact?.value });
  const intent = detectIntent(inp.snippet);
  const temperature = temperatureOf({ ageMs, lastSender, intent, engagement, inCount, optOut: contact?.optOut });
  const momentum = momentumOf(evs, now, ageMs);
  const waitingMs = lastSender === 'in' && ageMs != null ? ageMs : 0;
  const f = followUp({ temperature, momentum, intent, lastSender, waitingMs, ageMs, engagement, optOut: contact?.optOut, totalMsgs });

  return {
    key: it?.key ?? contact?.key ?? (last ? `${last.accountId}|${last.chatId}` : ''),
    accountId: it?.accountId ?? contact?.accountId ?? last?.accountId ?? '',
    chatId: it?.chatId ?? contact?.chatId ?? last?.chatId ?? '',
    name: it?.name || contact?.name || '', phone: it?.phone || contact?.phone || '',
    lastSender, lastActivityTs: lastTs, ourAvgResponseMs: ourAvg, theirAvgResponseMs: theirAvg,
    totalMsgs, inCount, outCount, msgs7d, engagement, intent, temperature, momentum,
    followUpPriority: f.priority, reason: f.reason, nextAction: f.nextAction, waitingMs,
    stage: contact?.stage, tags: contact?.tags, value: contact?.value, optOut: contact?.optOut,
  };
}

/** Batch: events grouped by chat once. snippets (optional) keyed by chat key, transient. */
export function computeAll(
  interactions: Interaction[], events: MsgEvent[], contacts: Contact[], now: number, snippets?: Map<string, string>,
): Map<string, LeadIntel> {
  const byChat = new Map<string, MsgEvent[]>();
  for (const e of events) {
    const k = `${e.accountId}|${e.chatId}`;
    const a = byChat.get(k);
    if (a) a.push(e); else byChat.set(k, [e]);
  }
  const cmap = new Map(contacts.map((c) => [c.key, c]));
  const out = new Map<string, LeadIntel>();
  for (const i of interactions) {
    out.set(i.key, computeLeadIntel({ interaction: i, events: byChat.get(i.key) ?? [], contact: cmap.get(i.key), snippet: snippets?.get(i.key), now }));
  }
  for (const c of contacts) {
    if (out.has(c.key)) continue;
    out.set(c.key, computeLeadIntel({ interaction: null, events: byChat.get(c.key) ?? [], contact: c, snippet: snippets?.get(c.key), now }));
  }
  return out;
}

const PRANK: Record<FollowPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
/** Sorted by priority, then engagement desc, then waiting desc, then key (stable). Returns a new array. */
export function rankFollowUps(list: LeadIntel[]): LeadIntel[] {
  return [...list].sort((a, b) =>
    PRANK[a.followUpPriority] - PRANK[b.followUpPriority] || b.engagement - a.engagement || b.waitingMs - a.waitingMs || a.key.localeCompare(b.key));
}

/** "Losing momentum": engaged (>=35) but slipping or stalled; not dormant, not opt-out. */
export function slippingLeads(list: LeadIntel[]): LeadIntel[] {
  return list
    .filter((l) => !l.optOut && (l.momentum === 'slipping' || l.momentum === 'stalled') && l.engagement >= 35 && l.temperature !== 'dormant' && l.totalMsgs > 0)
    .sort((a, b) => b.engagement - a.engagement || a.key.localeCompare(b.key));
}

export function hotLeads(list: LeadIntel[]): LeadIntel[] {
  return rankFollowUps(list.filter((l) => l.temperature === 'hot'));
}

// ---------- labels & CSV ----------

export const TEMP_LABEL: Record<Temperature, string> = { hot: 'Hot', warm: 'Warm', cold: 'Cold', dormant: 'Dormant' };
export const MOMENTUM_LABEL: Record<Momentum, string> = { rising: 'Naik', steady: 'Stabil', slipping: 'Menurun', stalled: 'Mandek' };
export const MOMENTUM_GLYPH: Record<Momentum, string> = { rising: '↗', steady: '→', slipping: '↘', stalled: '⏸' };
export const INTENT_LABEL: Record<Intent, string> = {
  'tanya-harga': 'Tanya harga', 'siap-beli': 'Siap beli', komplain: 'Komplain', 'tanya-info': 'Tanya info', lainnya: 'Lainnya',
};
export const FOLLOW_LABEL: Record<FollowPriority, string> = { urgent: 'Mendesak', high: 'Tinggi', normal: 'Normal', low: 'Rendah' };

export const INTEL_NOTE = 'Sinyal dihitung dari waktu dan arah pesan yang terlihat oleh WhatsApp Web. Intent berbasis kata kunci, bukan AI.';

const iso = (ts: number | null) => (ts == null ? '' : new Date(ts).toISOString());

export function exportLeadIntelCsv(list: LeadIntel[]): string {
  const cols = ['name', 'phone', 'chat_id', 'temperature', 'engagement', 'momentum', 'follow_up_priority', 'reason', 'next_action',
    'intent', 'last_sender', 'last_activity', 'our_avg_response', 'their_avg_response', 'total_msgs', 'in_count', 'out_count', 'msgs_7d', 'waiting', 'stage', 'tags', 'opt_out'];
  return toCsv(list.map((l) => ({
    name: l.name, phone: l.phone, chat_id: l.chatId, temperature: l.temperature, engagement: l.engagement, momentum: l.momentum,
    follow_up_priority: l.followUpPriority, reason: l.reason, next_action: l.nextAction, intent: l.intent ?? '',
    last_sender: l.lastSender ?? '', last_activity: iso(l.lastActivityTs),
    our_avg_response: l.ourAvgResponseMs == null ? '' : formatDuration(l.ourAvgResponseMs),
    their_avg_response: l.theirAvgResponseMs == null ? '' : formatDuration(l.theirAvgResponseMs),
    total_msgs: l.totalMsgs, in_count: l.inCount, out_count: l.outCount, msgs_7d: l.msgs7d,
    waiting: l.waitingMs ? formatDuration(l.waitingMs) : '', stage: l.stage ?? '', tags: (l.tags ?? []).join(';'), opt_out: l.optOut ? 'ya' : '',
  })), cols);
}
