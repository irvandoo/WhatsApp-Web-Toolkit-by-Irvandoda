import { db } from '../shared/db';
import type { Account, RuntimeMsg } from '../shared/messages';
import { colorFor, mergeRegistry, parseRegistry, validateGroup } from './registry';

const PATCH_KEYS = ['name', 'color', 'groupId', 'profileLabel', 'note'] as const;
export const NOT_HANDLED = Symbol('not-handled');

export async function handleAccounts(m: RuntimeMsg): Promise<unknown> {
  switch (m.kind) {
    case 'account:report': {
      if (typeof m.id !== 'string' || !m.id) throw new Error('bad id');
      const live = { online: !!m.online, unread: Math.max(0, +m.unread || 0), chatCount: Math.max(0, +m.chatCount || 0), lastSeen: Date.now() };
      await db.transaction('rw', db.accounts, async () => {
        const cur = await db.accounts.get(m.id);
        if (cur) await db.accounts.update(m.id, live);
        else await db.accounts.put({ id: m.id, name: m.id, color: colorFor(await db.accounts.count()), groupId: null, profileLabel: '', note: '', ...live });
      });
      return { ok: true };
    }
    case 'account:list': return db.accounts.toArray();
    case 'account:update': {
      const patch: Partial<Account> = {};
      for (const k of PATCH_KEYS) if (k in m.patch) (patch as Record<string, unknown>)[k] = m.patch[k];
      if (!(await db.accounts.update(m.id, patch))) throw new Error('account not found');
      return { ok: true };
    }
    case 'account:delete': await db.accounts.delete(m.id); return { ok: true };
    case 'group:list': return db.groups.toArray();
    case 'group:upsert': await db.groups.put(validateGroup(m.group)); return { ok: true };
    case 'group:delete':
      await db.transaction('rw', db.groups, db.accounts, async () => {
        await db.accounts.where('groupId').equals(m.id).modify({ groupId: null });
        await db.groups.delete(m.id);
      });
      return { ok: true };
    case 'registry:export':
      return JSON.stringify({ version: 1, accounts: await db.accounts.toArray(), groups: await db.groups.toArray() });
    case 'registry:import': {
      const imp = parseRegistry(m.json);
      return db.transaction('rw', db.accounts, db.groups, async () => {
        const merged = mergeRegistry(await db.accounts.toArray(), await db.groups.toArray(), imp);
        await db.groups.bulkPut(merged.groups);
        await db.accounts.bulkPut(merged.accounts);
        return { accounts: merged.accounts.length, groups: merged.groups.length };
      });
    }
    case 'session:list': return m.accountId ? db.sessions.where('accountId').equals(m.accountId).toArray() : db.sessions.toArray();
    case 'session:delete':
      await db.transaction('rw', db.sessions, db.sessionBlobs, async () => {
        await db.sessions.delete(m.id);
        await db.sessionBlobs.delete(m.id);
        await db.sessionBlobs.where('id').startsWith(`${m.id}#`).delete();
      });
      return { ok: true };
    default: return NOT_HANDLED;
  }
}
