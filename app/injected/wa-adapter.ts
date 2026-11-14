// MAIN world. WhatsApp Web internals change often: everything is feature-detected and
// failures degrade to "unavailable" / DOM fallbacks instead of throwing.
import {
  BRIDGE_CHANNEL, type ArchivedMsg, type BridgeEnvelope, type BridgeRequest, type BridgeResponse,
  type ActivityChat, type ActivityScanResult, type ChatInfo, type LoadEarlierResult, type PingResult,
  type RegisteredResult, type GroupInfo, type GroupMember, type GroupsListResult, type GroupMembersResult,
  type ChatContact, type ChatsContactsResult, type LabelInfo, type LabelChat, type LabelsListResult, type LabelChatsResult, type SendResult, type ProbeItem, type ProbeResult,
} from '../shared/messages';
import { insertIntoComposer } from '../content/composer-insert';
import { dataUrlToBlob, isValidMedia } from '../shared/image-logic';
import type { InboxItem } from '../shared/autoreply-types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/**
 * Only ask WhatsApp's module loader once the app UI exists, and remember misses for a while.
 * Calling `require()` for a module that is not defined yet makes WA's ErrorUtils print red
 * "Requiring unknown module ..." / "unresolved dependencies" errors in the console (harmless, but noisy
 * and it burns time), which happened while the QR/loading screen was still up.
 */
const appReady = (): boolean => !!document.querySelector('#pane-side, [data-testid="chatlist-header"], [data-testid="chat-list"]');
const missUntil = new Map<string, number>();
function req(name: string): Any {
  const w = window as Any;
  const now = Date.now();
  if ((missUntil.get(name) ?? 0) > now || !appReady()) return undefined;
  let out: Any;
  try { if (typeof w.require === 'function') out = w.require(name); } catch { /* module absent */ }
  if (out === undefined) { try { if (typeof w.mR?.findModule === 'function') out = w.mR.findModule(name)?.[0]; } catch { /* ignore */ } }
  if (out === undefined) missUntil.set(name, now + 30_000);
  return out;
}

/** Names of loaded WA modules matching a pattern (diagnostics only; empty when WA hides its module map). */
function discoverModules(pattern: RegExp, max = 40): string[] {
  try {
    const dbg = (window as Any).require?.('__debug');
    const keys = Object.keys(dbg?.modulesMap ?? {}).filter((k) => pattern.test(k));
    return keys.slice(0, max);
  } catch { return []; }
}

const store = {
  get collections(): Any { return req('WAWebCollections'); },
  get loader(): Any { return req('WAWebChatLoadMessages'); },
  get user(): Any { return req('WAWebUserPrefsMeUser'); },
};

/** WID serialization: `_serialized` was renamed to `$1` in a mid-2026 WA update. */
const wid = (x: Any): string => String(x?._serialized ?? x?.$1 ?? x?.user ?? x ?? '');

function accountId(): string | null {
  try {
    const me = store.user?.getMaybeMePnUser?.() ?? store.user?.getMaybeMeLidUser?.() ?? store.user?.getMaybeMeUser?.();
    return me ? wid(me) : null;
  } catch { return null; }
}

const chatsColl = (): Any[] => store.collections?.Chat?.getModelsArray?.() ?? store.collections?.Chat?.models ?? [];
const findChat = (id: string): Any => chatsColl().find((c) => wid(c.id) === id);
const msgsOf = (chat: Any): Any[] => chat?.msgs?.getModelsArray?.() ?? chat?.msgs?.models ?? [];

function info(c: Any): ChatInfo {
  const ms = msgsOf(c);
  const ts = ms.map((m) => m.t).filter((t: unknown) => typeof t === 'number') as number[];
  return {
    id: wid(c.id), name: c.formattedTitle ?? c.name ?? c.id.user ?? '',
    isGroup: !!c.isGroup, loaded: ms.length, oldestTs: ts.length ? Math.min(...ts) : null, unread: c.unreadCount ?? 0,
  };
}

function serialize(m: Any, chatId: string, acc: string): ArchivedMsg | null {
  const id = m.id?._serialized ?? m.id?.$1;
  if (!id) return null;
  return {
    key: `${acc}|${id}`, accountId: acc, chatId, id, ts: m.t ?? 0, fromMe: !!m.id?.fromMe,
    author: m.author ? wid(m.author) : m.from ? wid(m.from) : undefined, type: m.type ?? 'unknown',
    body: typeof m.body === 'string' ? m.body : (m.caption ?? ''),
  };
}

// loadEarlierMsgs({ chat }) returns the older messages but may not add them to chat.msgs,
// so we keep our own per-chat cache (same approach as whatsapp-web.js).
const cache = new Map<string, Map<string, ArchivedMsg>>();

function remember(chatId: string, raw: Any[]): number {
  const acc = accountId() ?? 'unknown';
  let m = cache.get(chatId);
  if (!m) { m = new Map(); cache.set(chatId, m); }
  let added = 0;
  for (const r of raw) {
    const a = serialize(r, chatId, acc);
    if (a && !m.has(a.key)) { m.set(a.key, a); added++; }
  }
  return added;
}

async function loadEarlier(chatId: string): Promise<LoadEarlierResult> {
  const chat = findChat(chatId);
  if (!chat) throw new Error('chat-not-found');
  const fn = store.loader?.loadEarlierMsgs;
  if (!fn) throw new Error('loader-unavailable');
  if (!cache.has(chatId)) remember(chatId, msgsOf(chat));
  let res: Any;
  try { res = await fn({ chat }); }          // current signature
  catch { res = await fn(chat, chat.msgs); } // legacy signature
  const list: Any[] = Array.isArray(res) ? res : [];
  const added = remember(chatId, list);
  const total = cache.get(chatId)?.size ?? 0;
  const hint = chat.msgs?.msgLoadState?.noEarlierMsgs === true; // unconfirmed, hint only
  return { added, total, reachedStart: list.length === 0 || hint };
}

/** Frees only our own cache; we deliberately do NOT mutate WA's chat.msgs (unverified API). */
function trim(): number {
  const n = cache.size;
  cache.clear();
  return n;
}

