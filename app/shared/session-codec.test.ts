import { describe, expect, it } from 'vitest';
import { decode, encode, splitChunks } from './session-codec';

const rt = async (v: unknown) => { const bad: string[] = []; const e = JSON.parse(JSON.stringify(await encode(v, 'p', bad))); return { out: decode(e), bad }; };

describe('session-codec', () => {
  it('round-trips rich values', async () => {
    const v = {
      s: 'x', n: 1, nan: NaN, inf: -Infinity, u: undefined, nul: null, big: 10n, d: new Date(12345),
      ab: new Uint8Array([1, 2, 3]).buffer, ta: new Float32Array([1.5, 2]), u8: new Uint8Array([9, 8]),
      m: new Map<unknown, unknown>([['k', new Set([1, 2])]]), nested: [{ a: [1] }], clash: { $t: 'date', v: 1 },
    };
    const { out, bad } = await rt(v);
    expect(bad).toEqual([]);
    expect(out).toEqual(v);
    const o = out as typeof v;
    expect(o.ab).toBeInstanceOf(ArrayBuffer);
    expect(o.ta).toBeInstanceOf(Float32Array);
    expect(Number.isNaN(o.nan)).toBe(true);
  });
  it('round-trips Blob', async () => {
    const { out } = await rt(new Blob(['hello'], { type: 'text/plain' }));
    expect(out).toBeInstanceOf(Blob);
    expect(await (out as Blob).text()).toBe('hello');
  });
  it('reports CryptoKey, functions and cycles instead of dropping', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, false, ['encrypt']);
    const cyc: Record<string, unknown> = {}; cyc.self = cyc;
    const bad: string[] = [];
    await encode({ k: key, f: () => 1, cyc }, 'db/store/1', bad);
    expect(bad.length).toBe(3);
    expect(bad[0]).toContain('db/store/1.k');
    expect(bad[0]).toContain('CryptoKey');
  });
  it('splits chunks', () => {
    expect(splitChunks('abcde', 2)).toEqual(['ab', 'cd', 'e']);
    expect(splitChunks('', 2)).toEqual(['']);
  });
});
