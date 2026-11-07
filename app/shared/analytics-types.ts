/** Analytics contracts (frozen). Pure logic lives in analytics-logic.ts. */
export type Direction = 'in' | 'out';

/** Minimal message event (no body text — privacy). key = `${accountId}|${msgId}` */
export interface MsgEvent { key: string; accountId: string; chatId: string; ts: number; dir: Direction; isGroup: boolean }

/** Per-chat summary maintained by the tracker. key = `${accountId}|${chatId}` */
export interface Interaction {
  key: string; accountId: string; chatId: string; name: string; phone: string; isGroup: boolean;
  firstInTs: number | null; firstOutTs: number | null;
  lastInTs: number | null; lastOutTs: number | null;
  inCount: number; outCount: number;
  /** true when WA only exposed partial history, so "first" may not be the true first */
  partialHistory: boolean;
}

export type LeadKind = 'new' | 'followup' | 'existing';
/**
 * Definition (user-specified):
 *  - NEW LEAD: a number whose first known inbound message falls in the period AND we had never replied
 *    (no outbound) before that inbound message. Counted on the day of firstInTs.
 *  - FOLLOW-UP: a number that has already been replied to (firstOutTs != null) and sends/receives again.
 *  - A number that is not a new lead in the period but was messaging before = 'existing'.
 */
export type RangeKey = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom';
export interface DateRange { key: RangeKey; from: number; to: number } // epoch ms, [from, to)

export interface DayStat { date: string; newLeads: number; followUps: number; inbound: number; outbound: number }
export interface Summary {
  range: DateRange; newLeads: number; followUps: number; inbound: number; outbound: number;
  activeChats: number; unanswered: number; avgFirstResponseMs: number | null; days: DayStat[];
}

export interface UnansweredRow {
  key: string; accountId: string; chatId: string; name: string; phone: string;
  waitingSinceTs: number; waitingMs: number; kind: LeadKind; inCount: number;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  stage?: string; tags?: string[]; optOut?: boolean;
}

export type TrackMsg =
  | { kind: 'track:put'; events: MsgEvent[]; interactions: Interaction[] }
  | { kind: 'track:clear'; accountId?: string };

export const PRIORITY_THRESHOLDS_MS = { urgent: 24 * 3600e3, high: 6 * 3600e3, normal: 1 * 3600e3 } as const;
