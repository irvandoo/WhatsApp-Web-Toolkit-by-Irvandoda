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
  | { id: string; type: 'chat:open'; chatId: string; phone?: string }
  | { id: string; type: 'groups:list' }
  | { id: string; type: 'groups:members'; groupId: string }
  | { id: string; type: 'labels:list' }
  | { id: string; type: 'labels:chats'; labelId: string }
  | { id: string; type: 'ping' }
  | { id: string; type: 'chats:list' }
  | { id: string; type: 'chats:contacts' }
  | { id: string; type: 'chat:messages'; chatId: string }
  | { id: string; type: 'sync:loadEarlier'; chatId: string }
  | { id: string; type: 'memory:trim'; keepChatId?: string }
  | { id: string; type: 'activity:scan' }
  | { id: string; type: 'inbox:poll'; sinceTs: number; includeGroups?: boolean }
  | { id: string; type: 'send:text'; chatId: string; text: string; allowDom?: boolean; verify?: boolean; group?: boolean }
  | { id: string; type: 'send:probe' }
  | { id: string; type: 'send:self-test'; allowDom?: boolean }
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
/** chats:contacts adapter op: chat list with resolved phone (CRM import). */
export interface ChatContact { chatId: string; name: string; phone: string | null; isGroup: boolean; unread: number; lastTs: number }
export type ChatsContactsResult = GroupsUnavailable | { unavailable?: false; accountId: string | null; chats: ChatContact[] };
export type RcpPingResult = GroupsUnavailable | { unavailable?: false; accountId: string | null };
/** Blast page -> background (rcp:groups / rcp:group-members reuse the grp relay). */
export type RcpMsg =
  | { kind: 'rcp:labels' }
  | { kind: 'rcp:label-chats'; labelId: string }
  | { kind: 'rcp:groups' }
  | { kind: 'rcp:group-members'; groupId: string }
  | { kind: 'rcp:chats' }
  | { kind: 'rcp:ping' };
/** background -> content (labels only; groups go through grp:exec). */
export type RcpExec = { kind: 'rcp:exec'; op: 'labels' } | { kind: 'rcp:exec'; op: 'label-chats'; labelId: string } | { kind: 'rcp:exec'; op: 'chats' } | { kind: 'rcp:exec'; op: 'ping' };

/** send:text result (adapter >= silent sending). `method` = which strategy actually sent; `verified` = message seen in the chat afterwards. */
export interface SendResult { ok: boolean; method: string; verified: boolean; error?: string }
/** Persisted silent-send settings (chrome.storage.local 'wwt-send'). */
export interface SendSettings { allowDomMacro: boolean }
export const SEND_SETTINGS_KEY = 'wwt-send';
export const DEFAULT_SEND_SETTINGS: SendSettings = { allowDomMacro: false };
/** send:probe result: what the adapter FOUND in WhatsApp Web internals (nothing is sent). */
export interface ProbeItem { name: string; found: boolean; type: string; group: string }
export interface ProbeResult { items: ProbeItem[]; accountId: string | null; store: boolean; hidden: boolean }
/** Extension page -> background -> WA tab content (diag-bridge) -> adapter. */
export type DiagMsg = { kind: 'diag:probe' } | { kind: 'diag:selftest'; allowDom?: boolean } | { kind: 'diag:explain' };
export type DiagExec = { kind: 'diag:exec'; op: 'probe' } | { kind: 'diag:exec'; op: 'explain' } | { kind: 'diag:exec'; op: 'selftest'; allowDom?: boolean };

/** Result of the auto-reply dry run ("Mengapa tidak membalas?"). Nothing is sent or written. */
export interface ExplainCheck { label: string; ok: boolean; detail: string }
export interface ExplainItem { name: string; isGroup: boolean; text: string; ageMin: number; afterActivation: boolean; decision: string; reason: string }
export interface ExplainResult { checks: ExplainCheck[]; items: ExplainItem[] }

/** Analytics/CRM -> background -> WhatsApp tab: open a chat room. accountId lets the right tab answer (a tab holding another account refuses). */
export type ChatOpenMsg = { kind: 'ui:chat-open'; accountId?: string; chatId: string; phone?: string };
export type ChatOpenExec = { kind: 'chatx:open'; accountId?: string; chatId: string; phone?: string };
export type ChatOpenResult = { ok: boolean; method?: string; error?: string };
