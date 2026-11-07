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
  | { id: string; type: 'groups:list' }
  | { id: string; type: 'groups:members'; groupId: string }
  | { id: string; type: 'labels:list' }
  | { id: string; type: 'labels:chats'; labelId: string }
  | { id: string; type: 'ping' }
  | { id: string; type: 'chats:list' }
  | { id: string; type: 'chat:messages'; chatId: string }
  | { id: string; type: 'sync:loadEarlier'; chatId: string }
  | { id: string; type: 'memory:trim'; keepChatId?: string }
  | { id: string; type: 'activity:scan' }
  | { id: string; type: 'inbox:poll'; sinceTs: number }
  | { id: string; type: 'send:text'; chatId: string; text: string }
  | { id: string; type: 'check:registered'; phones: string[] };

/** check:registered result per phone: registered null = unknown (WA internals unavailable). */
export interface RegisteredResult { phone: string; registered: boolean | null; chatId?: string }

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

/** Group member extraction (groups:list / groups:members adapter ops). */
export interface GroupInfo { id: string; name: string; size: number; isAdmin: boolean; creationTs?: number }
export interface GroupMember { id: string; phone: string | null; name: string; isAdmin: boolean; isSuperAdmin: boolean; isMe: boolean }
export type GroupsUnavailable = { unavailable: true; reason?: string };
export type GroupsListResult = GroupsUnavailable | { unavailable?: false; accountId: string | null; groups: GroupInfo[] };
export type GroupMembersResult = GroupsUnavailable | { unavailable?: false; groupId: string; members: GroupMember[]; truncated: boolean };
/** groups page -> background -> content (grp:exec) */
export type GrpMsg = { kind: 'grp:call'; op: 'list' } | { kind: 'grp:call'; op: 'members'; groupId: string };
export type GrpExec = { kind: 'grp:exec'; op: 'list' } | { kind: 'grp:exec'; op: 'members'; groupId: string };

/** WhatsApp Business labels (labels:list / labels:chats adapter ops). Internals unverified. */
export interface LabelInfo { id: string; name: string; color?: string; count: number }
export interface LabelChat { chatId: string; phone: string | null; name: string; isGroup: boolean }
export type LabelsListResult = GroupsUnavailable | { unavailable?: false; labels: LabelInfo[] };
export type LabelChatsResult = GroupsUnavailable | { unavailable?: false; labelId: string; chats: LabelChat[] };
/** Blast page -> background (rcp:groups / rcp:group-members reuse the grp relay). */
export type RcpMsg =
  | { kind: 'rcp:labels' }
  | { kind: 'rcp:label-chats'; labelId: string }
  | { kind: 'rcp:groups' }
  | { kind: 'rcp:group-members'; groupId: string };
/** background -> content (labels only; groups go through grp:exec). */
export type RcpExec = { kind: 'rcp:exec'; op: 'labels' } | { kind: 'rcp:exec'; op: 'label-chats'; labelId: string };
