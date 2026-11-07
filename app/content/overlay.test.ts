// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeOverlay, getOverlayGeometry, openOverlay, setOverlayGeometry } from './overlay';

let root: ShadowRoot;
const ptr = (el: Element, type: string, x: number, y: number) =>
  el.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0 }));
const stored = () => JSON.parse(localStorage.getItem('wwt-ov-geo') || '{}') as Record<string, { x: number; y: number; w: number; h: number }>;

beforeEach(() => {
  localStorage.clear();
  Object.assign(window, { innerWidth: 1600, innerHeight: 900 });
  (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { id: 'x', getURL: (p: string) => `chrome-extension://x/${p}`, sendMessage: vi.fn() } };
  const orig = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
    root = orig.call(this, { ...init, mode: 'open' });
    return root;
  });
});
afterEach(() => { closeOverlay(); vi.restoreAllMocks(); });

describe('overlay window', () => {
  it('opens with the per-page default size, centered', () => {
    openOverlay('crm');
    expect(getOverlayGeometry()).toEqual({ w: 1100, h: 700, x: 250, y: 100 });
    const win = root.querySelector('.card') as HTMLElement;
    expect(win.style.width).toBe('1100px');
    expect(win.getAttribute('aria-modal')).toBe('true');
  });

  it('resizes via a handle and persists per page', () => {
    openOverlay('crm');
    const h = root.querySelector('.rz[data-e=se]') as HTMLElement;
    ptr(h, 'pointerdown', 100, 100);
    ptr(h, 'pointermove', 160, 130);
    ptr(h, 'pointerup', 160, 130);
    expect(getOverlayGeometry()).toMatchObject({ w: 1160, h: 730 });
    expect(stored().crm).toMatchObject({ w: 1160, h: 730 });
    expect(stored().analytics).toBeUndefined();
  });

  it('does not close on scrim click while dragging, but does when idle', async () => {
    openOverlay('crm');
    const h = root.querySelector('.rz[data-e=e]') as HTMLElement;
    ptr(h, 'pointerdown', 0, 0);
    ptr(root.querySelector('.bd') as Element, 'mousedown', 0, 0);
    expect(getOverlayGeometry()).not.toBeNull();
    ptr(h, 'pointerup', 0, 0);
    await new Promise((r) => setTimeout(r, 5));
    ptr(root.querySelector('.bd') as Element, 'mousedown', 0, 0);
    expect(getOverlayGeometry()).toBeNull();
  });

  it('moves by header drag, clamped', () => {
    openOverlay('templates');
    const head = root.querySelector('header') as HTMLElement;
    ptr(head, 'pointerdown', 500, 50);
    ptr(head, 'pointermove', 99999, 99999);
    ptr(head, 'pointerup', 99999, 99999);
    expect(getOverlayGeometry()).toMatchObject({ x: 1520, y: 860 });
  });

  it('keyboard resize and move, maximize toggle, reset', () => {
    openOverlay('pos');
    const win = root.querySelector('.card') as HTMLElement;
    const before = getOverlayGeometry()!;
    win.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }));
    expect(getOverlayGeometry()!.w).toBe(before.w + 40);
    win.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, shiftKey: true, bubbles: true }));
    expect(getOverlayGeometry()!.x).toBe(before.x - 40);
    const head = root.querySelector('header') as HTMLElement;
    head.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(getOverlayGeometry()).toEqual({ x: 0, y: 0, w: 1600, h: 900 });
    head.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(getOverlayGeometry()!.w).toBe(before.w + 40);
    (root.querySelector('[data-p=reset]') as HTMLElement).click();
    expect(getOverlayGeometry()).toEqual(before);
    expect(stored().pos).toBeUndefined();
  });

  it('presets, restore from storage and re-clamp on window resize', () => {
    openOverlay('groups');
    (root.querySelector('[data-p=compact]') as HTMLElement).click();
    expect(getOverlayGeometry()).toMatchObject({ w: 700, h: 476 });
    closeOverlay();
    openOverlay('groups');
    expect(getOverlayGeometry()).toMatchObject({ w: 700, h: 476 });
    setOverlayGeometry({ x: 800, y: 400, w: 700, h: 476 });
    Object.assign(window, { innerWidth: 900, innerHeight: 600 });
    window.dispatchEvent(new Event('resize'));
    const g = getOverlayGeometry()!;
    expect(g.x + g.w).toBeLessThanOrEqual(900);
    expect(g.y + g.h).toBeLessThanOrEqual(600);
    expect((root.querySelector('.card') as HTMLElement).classList.contains('nar')).toBe(true);
  });

  it('ignores corrupt storage', () => {
    localStorage.setItem('wwt-ov-geo', '{bad');
    openOverlay('analytics');
    expect(getOverlayGeometry()).toMatchObject({ w: 1120, h: 720 });
  });

  it('layar penuh tetap saat pindah menu dan diingat sampai dimatikan', () => {
    openOverlay('crm');
    const head = root.querySelector('header') as HTMLElement;
    head.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(getOverlayGeometry()).toEqual({ x: 0, y: 0, w: 1600, h: 900 });
    // pindah menu lewat rail: tetap layar penuh
    (root.querySelector('.rail button[data-page=pos]') as HTMLElement).click();
    expect(getOverlayGeometry()).toEqual({ x: 0, y: 0, w: 1600, h: 900 });
    openOverlay('analytics');
    expect(getOverlayGeometry()).toEqual({ x: 0, y: 0, w: 1600, h: 900 });
    expect(localStorage.getItem('wwt-ov-max')).toBe('1');
    // ditutup lalu dibuka lagi: masih layar penuh
    closeOverlay();
    openOverlay('groups');
    expect(getOverlayGeometry()).toEqual({ x: 0, y: 0, w: 1600, h: 900 });
    // dimatikan: kembali ke ukuran biasa halaman itu dan tidak diingat lagi
    (root.querySelector('header') as HTMLElement).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(getOverlayGeometry()!.w).toBeLessThan(1600);
    expect(localStorage.getItem('wwt-ov-max')).toBeNull();
    (root.querySelector('.rail button[data-page=crm]') as HTMLElement).click();
    expect(getOverlayGeometry()!.w).toBeLessThan(1600);
  });

  it('memilih ukuran (Kompak/Sedang/Lebar) mematikan layar penuh', () => {
    openOverlay('crm');
    (root.querySelector('header') as HTMLElement).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(localStorage.getItem('wwt-ov-max')).toBe('1');
    (root.querySelector('[data-p=reset]') as HTMLElement).click();
    expect(localStorage.getItem('wwt-ov-max')).toBeNull();
    expect(getOverlayGeometry()!.w).toBeLessThan(1600);
  });
});
