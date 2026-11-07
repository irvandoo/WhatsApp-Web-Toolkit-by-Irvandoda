import { describe, expect, it } from 'vitest';
import { cleanVariants, emptyRotState, pickVariant, renderWithRotation, sanitizeRotState, validateVariants, type RotState } from './rotation';

const seq = (...n: number[]) => { let i = 0; return () => n[i++ % n.length]; };
const run = (vs: string[], s: 'random' | 'round-robin' | 'shuffle-bag', n: number, rng: () => number = Math.random) => {
  let st: RotState = emptyRotState(); const out: number[] = [];
  for (let i = 0; i < n; i++) { const p = pickVariant(vs, s, st, rng); st = p.state; out.push(p.index); }
  return out;
};

describe('pickVariant', () => {
  it('handles empty and single', () => {
    expect(pickVariant([], 'random', undefined).index).toBe(-1);
    expect(pickVariant(['', '  '], 'random', undefined).index).toBe(-1);
    expect(pickVariant(['a'], 'shuffle-bag', undefined).text).toBe('a');
  });
  it('round-robin cycles and skips blanks', () => {
    expect(run(['a', '', 'c', 'd'], 'round-robin', 7)).toEqual([0, 2, 3, 0, 2, 3, 0]);
  });
  it('random never repeats immediately', () => {
    for (const s of [0, 0.3, 0.99]) {
      const r = run(['a', 'b', 'c'], 'random', 50, seq(s, 0.5, 0.1));
      expect(r.every((v, i) => i === 0 || v !== r[i - 1])).toBe(true);
    }
    const r = run(['a', 'b', 'c'], 'random', 300);
    expect(r.every((v, i) => i === 0 || v !== r[i - 1])).toBe(true);
  });
  it('shuffle-bag uses all before repeating, no boundary repeat', () => {
    const r = run(['a', 'b', 'c', 'd'], 'shuffle-bag', 400);
    for (let k = 0; k < 400; k += 4) expect(new Set(r.slice(k, k + 4)).size).toBe(4);
    expect(r.every((v, i) => i === 0 || v !== r[i - 1])).toBe(true);
  });
  it('is deterministic with a seeded rng and tolerates corrupt state', () => {
    expect(run(['a', 'b', 'c'], 'shuffle-bag', 6, seq(0.1, 0.6, 0.9))).toEqual(run(['a', 'b', 'c'], 'shuffle-bag', 6, seq(0.1, 0.6, 0.9)));
    expect(sanitizeRotState({ last: 'x', bag: [1, -2, 'q'] })).toEqual({ last: -1, bag: [1] });
    expect(pickVariant(['a', 'b'], 'shuffle-bag', { last: 9, bag: [7, 8] }).index).toBeGreaterThanOrEqual(0);
  });
});

describe('renderWithRotation', () => {
  it('no variants = plain render', () => {
    expect(renderWithRotation({ body: 'Hai {nama}' }, { nama: 'Budi' }, undefined).text).toBe('Hai Budi');
  });
  it('picks variant, renders vars, then expands spintax', () => {
    const t = { body: 'A {nama}', variants: ['{Halo|Hai} {nama}'], rotation: 'round-robin' as const };
    const a = renderWithRotation(t, { nama: 'Budi' }, undefined, () => 0);
    expect(a.text).toBe('A Budi');
    const b = renderWithRotation(t, { nama: 'Budi' }, a.state, () => 0);
    expect(b.text).toBe('Halo Budi');
    expect(renderWithRotation(t, { nama: 'Budi' }, b.state, () => 0).text).toBe('A Budi');
  });
  it('variable values cannot inject spintax', () => {
    expect(renderWithRotation({ body: 'x', variants: ['{nama}'] }, { nama: '{a|b}' }, { last: 0, bag: [] }, () => 0).text).toBe('ab');
  });
});

describe('validation', () => {
  it('limits', () => {
    expect(validateVariants(undefined)).toBeNull();
    expect(validateVariants(Array(11).fill('a'))).toMatch(/maksimal 10/);
    expect(validateVariants(['a'.repeat(4001)])).toMatch(/4000/);
    expect(validateVariants(['ok'])).toBeNull();
    expect(cleanVariants(['a', ' ', 3, 'b'])).toEqual(['a', 'b']);
  });
});