const SCAN_CAP = 300;
/** WA timestamps are epoch SECONDS; normalise to ms (values already >= 1e12 are left alone). */
const toMs = (t: number): number => (t < 1e12 ? Math.round(t * 1000) : t);
const SYSTEM_TYPES = new Set(['e2e_notification', 'notification', 'notification_template', 'gp2', 'protocol', 'call_log', 'revoked']);

/** Per-chat activity (id/ts/fromMe only) from WA's loaded models merged with our own cache. Never throws. */
function scanActivity(): ActivityScanResult {
  const chats: ActivityChat[] = [];
  let list: Any[] = [];
  try { list = chatsColl(); } catch { list = []; }
  for (const c of list) {
    try {
      const id = wid(c?.id);
      if (!id || id.includes('broadcast') || id.startsWith('status@')) continue;
      const seen = new Map<string, { id: string; ts: number; fromMe: boolean }>();
      for (const m of msgsOf(c)) {
        const mid = m?.id?._serialized ?? m?.id?.$1;
        if (!mid || typeof m.t !== 'number' || m.t <= 0 || SYSTEM_TYPES.has(m.type)) continue;
        seen.set(String(mid), { id: String(mid), ts: toMs(m.t), fromMe: !!m.id?.fromMe });
      }
      for (const a of cache.get(id)?.values() ?? []) {
        if (!seen.has(a.id) && a.ts > 0 && !SYSTEM_TYPES.has(a.type)) seen.set(a.id, { id: a.id, ts: toMs(a.ts), fromMe: a.fromMe });
      }
      if (!seen.size) continue;
      const events = [...seen.values()].sort((x, y) => y.ts - x.ts).slice(0, SCAN_CAP);
      chats.push({ id, name: String(c.formattedTitle ?? c.name ?? c.id?.user ?? ''), isGroup: !!c.isGroup, events });
    } catch { /* skip chat */ }
  }
  return { accountId: accountId(), chats };
}


// ---- Group member extraction (feature-detected; internals unverified) ----
const GRP_GAP_MS = 600;
const GRP_MAX_MEMBERS = 5000;
let grpLast = 0;
async function grpPace(): Promise<void> {
  const wait = grpLast + GRP_GAP_MS - Date.now();
  grpLast = Math.max(Date.now(), grpLast + GRP_GAP_MS);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
const digits = (s: unknown): string => String(s ?? '').replace(/\D/g, '');
const wsUser = (x: Any): string => String(x?.user ?? '');
const groupsColl = (): Any[] => chatsColl().filter((c) => {
  try { const md = c.groupMetadata; return !!c.isGroup && !md?.isParentGroup && !md?.defaultSubgroup; } catch { return false; }
});
const metaOf = (c: Any): Any => c?.groupMetadata ?? store.collections?.GroupMetadata?.get?.(c?.id);
const partsOf = (md: Any): Any[] => md?.participants?.getModelsArray?.() ?? md?.participants?.models ?? (Array.isArray(md?.participants) ? md.participants : []);
const meIds = (): Set<string> => {
  const u = store.user; const s = new Set<string>();
  for (const f of ['getMaybeMePnUser', 'getMaybeMeLidUser', 'getMaybeMeUser']) { try { const v = u?.[f]?.(); if (v) { s.add(wid(v)); s.add(wsUser(v)); } } catch { /* ignore */ } }
  s.delete('');
  return s;
};

function groupsList(): GroupsListResult {
  if (!store.collections?.Chat) return { unavailable: true, reason: 'store' };
  const me = meIds();
  const groups: GroupInfo[] = [];
  for (const c of groupsColl()) {
    try {
      const md = metaOf(c);
      const parts = partsOf(md);
      const size = typeof md?.size === 'number' ? md.size : parts.length;
      const mine = parts.find((p) => me.has(wid(p.id)) || me.has(wsUser(p.id)));
      groups.push({
        id: wid(c.id), name: String(c.formattedTitle ?? c.name ?? md?.subject ?? ''), size,
        isAdmin: !!(mine?.isAdmin || mine?.isSuperAdmin),
        creationTs: typeof md?.creation === 'number' ? md.creation : undefined,
      });
    } catch { /* skip group */ }
  }
  return { accountId: accountId(), groups };
}

/** "+62 857-4747-6308" / "0857 4747 6308" (what WA shows as the title of an unsaved contact) -> digits, else ''. */
function phoneFromTitle(v: Any): string {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!/^\+?[\d\s().-]{9,22}$/.test(t)) return '';
  const d = digits(t);
  return d.length >= 9 && d.length <= 15 ? d : '';
}

/**
 * LID contacts keep their real phone number in a field whose NAME changes between WA releases
 * (phoneNumber / pn / pnJid / userid ...). Instead of guessing one name, scan the model's own fields:
 * only keys that look phone-related (never *lid*), values that are a c.us / s.whatsapp.net JID or a Wid with that server.
 */
function scanForPn(obj: Any, depth = 0): string {
  if (!obj || typeof obj !== 'object' || depth > 2) return '';
  let keys: string[] = [];
  try { keys = Object.keys(obj).slice(0, 80); } catch { return ''; }
  for (const k of keys) {
    if (/lid/i.test(k) || !/(phone|^pn|pnjid|number|jid|msisdn|userid|user$)/i.test(k)) continue;
    let v: Any;
    try { v = obj[k]; } catch { continue; }
    if (typeof v === 'string') {
      if (/@(c\.us|s\.whatsapp\.net)$/.test(v)) { const d = digits(v.split('@')[0]); if (d.length >= 8) return d; }
      else if (/phone|number|msisdn/i.test(k)) { const d = phoneFromTitle(v); if (d) return d; }
    } else if (v && typeof v === 'object') {
      const server = String(v.server ?? v.$2 ?? '');
      const raw = wid(v);
      if (server === 'c.us' || /@(c\.us|s\.whatsapp\.net)$/.test(raw)) { const d = digits(wsUser(v) || raw.split('@')[0]); if (d.length >= 8) return d; }
      else if (depth < 2) { const d = scanForPn(v, depth + 1); if (d) return d; }
    }
  }
  return '';
}

