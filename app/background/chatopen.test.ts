import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleChatOpen, isChatOpenMsg } from './chatopen';

type Tab = { id: number; active?: boolean; windowId?: number };
function fakeChrome(tabs: Tab[], answers: Record<number, unknown>) {
  const updated: number[] = [];
  const asked: number[] = [];
  vi.stubGlobal('chrome', {
    tabs: {
      query: vi.fn(async () => tabs),
      sendMessage: vi.fn(async (id: number) => {
        asked.push(id);
        const a = answers[id];
        if (a instanceof Error) throw a;
        return a;
      }),
      update: vi.fn(async (id: number) => { updated.push(id); }),
    },
    windows: { update: vi.fn(async () => undefined) },
  });
  return { updated, asked };
}

afterEach(() => vi.unstubAllGlobals());

describe('buka chat dari Analitik/CRM', () => {
  it('mengenali pesan', () => {
    expect(isChatOpenMsg({ kind: 'ui:chat-open', chatId: 'x' })).toBe(true);
    expect(isChatOpenMsg({ kind: 'ui:open' })).toBe(false);
    expect(isChatOpenMsg(null)).toBe(false);
  });

  it('tanpa tab WhatsApp -> no-tab', async () => {
    fakeChrome([], {});
    expect(await handleChatOpen({ kind: 'ui:chat-open', chatId: '6281@c.us' })).toEqual({ ok: false, error: 'no-tab' });
  });

  it('tab akun lain menolak, tab berikutnya berhasil lalu difokuskan', async () => {
    const c = fakeChrome([{ id: 1, active: true }, { id: 2 }], { 1: { ok: false, error: 'wrong-account' }, 2: { ok: true, method: 'WAWebCmd' } });
    const r = await handleChatOpen({ kind: 'ui:chat-open', accountId: 'A', chatId: '6281@c.us' });
    expect(r).toEqual({ ok: true, method: 'WAWebCmd' });
    expect(c.asked).toEqual([1, 2]);
    expect(c.updated).toEqual([2]);
  });

  it('tab pemanggil dicoba lebih dulu', async () => {
    const c = fakeChrome([{ id: 1, active: true }, { id: 7 }], { 1: { ok: true }, 7: { ok: true } });
    await handleChatOpen({ kind: 'ui:chat-open', chatId: 'a@c.us' }, { tab: { id: 7 } } as chrome.runtime.MessageSender);
    expect(c.asked[0]).toBe(7);
  });

  it('semua menolak -> galat terakhir dilaporkan; tab tanpa penerima dilewati', async () => {
    fakeChrome([{ id: 1 }, { id: 2 }], { 1: new Error('no receiver'), 2: { ok: false, error: 'wrong-account' } });
    expect(await handleChatOpen({ kind: 'ui:chat-open', accountId: 'A', chatId: 'a@c.us' })).toEqual({ ok: false, error: 'wrong-account' });
    fakeChrome([{ id: 1 }], { 1: new Error('no receiver') });
    expect(await handleChatOpen({ kind: 'ui:chat-open', chatId: 'a@c.us' })).toEqual({ ok: false, error: 'no-receiver' });
  });

  it('menolak chatId kosong atau terlalu panjang', async () => {
    fakeChrome([{ id: 1 }], { 1: { ok: true } });
    expect((await handleChatOpen({ kind: 'ui:chat-open', chatId: '' })).error).toBe('bad-chat');
    expect((await handleChatOpen({ kind: 'ui:chat-open', chatId: 'x'.repeat(201) })).error).toBe('bad-chat');
  });
});
