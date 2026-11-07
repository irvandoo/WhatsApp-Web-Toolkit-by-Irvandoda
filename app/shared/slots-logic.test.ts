import { describe, expect, it } from 'vitest';
import { defaultSlot, type Slot } from './slots';
import {
  drainPurge, effectiveView, enqueuePurge, mapReportedState, mergeSlotImport, parseBulkLabels, parseSlotRegistry,
  serializeSlots, sortSlots, waPhoneFromId,
} from './slots-logic';

const mk = (o: Partial<Slot>): Slot => ({ ...defaultSlot(1000), id: 'abc123', label: 'A', ...o });

describe('status staleness', () => {
  it('fresh status shown, stale/never => inactive', () => {
    expect(effectiveView({ status: 'online', statusTs: 100_000 }, 120_000)).toBe('online');
    expect(effectiveView({ status: 'online', statusTs: 100_000 }, 146_000)).toBe('inactive');
    expect(effectiveView({}, 1)).toBe('inactive');
    expect(effectiveView({ status: 'qr', statusTs: 900_000 }, 100_000)).toBe('inactive');
  });
  it('qr on a bound slot means logged-out', () => {
    expect(mapReportedState('qr', 'x@c.us')).toBe('logged-out');
    expect(mapReportedState('qr', null)).toBe('qr');
    expect(mapReportedState('online', 'x@c.us')).toBe('online');
  });
  it('phone from wa id', () => {
    expect(waPhoneFromId('628123456789:12@c.us')).toBe('628123456789');
    expect(waPhoneFromId('abc')).toBe('');
  });
});

describe('bulk add parsing', () => {
  it('trims, strips bullets, dedupes, skips blanks', () => {
    const r = parseBulkLabels('Toko A\n  - Toko B \n\n1. Toko A\r\ntoko b\nCS', ['cs']);
    expect(r.labels).toEqual(['Toko A', 'Toko B']);
    expect(r.skipped).toBe(3);
  });
  it('caps at 50', () => {
    const r = parseBulkLabels(Array.from({ length: 60 }, (_, i) => `n${i}`).join('\n'));
    expect(r.labels).toHaveLength(50);
    expect(r.truncated).toBe(true);
  });
});

describe('purge queue', () => {
  it('enqueues valid unique ids only', () => {
    expect(enqueuePurge(['abc123'], 'abc123')).toEqual(['abc123']);
    expect(enqueuePurge(undefined, 'default')).toEqual([]);
    expect(enqueuePurge('junk', 'A:b')).toEqual([]);
    expect(enqueuePurge(['abc123'], 'xyz789')).toEqual(['abc123', 'xyz789']);
  });
  it('never purges the tab own slot; keeps it queued', () => {
    expect(drainPurge(['abc123', 'xyz789', 5, 'default'], 'abc123')).toEqual({ run: ['xyz789'], keep: ['abc123'] });
  });
});

describe('registry import/export', () => {
  const slots = [mk({ id: 'abc123', label: 'Toko', accountId: 'secret@c.us', note: 'n', pinned: true })];
  const json = serializeSlots(slots, [{ id: 'g1', name: 'G', color: '#112233' }]);
  it('export has no session/account data', () => {
    expect(json).not.toContain('secret');
    expect(json).not.toContain('accountId');
  });
  it('round-trips', () => {
    const r = parseSlotRegistry(json);
    expect(r.slots[0]).toMatchObject({ id: 'abc123', label: 'Toko', pinned: true });
    expect(r.groups[0].name).toBe('G');
  });
  it('rejects bad input strictly', () => {
    expect(() => parseSlotRegistry('nope')).toThrow();
    expect(() => parseSlotRegistry('{"version":2}')).toThrow();
    const base = { version: 1, kind: 'wwt-slots', groups: [] };
    const bad = (slots: unknown[]) => () => parseSlotRegistry(JSON.stringify({ ...base, slots }));
    expect(bad([{ id: 'default', label: 'x' }])).toThrow();
    expect(bad([{ id: 'A!', label: 'x' }])).toThrow();
    expect(bad([{ id: 'abc123', label: ' ' }])).toThrow();
    expect(bad([{ id: 'abc123', label: 'a' }, { id: 'abc123', label: 'b' }])).toThrow();
    expect(bad([{ id: 'abc123', label: 'a', groupId: 5 }])).toThrow();
  });
  it('drops unknown fields and merge keeps live fields', () => {
    const imp = parseSlotRegistry(JSON.stringify({ version: 1, kind: 'wwt-slots', groups: [], slots: [{ id: 'abc123', label: 'New', groupId: 'zzz', accountId: 'evil@c.us', session: 'x' }] }));
    expect(imp.slots[0]).not.toHaveProperty('accountId');
    const m = mergeSlotImport([mk({ accountId: 'real@c.us' })], [], imp);
    expect(m.slots[0]).toMatchObject({ label: 'New', accountId: 'real@c.us', groupId: null });
    expect(m.updated).toBe(1);
  });
});

describe('sorting', () => {
  it('pinned first then key', () => {
    const l = [mk({ id: 'aaa', label: 'B' }), mk({ id: 'bbb', label: 'A' }), mk({ id: 'ccc', label: 'Z', pinned: true })];
    expect(sortSlots(l, 'name').map((s) => s.id)).toEqual(['ccc', 'bbb', 'aaa']);
  });
});

import { extractOrphanSids as _eo, parseMirror as _pm } from './slots-logic';
describe('pemulihan akun yatim', () => {
  it('menemukan slot yang datanya ada tapi tidak terdaftar', () => {
    const names = ['wwt:abc123:model-storage', 'wwt:abc123:wawc', 'wwt:zzz999:wawc', 'model-storage', 'wwt:default:x', 'wwt:BAD!:x', 'wwt:known1:wawc'];
    expect(_eo(names, ['default', 'known1'])).toEqual(['abc123', 'zzz999']);
  });
  it('tidak menghasilkan duplikat dan mengabaikan masukan aneh', () => {
    expect(_eo(['wwt:abc123:a', 'wwt:abc123:b', 'wwt::x', 'wwt:ab:x', 'wwt:abcdefghijklmnopq:x'], [])).toEqual(['abc123']);
    expect(_eo([], [])).toEqual([]);
  });
  it('membaca cermin dengan aman', () => {
    expect(_pm('{"abc123":{"label":" Toko A ","color":"#128c7e"},"default":{"label":"x"},"bad!":{"label":"y"},"zzz999":{"label":""}}'))
      .toEqual({ abc123: { label: 'Toko A', color: '#128c7e' } });
    expect(_pm('bukan json')).toEqual({});
    expect(_pm(null)).toEqual({});
  });
});