async function phoneOf(p: Any): Promise<string | null> {
  const id = p?.id;
  const server = String(id?.server ?? '');
  const raw = wid(id);
  if (server === 'c.us' || /@c\.us$/.test(raw)) { const d = digits(wsUser(id) || raw.split('@')[0]); return d || null; }
  // LID: try known phone-number links, else unknown (never guess).
  const cands: Any[] = [p?.contact?.phoneNumber, p?.phoneNumber, p?.pn];
  try {
    const c = store.collections?.Contact?.get?.(id);
    cands.push(c?.phoneNumber, c?.pn);
    const lidMod = req('WAWebApiContact');
    const viaApi = lidMod?.getPhoneNumber?.(id);
    cands.push(viaApi);
    // other places WA keeps the LID <-> phone mapping (names unverified; each call is guarded and cached on miss)
    for (const modName of ['WAWebLidPhoneUtils', 'WAWebLidMigrationUtils', 'WAWebContactPhoneUtils']) {
      const mod = req(modName);
      for (const fn of ['getPhoneNumber', 'getPnForLid', 'lidToPn', 'toPn', 'getPn', 'getPhoneNumberFromLid']) {
        try { const v = mod?.[fn]?.(id); if (v) cands.push(v); } catch { /* wrong signature */ }
      }
    }
  } catch { /* ignore */ }
  for (const x of cands) { const d = digits(typeof x === 'string' ? x.split('@')[0] : wsUser(x)); if (d.length >= 6) return d; }
  // generic fallbacks: scan model fields, then use the display title when it is itself a phone number
  try {
    const cm = store.collections?.Contact?.get?.(id);
    for (const o of [p?.contact, cm, p?.contact?.attributes, cm?.attributes]) { const d = scanForPn(o); if (d) return d; }
    for (const t of [p?.title, p?.contact?.formattedName, p?.contact?.formattedPhone, cm?.formattedName, cm?.formattedPhone, cm?.displayNameLID]) { const d = phoneFromTitle(t); if (d) return d; }
  } catch { /* ignore */ }
  return null;
}

/** Chat list with resolved phone numbers (CRM import). Never throws; chats without readable phone get phone null. */
async function chatContacts(): Promise<ChatsContactsResult> {
  if (!store.collections?.Chat) return { unavailable: true, reason: 'store' };
  const chats: ChatContact[] = [];
  for (const c of chatsColl()) {
    try {
      const id = wid(c?.id);
      if (!id || id.includes('broadcast') || id.startsWith('status@') || id.endsWith('@newsletter')) continue;
      const isGroup = id.endsWith('@g.us') || !!c.isGroup;
      let phone: string | null = null;
      if (!isGroup) {
        if (/@(c\.us|s\.whatsapp\.net)$/.test(id)) phone = digits(id.split('@')[0]) || null;
        else phone = await phoneOf({ id: c.id, contact: c.contact, title: c.formattedTitle ?? c.name });
      }
      const ts = typeof c.t === 'number' ? c.t : 0;
      chats.push({ chatId: id, name: String(c.formattedTitle ?? c.name ?? c.contact?.name ?? ''), phone, isGroup, unread: Number(c.unreadCount) || 0, lastTs: ts ? toMs(ts) : 0 });
    } catch { /* skip */ }
  }
  return { accountId: accountId(), chats };
}

async function groupMembers(groupId: string): Promise<GroupMembersResult> {
  if (!store.collections?.Chat) return { unavailable: true, reason: 'store' };
  const chat = findChat(groupId);
  if (!chat || !chat.isGroup) return { unavailable: true, reason: 'group-not-found' };
  await grpPace();
  try { // best-effort metadata refresh
    const q = req('WAWebGroupQueryJob');
    const fn = q?.queryAndUpdateGroupMetadataById ?? q?.queryGroupMetadata;
    if (typeof fn === 'function') await Promise.race([fn(chat.id), new Promise((r) => setTimeout(r, 8000))]);
  } catch { /* use cached metadata */ }
  const parts = partsOf(metaOf(chat));
  if (!parts.length) return { unavailable: true, reason: 'no-participants' };
  const me = meIds();
  const members: GroupMember[] = [];
  const truncated = parts.length > GRP_MAX_MEMBERS;
  for (const p of parts.slice(0, GRP_MAX_MEMBERS)) {
    try {
      const ct = p.contact ?? store.collections?.Contact?.get?.(p.id);
      members.push({
        id: wid(p.id), phone: await phoneOf(p),
        name: String(ct?.name ?? ct?.shortName ?? ct?.pushname ?? ct?.verifiedName ?? ''),
        isAdmin: !!(p.isAdmin || p.isSuperAdmin), isSuperAdmin: !!p.isSuperAdmin,
        isMe: me.has(wid(p.id)) || me.has(wsUser(p.id)),
      });
    } catch { /* skip */ }
  }
  return { groupId, members, truncated };
}

// ---- WhatsApp Business labels (feature-detected; internals UNVERIFIED) ----
const arrOf = (c: Any): Any[] => c?.getModelsArray?.() ?? c?.models ?? (Array.isArray(c) ? c : []);
const labelModels = (): Any[] | null => {
  const coll = store.collections?.Label;
  return coll ? arrOf(coll) : null;
};
const labelItems = (l: Any): Any[] => arrOf(l?.labelItemCollection ?? l?.items);

function labelsList(): LabelsListResult {
  const models = labelModels();
  if (!models) return { unavailable: true, reason: 'no-labels' };
  const labels: LabelInfo[] = [];
  for (const l of models) {
    try {
      const id = String(l?.id ?? '');
      if (!id || l?.isDeleted || l?.deleted) continue;
      const name = String(l?.name ?? '').trim();
      if (!name) continue;
      const n = labelItems(l).length;
      const color = typeof l?.hexColor === 'string' ? l.hexColor : typeof l?.color === 'string' ? l.color : undefined;
      labels.push({ id, name, color, count: n || (typeof l?.count === 'number' ? l.count : 0) });
    } catch { /* skip label */ }
  }
  return { labels };
}

