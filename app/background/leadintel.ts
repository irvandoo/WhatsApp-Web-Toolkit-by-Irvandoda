import { db } from '../shared/db';
import type { MsgEvent } from '../shared/analytics-types';
import { D, computeAll, computeLeadIntel, hotLeads, rankFollowUps, slippingLeads, type LeadIntel } from '../shared/lead-intel-logic';

export type LiMsg =
  | { kind: 'li:get'; accountId: string; chatId: string; snippet?: string }
  | { kind: 'li:top'; accountId?: string; limit?: number };

export const isLiMsg = (m: unknown): m is LiMsg => {
  const k = (m as { kind?: unknown } | null)?.kind;
  return k === 'li:get' || k === 'li:top';
};

const EVENT_LIMIT = 400;
const TOP_WINDOW_MS = 30 * D;
const MAX_SNIPPET = 500;

/** Compact row for li:top (no snippet, no message bodies). */
export type LiRow = Pick<LeadIntel, 'key' | 'accountId' | 'chatId' | 'name' | 'phone' | 'temperature' | 'engagement' | 'momentum' | 'followUpPriority' | 'reason' | 'nextAction' | 'lastSender' | 'lastActivityTs' | 'waitingMs'>;
const slim = (l: LeadIntel): LiRow => ({
  key: l.key, accountId: l.accountId, chatId: l.chatId, name: l.name, phone: l.phone, temperature: l.temperature, engagement: l.engagement,
  momentum: l.momentum, followUpPriority: l.followUpPriority, reason: l.reason, nextAction: l.nextAction, lastSender: l.lastSender,
  lastActivityTs: l.lastActivityTs, waitingMs: l.waitingMs,
});

export async function handleLi(m: LiMsg): Promise<unknown> {
  const now = Date.now();
  if (m.kind === 'li:get') {
    if (typeof m.accountId !== 'string' || typeof m.chatId !== 'string') return null;
    const key = `${m.accountId}|${m.chatId}`;
    const all = await db.events.where('chatId').equals(m.chatId).and((e) => e.accountId === m.accountId).toArray();
    const events = all.sort((a, b) => a.ts - b.ts).slice(-EVENT_LIMIT);
    const [interaction, contact] = await Promise.all([db.interactions.get(key), db.contacts.get(key)]);
    // The snippet is used transiently for keyword intent only and is never stored or logged.
    const snippet = typeof m.snippet === 'string' ? m.snippet.slice(0, MAX_SNIPPET) : null;
    return computeLeadIntel({ interaction, events, contact, snippet, now });
  }
  const limit = Math.max(1, Math.min(200, Math.floor(m.limit ?? 20)));
  const since = now - TOP_WINDOW_MS;
  const acc = m.accountId;
  const [ints, contacts, events] = await Promise.all([
    acc ? db.interactions.where('accountId').equals(acc).toArray() : db.interactions.toArray(),
    acc ? db.contacts.where('accountId').equals(acc).toArray() : db.contacts.toArray(),
    (acc
      ? db.events.where('[accountId+ts]').between([acc, since], [acc, now + 1], true, true).toArray()
      : db.events.where('ts').between(since, now + 1, true, true).toArray()) as Promise<MsgEvent[]>,
  ]);
  const map = computeAll(ints.filter((i) => !i.isGroup), events, contacts, now);
  const list = [...map.values()];
  return {
    hot: hotLeads(list).slice(0, limit).map(slim),
    slipping: slippingLeads(list).slice(0, limit).map(slim),
    followUps: rankFollowUps(list.filter((l) => l.followUpPriority !== 'low')).slice(0, limit).map(slim),
  };
}
