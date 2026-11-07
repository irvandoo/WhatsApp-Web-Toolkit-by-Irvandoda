/** Typed bridge between isolated content script and MAIN-world adapter. */
export const BRIDGE_CHANNEL = 'wwt-bridge';

export interface ChatInfo { id: string; name: string; isGroup: boolean; loaded: number; oldestTs: number | null; unread: number }
export interface ArchivedMsg {
  key: string;        // `${accountId}|${msgId}` primary key
  accountId: string;
  chatId: string;
  id: string;
  ts: number;
  fromMe: boolean;
  author?: string;
  type: string;
  body: string;
}

export type BridgeRequest =
  | { id: string; type: 'ping' }
  | { id: string; type: 'chats:list' }
  | { id: string; type: 'chat:messages'; chatId: string }
  | { id: string; type: 'sync:loadEarlier'; chatId: string }
  | { id: string; type: 'memory:trim'; keepChatId?: string }
  | { id: string; type: 'activity:scan' };

/** activity:scan result: per-chat message activity without bodies. */
export interface ActivityEvent { id: string; ts: number; fromMe: boolean }
export interface ActivityChat { id: string; name: string; isGroup: boolean; events: ActivityEvent[] }
export type ActivityScanResult = { accountId: string | null; chats: ActivityChat[] };

export type BridgeResponse = { id: string; ok: boolean; data?: unknown; error?: string };
export interface BridgeEnvelope<T> { channel: typeof BRIDGE_CHANNEL; dir: 'req' | 'res'; payload: T }

export type LoadEarlierResult = { added: number; total: number; reachedStart: boolean };
export type PingResult = { adapter: 'ready'; store: boolean; accountId: string | null };

export interface Account {
  id: string;            // WA user id (from adapter) — primary key
  name: string;          // display name chosen by user
  color: string;         // hex, for UI
  groupId: string | null;
  profileLabel: string;  // which Chrome profile runs it, e.g. "Profil Toko A"
  note: string;
  online: boolean;
  unread: number;
  chatCount: number;
  lastSeen: number;      // epoch ms
}
export interface AccountGroup { id: string; name: string; color: string }
export interface SessionMeta { id: string; accountId: string; label: string; createdAt: number; bytes: number; experimental: true }

/** content -> background / dashboard -> background */
export type RuntimeMsg =
  | { kind: 'account:report'; id: string; online: boolean; unread: number; chatCount: number }
  | { kind: 'account:list' }
  | { kind: 'account:update'; id: string; patch: Partial<Pick<Account, 'name' | 'color' | 'groupId' | 'profileLabel' | 'note'>> }
  | { kind: 'account:delete'; id: string }
  | { kind: 'group:list' }
  | { kind: 'group:upsert'; group: AccountGroup }
  | { kind: 'group:delete'; id: string }
  | { kind: 'registry:export' }
  | { kind: 'registry:import'; json: string }
  | { kind: 'session:list'; accountId?: string }
  | { kind: 'session:delete'; id: string }
  | { kind: 'archive:put'; msgs: ArchivedMsg[] }
  | { kind: 'archive:stats'; accountId: string }
  | { kind: 'archive:export'; accountId: string; chatId?: string };
