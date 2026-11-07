import type { RotState } from './rotation';
/** Auto-reply contracts (FROZEN). Pure logic lives in autoreply-logic.ts. */
export type ArTrigger = 'keyword' | 'first-message' | 'away-hours' | 'any';
export type ArMatchMode = 'contains' | 'exact' | 'regex-safe'; // regex-safe = word-boundary contains (no user regex)
export type ArMode = 'draft' | 'auto';

export interface ArSchedule { days: number[]; from: string; to: string } // days 0=Min..6=Sab, 'HH:MM'; business hours

export interface ArRule {
  id: string;
  name: string;
  enabled: boolean;
  order: number;
  trigger: ArTrigger;
  keywords: string[];
  matchMode: ArMatchMode;
  schedule?: ArSchedule;       // away-hours = reply OUTSIDE this schedule
  reply: string;               // template-engine syntax
  replyVariants?: string[];    // extra variants (reply is variant #1); max 10, each <= 1000 chars
  rotation?: 'random' | 'round-robin' | 'shuffle-bag';
  mode: ArMode;
  delaySec: [number, number];  // default [4,12]
  cooldownMin: number;         // per chat per rule, default 360
  maxPerHour: number;          // global cap of sent replies in the last hour (counted over the whole log), default 20
  onlyNewLeads: boolean;
  excludeOptOut: true;         // not editable
  groups: false;               // not editable
  stopAfterHumanReply: true;   // not editable
}

export type ArAction = 'draft' | 'sent' | 'skipped';
export interface ArLogEntry {
  id: string; ts: number; accountId: string; chatKey: string; chatName: string;
  ruleId: string; ruleName: string; action: ArAction; reason: string; text: string;
}

export interface ArGlobal { enabled: boolean; autoSend: boolean }
export const AR_GLOBAL_KEY = 'wwt-ar-global';
export const DEFAULT_AR_GLOBAL: ArGlobal = { enabled: false, autoSend: false };

export interface ArInbound { chatKey: string; text: string; ts: number; isGroup: boolean; isNewLead: boolean; optOut: boolean }
export interface ArDecision {
  action: 'skip' | 'draft' | 'send';
  rule?: ArRule; text?: string; delayMs?: number; reason: string;
  /** next rotation state for `rule.id` (persist it when the reply is actually used) */
  rotState?: RotState;
}

export type ArMsg =
  | { kind: 'ar:rules' }
  | { kind: 'ar:rule:upsert'; rule: ArRule }
  | { kind: 'ar:rule:delete'; id: string }
  | { kind: 'ar:rule:reorder'; ids: string[] }
  | { kind: 'ar:log'; entry: ArLogEntry }
  | { kind: 'ar:log:list'; limit?: number }
  | { kind: 'ar:ctx'; chatKey: string };

export interface ArCtx { isNewLead: boolean; lastOutTs: number | null; optOut: boolean; stage: string; name: string; phone: string }

export function newRule(order = 0): ArRule {
  return {
    id: crypto.randomUUID(), name: 'Aturan baru', enabled: false, order, trigger: 'keyword', keywords: [],
    matchMode: 'contains', reply: 'Halo {nama}, terima kasih sudah menghubungi kami.', mode: 'draft',
    delaySec: [4, 12], cooldownMin: 360, maxPerHour: 20, onlyNewLeads: false,
    excludeOptOut: true, groups: false, stopAfterHumanReply: true,
  };
}

/** One inbound item returned by the MAIN-world adapter `inbox:poll`. */
export interface InboxItem { chatId: string; name: string; msgId: string; ts: number; text: string; fromMe: false; lastOutTs: number | null }
