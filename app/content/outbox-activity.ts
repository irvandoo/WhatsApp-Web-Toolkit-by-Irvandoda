import { ACTIVITY_KEY, pushActivity, sanitizeActivity, type ActivityEvent, type ActivityLevel, type ActivityStep } from '../shared/outbox-activity';

let queue: ActivityEvent[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;

async function flush(): Promise<void> {
  timer = undefined;
  if (!queue.length) return;
  const batch = queue;
  queue = [];
  try {
    const got = await chrome.storage.local.get(ACTIVITY_KEY);
    await chrome.storage.local.set({ [ACTIVITY_KEY]: pushActivity(sanitizeActivity(got[ACTIVITY_KEY]), batch) });
  } catch { /* extension context gone or storage full: the feed is best-effort, never block sending */ }
}

/** Record what the sender is doing right now. Batched (one storage write per ~300 ms), never throws. */
export function logActivity(level: ActivityLevel, step: ActivityStep, text: string, extra: { campaignId?: string; itemId?: string; phone?: string } = {}): void {
  try {
    queue.push({ id: `${Date.now().toString(36)}-${(++seq).toString(36)}`, ts: Date.now(), level, step, text, ...extra });
    if (!timer) timer = setTimeout(() => { void flush(); }, 300);
  } catch { /* ignore */ }
}

export async function clearActivity(): Promise<void> {
  try { await chrome.storage.local.set({ [ACTIVITY_KEY]: [] }); } catch { /* ignore */ }
}
