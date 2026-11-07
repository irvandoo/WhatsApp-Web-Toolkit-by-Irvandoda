// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, unknown> = {};
beforeEach(() => {
  vi.resetModules();
  for (const k of Object.keys(store)) delete store[k];
  document.head.innerHTML = '';
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: { id: 'x' },
    storage: {
      local: { get: vi.fn(async (k: string) => ({ [k]: store[k] })), set: vi.fn(async (o: Record<string, unknown>) => { Object.assign(store, o); }) },
      onChanged: { addListener: vi.fn() },
    },
  };
});

describe('privacy-blur runtime', () => {
  it('setBlur persists, injects/removes a single style, notifies', async () => {
    const m = await import('./privacy-blur');
    const seen: boolean[] = [];
    m.onBlurState((s) => seen.push(s.active));
    m.mountPrivacyBlur();
    await new Promise((r) => setTimeout(r, 5));
    expect(document.getElementById('wwt-blur-style')).toBeNull();
    m.setBlur(true);
    expect(document.querySelectorAll('#wwt-blur-style').length).toBe(1);
    expect((store['wwt-blur'] as { enabled: boolean }).enabled).toBe(true);
    m.setBlur(12);
    expect(document.getElementById('wwt-blur-style')!.textContent).toContain('blur(12px)');
    m.setBlur(false);
    expect(document.getElementById('wwt-blur-style')).toBeNull();
    expect(seen).toContain(true);
    expect(m.getBlurState().active).toBe(false);
  });
  it('loads persisted options and Ctrl+Shift+B toggles; Esc does not', async () => {
    store['wwt-blur'] = { enabled: true, intensity: 10 };
    const m = await import('./privacy-blur');
    m.mountPrivacyBlur();
    await new Promise((r) => setTimeout(r, 5));
    expect(m.getBlurState().opts.intensity).toBe(10);
    expect(m.getBlurState().active).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(m.getBlurState().active).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'B', ctrlKey: true, shiftKey: true, bubbles: true }));
    expect(m.getBlurState().active).toBe(false);
  });
});
