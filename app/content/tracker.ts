import { call } from './bridge';
import { isEngineOn, reportHealth } from './engine-health';
import { phoneFromChatId } from '../shared/crm-logic';
import type { Interaction, MsgEvent, TrackMsg } from '../shared/analytics-types';
import type { ActivityScanResult, PingResult } from '../shared/messages';

const EVERY_MS = 30_000;
const BATCH = 500;
const SENT_CAP = 200_000;

/**
 * Passive activity tracker: scans WA's loaded messages (ids/timestamps/direction only, no bodies) and sends
 * only NEW events to the background, which merges them into the analytics tables.
 */
export function mountTracker(): void {
  const sent = new Set<string>();
  let timer: number | undefined;
  let busy = false;
  const stop = () => { if (timer) clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };

  async function scan() {
    if (busy) return;
    busy = true;
    try {
      if (!chrome.runtime?.id) return stop();
      if (!isEngineOn('tracker')) { reportHealth('tracker', { state: 'mati', detail: 'Dimatikan atau dijeda' }); return; }
      const p = await call<PingResult>({ type: 'ping' }, 5000);
      if (!p.accountId || !p.store) { reportHealth('tracker', { state: 'siaga', detail: 'Menunggu WhatsApp siap' }); return; }
      const acc = p.accountId;
      const res = await call<ActivityScanResult>({ type: 'activity:scan' }, 30_000);
      const events: MsgEvent[] = [];
      const interactions: Interaction[] = [];
      for (const c of res.chats) {
        const fresh: MsgEvent[] = [];
        let fi: number | null = null, fo: number | null = null, li: number | null = null, lo: number | null = null;
        for (const e of c.events) {
          if (e.fromMe) { fo = fo == null ? e.ts : Math.min(fo, e.ts); lo = lo == null ? e.ts : Math.max(lo, e.ts); }
          else { fi = fi == null ? e.ts : Math.min(fi, e.ts); li = li == null ? e.ts : Math.max(li, e.ts); }
          const key = `${acc}|${e.id}`;
          if (!sent.has(key)) fresh.push({ key, accountId: acc, chatId: c.id, ts: e.ts, dir: e.fromMe ? 'out' : 'in', isGroup: c.isGroup });
        }
        if (!fresh.length) continue;
        events.push(...fresh);
        const inCount = c.events.filter((e) => !e.fromMe).length;
        interactions.push({
          key: `${acc}|${c.id}`, accountId: acc, chatId: c.id, name: c.name, phone: phoneFromChatId(c.id), isGroup: c.isGroup,
          firstInTs: fi, firstOutTs: fo, lastInTs: li, lastOutTs: lo, inCount, outCount: c.events.length - inCount,
          partialHistory: true, // WA only exposes what is loaded; "first" may not be the true first
        });
      }
      reportHealth('tracker', { state: 'jalan', detail: events.length ? `Mencatat ${events.length} aktivitas baru` : 'Memantau aktivitas chat' });
      if (!events.length) return;
      // Batch by events; interactions go with the first batch (background recomputes counts from the events table).
      for (let i = 0; i < events.length; i += BATCH) {
        const batch = events.slice(i, i + BATCH);
        const msg: TrackMsg = { kind: 'track:put', events: batch, interactions: i === 0 ? interactions : [] };
        await chrome.runtime.sendMessage(msg);
        if (sent.size > SENT_CAP) sent.clear();
        for (const e of batch) sent.add(e.key);
      }
      // Interactions of chats whose events straddle later batches are refreshed on the next tick via recompute; send a
      // second pass so counts reflect all batches.
      if (events.length > BATCH) await chrome.runtime.sendMessage({ kind: 'track:put', events: [], interactions } satisfies TrackMsg);
    } catch (e) {
      if (!chrome.runtime?.id || /context invalidated/i.test(String(e))) stop(); // else adapter not ready, retry next tick
      else reportHealth('tracker', { state: 'siaga', detail: 'Menunggu WhatsApp siap' });
    } finally { busy = false; }
  }
  function onVis() { if (document.visibilityState === 'visible') void scan(); }
  document.addEventListener('visibilitychange', onVis);
  timer = window.setInterval(() => void scan(), EVERY_MS);
  setTimeout(() => void scan(), 3000);
}
