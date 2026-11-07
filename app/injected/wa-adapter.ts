// MAIN world. WhatsApp Web internals change often: everything is feature-detected and
// failures degrade to "unavailable" / DOM fallbacks instead of throwing.
import {
  BRIDGE_CHANNEL, type ArchivedMsg, type BridgeEnvelope, type BridgeRequest, type BridgeResponse,
  type ActivityChat, type ActivityScanResult, type ChatInfo, type LoadEarlierResult, type PingResult,
  type RegisteredResult, type GroupInfo, type GroupMember, type GroupsListResult, type GroupMembersResult,
  type LabelInfo, type LabelChat, type LabelsListResult, type LabelChatsResult, type SendResult, type ProbeItem, type ProbeResult,
} from '../shared/messages';
import { insertIntoComposer } from '../content/composer-insert';
import type { InboxItem } from '../shared/autoreply-types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function req(name: string): Any {
  const w = window as Any;
  try { if (typeof w.require === 'function') return w.require(name); } catch { /* module absent */ }
  try { if (typeof w.mR?.findModule === 'function') return w.mR.findModule(name)?.[0]; } catch { /* ignore */ }
  return undefined;
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
  } catch { /* ignore */ }
  for (const x of cands) { const d = digits(typeof x === 'string' ? x.split('@')[0] : wsUser(x)); if (d.length >= 6) return d; }
  return null;
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
      else if (chat) phone = await phoneOf({ id: chat.id, contact: chat.contact });
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
async function openChat(chat: Any): Promise<boolean> {
  try {
    const cmd = req('WAWebCmd');
    const host = cmd?.Cmd ?? cmd;
    const fn = host?.openChatBottom ?? host?.openChatAt;
    if (typeof fn !== 'function') return false;
    await fn.call(host, chat);
    for (let i = 0; i < 20; i++) { if (document.querySelector('footer [contenteditable="true"]')) return true; await sleepMs(150); }
  } catch { /* ignore */ }
  return false;
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
  add('Makro DOM', 'WAWebCmd', []);
  const cmd = req('WAWebCmd');
  items.push(fnItem('Makro DOM', 'WAWebCmd.Cmd', cmd?.Cmd ?? cmd, 'openChatBottom'));
  add('Grup', 'WAWebGroupQueryJob', ['queryAndUpdateGroupMetadataById', 'queryGroupMetadata']);
  items.push(fnItem('Grup', 'chat (contoh)', sample, 'groupMetadata'));
  items.push(fnItem('Label', 'WAWebCollections', c, 'Label'));
  add('Cek nomor (check:registered)', 'WAWebQueryExist', ['queryExists', 'queryExist']);
  add('Akun', 'WAWebUserPrefsMeUser', ['getMaybeMePnUser', 'getMaybeMeLidUser', 'getMaybeMeUser']);
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
    case 'inbox:poll':
      return { id: r.id, ok: true, data: pollInbox(Number(r.sinceTs) || 0, r.includeGroups === true) };
    case 'send:text':
      return { id: r.id, ok: true, data: await sendText(r.chatId, r.text, r.allowDom === true, r.verify !== false, r.group === true) };
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
