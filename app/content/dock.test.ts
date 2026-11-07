// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./switcher', () => ({ openSwitcher: vi.fn(), currentSlot: vi.fn(async () => ({ id: 's1', label: 'Toko', color: '#123456' })), switchTo: vi.fn() }));
vi.mock('./autoreply', () => ({ getAutoReplyState: () => ({ enabled: false, autoSend: false }), onAutoReplyState: () => () => {} }));
vi.mock('./overlay', () => ({ openOverlay: vi.fn() }));

import { DOCK_DEFS, mountDock, normalizePrefs, parseCounts, registerDockProvider } from './dock';
import { openOverlay } from './overlay';
import { openSwitcher } from './switcher';

const item = (label: string) =>
  `<div><span><div><button aria-label="${label}" data-navbar-item="true"><div><span><svg viewBox="0 0 24 24"><path d="M0 0"/></svg></span></div></button></div></span></div>`;
const NAV = `<div data-testid="navbar-primary-section"><div class="col">${item('Chats')}<hr>${item('Advertise')}</div></div>`;
const raf = () => new Promise((r) => setTimeout(r, 30));

describe('dock logic', () => {
  it('normalizePrefs: default visible, only explicit false hides, toolkit not toggleable', () => {
    const p = normalizePrefs({ crm: false, analytics: 'no', bogus: false });
    expect(p.crm).toBe(false);
    expect(p.analytics).toBe(true);
    expect(p.toolkit).toBeUndefined();
    expect(Object.values(normalizePrefs(null)).every(Boolean)).toBe(true);
  });
  it('parseCounts validates', () => {
    expect(parseCounts({ error: 'x' })).toBeNull();
    expect(parseCounts({ unanswered: 3, urgent: -1, newLeadsToday: 2.7 })).toEqual({ unanswered: 3, urgent: 0, newLeadsToday: 2 });
  });
});

describe('mountDock', () => {
  beforeEach(() => {
    document.body.innerHTML = NAV;
    (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: { id: 'x', sendMessage: vi.fn(async () => ({ unanswered: 4, urgent: 1, newLeadsToday: 0 })) },
      storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) }, onChanged: { addListener: vi.fn() } },
    };
  });

  it('adds all items in order, wires clicks, slot badge, auto-reply dot', async () => {
    const onToolkit = vi.fn();
    const dock = mountDock({ onToolkit });
    const ids = [...document.querySelectorAll('[data-wwt-nav]')].map((n) => n.getAttribute('data-wwt-nav'));
    expect(ids).toEqual(DOCK_DEFS.map((d) => d.id));
    await raf();
    expect(document.querySelector('[data-wwt-nav="account"] [data-wwt-badge]')!.textContent).toBe('TO');
    document.querySelector<HTMLButtonElement>('[data-wwt-nav="unanswered"] button')!.click();
    expect(openOverlay).toHaveBeenCalledWith('analytics', 'unanswered');
    document.querySelector<HTMLButtonElement>('[data-wwt-nav="account"] button')!.click();
    expect(openSwitcher).toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>('[data-wwt-nav="toolkit"] button')!.click();
    expect(onToolkit).toHaveBeenCalled();
    let cb: (s: { enabled: boolean; autoSend: boolean }) => void = () => {};
    registerDockProvider({ autoReply: { get: () => ({ enabled: true, autoSend: true }), on: (f) => { cb = f; return () => {}; } } });
    expect(document.querySelector('[data-wwt-nav="autoreply"] [data-wwt-dot]')).not.toBeNull();
    cb({ enabled: false, autoSend: false });
    expect(document.querySelector('[data-wwt-nav="autoreply"] [data-wwt-dot]')).toBeNull();
    expect(dock.present()).toBe(true);
  });

  it('falls back (present=false, views still available) with no navbar', () => {
    document.body.innerHTML = '';
    const onPresence = vi.fn();
    const dock = mountDock({ onToolkit: () => {}, onPresence });
    expect(dock.present()).toBe(false);
    expect(onPresence).toHaveBeenLastCalledWith(false);
    expect(dock.views().map((v) => v.id)).toEqual(DOCK_DEFS.map((d) => d.id));
  });
});
