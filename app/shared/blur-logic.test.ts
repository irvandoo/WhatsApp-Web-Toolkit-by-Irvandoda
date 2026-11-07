import { describe, expect, it } from 'vitest';
import { BLUR_MAX, BLUR_MIN, DEFAULT_BLUR, buildBlurCss, isBlurActive, mergeBlur, normalizeBlur } from './blur-logic';

describe('normalizeBlur', () => {
  it('defaults on junk', () => {
    expect(normalizeBlur(null)).toEqual(DEFAULT_BLUR);
    expect(normalizeBlur('x')).toEqual(DEFAULT_BLUR);
  });
  it('clamps intensity and minutes, keeps valid booleans', () => {
    expect(normalizeBlur({ intensity: 1 }).intensity).toBe(BLUR_MIN);
    expect(normalizeBlur({ intensity: 99 }).intensity).toBe(BLUR_MAX);
    expect(normalizeBlur({ intensity: 'a' }).intensity).toBe(DEFAULT_BLUR.intensity);
    expect(normalizeBlur({ autoOnIdle: { enabled: true, minutes: 0 } }).autoOnIdle).toEqual({ enabled: true, minutes: 1 });
    const o = normalizeBlur({ enabled: true, targets: { names: false, chatList: 'yes' }, revealOnHover: false });
    expect(o.enabled).toBe(true);
    expect(o.targets.names).toBe(false);
    expect(o.targets.chatList).toBe(true);
    expect(o.revealOnHover).toBe(false);
  });
  it('mergeBlur merges nested', () => {
    const m = mergeBlur(DEFAULT_BLUR, { targets: { composer: true }, autoOnIdle: { enabled: true } });
    expect(m.targets.composer).toBe(true);
    expect(m.targets.messages).toBe(true);
    expect(m.autoOnIdle).toEqual({ enabled: true, minutes: 2 });
  });
});

describe('isBlurActive', () => {
  const act = { windowActive: true, idleMs: 0 };
  it('manual', () => {
    expect(isBlurActive(DEFAULT_BLUR, act)).toBe(false);
    expect(isBlurActive({ ...DEFAULT_BLUR, enabled: true }, act)).toBe(true);
  });
  it('inactive window only when option set', () => {
    expect(isBlurActive(DEFAULT_BLUR, { windowActive: false, idleMs: 0 })).toBe(false);
    expect(isBlurActive({ ...DEFAULT_BLUR, onInactive: true }, { windowActive: false, idleMs: 0 })).toBe(true);
  });
  it('idle threshold', () => {
    const o = { ...DEFAULT_BLUR, autoOnIdle: { enabled: true, minutes: 2 } };
    expect(isBlurActive(o, { windowActive: true, idleMs: 119_000 })).toBe(false);
    expect(isBlurActive(o, { windowActive: true, idleMs: 120_000 })).toBe(true);
  });
});

describe('buildBlurCss', () => {
  it('empty when no targets', () => {
    expect(buildBlurCss({ ...DEFAULT_BLUR, targets: { chatList: false, messages: false, names: false, avatars: false, composer: false } })).toBe('');
  });
  it('uses stable attributes, intensity, hover reveal', () => {
    const css = buildBlurCss({ ...DEFAULT_BLUR, intensity: 12 });
    expect(css).toContain('blur(12px)');
    expect(css).toContain('#pane-side');
    expect(css).toContain(':hover');
    expect(css).not.toMatch(/\._[a-z0-9]{4,}/i);
  });
  it('no hover rules when revealOnHover off; no compounding names inside blurred chat list', () => {
    const css = buildBlurCss({ ...DEFAULT_BLUR, revealOnHover: false });
    expect(css).not.toContain(':hover');
    expect(css).not.toContain('#pane-side span[title]');
    expect(buildBlurCss({ ...DEFAULT_BLUR, targets: { ...DEFAULT_BLUR.targets, chatList: false } })).toContain('#pane-side span[title]');
  });
  it('pointer-events untouched', () => {
    expect(buildBlurCss(DEFAULT_BLUR)).not.toContain('pointer-events');
  });
});
