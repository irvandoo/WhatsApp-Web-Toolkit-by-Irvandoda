import { call } from './bridge';
import type { ArchivedMsg, ChatInfo, LoadEarlierResult, PingResult, RuntimeMsg } from '../shared/messages';

export interface SyncProgress { chatId: string; name: string; rounds: number; total: number; done: boolean; reachedStart: boolean; error?: string }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (min: number, max: number) => min + Math.random() * (max - min);

export const ping = () => call<PingResult>({ type: 'ping' }, 5000);
export const listChats = () => call<ChatInfo[]>({ type: 'chats:list' });

async function archive(chatId: string) {
  const msgs = await call<ArchivedMsg[]>({ type: 'chat:messages', chatId });
  if (msgs.length) await chrome.runtime.sendMessage({ kind: 'archive:put', msgs } satisfies RuntimeMsg);
  return msgs.length;
}

/** Load earlier history until WA reports the start, no growth for 3 rounds, or cancel. */
export async function syncChat(
  chat: ChatInfo, signal: AbortSignal, onProgress: (p: SyncProgress) => void, maxRounds = 400,
): Promise<SyncProgress> {
  const p: SyncProgress = { chatId: chat.id, name: chat.name, rounds: 0, total: chat.loaded, done: false, reachedStart: false };
  let stale = 0;
  try {
    while (!signal.aborted && p.rounds < maxRounds) {
      const r = await call<LoadEarlierResult>({ type: 'sync:loadEarlier', chatId: chat.id }, 90_000);
      p.rounds++;
      p.total = r.total;
      p.reachedStart = r.reachedStart;
      stale = r.added > 0 ? 0 : stale + 1;
      onProgress({ ...p });
      if (r.reachedStart || stale >= 3) break;
      await sleep(jitter(700, 1600)); // be gentle: on-demand sync hits the phone
    }
    await archive(chat.id);
  } catch (e) { p.error = e instanceof Error ? e.message : String(e); }
  p.done = true;
  onProgress({ ...p });
  return p;
}

export async function syncAll(
  chats: ChatInfo[], signal: AbortSignal, onProgress: (p: SyncProgress) => void,
): Promise<SyncProgress[]> {
  const out: SyncProgress[] = [];
  for (const c of chats) {
    if (signal.aborted) break;
    out.push(await syncChat(c, signal, onProgress));
    await sleep(jitter(1000, 2500));
  }
  return out;
}
