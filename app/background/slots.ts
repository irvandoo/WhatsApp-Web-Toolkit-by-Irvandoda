import { db } from '../shared/db';
import {
  DEFAULT_SID, PURGE_QUEUE_KEY, SLOT_COLORS, SLOT_STATES, defaultSlot, isValidSid, newSid, normalizeColor, validateLabel,
  type Slot, type SlotExec, type SlotMsg, type SlotPatch,
} from '../shared/slots';
import { enqueuePurge, mapReportedState, mergeSlotImport, parseSlotRegistry, serializeSlots, waPhoneFromId, MAX_BULK } from '../shared/slots-logic';

/**
 * Purging a deleted slot's data (IndexedDB `wwt:<sid>:*`, localStorage) must run inside a WhatsApp tab
 * (content/slot-status.ts); the service worker cannot see the page origin's storage. If no tab can do it,
 * the id is queued in chrome.storage.local[PURGE_QUEUE_KEY] and drained by the next WA tab that loads.
 */
export const isSlotMsg = (m: unknown): m is SlotMsg => /^slot:/.test(String((m as { kind?: string } | null)?.kind));

const WA_URL = 'https://web.whatsapp.com/*';

async function ensureDefault(): Promise<void> {
  if (!(await db.slots.get(DEFAULT_SID))) await db.slots.put(defaultSlot());
}

function cleanPatch(p: SlotPatch | undefined): Partial<Slot> {
  const src = p ?? {}, up: Partial<Slot> = {};
  if ('label' in src) up.label = validateLabel(src.label);
  if ('color' in src) up.color = normalizeColor(src.color);
  if ('groupId' in src) up.groupId = typeof src.groupId === 'string' ? src.groupId : null;
  if ('note' in src) up.note = String(src.note ?? '').slice(0, 500);
  if ('pinned' in src) up.pinned = !!src.pinned;
  if ('archived' in src) up.archived = !!src.archived;
  if ('order' in src) up.order = typeof src.order === 'number' && Number.isFinite(src.order) ? src.order : undefined;
  return up;
}

async function newSlot(label: string, n: number, o: { color?: string; groupId?: string | null; note?: string }): Promise<Slot> {
  const now = Date.now();
  let id = newSid();
  while (await db.slots.get(id)) id = newSid();
  const slot: Slot = {
    id, label: validateLabel(label), color: normalizeColor(o.color, SLOT_COLORS[n % SLOT_COLORS.length]),
    groupId: o.groupId ?? null, note: String(o.note ?? '').slice(0, 500), accountId: null, createdAt: now, lastUsedAt: 0,
  };
  await db.slots.put(slot);
  return slot;
}

const sendTab = (tabId: number, m: SlotExec): Promise<{ holds?: boolean; ok?: boolean; refused?: string; error?: string } | undefined> =>
  new Promise((res) => {
    try { chrome.tabs.sendMessage(tabId, m, (r) => { void chrome.runtime.lastError; res(r); }); } catch { res(undefined); }
  });

async function waTabs(): Promise<chrome.tabs.Tab[]> {
  try { return (await chrome.tabs.query({ url: WA_URL })).filter((t) => typeof t.id === 'number'); } catch { return []; }
}

/** Tab currently holding `sid` (verified by asking the tab; the stored hint is tried first). */
async function findTab(sid: string, hint?: number): Promise<chrome.tabs.Tab | null> {
  const tabs = await waTabs();
  tabs.sort((a, b) => Number(b.id === hint) - Number(a.id === hint));
  for (const t of tabs) {
    const r = await sendTab(t.id!, { kind: 'slotx:holds', id: sid });
    if (r?.holds) return t;
  }
  return null;
}

async function focusTab(t: chrome.tabs.Tab): Promise<void> {
  await chrome.tabs.update(t.id!, { active: true });
  if (t.windowId !== undefined) await chrome.windows.update(t.windowId, { focused: true }).catch(() => undefined);
}