async function labelChats(labelId: string): Promise<LabelChatsResult> {
  const models = labelModels();
  if (!models) return { unavailable: true, reason: 'no-labels' };
  const label = models.find((l) => String(l?.id) === labelId);
  if (!label) return { unavailable: true, reason: 'label-not-found' };
  const ids = new Set<string>();
  for (const it of labelItems(label)) {
    const t = String(it?.type ?? 'chat');
    if (t !== 'chat' && t !== 'jid' && t !== '') continue; // skip message / contact-less items
    const id = wid(it?.parentId ?? it?.chatId ?? it?.id);
    if (id.includes('@')) ids.add(id);
  }
  if (!ids.size) { // fallback: chats carry their label ids
    for (const c of chatsColl()) {
      try { if ((c?.labels ?? []).map(String).includes(labelId)) ids.add(wid(c.id)); } catch { /* skip */ }
    }
  }
  const chats: LabelChat[] = [];
  for (const id of ids) {
    try {
      if (id.endsWith('@g.us') || id.includes('broadcast') || id.startsWith('status@') || id.endsWith('@newsletter')) continue;
      const chat = findChat(id);
      const idObj = chat?.id ?? id;
      let phone: string | null = null;
      if (/@(c\.us|s\.whatsapp\.net)$/.test(id)) phone = digits(id.split('@')[0]) || null;
      else if (chat) phone = await phoneOf({ id: chat.id, contact: chat.contact, title: chat.formattedTitle ?? chat.name });
      const ct = chat?.contact ?? store.collections?.Contact?.get?.(idObj);
      chats.push({
        chatId: id, phone,
        name: String(chat?.formattedTitle ?? chat?.name ?? ct?.name ?? ct?.pushname ?? ''),
        isGroup: false,
      });
    } catch { /* skip */ }
  }
  return { labelId, chats };
}

const INBOX_TEXT_TYPES = new Set(['chat']);
const INBOX_CAP = 500;
const BOT_RE = /(^|[^a-z])bot($|[^a-z])/i;

const mentionsMe = (m: Any, me: Set<string>): boolean => {
  try {
    const list: Any[] = m?.mentionedJidList ?? m?.mentionedJids ?? [];
    return list.some((x) => me.has(wid(x)) || me.has(wsUser(x)));
  } catch { return false; }
};
const quotesMe = (m: Any, me: Set<string>): boolean => {
  try {
    const q = m?.quotedParticipant ?? m?.quotedMsg?.author ?? m?.quotedMsg?.from;
    return !!q && (me.has(wid(q)) || me.has(wsUser(q)));
  } catch { return false; }
};

/**
 * Newest inbound text per chat since sinceTs (ms). Personal chats only unless `includeGroups` (then group items carry
 * isGroup/author/groupName/mentionedMe/quotedMe). Never throws.
 */
