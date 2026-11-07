import type { ChatOpenMsg, ChatOpenResult } from '../shared/messages';

const ERR: Record<string, string> = {
  'no-tab': 'Tab WhatsApp Web belum terbuka. Buka web.whatsapp.com dulu.',
  'no-receiver': 'Tab WhatsApp belum memuat ekstensi. Muat ulang tab WhatsApp lalu coba lagi.',
  'wrong-account': 'Chat ini milik akun lain yang sedang tidak aktif di tab mana pun. Buka akun itu dari Hub Akun, lalu coba lagi.',
  'chat-not-found': 'Chat tidak ditemukan di WhatsApp (mungkin sudah dihapus atau belum dimuat).',
  'open-failed': 'WhatsApp tidak mau membuka chat ini. Cari manual dari daftar chat.',
  adapter: 'Adapter WhatsApp belum siap. Tunggu daftar chat tampil lalu coba lagi.',
};

/** Open the chat room of a row (Belum dibalas / Lead panas) in the WhatsApp tab; returns a user-facing message. */
export async function openChatRoom(row: { accountId: string; chatId: string; phone?: string }): Promise<{ ok: boolean; text: string }> {
  const msg: ChatOpenMsg = { kind: 'ui:chat-open', accountId: row.accountId || undefined, chatId: row.chatId, phone: row.phone || undefined };
  try {
    const r = (await chrome.runtime.sendMessage(msg)) as ChatOpenResult | undefined;
    if (r?.ok) return { ok: true, text: r.method === 'deep-link' ? 'Membuka chat (halaman WhatsApp dimuat ulang)…' : 'Chat dibuka di WhatsApp.' };
    return { ok: false, text: ERR[r?.error ?? ''] ?? `Gagal membuka chat (${r?.error ?? 'tidak ada jawaban'}).` };
  } catch { return { ok: false, text: 'Gagal menghubungi ekstensi.' }; }
}
