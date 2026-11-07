// MAIN world. WhatsApp Web internals change often: everything is feature-detected and
// failures degrade to "unavailable" / DOM fallbacks instead of throwing.
import {
  BRIDGE_CHANNEL, type ArchivedMsg, type BridgeEnvelope, type BridgeRequest, type BridgeResponse,
  type ChatInfo, type LoadEarlierResult, type PingResult,
} from '../shared/messages';

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

function reply(res: BridgeResponse) {
  const env: BridgeEnvelope<BridgeResponse> = { channel: BRIDGE_CHANNEL, dir: 'res', payload: res };
  window.postMessage(env, window.location.origin);
}

async function handle(r: BridgeRequest): Promise<BridgeResponse> {
  switch (r.type) {
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