function pollInbox(sinceTs: number, includeGroups = false): InboxItem[] {
  const out: InboxItem[] = [];
  let list: Any[] = [];
  try { list = chatsColl(); } catch { list = []; }
  const me = includeGroups ? meIds() : new Set<string>();
  for (const c of list) {
    try {
      const id = wid(c?.id);
      if (!id || id.includes('broadcast') || id.startsWith('status@') || id.endsWith('@newsletter')) continue;
      const isGroup = !!c.isGroup || id.endsWith('@g.us');
      if (isGroup && !includeGroups) continue;
      let lastIn: Any = null, lastInTs = 0, lastOut = 0;
      for (const m of msgsOf(c)) {
        if (typeof m?.t !== 'number' || m.t <= 0 || SYSTEM_TYPES.has(m.type)) continue;
        const ts = toMs(m.t);
        if (m.id?.fromMe) { if (ts > lastOut) lastOut = ts; }
        else if (ts > lastInTs) { lastInTs = ts; lastIn = m; }
      }
      // newest inbound must be a plain text message newer than sinceTs
      if (!lastIn || lastInTs <= sinceTs || !INBOX_TEXT_TYPES.has(lastIn.type)) continue;
      const body = typeof lastIn.body === 'string' ? lastIn.body : '';
      if (!body.trim()) continue;
      const item: InboxItem = {
        chatId: id, name: String(c.formattedTitle ?? c.name ?? c.id?.user ?? ''),
        msgId: String(lastIn.id?._serialized ?? lastIn.id?.$1 ?? `${id}|${lastInTs}`), ts: lastInTs,
        text: body.slice(0, INBOX_CAP), fromMe: false, lastOutTs: lastOut || null,
      };
      if (includeGroups) {
        item.isGroup = isGroup;
        if (isGroup) {
          const au = lastIn.author ?? lastIn.senderObj?.id ?? lastIn.from;
          item.author = au ? wid(au) : undefined;
          const ct = lastIn.senderObj ?? store.collections?.Contact?.get?.(au);
          item.authorName = String(ct?.name ?? ct?.shortName ?? ct?.pushname ?? lastIn.notifyName ?? '') || undefined;
          item.groupName = item.name;
          item.mentionedMe = mentionsMe(lastIn, me);
          item.quotedMe = quotesMe(lastIn, me);
          item.isBot = !!lastIn.isBot || BOT_RE.test(String(item.authorName ?? '')) || /@bot$/.test(item.author ?? '');
        }
      }
      out.push(item);
    } catch { /* skip chat */ }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

// ---- Silent sending (strategy chain). Module names/signatures are UNVERIFIED guesses: use send:probe to see what exists. ----
const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isBlockedId = (id: string, allowGroup = false) => (!allowGroup && id.endsWith('@g.us')) || id.includes('broadcast') || id.startsWith('status@') || id.endsWith('@newsletter');

/** Find the Chat model; create it (numbers with no chat yet) via WAWebFindChatAction. Returns undefined when impossible. */
async function resolveChat(chatId: string): Promise<Any> {
  let chat = findChat(chatId);
  if (chat) return chat;
  const coll = store.collections?.Chat;
  const widObj = (() => {
    try { const w = req('WAWebWidFactory'); return typeof w?.createWid === 'function' ? w.createWid(chatId) : undefined; } catch { return undefined; }
  })();
  try { chat = widObj ? coll?.get?.(widObj) : coll?.get?.(chatId); } catch { /* ignore */ }
  if (chat) return chat;
  try {
    const fa = req('WAWebFindChatAction');
    const fn = fa?.findOrCreateLatestChat ?? fa?.findChat;
    if (widObj && typeof fn === 'function') {
      const r = await fn(widObj);
      chat = r?.chat ?? r;
      if (chat && chat.id) return chat;
    }
  } catch { /* ignore */ }
  try { if (widObj && typeof coll?.find === 'function') { const r = await coll.find(widObj); if (r) return r; } } catch { /* ignore */ }
  return findChat(chatId);
}

/** True when a matching fromMe text message (same body, recent) shows up in the chat's loaded messages within `waitMs`. */
async function verifySent(chat: Any, text: string, since: number, waitMs = 10_000): Promise<boolean> {
  const end = Date.now() + waitMs;
  const want = text.trim();
  do {
    for (const m of msgsOf(chat)) {
      if (!m?.id?.fromMe || typeof m.t !== 'number') continue;
      if (toMs(m.t) >= since - 3000 && typeof m.body === 'string' && m.body.trim() === want) return true;
    }
    await sleepMs(500);
  } while (Date.now() < end);
  return false;
}

const API_NAMES: Array<[string, string]> = [
  ['WAWebChatSendMessages', 'sendTextMsgToChat'], ['WAWebSendTextMsgChatAction', 'sendTextMsgToChat'],
  ['WAWebChatSendMessages', 'addAndSendTextMsg'], ['WAWebMessageSender', 'sendTextMsgToChat'], ['WAWebMessageSender', 'addAndSendTextMsg'],
];
const SENDERR = (r: Any): boolean => !!r && typeof r === 'object' && (r.messageSendResult === 'ERROR_UNKNOWN' || !!r.error);

async function sendViaApi(chat: Any, text: string): Promise<{ method: string } | { error: string }> {
  const tries: Array<[string, () => unknown]> = [];
  for (const [mod, fn] of API_NAMES) {
    const m = req(mod);
    if (typeof m?.[fn] === 'function') tries.push([`${mod}.${fn}`, () => m[fn](chat, text)]);
  }
  if (typeof chat?.sendMessage === 'function') tries.push(['chat.sendMessage', () => chat.sendMessage(text)]);
  if (!tries.length) return { error: 'send-unavailable' };
  let failed = false;
  for (const [name, fn] of tries) {
    try {
      const r = await fn();
      if (SENDERR(r)) { failed = true; continue; }
      return { method: name };
    } catch { failed = true; }
  }
  return { error: failed ? 'send-failed' : 'send-unavailable' };
}

const activeChat = (): Any => { try { return store.collections?.Chat?.getActive?.() ?? chatsColl().find((c) => c?.active); } catch { return undefined; } };
const composerThere = (): boolean => !!document.querySelector('footer [contenteditable="true"]');
/** Is `chat` the chat currently shown? Uses the collection's active chat when available, else the composer as a weak signal. */
function isOpenNow(chat: Any): boolean {
  const canVerify = typeof store.collections?.Chat?.getActive === 'function';
  if (canVerify) { const a = activeChat(); return !!a && wid(a.id) === wid(chat?.id); }
  return composerThere();
}
function fire(el: HTMLElement): void {
  for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
}
/** Last resort without reloading: click the chat's row in the (visible part of the) chat list. */
async function openViaList(chat: Any): Promise<boolean> {
  try {
    const name = String(chat?.formattedTitle ?? chat?.name ?? '').trim();
    if (!name) return false;
    const hit = [...document.querySelectorAll<HTMLElement>('#pane-side span[title]')].find((s) => s.title === name);
    const row = hit?.closest<HTMLElement>('[role="listitem"],[role="row"],[data-testid="cell-frame-container"]') ?? hit;
    if (!row) return false;
    fire(row);
    for (let i = 0; i < 14; i++) { if (isOpenNow(chat)) return true; await sleepMs(150); }
  } catch { /* ignore */ }
  return false;
}
async function openChat(chat: Any): Promise<boolean> {
  try {
    const cmd = req('WAWebCmd');
    const host = cmd?.Cmd ?? cmd;
    const fns = ['openChatBottom', 'openChatAt'].map((n) => host?.[n]).filter((f) => typeof f === 'function') as Array<(...a: unknown[]) => unknown>;
    // WhatsApp changed several helpers from (chat) to ({chat}); try both shapes.
    for (const fn of fns) {
      for (const arg of [chat, { chat }]) {
        try { await fn.call(host, arg); } catch { continue; }
        for (let i = 0; i < 14; i++) { if (isOpenNow(chat)) return true; await sleepMs(150); }
      }
    }
  } catch { /* ignore */ }
  return openViaList(chat);
}
/**
 * Open a chat room (what the user does by clicking it in the chat list).
 * 1) WhatsApp's own command (no reload). 2) Deep link `/send?phone=` (reloads the page) only when a real phone number is known.
 */
async function openChatById(chatId: string, phone?: string): Promise<{ ok: boolean; method?: string; error?: string }> {
  const isLid = /@lid$/.test(chatId);
  let chat = findChat(chatId);
  if (!chat) { try { chat = await resolveChat(chatId); } catch { /* not resolvable */ } }
  // A real phone number is only trusted for c.us ids or an explicitly given number; LID digits are NOT a phone number.
  const d = isLid ? '' : digits(phone ?? (/@c\.us$/.test(chatId) ? chatId.split('@')[0] : ''));
  if (!chat && d.length >= 8) { try { chat = await resolveChat(`${d}@c.us`); } catch { /* ignore */ } }
  if (chat && (await openChat(chat))) return { ok: true, method: 'WAWebCmd' };
  // Reloading the page via a deep link is the last resort and only for a chat that does not exist yet (new number).
  if (!chat && d.length >= 8) { location.assign(`https://web.whatsapp.com/send?phone=${d}`); return { ok: true, method: 'deep-link' }; }
  return { ok: false, error: chat ? 'open-failed' : 'chat-not-found' };
}

function clickSend(): boolean {
  const b = document.querySelector<HTMLElement>('footer button[aria-label="Kirim"], footer button[aria-label="Send"], footer [data-icon="send"], footer [data-icon="wds-ic-send-filled"]');
  const el = (b?.closest('button') as HTMLElement | null) ?? b;
  if (!el) return false;
  el.click();
  return true;
}
/** VISIBLE fallback: briefly opens the target chat, inserts via the shared composer helper, clicks Send, then restores the previous chat. */
async function sendViaDom(chat: Any, text: string): Promise<{ method: string } | { error: string }> {
  const prev = activeChat();
  try {
    if (!(await openChat(chat))) return { error: 'send-unavailable' };
    const r = await insertIntoComposer(text, { mode: 'empty-only' });
    if (!r.ok) return { error: r.reason === 'composer-not-empty' ? 'composer-busy' : 'send-unavailable' };
    await sleepMs(150);
    if (!clickSend()) return { error: 'send-unavailable' };
    return { method: 'dom-macro' };
  } finally {
    if (prev && prev !== chat) { try { await openChat(prev); } catch { /* ignore */ } }
  }
}

/**
 * Strategy chain: (1) internal API without opening the chat UI, (2) DOM macro only when `allowDom`. Never fakes success:
 * `verified` says whether the message was actually seen in the chat afterwards. Throws a code ('send-unavailable',
 * 'send-failed', 'chat-not-found', 'send-rejected') when nothing sent.
 */
async function sendText(chatId: string, text: string, allowDom = false, verify = true, group = false): Promise<SendResult> {
  if (!text.trim() || isBlockedId(chatId, group)) throw new Error('send-rejected'); // groups only when the auto-reply engine asks (group:true)
  const chat = await resolveChat(chatId);
  if (!chat) throw new Error('chat-not-found');
  const since = Date.now();
  let res = await sendViaApi(chat, text);
  if ('error' in res && allowDom) res = await sendViaDom(chat, text);
  if ('error' in res) throw new Error(res.error);
  const verified = verify ? await verifySent(chat, text, since) : false;
  return { ok: true, method: res.method, verified };
}

// ---- Image sending (send:media). Same rules as text: internal API first, visible DOM macro only when allowed. UNVERIFIED module names. ----
/** True when a recent fromMe image shows up in the chat (caption compared when one was sent). */
async function verifyMediaSent(chat: Any, caption: string, since: number, waitMs = 15_000): Promise<boolean> {
  const end = Date.now() + waitMs;
  const want = caption.trim();
  do {
    for (const m of msgsOf(chat)) {
      if (!m?.id?.fromMe || typeof m.t !== 'number' || m.type !== 'image') continue;
      if (toMs(m.t) < since - 3000) continue;
      if (!want || String(m.caption ?? '').trim() === want) return true;
    }
    await sleepMs(500);
  } while (Date.now() < end);
  return false;
}

/**
 * Finds `fn` by exported name when the module name is unknown: scans only loaded modules whose NAME looks media-related
 * (never every module), remembers the result. Returns the exporting module's function or undefined.
 */
const fnCache = new Map<string, { at: number; fn: Any; from: string }>();
function findFn(fn: string, known: string[]): { fn: Any; from: string } | undefined {
  const hit = fnCache.get(fn);
  if (hit && (hit.fn || Date.now() - hit.at < 30_000)) return hit.fn ? hit : undefined;
  let found: { fn: Any; from: string } | undefined;
  const pick = (m: Any, from: string) => {
    const f = m?.[fn] ?? m?.default?.[fn] ?? m?.OpaqueData?.[fn];
    if (typeof f === 'function') found = { fn: f.bind(m?.[fn] ? m : m?.default?.[fn] ? m.default : m.OpaqueData), from };
  };
  for (const n of known) { if (!found) pick(req(n), n); }
  if (!found) for (const n of discoverModules(/Media|Opaque|Prep|Upload|Attach/i, 200)) { if (!found) pick(req(n), n); }
  fnCache.set(fn, { at: Date.now(), fn: found?.fn, from: found?.from ?? '' });
  return found;
}

async function sendMediaViaApi(chat: Any, blob: Blob, mime: string, caption: string): Promise<{ method: string } | { error: string }> {
  const prepFound = findFn('prepRawMedia', ['WAWebMediaPrep']);
  const createFound = findFn('createFromData', ['WAWebMediaOpaqueData']);
  const prepRaw = prepFound?.fn;
  const create = createFound?.fn;
  if (typeof prepRaw !== 'function' || typeof create !== 'function') return { error: 'send-unavailable' };
  let stage = 'file';
  const names = (o: Any): string => { try { const k = new Set<string>(Object.keys(o ?? {})); for (let p = Object.getPrototypeOf(o); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) Object.getOwnPropertyNames(p).forEach((n) => k.add(n)); return [...k].slice(0, 25).join(','); } catch { return '?'; } };
  const msg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 120);
  try {
    const file = new File([blob], mime === 'image/png' ? 'gambar.png' : 'gambar.jpg', { type: mime });
    stage = 'createFromData'; const opaque = await create(file, mime);
    stage = 'prepRawMedia'; const job = prepRaw(opaque, { isViewOnce: false });
    if (typeof job?.waitForPrep === 'function') { stage = 'waitForPrep'; await job.waitForPrep(); }
    if (typeof job?.sendToChat !== 'function') return { error: `send-failed: tahap ${stage}, objek persiapan tanpa sendToChat (isi: ${names(job)})` };
    // sendToChat(chat, options) needs an options object; WhatsApp reads several optional fields from it, so offer the usual ones.
    const full = { caption: caption || undefined, isCaptionByUser: !!caption, quotedMsg: undefined, mentionedJidList: [], groupMentions: [], isViewOnce: false, ...(caption ? {} : { caption: '' }) };
    const variants: Array<[string, () => unknown]> = [
      ['(chat,{caption})', () => job.sendToChat(chat, { caption })],
      ['(chat,full)', () => job.sendToChat(chat, full)],
      ['(chat,{chat,...full})', () => job.sendToChat(chat, { chat, ...full })],
    ];
    const errs: string[] = [];
    for (const [label, call] of variants) {
      stage = `sendToChat${label}`;
      try {
        const r = await call();
        if (SENDERR(r)) { errs.push(`${label}: hasil galat`); continue; }
        return { method: `${prepFound?.from ?? 'media'}.prepRawMedia→sendToChat` };
      } catch (e) {
        const frames = String((e as Error)?.stack ?? '').split(/\r?\n/).slice(1, 6).map((l) => l.trim().replace(/https?:\/\/\S*\//, ''));
        try { console.warn('[WWT] kirim gambar gagal', label, e, frames); } catch { /* ignore */ }
        errs.push(`${label}: ${msg(e)} @ ${frames[0] ?? ''}`);
      }
    }
    return { error: `send-failed: modul prep=${prepFound?.from}, opaque=${createFound?.from}; sendToChat gagal [${errs[0] ?? ''}] (detail lengkap di konsol WhatsApp: [WWT] kirim gambar gagal; job: ${names(job)}; mediaData: ${names(job?.mediaData)})` };
  } catch (e) { return { error: `send-failed: tahap ${stage}: ${msg(e)}` }; }
}

const waitFor = async <T,>(fn: () => T | null | undefined, ms: number): Promise<T | null> => {
  const end = Date.now() + ms;
  do { const v = fn(); if (v) return v; await sleepMs(150); } while (Date.now() < end);
  return null;
};
/** VISIBLE fallback: opens the chat, pastes the image into the composer, types the caption in the media preview, clicks send, restores the chat. */
async function sendMediaViaDom(chat: Any, blob: Blob, mime: string, caption: string): Promise<{ method: string } | { error: string }> {
  const prev = activeChat();
  try {
    if (!(await openChat(chat))) return { error: 'send-unavailable' };
    const composer = document.querySelector<HTMLElement>('footer [contenteditable="true"]');
    if (!composer) return { error: 'send-unavailable' };
    composer.focus();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], mime === 'image/png' ? 'gambar.png' : 'gambar.jpg', { type: mime }));
    composer.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    // the media preview replaces the composer: its caption box is a contenteditable outside <footer>
    const cap = await waitFor(() => document.querySelector<HTMLElement>('[data-testid="media-caption-input-container"] [contenteditable="true"], div[role="dialog"] [contenteditable="true"], [data-animate-media-viewer] [contenteditable="true"]'), 6000);
    if (!cap) return { error: 'send-unavailable' };
    if (caption) {
      const r = await insertIntoComposer(caption, { mode: 'replace', composer: cap });
      if (!r.ok) return { error: 'send-unavailable' };
      await sleepMs(150);
    }
    const icons = [...document.querySelectorAll<HTMLElement>('[data-icon="send"], [data-icon="wds-ic-send-filled"], [data-testid="send"]')];
    const btn = icons.length ? ((icons[icons.length - 1].closest('button,[role="button"]') as HTMLElement | null) ?? icons[icons.length - 1]) : null;
    if (!btn) return { error: 'send-unavailable' };
    btn.click();
    return { method: 'dom-paste' };
  } finally {
    if (prev && prev !== chat) { try { await openChat(prev); } catch { /* ignore */ } }
  }
}

