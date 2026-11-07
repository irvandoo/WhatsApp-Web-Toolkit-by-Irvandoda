/** Pure helpers for the Hub / slot registry (no DOM, no chrome). */
import {
  DEFAULT_SID, STATUS_STALE_MS, isValidSid, normalizeColor, validateLabel,
  type Slot, type SlotState, type SlotView,
} from './slots';
import type { AccountGroup } from './messages';

export const MAX_BULK = 50;
export const MAX_IMPORT = 2000;

/** What the Hub shows: a status older than STATUS_STALE_MS (or never reported) is 'inactive'. */
export function effectiveView(s: Pick<Slot, 'status' | 'statusTs'>, now = Date.now()): SlotView {
  if (!s.status || !s.statusTs || now - s.statusTs > STATUS_STALE_MS || s.statusTs - now > 60_000) return 'inactive';
  return s.status;
}
/** A QR on a slot that was logged in before means the login was lost. */
export const mapReportedState = (state: SlotState, boundAccountId: string | null | undefined): SlotState =>
  state === 'qr' && boundAccountId ? 'logged-out' : state;

export const VIEW_LABEL: Record<SlotView, string> = {
  qr: 'Perlu scan QR', 'logged-out': 'Logout - scan ulang', loading: 'Memuat', online: 'Online',
  offline: 'Offline', unknown: 'Tidak diketahui', inactive: 'Tidak aktif',
};
export const needsQr = (v: SlotView) => v === 'qr' || v === 'logged-out';

export const waPhoneFromId = (id: string | null | undefined): string => {
  const m = /^(\d{5,20})(?::\d+)?@/.exec(id ?? '');
  return m ? m[1] : '';
};

/** "Tambah beberapa akun": one label per line. Dedupes (case-insensitive, also against `existing`). */
export function parseBulkLabels(text: string, existing: string[] = []): { labels: string[]; skipped: number; truncated: boolean } {
  const seen = new Set(existing.map((x) => x.trim().toLowerCase()));
  const labels: string[] = [];
  let skipped = 0, truncated = false;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
    if (!line) continue;
    let l: string;
    try { l = validateLabel(line); } catch { skipped++; continue; }
    const k = l.toLowerCase();
    if (seen.has(k)) { skipped++; continue; }
    if (labels.length >= MAX_BULK) { truncated = true; skipped++; continue; }
    seen.add(k); labels.push(l);
  }
  return { labels, skipped, truncated };
}

// ---- purge queue (stored in chrome.storage.local['wwt-purge-queue']) ----
export function sanitizeQueue(q: unknown): string[] {
  return Array.isArray(q) ? [...new Set(q.filter((x): x is string => isValidSid(x) && x !== DEFAULT_SID))].slice(0, 500) : [];
}
export const enqueuePurge = (q: unknown, sid: string): string[] =>
  isValidSid(sid) && sid !== DEFAULT_SID ? sanitizeQueue([...sanitizeQueue(q), sid]) : sanitizeQueue(q);
/** Ids this tab may purge now (everything except its own active slot) and what stays queued. */
export function drainPurge(q: unknown, activeSid: string): { run: string[]; keep: string[] } {
  const all = sanitizeQueue(q);
  return { run: all.filter((x) => x !== activeSid), keep: all.filter((x) => x === activeSid) };
}

// ---- registry export / import (labels, colors, groups, notes ONLY; never session data) ----
export const SLOT_EXPORT_NOTE = 'Hanya daftar akun (label/warna/grup/catatan). TIDAK berisi sesi login atau kredensial WhatsApp.';
export type ImportedSlot = Pick<Slot, 'id' | 'label' | 'color' | 'groupId' | 'note' | 'createdAt'> & { pinned: boolean; archived: boolean; order?: number };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

export function serializeSlots(slots: Slot[], groups: AccountGroup[]): string {
  return JSON.stringify({
    version: 1, kind: 'wwt-slots', note: SLOT_EXPORT_NOTE,
    groups: groups.map((g) => ({ id: g.id, name: g.name, color: g.color })),
    slots: slots.filter((s) => s.id !== DEFAULT_SID).map((s) => ({
      id: s.id, label: s.label, color: s.color, groupId: s.groupId, note: s.note, createdAt: s.createdAt,
      pinned: !!s.pinned, archived: !!s.archived, ...(typeof s.order === 'number' ? { order: s.order } : {}),
    })),
  }, null, 2);
}

