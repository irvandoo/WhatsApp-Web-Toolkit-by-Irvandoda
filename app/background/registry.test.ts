import { describe, expect, it } from 'vitest';
import type { Account } from '../shared/messages';
import { mergeRegistry, parseRegistry } from './registry';

const acc = (o: Partial<Account> = {}): Account => ({ id: 'a', name: 'A', color: '#fff', groupId: null, profileLabel: '', note: '', online: true, unread: 5, chatCount: 9, lastSeen: 1, ...o });
const reg = (o: unknown) => JSON.stringify(o);

describe('parseRegistry', () => {
  it('accepts valid export and drops extras', () => {
    const r = parseRegistry(reg({ version: 1, groups: [{ id: 'g', name: 'G', color: '#000', x: 1 }], accounts: [{ ...acc({ groupId: 'g' }), evil: 1 }] }));
    expect(r.groups).toEqual([{ id: 'g', name: 'G', color: '#000' }]);
    expect(r.accounts[0]).not.toHaveProperty('evil');
  });
  it.each([
    ['bad json', '{'],
    ['wrong version', reg({ version: 2, accounts: [], groups: [] })],
    ['accounts not array', reg({ version: 1, accounts: {}, groups: [] })],
    ['account missing id', reg({ version: 1, groups: [], accounts: [{ ...acc(), id: '' }] })],
    ['groupId number', reg({ version: 1, groups: [], accounts: [{ ...acc(), groupId: 3 }] })],
    ['group bad', reg({ version: 1, groups: [{ id: 'g' }], accounts: [] })],
    ['null', 'null'],
  ])('rejects %s', (_n, j) => expect(() => parseRegistry(j)).toThrow());
});

describe('mergeRegistry', () => {
  it('keeps live fields of existing, nulls unknown group, defaults new', () => {
    const imp = parseRegistry(reg({ version: 1, groups: [], accounts: [acc({ name: 'New', online: false, unread: 0, groupId: 'nope' }), acc({ id: 'b' })] }));
    const m = mergeRegistry([acc()], [], imp);
    expect(m.accounts[0]).toMatchObject({ name: 'New', online: true, unread: 5, chatCount: 9, groupId: null });
    expect(m.accounts[1]).toMatchObject({ id: 'b', online: false, unread: 0, chatCount: 0 });
  });
});