/** Image send with optional caption. Same guarantees as sendText: never fakes success, `verified` says whether it was seen in the chat. */
async function sendMedia(chatId: string, dataUrl: string, mime: string, caption: string, allowDom = false, verify = true): Promise<SendResult> {
  if (isBlockedId(chatId) || !isValidMedia({ name: 'x', mime, bytes: 0, dataUrl })) throw new Error('send-rejected');
  const blob = dataUrlToBlob(dataUrl);
  if (!blob) throw new Error('send-rejected');
  const chat = await resolveChat(chatId);
  if (!chat) throw new Error('chat-not-found');
  const since = Date.now();
  let res = await sendMediaViaApi(chat, blob, mime, caption);
  if ('error' in res && allowDom) res = await sendMediaViaDom(chat, blob, mime, caption);
  if ('error' in res) throw new Error(res.error);
  const verified = verify ? await verifyMediaSent(chat, caption, since) : false;
  return { ok: true, method: res.method, verified };
}

// ---- send:probe: report what exists, never sends ----
function fnItem(group: string, name: string, v: Any, fn: string): ProbeItem {
  const t = v?.[fn];
  return { group, name: `${name}.${fn}`, found: t !== undefined && t !== null, type: t === undefined || t === null ? '-' : typeof t };
}
function probe(): ProbeResult {
  const items: ProbeItem[] = [];
  const add = (group: string, mod: string, fns: string[]) => {
    let m: Any;
    try { m = req(mod); } catch { m = undefined; }
    items.push({ group, name: mod, found: !!m, type: m ? typeof m : '-' });
    for (const f of fns) items.push(fnItem(group, mod, m, f));
  };
  const c = store.collections;
  items.push({ group: 'Koleksi', name: 'WAWebCollections', found: !!c, type: c ? typeof c : '-' });
  for (const k of ['Chat', 'Contact', 'GroupMetadata', 'Label', 'Msg']) items.push(fnItem('Koleksi', 'WAWebCollections', c, k));
  for (const f of ['get', 'find', 'getModelsArray', 'getActive']) items.push(fnItem('Pencarian chat', 'Collections.Chat', c?.Chat, f));
  add('Pencarian chat', 'WAWebFindChatAction', ['findOrCreateLatestChat']);
  add('Pencarian chat', 'WAWebWidFactory', ['createWid']);
  add('Kirim pesan', 'WAWebChatSendMessages', ['sendTextMsgToChat', 'addAndSendTextMsg']);
  add('Kirim pesan', 'WAWebSendTextMsgChatAction', ['sendTextMsgToChat']);
  add('Kirim pesan', 'WAWebMessageSender', ['sendTextMsgToChat', 'addAndSendTextMsg']);
  const sample = chatsColl()[0];
  items.push(fnItem('Kirim pesan', 'chat (contoh)', sample, 'sendMessage'));
  add('Kirim gambar', 'WAWebMediaPrep', ['prepRawMedia']);
  add('Kirim gambar', 'WAWebMediaOpaqueData', ['createFromData']);
  add('Makro DOM', 'WAWebCmd', []);
  const cmd = req('WAWebCmd');
  items.push(fnItem('Makro DOM', 'WAWebCmd.Cmd', cmd?.Cmd ?? cmd, 'openChatBottom'));
  add('Grup', 'WAWebGroupQueryJob', ['queryAndUpdateGroupMetadataById', 'queryGroupMetadata']);
  items.push(fnItem('Grup', 'chat (contoh)', sample, 'groupMetadata'));
  items.push(fnItem('Label', 'WAWebCollections', c, 'Label'));
  add('Cek nomor (check:registered)', 'WAWebQueryExist', ['queryExists', 'queryExist']);
  add('Akun', 'WAWebUserPrefsMeUser', ['getMaybeMePnUser', 'getMaybeMeLidUser', 'getMaybeMeUser']);
  for (const n of discoverModules(/Media(Prep|Opaque|Send|Upload)|OpaqueData|SendMsg|SendMessage|AddAndSend|SendMedia|Attach/i, 60)) items.push({ group: 'Penemuan modul (kirim gambar/pesan)', name: n, found: true, type: 'module' });
  for (const n of discoverModules(/lid|phone|pn[A-Z]|PhoneNumber/i)) items.push({ group: 'Penemuan modul (LID/nomor)', name: n, found: true, type: 'module' });
  return { items, accountId: accountId(), store: !!c?.Chat, hidden: document.hidden };
}

