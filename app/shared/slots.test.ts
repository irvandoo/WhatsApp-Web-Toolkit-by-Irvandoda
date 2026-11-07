import { describe, expect, it } from 'vitest';
import { DEFAULT_SID, isValidSid, newSid, normalizeColor, prefixName, stripPrefix, validateLabel } from './slots';

describe('slots helpers', () => {
  it('prefixes and strips', () => {
    expect(prefixName('abc123', 'model-storage')).toBe('wwt:abc123:model-storage');
    expect(stripPrefix('abc123', 'wwt:abc123:x')).toBe('x');
    expect(stripPrefix('abc123', 'wwt:other:x')).toBeNull();
    expect(stripPrefix('abc123', 'plain')).toBeNull();
  });
  it('default is untouched', () => {
    expect(prefixName(DEFAULT_SID, 'a')).toBe('a');
    expect(stripPrefix(DEFAULT_SID, 'a')).toBe('a');
  });
  it('validates ids, labels, colors', () => {
    expect(isValidSid('abc123')).toBe(true);
    expect(isValidSid('AB')).toBe(false);
    expect(isValidSid('a:b')).toBe(false);
    expect(isValidSid(newSid())).toBe(true);
    expect(newSid(() => 0)).toBe('00000000');
    expect(validateLabel('  Toko A ')).toBe('Toko A');
    expect(() => validateLabel('  ')).toThrow();
    expect(normalizeColor('#ABCDEF')).toBe('#abcdef');
    expect(normalizeColor('red', '#111111')).toBe('#111111');
  });
});
