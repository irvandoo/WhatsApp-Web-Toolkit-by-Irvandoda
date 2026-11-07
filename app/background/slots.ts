import { db } from '../shared/db';
import {
  DEFAULT_SID, SLOT_COLORS, defaultSlot, isValidSid, newSid, normalizeColor, validateLabel,
  type Slot, type SlotMsg,
} from '../shared/slots';

/**
 * Data of deleted slots (IndexedDB `wwt:<sid>:*`, localStorage) is purged by the content script
 * (switcher.ts purgeSlotData), not here: the service worker cannot see the page's origin storage.
 */
export const isSlotMsg = (m: unknown): m is SlotMsg => /^slot:/.test(String((m as { kind?: string } | null)?.kind));

async function ensureDefault(): Promise<void> {
  if (!(await db.slots.get(DEFAULT_SID))) await db.slots.put(defaultSlot());
}

export async function handleSlots(m: SlotMsg): Promise<unknown> {
  await ensureDefault();
  switch (m.kind) {
    case 'slot:list':
      return (await db.slots.toArray()).sort((a, b) => a.createdAt - b.createdAt);
    case 'slot:create': {
      const now = Date.now();
      let id = newSid();
      while (await db.slots.get(id)) id = newSid();
      const n = await db.slots.count();
      const slot: Slot = {
        id, label: validateLabel(m.label), color: normalizeColor(m.color, SLOT_COLORS[n % SLOT_COLORS.length]),
        groupId: m.groupId ?? null, note: '', accountId: null, createdAt: now, lastUsedAt: now,
      };
      await db.slots.put(slot);
      return slot;
    }
    case 'slot:update': {
      if (!(await db.slots.get(m.id))) throw new Error('slot tidak ada');
      const p = m.patch ?? {}, up: Partial<Slot> = {};
      if ('label' in p) up.label = validateLabel(p.label);
      if ('color' in p) up.color = normalizeColor(p.color);
      if ('groupId' in p) up.groupId = typeof p.groupId === 'string' ? p.groupId : null;
      if ('note' in p) up.note = String(p.note ?? '').slice(0, 500);
      await db.slots.update(m.id, up);
      return db.slots.get(m.id);
    }
    case 'slot:delete':
      if (m.id === DEFAULT_SID) throw new Error('slot utama tidak bisa dihapus');
      await db.slots.delete(m.id);
      return { ok: true };
    case 'slot:touch':
      await db.slots.update(m.id, { lastUsedAt: Date.now() });
      return { ok: true };
    case 'slot:bind':
      if (typeof m.accountId !== 'string' || !m.accountId) throw new Error('bad accountId');
      await db.slots.update(m.id, { accountId: m.accountId });
      return { ok: true };
    case 'slot:open-tab': {
      if (!isValidSid(m.id)) throw new Error('bad id');
      await chrome.tabs.create({ url: `https://web.whatsapp.com/#wwt-sid=${m.id}` });
      return { ok: true };
    }
    default:
      throw new Error('unknown slot message');
  }
}
