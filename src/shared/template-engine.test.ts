import { describe, expect, it } from 'vitest';
import { expandSpintax, extractVars, render, validateShortcut } from './template-engine';

describe('template-engine', () => {
  it('replaces vars, keeps unknown', () => {
    expect(render('Halo {nama}, {x} {telepon}', { nama: 'Budi', telepon: '62' })).toBe('Halo Budi, {x} 62');
  });
  it('does not treat {nama} as spintax', () => {
    expect(render('{nama}', {}, () => 0)).toBe('{nama}');
  });
  it('spintax deterministic', () => {
    expect(expandSpintax('{a|b|c}', () => 0)).toBe('a');
    expect(expandSpintax('{a|b|c}', () => 0.99)).toBe('c');
    expect(expandSpintax('{a|b|c}', () => 0.5)).toBe('b');
  });
  it('nested spintax and var inside', () => {
    expect(expandSpintax('{Hai {kak|bro}|Halo}', () => 0)).toBe('Hai kak');
    expect(render('{Hai {nama}|Halo}', { nama: 'Ani' }, () => 0)).toBe('Hai Ani');
  });
  it('sanitizes var values', () => {
    expect(render('{nama}', { nama: '{a|b}' }, () => 0)).toBe('ab');
  });
  it('validateShortcut', () => {
    expect(validateShortcut('hi_1-a')).toBe(true);
    expect(validateShortcut('')).toBe(false);
    expect(validateShortcut('Hi')).toBe(false);
    expect(validateShortcut('a'.repeat(25))).toBe(false);
  });
  it('extractVars', () => {
    expect(extractVars('{nama} {Nama} {a|b} {tahap}')).toEqual(['nama', 'tahap']);
  });
});
