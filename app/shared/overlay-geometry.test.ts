import { describe, expect, it } from 'vitest';
import { clampSize, defaultGeo, keyAdjust, clampMove, parseStore, presetGeo, resizeEdge } from './overlay-geometry';

describe('overlay-geometry', () => {
  it('defaults are per page, centered and capped at 92vw x 90vh', () => {
    expect(defaultGeo('analytics', 1920, 1080)).toEqual({ w: 1120, h: 720, x: 400, y: 180 });
    const g = defaultGeo('analytics', 1000, 600);
    expect(g.w).toBe(920);
    expect(g.h).toBe(540);
  });
  it('never below min', () => {
    expect(clampSize(10, 10, 1920, 1080)).toEqual({ w: 560, h: 380 });
    expect(clampSize(10, 10, 400, 300)).toEqual({ w: 400, h: 300 });
  });
  it('presets', () => {
    const d = presetGeo('medium', 'crm', 1920, 1080);
    expect([d.w, d.h]).toEqual([1100, 700]);
    const c = presetGeo('compact', 'crm', 1920, 1080);
    expect([c.w, c.h]).toEqual([770, 490]);
    const w = presetGeo('wide', 'crm', 1920, 1080);
    expect([w.w, w.h]).toEqual([1400, 900]);
    const w2 = presetGeo('wide', 'crm', 1000, 700);
    expect([w2.w, w2.h]).toEqual([960, 644]);
  });
  it('compact respects the minimum', () => {
    const c = presetGeo('compact', 'templates', 1920, 1080);
    expect(c.w).toBeGreaterThanOrEqual(560);
    expect(c.h).toBeGreaterThanOrEqual(380);
  });
  it('edge resize anchors the opposite edge and clamps', () => {
    const s = { x: 100, y: 100, w: 800, h: 600 };
    expect(resizeEdge(s, 'e', 50, 0, 1920, 1080)).toEqual({ x: 100, y: 100, w: 850, h: 600 });
    expect(resizeEdge(s, 'w', -50, 0, 1920, 1080)).toEqual({ x: 50, y: 100, w: 850, h: 600 });
    expect(resizeEdge(s, 'w', 900, 0, 1920, 1080)).toEqual({ x: 340, y: 100, w: 560, h: 600 });
    expect(resizeEdge(s, 'nw', -500, -500, 1920, 1080)).toEqual({ x: 0, y: 0, w: 900, h: 700 });
    expect(resizeEdge(s, 'se', 5000, 5000, 1920, 1080)).toEqual({ x: 100, y: 100, w: 1820, h: 980 });
    expect(resizeEdge(s, 's', 0, -900, 1920, 1080).h).toBe(380);
  });
  it('move keeps 80px of header on screen', () => {
    const g = clampMove({ x: 5000, y: 5000, w: 800, h: 600 }, 1920, 1080);
    expect(g.x).toBe(1840);
    expect(g.y).toBe(1040);
    expect(clampMove({ x: -5000, y: -5, w: 800, h: 600 }, 1920, 1080)).toMatchObject({ x: -720, y: 0 });
  });
  it('keyboard adjust', () => {
    const g = { x: 100, y: 100, w: 800, h: 600 };
    expect(keyAdjust(g, 'ArrowRight', false, 1920, 1080)).toEqual({ ...g, w: 840 });
    expect(keyAdjust(g, 'ArrowUp', true, 1920, 1080)).toEqual({ ...g, y: 60 });
    expect(keyAdjust(g, 'a', false, 1920, 1080)).toBeNull();
  });
  it('validates persisted data', () => {
    const raw = JSON.stringify({ crm: { x: -50, y: 0, w: 99999, h: 10 }, bogus: { x: 0, y: 0, w: 800, h: 600 }, pos: { x: 'a' }, blast: null });
    const o = parseStore(raw, 1280, 720);
    expect(Object.keys(o)).toEqual(['crm']);
    expect(o.crm).toEqual({ x: 0, y: 0, w: 1280, h: 380 });
    expect(parseStore('{not json', 1280, 720)).toEqual({});
    expect(parseStore('[1]', 1280, 720)).toEqual({});
    expect(parseStore(null, 1280, 720)).toEqual({});
  });
});
