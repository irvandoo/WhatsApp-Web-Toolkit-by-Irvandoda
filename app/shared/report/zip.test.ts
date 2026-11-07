import { describe, expect, it } from 'vitest';
import { crc32, zipStored } from './zip';

const b = (s: string) => new TextEncoder().encode(s);

/** Tiny ZIP reader used by tests: validates CRCs while reading the central directory. */
export function readZip(buf: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let e = buf.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('no EOCD');
  const n = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('bad central');
    const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nl));
    if (dv.getUint32(off, true) !== 0x04034b50) throw new Error('bad local');
    const lnl = dv.getUint16(off + 26, true), lxl = dv.getUint16(off + 28, true);
    const data = buf.subarray(off + 30 + lnl + lxl, off + 30 + lnl + lxl + size);
    if (crc32(data) !== crc) throw new Error('crc mismatch ' + name);
    out.set(name, data);
    p += 46 + nl + xl + cl;
  }
  return out;
}

describe('crc32', () => {
  it('known vectors', () => {
    expect(crc32(b(''))).toBe(0);
    expect(crc32(b('123456789'))).toBe(0xcbf43926);
    expect(crc32(b('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
  it('incremental', () => {
    expect(crc32(b('6789'), crc32(b('12345')))).toBe(0xcbf43926);
  });
});

describe('zipStored', () => {
  it('round trips entries incl. utf8 names', () => {
    const z = zipStored([{ name: 'a.txt', data: b('halo') }, { name: 'dir/é.bin', data: new Uint8Array([0, 1, 2, 255]) }]);
    const m = readZip(z);
    expect([...m.keys()]).toEqual(['a.txt', 'dir/é.bin']);
    expect(new TextDecoder().decode(m.get('a.txt')!)).toBe('halo');
    expect([...m.get('dir/é.bin')!]).toEqual([0, 1, 2, 255]);
  });
  it('rejects duplicate names', () => {
    expect(() => zipStored([{ name: 'a', data: b('') }, { name: 'a', data: b('') }])).toThrow();
  });
  it('handles empty archive', () => {
    expect(zipStored([]).length).toBe(22);
  });
});