export async function handleSlots(m: SlotMsg, sender?: chrome.runtime.MessageSender): Promise<unknown> {
  await ensureDefault();
  switch (m.kind) {
    case 'slot:list':
      return (await db.slots.toArray()).sort((a, b) => a.createdAt - b.createdAt);
    case 'slot:create':
      return newSlot(m.label, await db.slots.count(), m);
    case 'slot:bulk-create': {
      if (!Array.isArray(m.labels) || !m.labels.length) throw new Error('daftar label kosong');
      const out: Slot[] = [];
      let n = await db.slots.count();
      for (const l of m.labels.slice(0, MAX_BULK)) out.push(await newSlot(l, n++, { groupId: m.groupId, color: m.color }));
      return out;
    }
    case 'slot:update': {
      if (!(await db.slots.get(m.id))) throw new Error('slot tidak ada');
      const up = cleanPatch(m.patch);
      if (m.id === DEFAULT_SID) delete up.archived;
      await db.slots.update(m.id, up);
      return db.slots.get(m.id);
    }
    case 'slot:bulk-update': {
      const up = cleanPatch(m.patch);
      if ('archived' in up) m.ids = m.ids.filter((i) => i !== DEFAULT_SID);
      let n = 0;
      for (const id of m.ids ?? []) if (await db.slots.update(id, up)) n++;
      return { ok: true, updated: n };
    }
    case 'slot:delete':
      if (m.id === DEFAULT_SID) throw new Error('slot utama tidak bisa dihapus');
      await db.slots.delete(m.id);
      return { ok: true };
    case 'slot:touch':
      await db.slots.update(m.id, { lastUsedAt: Date.now() });
      return { ok: true };
    case 'slot:bind': {
      if (typeof m.accountId !== 'string' || !m.accountId) throw new Error('bad accountId');
      await db.slots.update(m.id, { accountId: m.accountId, waPhone: waPhoneFromId(m.accountId) || undefined });
      return { ok: true };
    }
    case 'slot:status': {
      if (!SLOT_STATES.includes(m.state) || typeof m.id !== 'string') throw new Error('bad status');
      const cur = await db.slots.get(m.id);
      if (!cur) return { ok: false };
      const accountId = typeof m.accountId === 'string' && m.accountId ? m.accountId : cur.accountId;
      const up: Partial<Slot> = {
        status: mapReportedState(m.state, cur.accountId), statusTs: Date.now(), unread: Math.max(0, +(m.unread ?? 0) || 0),
        statusTabId: sender?.tab?.id,
      };
      if (accountId && accountId !== cur.accountId) { up.accountId = accountId; up.waPhone = waPhoneFromId(accountId) || undefined; }
      if (m.state === 'online') up.lastUsedAt = Date.now();
      await db.slots.update(m.id, up);
      return { ok: true };
    }
    case 'slot:open-tab': {
      if (!isValidSid(m.id)) throw new Error('bad id');
      await chrome.tabs.create({ url: `https://web.whatsapp.com/#wwt-sid=${m.id}` });
      return { ok: true };
    }
    case 'slot:focus': {
      if (!isValidSid(m.id)) throw new Error('bad id');
      const cur = await db.slots.get(m.id);
      const t = await findTab(m.id, cur?.statusTabId);
      if (t) { await focusTab(t); return { ok: true, opened: false }; }
      await chrome.tabs.create({ url: `https://web.whatsapp.com/#wwt-sid=${m.id}` });
      return { ok: true, opened: true };
    }
    case 'slot:switch-here': {
      // ask a WA tab (not holding another live copy of this slot) to switch itself to the slot
      if (!isValidSid(m.id)) throw new Error('bad id');
      const st = sender?.tab && /^https:\/\/web\.whatsapp\.com\//.test(sender.tab.url ?? '') ? sender.tab : null;
      const t = st ?? (await waTabs())[0];
      if (!t) { await chrome.tabs.create({ url: `https://web.whatsapp.com/#wwt-sid=${m.id}` }); return { ok: true, opened: true }; }
      const r = await sendTab(t.id!, { kind: 'slotx:switch', id: m.id });
      if (!r?.ok) throw new Error('tab WhatsApp tidak merespons');
      await focusTab(t);
      return { ok: true, opened: false };
    }
    case 'slot:purge': {
      if (!isValidSid(m.id) || m.id === DEFAULT_SID) throw new Error('slot ini tidak bisa dihapus datanya');
      if (await findTab(m.id)) throw new Error('Akun ini sedang aktif di sebuah tab WhatsApp. Pindah ke akun lain atau tutup tabnya dulu.');
      for (const t of await waTabs()) {
        const r = await sendTab(t.id!, { kind: 'slotx:purge', id: m.id });
        if (r?.ok) return { ok: true, queued: false };
      }
      const got = await chrome.storage.local.get(PURGE_QUEUE_KEY);
      await chrome.storage.local.set({ [PURGE_QUEUE_KEY]: enqueuePurge(got[PURGE_QUEUE_KEY], m.id) });
      return { ok: true, queued: true };
    }
    case 'slot:export':
      return serializeSlots(await db.slots.toArray(), await db.groups.toArray());
    case 'slot:import': {
      const imp = parseSlotRegistry(m.json);
      return db.transaction('rw', db.slots, db.groups, async () => {
        const r = mergeSlotImport(await db.slots.toArray(), await db.groups.toArray(), imp);
        const have = new Set((await db.groups.toArray()).map((g) => g.id));
        await db.groups.bulkPut(r.groups.filter((g) => !have.has(g.id)));
        await db.slots.bulkPut(r.slots);
        return { added: r.added, updated: r.updated };
      });
    }
    default:
      throw new Error('unknown slot message');
  }
}