/** Sends the fixed test text to the account's own chat (self-chat). The caller must have asked for explicit confirmation. */
async function selfTest(allowDom: boolean): Promise<SendResult> {
  const me = accountId();
  if (!me) throw new Error('account-unknown');
  const id = /@/.test(me) ? me : `${me}@c.us`;
  return sendText(id, 'Tes WhatsApp Web Toolkit', allowDom, true);
}

/**
 * check:registered — is each phone a WhatsApp user? Feature-detected, module names UNVERIFIED against the live
 * site. Returns registered:null when unknown. For registered numbers without a chat yet it best-effort creates
 * the Chat model (Chat.find) so a later send:text can find it.
 */
async function checkRegistered(phones: string[]): Promise<RegisteredResult[]> {
  const out: RegisteredResult[] = [];
  for (const raw of phones.slice(0, 20)) {
    const phone = String(raw).replace(/\D/g, '');
    const jid = `${phone}@c.us`;
    try {
      if (!phone || phone.length < 8) { out.push({ phone, registered: false }); continue; }
      if (findChat(jid)) { out.push({ phone, registered: true, chatId: jid }); continue; }
      const w = req('WAWebWidFactory');
      const widObj = typeof w?.createWid === 'function' ? w.createWid(jid) : undefined;
      const q = req('WAWebQueryExist');
      const fn = q?.queryExists ?? q?.queryExist ?? q?.default;
      if (!widObj || typeof fn !== 'function') { out.push({ phone, registered: null }); continue; }
      const res = await fn(widObj);
      if (!res) { out.push({ phone, registered: false }); continue; }
      const target = res.wid ?? widObj;
      try { await store.collections?.Chat?.find?.(target); } catch { /* chat model creation is best effort */ }
      const resolved = wid(target) || jid;
      out.push({ phone, registered: true, chatId: findChat(resolved) ? resolved : jid });
    } catch { out.push({ phone, registered: null }); }
  }
  return out;
}

