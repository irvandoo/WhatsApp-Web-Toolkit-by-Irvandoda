// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountNavButton } from './nav-button';

// Same shape as WhatsApp's real navbar (section > column > item wrappers > span > div > button).
const item = (label: string, extra = '') =>
  `<div><span class="s"><div class="c"><button aria-label="${label}" aria-pressed="false" tabindex="-1" data-navbar-item="true" data-navbar-item-selected="false" ${extra}>` +
  `<div><span aria-hidden="true"><svg viewBox="0 0 24 24"><title>ic</title><path d="M0 0"/></svg></span></div></button>` +
  `<div class="badge"><span role="status">3</span></div></div></span></div>`;
const NAV = `<div data-testid="navbar-primary-section"><div class="col">${item('Chats', 'data-navbar-item-index="0"')}${item('Status')}<hr>${item('Tools')}${item('Advertise')}</div></div>
<div data-testid="navbar-footer-section"><div class="col">${item('Settings')}<div><span><div><button data-navbar-item="true" aria-label="Profile"><img alt=""></button></div></span></div></div></div>`;

const raf = () => new Promise((r) => setTimeout(r, 30));

describe('mountNavButton', () => {
  beforeEach(() => {
    document.body.innerHTML = NAV;
    (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
  });

  it('inserts a clone right after Advertise, with own label/icon and no copied badge', () => {
    const onPresence = vi.fn();
    const onClick = vi.fn();
    const nb = mountNavButton({ label: 'Toolkit', onClick, onPresence });
    const col = document.querySelector('[data-testid="navbar-primary-section"] > .col')!;
    const kids = [...col.children];
    const mine = col.querySelector('[data-wwt-nav]')!;
    expect(mine).toBeTruthy();
    expect(kids.indexOf(mine)).toBe(kids.length - 1);
    expect(kids[kids.length - 2].querySelector('button')!.getAttribute('aria-label')).toBe('Advertise');
    const btn = mine.querySelector('button')!;
    expect(btn.getAttribute('aria-label')).toBe('Toolkit');
    expect(btn.hasAttribute('data-navbar-item-index')).toBe(false);
    expect(mine.querySelector('[role="status"]')).toBeNull();
    expect(mine.querySelector('svg title')).toBeNull(); // old icon replaced
    expect(onPresence).toHaveBeenLastCalledWith(true);
    btn.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    nb.setPressed(true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelectorAll('[data-wwt-nav]').length).toBe(1);
  });

  it('re-inserts after React removes it, and reports absence when navbar is gone', async () => {
    const onPresence = vi.fn();
    mountNavButton({ label: 'Toolkit', onClick: () => {}, onPresence });
    document.querySelector('[data-wwt-nav]')!.remove();
    await raf();
    expect(document.querySelectorAll('[data-wwt-nav]').length).toBe(1);
    document.body.innerHTML = '<div>no navbar</div>';
    await raf();
    expect(onPresence).toHaveBeenLastCalledWith(false);
  });

  it('does nothing (fallback) when there is no navbar', () => {
    document.body.innerHTML = '<div></div>';
    const onPresence = vi.fn();
    const nb = mountNavButton({ label: 'x', onClick: () => {}, onPresence });
    expect(nb.present()).toBe(false);
    expect(onPresence).toHaveBeenLastCalledWith(false);
  });
});
