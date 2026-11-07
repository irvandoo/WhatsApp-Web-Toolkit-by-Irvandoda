/** Slot = one isolated WhatsApp Web login namespace (see injected/virtual-session.ts). Pure helpers, no DOM/chrome. */
export const DEFAULT_SID = 'default';
export const SID_KEY = 'wwt-sid';
export const SLOT_COLORS = ['#128c7e', '#2563eb', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#65a30d', '#db2777'];

export interface Slot {
  id: string;            // 'default' (reserved, untouched original namespace) or short random id
  label: string;
  color: string;
  groupId: string | null;
  note: string;
  accountId: string | null; // WA id once known
  createdAt: number;
  lastUsedAt: number;
}

export type SlotMsg =
  | { kind: 'slot:list' }
  | { kind: 'slot:create'; label: string; color?: string; groupId?: string | null }
  | { kind: 'slot:update'; id: string; patch: Partial<Pick<Slot, 'label' | 'color' | 'groupId' | 'note'>> }
  | { kind: 'slot:delete'; id: string }
  | { kind: 'slot:touch'; id: string }
  | { kind: 'slot:bind'; id: string; accountId: string }
  | { kind: 'slot:open-tab'; id: string };

/** Storage/IDB/BroadcastChannel name prefix for a slot. Must match injected/virtual-session.ts. */
export const slotPrefix = (sid: string): string => `wwt:${sid}:`;
export const prefixName = (sid: string, name: string): string => (sid === DEFAULT_SID ? name : slotPrefix(sid) + name);
/** Returns the unprefixed name, or null when `name` is outside the slot's namespace. */
export function stripPrefix(sid: string, name: string): string | null {
  if (sid === DEFAULT_SID) return name;
  const p = slotPrefix(sid);
  return name.startsWith(p) ? name.slice(p.length) : null;
}

export const isValidSid = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9]{3,16}$/.test(s);
export function newSid(rand: () => number = Math.random): string {
  let s = '';
  while (s.length < 8) s += Math.floor(rand() * 36).toString(36);
  return s === DEFAULT_SID ? newSid(rand) : s;
}
export function validateLabel(v: unknown): string {
  const s = typeof v === 'string' ? v.trim().slice(0, 40) : '';
  if (!s) throw new Error('label kosong');
  return s;
}
export const normalizeColor = (v: unknown, fallback = SLOT_COLORS[0]): string =>
  typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fallback;
export const defaultSlot = (now = Date.now()): Slot =>
  ({ id: DEFAULT_SID, label: 'Akun utama', color: SLOT_COLORS[0], groupId: null, note: '', accountId: null, createdAt: now, lastUsedAt: now });
