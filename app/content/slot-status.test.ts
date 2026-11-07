// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { decideState, detectDom, unreadFromTitle } from './slot-status';

const dom = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return d; };
const ready = { store: true, accountId: '628@c.us' };

describe('detectDom', () => {
  it('finds QR by data-testid, canvas in data-ref, aria-label', () => {
    expect(detectDom(dom('<div data-testid="qrcode"></div>')).qr).toBe(true);
    expect(detectDom(dom('<div data-ref="abc"><canvas></canvas></div>')).qr).toBe(true);
    expect(detectDom(dom('<canvas aria-label="Scan this QR code to link a device!"></canvas>')).qr).toBe(true);
  });
  it('finds QR by text when no chat list', () => {
    expect(detectDom(dom('<h1>Pindai kode QR</h1>')).qr).toBe(true);
    expect(detectDom(dom('<h1>Scan QR</h1><div id="pane-side"></div>')).qr).toBe(false);
  });
  it('loading and offline', () => {
    expect(detectDom(dom('<progress></progress>')).loading).toBe(true);
    expect(detectDom(dom('<div role="status">Memuat chat Anda</div>')).loading).toBe(true);
    expect(detectDom(dom('<div role="alert">Mencoba menyambung</div>')).offline).toBe(true);
    expect(detectDom(dom('<div role="alert">Computer not connected</div>')).offline).toBe(true);
    expect(detectDom(dom('<p>halo</p>'))).toEqual({ qr: false, loading: false, offline: false, chatList: false });
  });
});

describe('decideState', () => {
  const base = { qr: false, loading: false, offline: false, chatList: false };
  it('qr / loading / online / offline / unknown', () => {
    expect(decideState({ ...base, qr: true }, null, true)).toBe('qr');
    expect(decideState({ ...base, loading: true }, null, true)).toBe('loading');
    expect(decideState({ ...base, chatList: true }, ready, true)).toBe('online');
    expect(decideState(base, ready, true)).toBe('online');
    expect(decideState({ ...base, chatList: true }, ready, false)).toBe('offline');
    expect(decideState({ ...base, offline: true, chatList: true }, ready, true)).toBe('offline');
    expect(decideState(base, null, true)).toBe('unknown');
    expect(decideState(base, null, false)).toBe('offline');
  });
  it('loading while store not ready', () => {
    expect(decideState({ ...base, chatList: true, loading: true }, { store: false, accountId: null }, true)).toBe('loading');
  });
});

describe('unreadFromTitle', () => {
  it('parses', () => {
    expect(unreadFromTitle('(3) WhatsApp')).toBe(3);
    expect(unreadFromTitle('WhatsApp')).toBe(0);
  });
});
