import type { Account, AccountGroup } from '../shared/messages';

export const PALETTE = ['#25d366', '#128c7e', '#34b7f1', '#ff7043', '#ab47bc', '#ffb300', '#ec407a', '#5c6bc0', '#26a69a', '#8d6e63'];
export const colorFor = (n: number) => PALETTE[n % PALETTE.length];
const MAX = 10_000;
const isStr = (v: unknown): v is string => typeof v === 'string';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export type ImportedAccount = Pick<Account, 'id' | 'name' | 'color' | 'groupId' | 'profileLabel' | 'note' | 'lastSeen'>;

export function validateGroup(g: unknown): AccountGroup {
  if (!isObj(g) || !isStr(g.id) || !g.id || !isStr(g.name) || !isStr(g.color)) throw new Error('invalid group');
  return { id: g.id, name: g.name, color: g.color };
}

/** Strictly validate a registry export; throws on any shape violation. Extra fields are dropped. */
export function parseRegistry(json: string): { accounts: ImportedAccount[]; groups: AccountGroup[] } {
  let d: unknown;
  try { d = JSON.parse(json); } catch { throw new Error('invalid JSON'); }
  if (!isObj(d) || d.version !== 1) throw new Error('unsupported version');
  if (!Array.isArray(d.accounts) || !Array.isArray(d.groups)) throw new Error('accounts/groups must be arrays');
  if (d.accounts.length > MAX || d.groups.length > MAX) throw new Error('too many entries');
  const groups = d.groups.map(validateGroup);
  const accounts = d.accounts.map((a, i): ImportedAccount => {
    if (!isObj(a) || !isStr(a.id) || !a.id || !isStr(a.name) || !isStr(a.color) || !isStr(a.profileLabel) || !isStr(a.note)
      || !(a.groupId === null || isStr(a.groupId))) throw new Error(`invalid account #${i}`);
    return { id: a.id, name: a.name, color: a.color, groupId: a.groupId, profileLabel: a.profileLabel, note: a.note,
      lastSeen: typeof a.lastSeen === 'number' && Number.isFinite(a.lastSeen) ? a.lastSeen : 0 };
  });
  return { accounts, groups };
}

/** Merge by id. Existing accounts keep live online/unread/chatCount/lastSeen. Unknown groupIds become null. */
export function mergeRegistry(existing: Account[], existingGroups: AccountGroup[], imp: { accounts: ImportedAccount[]; groups: AccountGroup[] }) {
  const gids = new Set([...existingGroups.map((g) => g.id), ...imp.groups.map((g) => g.id)]);
  const byId = new Map(existing.map((a) => [a.id, a]));
  const accounts = imp.accounts.map((a): Account => {
    const groupId = a.groupId && gids.has(a.groupId) ? a.groupId : null;
    const cur = byId.get(a.id);
    return cur
      ? { ...cur, name: a.name, color: a.color, groupId, profileLabel: a.profileLabel, note: a.note }
      : { ...a, groupId, online: false, unread: 0, chatCount: 0 };
  });
  return { accounts, groups: imp.groups };
}
