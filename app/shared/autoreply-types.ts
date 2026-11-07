import type { RotState } from './rotation';
/** Auto-reply contracts (FROZEN). Pure logic lives in autoreply-logic.ts. */
export type ArTrigger = 'keyword' | 'first-message' | 'away-hours' | 'any';
export type ArMatchMode = 'contains' | 'exact' | 'regex-safe'; // regex-safe = word-boundary contains (no user regex)
export type ArMode = 'draft' | 'auto';

/** Who may trigger a rule: 1:1 chats, groups, or both. Old rules without the field are migrated to 'personal'. */
export type ArScope = 'personal' | 'group' | 'all';
export const AR_SCOPES: ArScope[] = ['personal', 'group', 'all'];
/** A group reference. `id` = '' means a manually typed name (store flavor / group not loaded): matched by name. */
export interface ArGroupRef { id: string; name: string }
/** Extra, stricter guards for group replies. The floors (cooldown >= 5, maxPerHour >= 1) cannot be disabled. */
export interface ArGroupCfg {
  allow: ArGroupRef[];         // groups where the rule may reply (must not be empty for group/all scope)
  deny: ArGroupRef[];          // always ignored, wins over allow
  requireMention: boolean;     // default true: only if I am mentioned or the message quotes me
  groupCooldownMin: number;    // group-wide cooldown (any author), default 10, min 5
  maxPerHour: number;          // sent replies/hour over all groups, default 6 (separate from personal cap)
}
export const GROUP_COOLDOWN_MIN = 5;
export const DEFAULT_GROUP_CFG: ArGroupCfg = { allow: [], deny: [], requireMention: true, groupCooldownMin: 10, maxPerHour: 6 };

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
  scope: ArScope;              // default 'personal'
  grp: ArGroupCfg;             // only used when scope is 'group' | 'all'
  excludeOptOut: true;         // not editable
  groups: false;               // LEGACY marker kept for stored data; group behaviour is now governed by `scope` + `grp`
  stopAfterHumanReply: true;   // not editable
}

export type ArAction = 'draft' | 'sent' | 'skipped';
export interface ArLogEntry {
  id: string; ts: number; accountId: string; chatKey: string; chatName: string;
  ruleId: string; ruleName: string; action: ArAction; reason: string; text: string;
  /** group replies only: sender wid (used for the per-author cooldown) */
  author?: string;
}

export interface ArGlobal { enabled: boolean; autoSend: boolean }
export const AR_GLOBAL_KEY = 'wwt-ar-global';
export const DEFAULT_AR_GLOBAL: ArGlobal = { enabled: false, autoSend: false };

export interface ArInbound {
  chatKey: string; text: string; ts: number; isGroup: boolean; isNewLead: boolean; optOut: boolean;
  /** group messages */
  author?: string; groupName?: string; mentionedMe?: boolean; quotedMe?: boolean;
  /** sent by the account owner (e.g. from another device) */
  fromMe?: boolean; isBot?: boolean;
}
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
    scope: 'personal', grp: { ...DEFAULT_GROUP_CFG, allow: [], deny: [] },
    excludeOptOut: true, groups: false, stopAfterHumanReply: true,
  };
}

/** One inbound item returned by the MAIN-world adapter `inbox:poll`. */
export interface InboxItem {
  chatId: string; name: string; msgId: string; ts: number; text: string; fromMe: false; lastOutTs: number | null;
  /** present for every item from adapters >= group scope; absent = personal chat */
  isGroup?: boolean; author?: string; authorName?: string; groupName?: string;
  mentionedMe?: boolean; quotedMe?: boolean; isBot?: boolean;
}
