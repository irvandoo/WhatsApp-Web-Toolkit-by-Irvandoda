// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { UI_PREFIX, clearPersisted, readPersisted, sameShape, writePersisted } from './persist';

beforeEach(() => { localStorage.clear(); });

describe('pengaturan UI tersimpan', () => {
  it('sameShape menolak tipe yang berbeda', () => {
    expect(sameShape('a', 'b')).toBe(true);
    expect(sameShape(5, 'b')).toBe(false);
    expect(sameShape(null, 'b')).toBe(false);
    expect(sameShape([1], [])).toBe(true);
    expect(sameShape({}, [])).toBe(false);
    expect(sameShape({ a: 1 }, { b: 2 })).toBe(true);
    expect(sameShape([], {})).toBe(false);
  });

  it('tulis lalu baca kembali (setelah "refresh")', async () => {
    await writePersisted('analytics.range', 'month');
    expect(await readPersisted('analytics.range', 'today')).toBe('month');
    await writePersisted('crm.filters', { stage: 'Deal', tags: ['a', 'b'] });
    expect(await readPersisted('crm.filters', { stage: '', tags: [] as string[] })).toEqual({ stage: 'Deal', tags: ['a', 'b'] });
  });

  it('nilai tersimpan yang rusak/berbeda tipe jatuh ke bawaan', async () => {
    localStorage.setItem(`${UI_PREFIX}x`, JSON.stringify(42));
    expect(await readPersisted('x', 'bawaan')).toBe('bawaan');
    localStorage.setItem(`${UI_PREFIX}y`, '{rusak');
    expect(await readPersisted('y', 'bawaan')).toBe('bawaan');
    expect(await readPersisted('belum-ada', 7)).toBe(7);
  });

  it('validator khusus dipakai', async () => {
    await writePersisted('tab', 'aneh');
    const isTab = (v: unknown): v is 'a' | 'b' => v === 'a' || v === 'b';
    expect(await readPersisted<'a' | 'b'>('tab', 'a', isTab)).toBe('a');
    await writePersisted('tab', 'b');
    expect(await readPersisted<'a' | 'b'>('tab', 'a', isTab)).toBe('b');
  });

  it('clearPersisted menghapus semua atau hanya awalan tertentu', async () => {
    await writePersisted('crm.a', 1); await writePersisted('crm.b', 2); await writePersisted('pos.a', 3);
    localStorage.setItem('lain', '1');
    expect(await clearPersisted('crm.')).toBe(2);
    expect(await readPersisted('pos.a', 0)).toBe(3);
    expect(await clearPersisted()).toBe(1);
    expect(localStorage.getItem('lain')).toBe('1');
  });
});
