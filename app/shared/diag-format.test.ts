import { describe, expect, it } from 'vitest';
import { diagError, formatProbe, formatSelfTest } from './diag-format';

describe('diag-format', () => {
  const r = {
    store: true, accountId: '62@c.us', hidden: false,
    items: [
      { group: 'Kirim pesan', name: 'WAWebChatSendMessages', found: true, type: 'object' },
      { group: 'Kirim pesan', name: 'WAWebChatSendMessages.sendTextMsgToChat', found: true, type: 'function' },
      { group: 'Grup', name: 'WAWebGroupQueryJob', found: false, type: '-' },
    ],
  };
  it('formats a check list', () => {
    const t = formatProbe(r);
    expect(t).toContain('ADA (1 fungsi');
    expect(t).toContain('✔ WAWebChatSendMessages.sendTextMsgToChat (function)');
    expect(t).toContain('✘ WAWebGroupQueryJob (tidak ditemukan)');
  });
  it('says none when no send function exists', () => {
    expect(formatProbe({ ...r, items: [r.items[2]] })).toContain('TIDAK ADA');
  });
  it('self test and errors', () => {
    expect(formatSelfTest({ ok: true, method: 'chat.sendMessage', verified: false })).toContain('belum terverifikasi');
    expect(formatSelfTest({ error: 'no-tab' })).toContain('web.whatsapp.com');
    expect(diagError('zzz')).toBe('zzz');
  });
});