/** Strict: throws on any shape violation; unknown fields are dropped (so credentials can never sneak in). */
export function parseSlotRegistry(json: string): { slots: ImportedSlot[]; groups: AccountGroup[] } {
  if (typeof json !== 'string' || json.length > 5_000_000) throw new Error('file terlalu besar');
  let d: unknown;
  try { d = JSON.parse(json); } catch { throw new Error('bukan JSON yang valid'); }
  if (!isObj(d) || d.kind !== 'wwt-slots' || d.version !== 1) throw new Error('bukan file daftar akun (versi tidak didukung)');
  if (!Array.isArray(d.slots) || !Array.isArray(d.groups)) throw new Error('slots/groups harus berupa array');
  if (d.slots.length > MAX_IMPORT || d.groups.length > MAX_IMPORT) throw new Error('terlalu banyak entri');
  const groups = d.groups.map((g, i): AccountGroup => {
    if (!isObj(g) || !isStr(g.id) || !g.id || g.id.length > 64 || !isStr(g.name) || !g.name.trim()) throw new Error(`grup #${i + 1} tidak valid`);
    return { id: g.id, name: g.name.trim().slice(0, 60), color: normalizeColor(g.color, '#128c7e') };
  });
  const ids = new Set<string>();
  const slots = d.slots.map((s, i): ImportedSlot => {
    if (!isObj(s) || !isValidSid(s.id) || s.id === DEFAULT_SID) throw new Error(`akun #${i + 1}: id tidak valid`);
    if (ids.has(s.id)) throw new Error(`akun #${i + 1}: id ganda`);
    ids.add(s.id);
    if (!isStr(s.label) || !s.label.trim()) throw new Error(`akun #${i + 1}: label kosong`);
    if (!(s.groupId === null || s.groupId === undefined || isStr(s.groupId))) throw new Error(`akun #${i + 1}: groupId tidak valid`);
    if (s.note !== undefined && !isStr(s.note)) throw new Error(`akun #${i + 1}: catatan tidak valid`);
    return {
      id: s.id, label: validateLabel(s.label), color: normalizeColor(s.color), groupId: (s.groupId as string | null | undefined) ?? null,
      note: String(s.note ?? '').slice(0, 500),
      createdAt: typeof s.createdAt === 'number' && Number.isFinite(s.createdAt) && s.createdAt > 0 ? s.createdAt : 0,
      pinned: s.pinned === true, archived: s.archived === true,
      ...(typeof s.order === 'number' && Number.isFinite(s.order) ? { order: s.order } : {}),
    };
  });
  return { slots, groups };
}

/** Existing slots keep their live fields (accountId, status, lastUsedAt); unknown groupIds become null. */
export function mergeSlotImport(existing: Slot[], existingGroups: AccountGroup[], imp: { slots: ImportedSlot[]; groups: AccountGroup[] }, now = Date.now()) {
  const gids = new Set([...existingGroups.map((g) => g.id), ...imp.groups.map((g) => g.id)]);
  const byId = new Map(existing.map((s) => [s.id, s]));
  let added = 0, updated = 0;
  const slots = imp.slots.map((i): Slot => {
    const groupId = i.groupId && gids.has(i.groupId) ? i.groupId : null;
    const cur = byId.get(i.id);
    if (cur) { updated++; return { ...cur, label: i.label, color: i.color, groupId, note: i.note, pinned: i.pinned, archived: i.archived, order: i.order }; }
    added++;
    return { id: i.id, label: i.label, color: i.color, groupId, note: i.note, accountId: null, createdAt: i.createdAt || now, lastUsedAt: 0, pinned: i.pinned, archived: i.archived, order: i.order };
  });
  return { slots, groups: imp.groups, added, updated };
}

// ---- list view helpers ----
export type SortKey = 'name' | 'active' | 'unread' | 'created' | 'manual';
export function sortSlots(list: Slot[], key: SortKey): Slot[] {
  const cmp: Record<SortKey, (a: Slot, b: Slot) => number> = {
    name: (a, b) => a.label.localeCompare(b.label, 'id'),
    active: (a, b) => b.lastUsedAt - a.lastUsedAt,
    unread: (a, b) => (b.unread ?? 0) - (a.unread ?? 0),
    created: (a, b) => b.createdAt - a.createdAt,
    manual: (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.createdAt - b.createdAt,
  };
  return [...list].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || cmp[key](a, b));
}

// ---- recovery of slots whose login data still exists but that are missing from the registry ----
/**
 * Slot ids found in WhatsApp-origin storage names (`wwt:<sid>:…` IndexedDB databases or localStorage keys)
 * that are not registered. Happens when the extension id changed (loaded from another folder), the extension
 * was removed/reinstalled, or its own storage was cleared: the login data is intact, only the list is gone.
 */
export function extractOrphanSids(names: string[], known: string[]): string[] {
  const seen = new Set(known);
  const out: string[] = [];
  for (const n of names) {
    const m = /^wwt:([a-z0-9]{3,16}):/.exec(String(n));
    if (!m) continue;
    const id = m[1];
    if (id === DEFAULT_SID || !isValidSid(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Parse the localStorage mirror defensively: {id: {label, color}}. */
export function parseMirror(raw: unknown): Record<string, { label: string; color?: string }> {
  const out: Record<string, { label: string; color?: string }> = {};
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!o || typeof o !== 'object') return out;
    for (const [id, v] of Object.entries(o as Record<string, unknown>)) {
      if (!isValidSid(id) || id === DEFAULT_SID || !v || typeof v !== 'object') continue;
      const label = (v as { label?: unknown }).label;
      if (typeof label !== 'string' || !label.trim()) continue;
      const color = (v as { color?: unknown }).color;
      out[id] = { label: label.trim().slice(0, 60), color: typeof color === 'string' ? color : undefined };
    }
  } catch { /* corrupt mirror -> ignore */ }
  return out;
}