function reply(res: BridgeResponse) {
  const env: BridgeEnvelope<BridgeResponse> = { channel: BRIDGE_CHANNEL, dir: 'res', payload: res };
  window.postMessage(env, window.location.origin);
}

async function handle(r: BridgeRequest): Promise<BridgeResponse> {
  switch (r.type) {
    case 'groups:list':
      return { id: r.id, ok: true, data: ((): GroupsListResult => { try { return groupsList(); } catch { return { unavailable: true, reason: 'error' }; } })() };
    case 'groups:members':
      return { id: r.id, ok: true, data: await groupMembers(r.groupId).catch((): GroupMembersResult => ({ unavailable: true, reason: 'error' })) };
    case 'labels:list':
      return { id: r.id, ok: true, data: ((): LabelsListResult => { try { return labelsList(); } catch { return { unavailable: true, reason: 'error' }; } })() };
    case 'labels:chats':
      return { id: r.id, ok: true, data: await labelChats(String(r.labelId)).catch((): LabelChatsResult => ({ unavailable: true, reason: 'error' })) };
    case 'ping': {
      const data: PingResult = { adapter: 'ready', store: !!store.collections?.Chat, accountId: accountId() };
      return { id: r.id, ok: true, data };
    }
    case 'chats:contacts':
      return { id: r.id, ok: true, data: await chatContacts().catch((): ChatsContactsResult => ({ unavailable: true, reason: 'error' })) };
    case 'chats:list':
      return { id: r.id, ok: true, data: chatsColl().map(info) };
    case 'chat:messages': {
      const acc = accountId() ?? 'unknown';
      const chat = findChat(r.chatId);
      if (chat && !cache.has(r.chatId)) remember(r.chatId, msgsOf(chat));
      const out = [...(cache.get(r.chatId)?.values() ?? [])].map((m) => ({ ...m, accountId: acc, key: `${acc}|${m.id}` }));
      return { id: r.id, ok: true, data: out };
    }
    case 'sync:loadEarlier':
      return { id: r.id, ok: true, data: await loadEarlier(r.chatId) };
    case 'activity:scan':
      return { id: r.id, ok: true, data: scanActivity() };
    case 'chat:open':
      return { id: r.id, ok: true, data: await openChatById(String(r.chatId), r.phone) };
    case 'inbox:poll':
      return { id: r.id, ok: true, data: pollInbox(Number(r.sinceTs) || 0, r.includeGroups === true) };
    case 'send:text':
      return { id: r.id, ok: true, data: await sendText(r.chatId, r.text, r.allowDom === true, r.verify !== false, r.group === true) };
    case 'send:media':
      return { id: r.id, ok: true, data: await sendMedia(r.chatId, r.dataUrl, r.mime, r.caption ?? '', r.allowDom === true, r.verify !== false) };
    case 'send:probe':
      return { id: r.id, ok: true, data: probe() };
    case 'send:self-test':
      return { id: r.id, ok: true, data: await selfTest(r.allowDom === true) };
    case 'check:registered':
      return { id: r.id, ok: true, data: await checkRegistered(Array.isArray(r.phones) ? r.phones : []) };
    case 'memory:trim':
      return { id: r.id, ok: true, data: { trimmed: trim() } };
  }
}

window.addEventListener('message', async (e) => {
  if (e.source !== window || e.origin !== window.location.origin) return;
  const d = e.data as BridgeEnvelope<BridgeRequest> | undefined;
  if (!d || d.channel !== BRIDGE_CHANNEL || d.dir !== 'req') return;
  try { reply(await handle(d.payload)); }
  catch (err) { reply({ id: d.payload.id, ok: false, error: err instanceof Error ? err.message : String(err) }); }
});
