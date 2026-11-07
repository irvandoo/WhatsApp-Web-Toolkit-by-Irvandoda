// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountNavItems } from './nav-button';

const item = (label: string) =>
  `<div><span class="s"><div class="c"><button aria-label="${label}" aria-pressed="false" data-navbar-item="true" data-navbar-item-selected="false">` +
  `<div><span aria-hidden="true"><svg viewBox="0 0 24 24"><title>ic</title><path d="M0 0"/></svg></span></div></button>` +
  `<div class="badge"><span role="status">3</span></div></div></span></div>`;
const NAV = `<div data-testid="navbar-primary-section"><div class="col">${item('Chats')}${item('Status')}<hr>${item('Tools')}${item('Advertise')}</div></div>`;
const raf = () => new Promise((r) => setTimeout(r, 30));

const specs = (fn = () => {}) => ['a', 'b', 'c'].map((id) => ({ id, label: id.toUpperCase(), iconPath: 'M0 0h1v1z', stroke: true, onClick: fn }));
const order = () => [...document.querySelector('[data-testid="navbar-primary-section"] > .col')!.children]
  .map((n) => n.getAttribute('data-wwt-nav') ?? n.querySelector('button')?.getAttribute('aria-label') ?? n.tagName);

describe('mountNavItems', () => {
  beforeEach(() => {
    document.body.innerHTML = NAV;
    (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
  });

  it('inserts all items in order after Advertise', () => {
    mountNavItems(specs());
    expect(order()).toEqual(['Chats', 'Status', 'HR', 'Tools', 'Advertise', 'a', 'b', 'c']);
  });

  it('restores items and order after React removes them or reorders', async () => {
    const nav = mountNavItems(specs());
    document.querySelector('[data-wwt-nav="b"]')!.remove();
    await raf();
    expect(order().slice(-3)).toEqual(['a', 'b', 'c']);
    const a = document.querySelector('[data-wwt-nav="a"]')!;
    a.parentElement!.append(a);
    await raf();
    expect(order().slice(-3)).toEqual(['a', 'b', 'c']);
    expect(nav.present()).toBe(true);
  });

  it('badges: numbers, caps, strings, hide, survive rebuild; dot and hidden work', async () => {
    const nav = mountNavItems(specs());
    const h = nav.handles;
    const badge = (id: string) => document.querySelector(`[data-wwt-nav="${id}"] [data-wwt-badge]`);
    h.a.setBadge(5);
    expect(badge('a')!.textContent).toBe('5');
    expect(document.querySelector('[data-wwt-nav="a"] button')!.getAttribute('aria-label')).toBe('A (5)');
    h.a.setBadge(150);
    expect(badge('a')!.textContent).toBe('99+');
    h.b.setBadge('AB', '#123456');
    expect(badge('b')!.textContent).toBe('AB');
    h.a.setBadge(0);
    expect(badge('a')).toBeNull();
    h.c.setBadge(7);
    h.c.setActive(true, '#0f0');
    document.querySelector('[data-wwt-nav="c"]')!.remove();
    await raf();
    expect(badge('c')!.textContent).toBe('7');
    expect(document.querySelector('[data-wwt-nav="c"] [data-wwt-dot]')).not.toBeNull();
    h.c.setActive(false);
    expect(document.querySelector('[data-wwt-nav="c"] [data-wwt-dot]')).toBeNull();
    h.b.setHidden(true);
    expect(order().slice(-2)).toEqual(['a', 'c']);
    h.b.setHidden(false);
    expect(order().slice(-3)).toEqual(['a', 'b', 'c']);
  });

  it('reports absence and inserts nothing when there is no navbar', () => {
    document.body.innerHTML = '<div></div>';
    const onPresence = vi.fn();
    const nav = mountNavItems(specs(), onPresence);
    expect(nav.present()).toBe(false);
    expect(onPresence).toHaveBeenLastCalledWith(false);
    expect(document.querySelectorAll('[data-wwt-nav]').length).toBe(0);
  });
});
